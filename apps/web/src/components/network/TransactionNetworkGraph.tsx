"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { useAuth } from "@/lib/auth";
import type { AccountNode, TransactionEdge } from "@/types/aml";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

interface GraphData {
  nodes: AccountNode[];
  edges: TransactionEdge[];
}

// D3 simulation requires mutable x/y
type SimNode = AccountNode & d3.SimulationNodeDatum;
type SimLink = Omit<TransactionEdge, "source" | "target"> & {
  source: SimNode | string;
  target: SimNode | string;
};

interface Props {
  uploadId: string;
}

function nodeRiskColor(riskScore: number): string {
  if (riskScore >= 75) return "#7f1d1d";
  if (riskScore >= 45) return "#78350f";
  if (riskScore > 0) return "#365314";
  return "#1e293b";
}

function nodeStrokeColor(riskScore: number): string {
  if (riskScore >= 75) return "#991b1b";
  if (riskScore >= 45) return "#92400e";
  if (riskScore > 0) return "#3f6212";
  return "#334155";
}

function nodeRadius(node: AccountNode): number {
  const volume = node.totalSent + node.totalReceived;
  return Math.max(8, Math.min(28, 8 + Math.sqrt(volume / 1000)));
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  content: React.ReactNode;
}

function buildGraphFromCache(
  transactions: Array<{ id: string; txId: string; fromAccount: string; toAccount: string; amount: number; currency: string; txDate: string }>,
  alerts: Array<{ transactionId: string | null; patternType: string; riskScore: number }>
): GraphData {
  const alertByTxId = new Map(alerts.map((a) => [a.transactionId, a]));
  const nodeMap = new Map<string, AccountNode>();
  const ensureNode = (id: string, currency: string): AccountNode => {
    if (!nodeMap.has(id)) nodeMap.set(id, { id, riskScore: 0, flaggedCount: 0, totalSent: 0, totalReceived: 0, currency });
    return nodeMap.get(id)!;
  };
  const edges: TransactionEdge[] = transactions.map((tx) => {
    const alert = alertByTxId.get(tx.txId);
    const from = ensureNode(tx.fromAccount, tx.currency);
    const to = ensureNode(tx.toAccount, tx.currency);
    from.totalSent += tx.amount;
    to.totalReceived += tx.amount;
    if (alert) {
      if (alert.riskScore > from.riskScore) from.riskScore = alert.riskScore;
      if (alert.riskScore > to.riskScore) to.riskScore = alert.riskScore;
      from.flaggedCount += 1;
    }
    return { id: tx.id, txId: tx.txId, source: tx.fromAccount, target: tx.toAccount, amount: tx.amount, currency: tx.currency, date: tx.txDate, isSuspicious: !!alert, patternType: alert?.patternType as import("@/types/aml").PatternType | undefined, riskScore: alert?.riskScore };
  });
  return { nodes: Array.from(nodeMap.values()), edges };
}

