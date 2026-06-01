"""
AML Suspicious Pattern Detector — Python microservice
Uses IsolationForest + velocity analysis to flag anomalies
"""
import os
import logging
import time
from typing import Optional

import numpy as np
import pandas as pd
import networkx as nx
from datetime import timedelta
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pythonjsonlogger import jsonlogger
from pydantic import BaseModel
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

# ─── Structured JSON logging ──────────────────────────────────────────────────

handler = logging.StreamHandler()
handler.setFormatter(jsonlogger.JsonFormatter(
    fmt="%(asctime)s %(levelname)s %(name)s %(message)s"
))
logging.root.setLevel(logging.INFO)
logging.root.handlers = [handler]
logger = logging.getLogger("aml.detector")

# ─── Thresholds from environment ─────────────────────────────────────────────
# Defaults match EU/EEA €10k reporting threshold. Override per deployment.

SMURFING_THRESHOLD      = float(os.getenv("AML_SMURFING_THRESHOLD",      "9000"))
VELOCITY_WINDOW_HOURS   = int(  os.getenv("AML_VELOCITY_WINDOW_HOURS",   "24"))
VELOCITY_COUNT_THRESHOLD= int(  os.getenv("AML_VELOCITY_COUNT_THRESHOLD", "5"))
ROUND_TRIP_HOURS        = int(  os.getenv("AML_ROUND_TRIP_HOURS",        "72"))

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="AML Pattern Detector",
    description="Anomaly detection microservice for AML suspicious pattern analysis",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - t0) * 1000, 1)
    logger.info("request", extra={
        "method": request.method,
        "path": request.url.path,
        "status": response.status_code,
        "duration_ms": duration_ms,
    })
    return response

# ─── Pydantic Models ──────────────────────────────────────────────────────────

class Transaction(BaseModel):
    tx_id: str
    from_account: str
    to_account: str
    amount: float
    currency: str = "EUR"
    date: str
    type: Optional[str] = None
    country: Optional[str] = None
    description: Optional[str] = None


class AnalyzeRequest(BaseModel):
    upload_id: str
    transactions: list[Transaction]


class AnomalyResult(BaseModel):
    tx_id: str
    anomaly_score: float
    iso_forest_score: float
    velocity_score: float
    pattern_type: str
    is_anomaly: bool
    features: dict


class AnalyzeResponse(BaseModel):
    upload_id: str
    total: int
    anomaly_count: int
    results: list[AnomalyResult]
    graph_stats: dict

# ─── Detection Logic ─────────────────────────────────────────────────────────

def compute_velocity_scores(df: pd.DataFrame) -> pd.Series:
    """
    Count transactions per account in a rolling VELOCITY_WINDOW_HOURS window.
    Vectorized per-account using groupby + searchsorted instead of nested loops.
    """
    df2 = df[["from_account", "date"]].copy()
    df2["date"] = pd.to_datetime(df2["date"])
    scores = pd.Series(0.0, index=df2.index)

    window = pd.Timedelta(hours=VELOCITY_WINDOW_HOURS)
    dates_ns = window.value  # nanoseconds

    for _, group in df2.groupby("from_account"):
        sorted_dates = group["date"].sort_values()
        ts = sorted_dates.values.astype(np.int64)
        # For each point, binary-search the start of the window
        starts = np.searchsorted(ts, ts - dates_ns, side="left")
        counts = np.arange(len(ts)) - starts + 1
        # Re-index back to original order
        scores[sorted_dates.index] = np.minimum(counts / 10.0, 1.0)

    return scores


def detect_round_tripping(df: pd.DataFrame) -> dict[str, bool]:
    """
    Detect A→B / B→A flows within ROUND_TRIP_HOURS using a vectorized merge.
    O(n log n) via pandas join instead of O(n²) nested loops.
    """
    df2 = df[["tx_id", "from_account", "to_account", "date"]].copy()
    df2["date"] = pd.to_datetime(df2["date"])

    # Build reverse-flow lookup: swap from/to, call reversed flow's date "rev_date"
    rev = df2[["from_account", "to_account", "date"]].rename(
        columns={"from_account": "to_account", "to_account": "from_account", "date": "rev_date"}
    )

    merged = df2.merge(rev, on=["from_account", "to_account"])
    window = pd.Timedelta(hours=ROUND_TRIP_HOURS)
    hits = merged[
        (merged["rev_date"] > merged["date"]) &
        (merged["rev_date"] <= merged["date"] + window)
    ]

    flagged = set(hits["tx_id"])
    return {tx_id: tx_id in flagged for tx_id in df["tx_id"]}


