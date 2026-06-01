"""
AML Suspicious Pattern Detector — Python microservice
Uses IsolationForest + velocity analysis to flag anomalies
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import networkx as nx
from datetime import datetime, timedelta
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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

# ─── Pydantic Models ──────────────────────────────────────────────────────────

class Transaction(BaseModel):
    tx_id: str
    from_account: str
    to_account: str
    amount: float
    currency: str = "EUR"
    date: str  # ISO 8601
    type: Optional[str] = None
    country: Optional[str] = None
    description: Optional[str] = None


class AnalyzeRequest(BaseModel):
    upload_id: str
    transactions: list[Transaction]


class AnomalyResult(BaseModel):
    tx_id: str
    anomaly_score: float       # 0–1, higher = more suspicious
    iso_forest_score: float    # raw IsolationForest decision score
    velocity_score: float      # 0–1, transaction velocity anomaly
    pattern_type: str
    is_anomaly: bool
    features: dict             # for explainability


class AnalyzeResponse(BaseModel):
    upload_id: str
    total: int
    anomaly_count: int
    results: list[AnomalyResult]
    graph_stats: dict          # network analysis stats


# ─── Thresholds ──────────────────────────────────────────────────────────────

SMURFING_THRESHOLD = 9_000     # just below €10k reporting threshold
VELOCITY_WINDOW_HOURS = 24
VELOCITY_COUNT_THRESHOLD = 5   # >5 tx from same account in 24h = suspicious
ROUND_TRIP_HOURS = 72          # money returns within 3 days


# ─── Detection Logic ─────────────────────────────────────────────────────────

def compute_velocity_scores(df: pd.DataFrame) -> pd.Series:
    """Count how many transactions each account made in a rolling 24h window."""
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date")

    velocity_scores = pd.Series(0.0, index=df.index)

    for idx, row in df.iterrows():
        window_start = row["date"] - timedelta(hours=VELOCITY_WINDOW_HOURS)
        same_account_in_window = df[
            (df["from_account"] == row["from_account"]) &
            (df["date"] >= window_start) &
            (df["date"] <= row["date"])
        ]
        count = len(same_account_in_window)
        # normalize: >10 tx = score 1.0
        velocity_scores[idx] = min(count / 10.0, 1.0)

    return velocity_scores


def detect_round_tripping(df: pd.DataFrame) -> dict[str, bool]:
    """Detect if money flows out and comes back within ROUND_TRIP_HOURS."""
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])
    round_trip = {}

    for idx, row in df.iterrows():
        window_end = row["date"] + timedelta(hours=ROUND_TRIP_HOURS)
        # look for reverse flow: A→B then B→A within window
        reverse = df[
            (df["from_account"] == row["to_account"]) &
            (df["to_account"] == row["from_account"]) &
            (df["date"] > row["date"]) &
            (df["date"] <= window_end)
        ]
        round_trip[row["tx_id"]] = len(reverse) > 0

    return round_trip


def build_transaction_graph(df: pd.DataFrame) -> nx.DiGraph:
    """Build directed graph of account→account flows."""
    G = nx.DiGraph()
    for _, row in df.iterrows():
        if G.has_edge(row["from_account"], row["to_account"]):
            G[row["from_account"]][row["to_account"]]["weight"] += row["amount"]
            G[row["from_account"]][row["to_account"]]["count"] += 1
        else:
            G.add_edge(
                row["from_account"],
                row["to_account"],
                weight=row["amount"],
                count=1,
            )
    return G


def classify_pattern(row: dict, round_trips: dict) -> str:
    """Assign a human-readable pattern type based on feature values."""
    if round_trips.get(row["tx_id"], False):
        return "ROUND_TRIPPING"
    if row["velocity_score"] > 0.7:
        return "UNUSUAL_VELOCITY"
    if SMURFING_THRESHOLD * 0.85 <= row["amount"] <= SMURFING_THRESHOLD * 1.05:
        return "SMURFING"
    if row["iso_forest_score"] < -0.3:
        return "LAYERING"
    return "UNKNOWN"


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "aml-detector"}


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    if len(req.transactions) < 2:
        raise HTTPException(400, "Need at least 2 transactions to analyze")

    df = pd.DataFrame([t.model_dump() for t in req.transactions])
    logger.info(f"Analyzing {len(df)} transactions for upload {req.upload_id}")

    # ── Feature engineering ─────────────────────────────────────────────────
    df["date_ts"] = pd.to_datetime(df["date"]).astype(np.int64) // 10**9
    df["velocity_score"] = compute_velocity_scores(df)
    round_trips = detect_round_tripping(df)

    # Amount buckets for IsolationForest
    features = df[["amount", "date_ts", "velocity_score"]].copy()
    scaler = StandardScaler()
    X = scaler.fit_transform(features)

    # ── IsolationForest ─────────────────────────────────────────────────────
    contamination = min(0.15, max(0.01, 10 / len(df)))  # adaptive contamination
    iso = IsolationForest(
        n_estimators=200,
        contamination=contamination,
        random_state=42,
    )
    iso.fit(X)
    raw_scores = iso.decision_function(X)      # more negative = more anomalous
    predictions = iso.predict(X)               # -1 = anomaly, 1 = normal

    # ── Normalize iso score to 0–1 (1 = most anomalous) ────────────────────
    iso_norm = 1 - (raw_scores - raw_scores.min()) / (raw_scores.max() - raw_scores.min() + 1e-9)

    # ── Build graph stats ───────────────────────────────────────────────────
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
        is_anomaly = predictions[i] == -1
        # combined score: 60% iso + 40% velocity
        combined = 0.6 * iso_norm[i] + 0.4 * row["velocity_score"]
        pattern = classify_pattern(
            {"tx_id": row["tx_id"], "amount": row["amount"],
             "velocity_score": row["velocity_score"], "iso_forest_score": raw_scores[i]},
            round_trips
        )

        results.append(AnomalyResult(
            tx_id=row["tx_id"],
            anomaly_score=round(float(combined), 4),
            iso_forest_score=round(float(raw_scores[i]), 4),
            velocity_score=round(float(row["velocity_score"]), 4),
            pattern_type=pattern,
            is_anomaly=is_anomaly,
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
    logger.info(f"Found {len(anomalies)} anomalies out of {len(results)}")

    return AnalyzeResponse(
        upload_id=req.upload_id,
        total=len(results),
        anomaly_count=len(anomalies),
        results=results,
        graph_stats=graph_stats,
    )