export function TransactionNetworkGraph({ uploadId }: Props) {
  const { authHeaders } = useAuth();
  const svgRef = useRef<SVGSVGElement>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    content: null,
  });
  const [stats, setStats] = useState({ nodes: 0, edges: 0, suspicious: 0 });

  useEffect(() => {
    const cached = sessionStorage.getItem(`aml_${uploadId}`);
    if (cached) {
      try {
        const data = JSON.parse(cached) as {
          alerts: Array<{ transactionId: string | null; patternType: string; riskScore: number }>;
          transactions: Array<{ id: string; txId: string; fromAccount: string; toAccount: string; amount: number; currency: string; txDate: string }>;
        };
        const d = buildGraphFromCache(data.transactions, data.alerts);
        setGraphData(d);
        setStats({ nodes: d.nodes.length, edges: d.edges.length, suspicious: d.edges.filter((e) => e.isSuspicious).length });
        setLoading(false);
        return;
      } catch {}
    }
    fetch(`${API_URL}/api/analysis/${uploadId}/graph`, { headers: authHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error(`Graph API returned ${r.status}`);
        return r.json() as Promise<GraphData>;
      })
      .then((d) => {
        setGraphData(d);
        setStats({ nodes: d.nodes.length, edges: d.edges.length, suspicious: d.edges.filter((e) => e.isSuspicious).length });
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [uploadId]);

  useEffect(() => {
    if (!graphData || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 500;

    const root = svg.append("g");

    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.15, 4])
        .on("zoom", (event) => root.attr("transform", event.transform))
    );

    // Arrow markers
    const defs = svg.append("defs");
    const mkMarker = (id: string, color: string) => {
      defs.append("marker")
        .attr("id", id)
        .attr("viewBox", "0 -4 10 8")
        .attr("refX", 20)
        .attr("refY", 0)
        .attr("markerWidth", 5)
        .attr("markerHeight", 5)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-4L10,0L0,4")
        .attr("fill", color);
    };
    mkMarker("net-arrow-normal", "#1e293b");
    mkMarker("net-arrow-suspicious", "#7f1d1d");

    const nodes: SimNode[] = graphData.nodes.map((n) => ({ ...n }));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const links: SimLink[] = graphData.edges
      .filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
      .map((e) => ({ ...e }));

    const simulation = d3
      .forceSimulation<SimNode>(nodes)
      .force(
        "link",
        d3.forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(110)
          .strength(0.35)
      )
      .force("charge", d3.forceManyBody().strength(-350))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<SimNode>().radius((d) => nodeRadius(d) + 10));

    // Links
    const linkG = root.append("g");
    const linkEl = linkG
      .selectAll<SVGLineElement, SimLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", (d) => d.isSuspicious ? "#7f1d1d" : "#1e293b")
      .attr("stroke-width", (d) => {
        const w = Math.max(1, Math.min(3.5, d.amount / 10000));
        return d.isSuspicious ? w + 0.5 : w;
      })
      .attr("stroke-opacity", (d) => d.isSuspicious ? 0.85 : 0.4)
      .attr("marker-end", (d) => `url(#${d.isSuspicious ? "net-arrow-suspicious" : "net-arrow-normal"})`)
      .style("cursor", "pointer");

    // Nodes
    const nodeG = root.append("g");
    const nodeEl = nodeG
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .style("cursor", "grab");

    nodeEl.append("circle")
      .attr("r", (d) => nodeRadius(d))
      .attr("fill", (d) => nodeRiskColor(d.riskScore))
      .attr("stroke", (d) => nodeStrokeColor(d.riskScore))
      .attr("stroke-width", 1.5);

    // Flag count badge
    nodeEl.filter((d) => d.flaggedCount > 0)
      .append("text")
      .text((d) => d.flaggedCount)
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", 9)
      .attr("font-weight", "600")
      .attr("fill", (d) => d.riskScore >= 75 ? "#fca5a5" : "#fbbf24")
      .style("pointer-events", "none");

    // Node labels
    nodeEl.append("text")
      .text((d) => d.id.length > 10 ? `${d.id.slice(0, 8)}…` : d.id)
      .attr("text-anchor", "middle")
      .attr("dy", (d) => nodeRadius(d) + 12)
      .attr("font-size", 10)
      .attr("font-family", "monospace")
      .attr("fill", "#64748b")
      .style("user-select", "none")
      .style("pointer-events", "none");

    // Drag
    const drag = d3.drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    nodeEl.call(drag);

    // Node tooltip
    nodeEl
      .on("mouseenter", (event, d) => {
        const rect = svgRef.current!.getBoundingClientRect();
        setTooltip({
          visible: true,
          x: event.clientX - rect.left + 14,
          y: event.clientY - rect.top - 10,
          content: (
            <div className="bg-slate-900 border border-slate-700 rounded-md p-3 shadow-lg text-xs min-w-44">
              <p className="font-mono font-semibold text-slate-200 mb-2">{d.id}</p>
              <dl className="space-y-1 text-slate-400">
                <div className="flex justify-between gap-4">
                  <dt>Risk score</dt>
                  <dd className={`font-semibold ${d.riskScore >= 75 ? "text-red-400" : d.riskScore >= 45 ? "text-amber-400" : "text-slate-300"}`}>
                    {d.riskScore > 0 ? d.riskScore : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Flagged txns</dt>
                  <dd className="text-slate-300">{d.flaggedCount}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Total sent</dt>
                  <dd className="text-slate-300 font-mono">{d.totalSent.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Total received</dt>
                  <dd className="text-slate-300 font-mono">{d.totalReceived.toLocaleString()}</dd>
                </div>
              </dl>
            </div>
          ),
        });
      })
      .on("mouseleave", () => setTooltip((t) => ({ ...t, visible: false })));

    // Edge tooltip
    linkEl
      .on("mouseenter", (event, d) => {
        const rect = svgRef.current!.getBoundingClientRect();
        const sourceId = typeof d.source === "object" ? (d.source as SimNode).id : String(d.source);
        const targetId = typeof d.target === "object" ? (d.target as SimNode).id : String(d.target);
        setTooltip({
          visible: true,
          x: event.clientX - rect.left + 14,
          y: event.clientY - rect.top - 10,
          content: (
            <div className="bg-slate-900 border border-slate-700 rounded-md p-3 shadow-lg text-xs min-w-48">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-slate-400">{d.txId}</span>
                {d.isSuspicious && (
                  <span className="px-1.5 py-0.5 rounded bg-red-950/40 border border-red-800 text-red-400 text-xs">
                    {d.patternType?.replace(/_/g, " ") ?? "Flagged"}
                  </span>
                )}
              </div>
              <dl className="space-y-1 text-slate-400">
                <div className="flex justify-between gap-4">
                  <dt>From</dt>
                  <dd className="font-mono text-slate-300">{sourceId}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>To</dt>
                  <dd className="font-mono text-slate-300">{targetId}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Amount</dt>
                  <dd className="font-mono font-semibold text-slate-200">
                    {d.amount.toLocaleString()} {d.currency}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Date</dt>
                  <dd className="text-slate-300">{d.date}</dd>
                </div>
                {d.riskScore !== undefined && (
                  <div className="flex justify-between gap-4">
                    <dt>Risk score</dt>
                    <dd className={d.riskScore >= 75 ? "text-red-400" : "text-amber-400"}>
                      {d.riskScore}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          ),
        });
      })
      .on("mouseleave", () => setTooltip((t) => ({ ...t, visible: false })));

    // Tick
    simulation.on("tick", () => {
      linkEl
        .attr("x1", (d) => (d.source as SimNode).x ?? 0)
        .attr("y1", (d) => (d.source as SimNode).y ?? 0)
        .attr("x2", (d) => (d.target as SimNode).x ?? 0)
        .attr("y2", (d) => (d.target as SimNode).y ?? 0);
      nodeEl.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => { simulation.stop(); };
  }, [graphData]);

  if (loading) {
    return (
      <div className="bg-slate-900/40 border border-slate-800 rounded-md flex items-center justify-center gap-3 text-slate-400" style={{ height: 480 }}>
        <div className="w-4 h-4 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
        <span className="text-sm">Loading transaction network...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-900/40 border border-slate-800 rounded-md flex items-center justify-center" style={{ height: 480 }}>
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-md overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-200">Transaction Network</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Account-level flow graph — drag nodes, scroll to zoom
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>
            <span className="font-mono text-slate-300">{stats.nodes}</span> accounts
          </span>
          <span>
            <span className="font-mono text-slate-300">{stats.edges}</span> transactions
          </span>
          <span>
            <span className="font-mono text-red-400">{stats.suspicious}</span> flagged
          </span>
        </div>
      </div>

      {/* Graph canvas */}
      <div className="relative" style={{ height: 500 }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          className="bg-[#070b12]"
        />
        {tooltip.visible && (
          <div
            className="absolute z-10 pointer-events-none"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            {tooltip.content}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="px-4 py-2.5 border-t border-slate-800 flex items-center gap-5 text-xs text-slate-500">
        <span className="text-slate-400 font-medium">Risk:</span>
        {[
          { label: "High", color: "#991b1b" },
          { label: "Medium", color: "#92400e" },
          { label: "Low", color: "#3f6212" },
          { label: "Clean", color: "#334155" },
        ].map(({ label, color }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-full border"
              style={{ borderColor: color, background: color + "44" }}
            />
            {label}
          </span>
        ))}
        <span className="ml-2 flex items-center gap-1.5">
          <span className="inline-block w-6 h-px bg-red-900" />
          Flagged
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-6 h-px bg-slate-700" />
          Normal
        </span>
      </div>
    </div>
  );
}