def build_transaction_graph(df: pd.DataFrame) -> nx.DiGraph:
    G = nx.DiGraph()
    for _, row in df.iterrows():
        if G.has_edge(row["from_account"], row["to_account"]):
            G[row["from_account"]][row["to_account"]]["weight"] += row["amount"]
            G[row["from_account"]][row["to_account"]]["count"] += 1
        else:
            G.add_edge(row["from_account"], row["to_account"],
                       weight=row["amount"], count=1)
    return G


def classify_pattern(tx_id: str, amount: float, velocity_score: float,
                     iso_score: float, round_trips: dict) -> str:
    if round_trips.get(tx_id, False):
        return "ROUND_TRIPPING"
    if velocity_score > 0.7:
        return "UNUSUAL_VELOCITY"
    if SMURFING_THRESHOLD * 0.85 <= amount <= SMURFING_THRESHOLD * 1.05:
        return "SMURFING"
    if iso_score < -0.3:
        return "LAYERING"
    return "UNKNOWN"

# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "aml-detector", "config": {
        "smurfing_threshold": SMURFING_THRESHOLD,
        "velocity_window_hours": VELOCITY_WINDOW_HOURS,
        "round_trip_hours": ROUND_TRIP_HOURS,
    }}


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    if len(req.transactions) < 2:
        raise HTTPException(400, "Need at least 2 transactions to analyze")

    t0 = time.perf_counter()
    df = pd.DataFrame([t.model_dump() for t in req.transactions])
    logger.info("analysis_start", extra={
        "upload_id": req.upload_id,
        "tx_count": len(df),
    })

    # ── Feature engineering ──────────────────────────────────────────────────
    df["date_ts"] = pd.to_datetime(df["date"]).astype(np.int64) // 10**9
    df["velocity_score"] = compute_velocity_scores(df)
    round_trips = detect_round_tripping(df)

    features = df[["amount", "date_ts", "velocity_score"]].copy()
    X = StandardScaler().fit_transform(features)

    # ── IsolationForest ──────────────────────────────────────────────────────
    contamination = min(0.15, max(0.01, 10 / len(df)))
    iso = IsolationForest(n_estimators=200, contamination=contamination, random_state=42)
    iso.fit(X)
    raw_scores  = iso.decision_function(X)
    predictions = iso.predict(X)

    iso_norm = 1 - (raw_scores - raw_scores.min()) / (raw_scores.max() - raw_scores.min() + 1e-9)

    # ── Graph stats ──────────────────────────────────────────────────────────
    G = build_transaction_graph(df)
    try:
        pagerank = nx.pagerank(G, weight="weight")
        top_accounts = sorted(pagerank, key=pagerank.get, reverse=True)[:5]
    except Exception:
        top_accounts = []

    graph_stats = {
        "nodes": G.number_of_nodes(),
        "edges": G.number_of_edges(),
        "top_accounts_by_flow": top_accounts,
        "density": nx.density(G),
    }

    # ── Build results ────────────────────────────────────────────────────────
    results = []
    for i, row in df.iterrows():
        combined = 0.6 * iso_norm[i] + 0.4 * row["velocity_score"]
        pattern = classify_pattern(
            row["tx_id"], row["amount"], row["velocity_score"],
            raw_scores[i], round_trips
        )
        results.append(AnomalyResult(
            tx_id=row["tx_id"],
            anomaly_score=round(float(combined), 4),
            iso_forest_score=round(float(raw_scores[i]), 4),
            velocity_score=round(float(row["velocity_score"]), 4),
            pattern_type=pattern,
            is_anomaly=predictions[i] == -1,
            features={
                "amount": row["amount"],
                "currency": row["currency"],
                "velocity_score": round(float(row["velocity_score"]), 4),
                "is_round_trip": round_trips.get(row["tx_id"], False),
                "near_smurfing_threshold": bool(
                    SMURFING_THRESHOLD * 0.85 <= row["amount"] <= SMURFING_THRESHOLD * 1.05
                ),
            }
        ))

    anomalies = [r for r in results if r.is_anomaly]
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)

    logger.info("analysis_complete", extra={
        "upload_id": req.upload_id,
        "tx_count": len(results),
        "anomaly_count": len(anomalies),
        "contamination": round(contamination, 4),
        "elapsed_ms": elapsed_ms,
    })

    return AnalyzeResponse(
        upload_id=req.upload_id,
        total=len(results),
        anomaly_count=len(anomalies),
        results=results,
        graph_stats=graph_stats,
    )
