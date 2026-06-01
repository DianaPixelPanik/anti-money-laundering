"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type { GraphData, GraphNode, GraphEdge } from "@aml/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// D3 requires mutable x/y on simulation nodes
type SimNode = GraphNode & d3.SimulationNodeDatum;
type SimLink = Omit<GraphEdge, "source" | "target"> & {
  source: SimNode | string;
  target: SimNode | string;
};

function nodeColor(riskScore: number): string {
  if (riskScore >= 80) return "#ef4444";
  if (riskScore >= 55) return "#f97316";
  if (riskScore > 0)   return "#eab308";
  return "#4b5563";
}

function nodeRadius(node: GraphNode): number {
  const volume = node.totalSent + node.totalReceived;
  return Math.max(10, Math.min(32, 10 + Math.sqrt(volume / 1000)));
}

interface Props {
  uploadId: string;
}

export function TransactionGraph({ uploadId }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    content: React.ReactNode;
  }>({ visible: false, x: 0, y: 0, content: null });
  const [stats, setStats] = useState({ nodes: 0, edges: 0, suspicious: 0 });

  useEffect(() => {
    fetch(`${API_URL}/api/analysis/${uploadId}/graph`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load graph data");
        return r.json() as Promise<GraphData>;
      })
      .then((d) => {
        setData(d);
        setStats({
          nodes: d.nodes.length,
          edges: d.edges.length,
          suspicious: d.edges.filter((e) => e.isSuspicious).length,
        });
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [uploadId]);

  useEffect(() => {
    if (!data || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth || 900;
    const height = svgRef.current.clientHeight || 600;

    // Zoom container
    const root = svg.append("g");

    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on("zoom", (event) => root.attr("transform", event.transform))
    );

    // Arrow markers
    const defs = svg.append("defs");

    const markerFor = (id: string, color: string) => {
      defs.append("marker")
        .attr("id", id)
        .attr("viewBox", "0 -4 10 8")
        .attr("refX", 18)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-4L10,0L0,4")
        .attr("fill", color);
    };

    markerFor("arrow-normal",    "#374151");
    markerFor("arrow-low",       "#ca8a04");
    markerFor("arrow-medium",    "#ea580c");
    markerFor("arrow-high",      "#dc2626");

    const arrowId = (riskScore?: number) => {
      if (!riskScore)        return "arrow-normal";
      if (riskScore >= 80)   return "arrow-high";
      if (riskScore >= 55)   return "arrow-medium";
      return "arrow-low";
    };

    // Deep-copy nodes/links for simulation
    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const links: SimLink[] = data.edges
      .filter((e) => nodeById.has(e.source as string) && nodeById.has(e.target as string))
      .map((e) => ({ ...e }));

    // Force simulation
    const simulation = d3
      .forceSimulation<SimNode>(nodes)
      .force("link", d3.forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(120)
        .strength(0.4))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<SimNode>().radius((d) => nodeRadius(d) + 12));

    // Edges
    const linkGroup = root.append("g").attr("class", "links");
    const linkEl = linkGroup
      .selectAll<SVGLineElement, SimLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", (d) => {
        if (!d.isSuspicious) return "#1f2937";
        if ((d.riskScore ?? 0) >= 80) return "#dc2626";
        if ((d.riskScore ?? 0) >= 55) return "#ea580c";
        return "#ca8a04";
      })
      .attr("stroke-width", (d) => {
        const w = Math.max(1, Math.min(4, (d.amount ?? 0) / 5000));
        return d.isSuspicious ? w + 0.5 : w;
      })
      .attr("stroke-opacity", (d) => d.isSuspicious ? 0.9 : 0.35)
      .attr("marker-end", (d) => `url(#${arrowId(d.riskScore)})`)
      .style("cursor", "pointer");

    // Nodes group
    const nodeGroup = root.append("g").attr("class", "nodes");
    const nodeEl = nodeGroup
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer");

    // Node shadow glow for high-risk
    nodeEl.filter((d) => d.riskScore >= 55)
      .append("circle")
      .attr("r", (d) => nodeRadius(d) + 6)
      .attr("fill", (d) => nodeColor(d.riskScore))
      .attr("opacity", 0.15);

    // Node circle
    nodeEl.append("circle")
      .attr("r", (d) => nodeRadius(d))
      .attr("fill", (d) => `${nodeColor(d.riskScore)}22`)
      .attr("stroke", (d) => nodeColor(d.riskScore))
      .attr("stroke-width", (d) => d.riskScore >= 55 ? 2 : 1.5);

    // Node label
    nodeEl.append("text")
      .text((d) => d.id.length > 10 ? `${d.id.slice(0, 8)}…` : d.id)
      .attr("text-anchor", "middle")
      .attr("dy", (d) => nodeRadius(d) + 14)
      .attr("font-size", 10)
      .attr("fill", "#9ca3af")
      .style("user-select", "none")
      .style("pointer-events", "none");

    // Alert count badge
    nodeEl.filter((d) => d.alertCount > 0)
      .append("text")
      .text((d) => d.alertCount)
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", 9)
      .attr("font-weight", "bold")
      .attr("fill", (d) => nodeColor(d.riskScore))
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

    // Hover tooltip for nodes
    nodeEl
      .on("mouseenter", (event, d) => {
        const rect = svgRef.current!.getBoundingClientRect();
        setTooltip({
          visible: true,
          x: event.clientX - rect.left + 14,
          y: event.clientY - rect.top - 10,
          content: (
            <NodeTooltip node={d} />
          ),
        });
      })
      .on("mouseleave", () => setTooltip((t) => ({ ...t, visible: false })));

    // Hover tooltip for edges
    // After simulation runs, d.source/target are SimNode objects, not strings — extract .id
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
            <EdgeTooltip
              edge={d as unknown as GraphEdge}
              sourceId={sourceId}
              targetId={targetId}
            />
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
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96 gap-3 text-gray-400">
        <div className="w-5 h-5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
        Loading transaction graph...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96 text-red-400 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">Transaction Network</h3>
          <p className="text-xs text-gray-500 mt-0.5">Account-level flow graph — drag nodes, scroll to zoom</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span>
            <span className="font-medium text-white">{stats.nodes}</span> accounts
          </span>
          <span>
            <span className="font-medium text-white">{stats.edges}</span> transactions
          </span>
          <span>
            <span className="font-medium text-red-400">{stats.suspicious}</span> flagged
          </span>
        </div>
      </div>

      {/* Graph */}
      <div className="relative" style={{ height: 560 }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          className="bg-gray-950"
        />

        {/* Tooltip */}
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
      <div className="px-5 py-3 border-t border-gray-800 flex items-center gap-6 text-xs text-gray-400">
        <span className="font-medium text-gray-300">Risk level:</span>
        {[
          { label: "High (80+)", color: "#ef4444" },
          { label: "Medium (55–79)", color: "#f97316" },
          { label: "Low (<55)", color: "#eab308" },
          { label: "Clean", color: "#4b5563" },
        ].map(({ label, color }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full border" style={{ borderColor: color, background: `${color}22` }} />
            {label}
          </span>
        ))}
        <span className="ml-4 flex items-center gap-1.5">
          <span className="inline-block w-8 h-px bg-red-500" />
          Flagged transaction
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-8 h-px" style={{ background: "#1f2937" }} />
          Normal
        </span>
      </div>
    </div>
  );
}

function NodeTooltip({ node }: { node: GraphNode }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 shadow-xl text-xs min-w-48">
      <p className="font-mono font-semibold text-white mb-2">{node.id}</p>
      <div className="space-y-1 text-gray-400">
        <div className="flex justify-between gap-4">
          <span>Risk score</span>
          <span style={{ color: nodeColor(node.riskScore) }} className="font-semibold">
            {node.riskScore > 0 ? node.riskScore : "—"}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Alerts</span>
          <span className="text-white">{node.alertCount}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Total sent</span>
          <span className="text-white">{node.totalSent.toLocaleString()} {node.currency}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Total received</span>
          <span className="text-white">{node.totalReceived.toLocaleString()} {node.currency}</span>
        </div>
      </div>
    </div>
  );
}

function EdgeTooltip({ edge, sourceId, targetId }: { edge: GraphEdge; sourceId: string; targetId: string }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 shadow-xl text-xs min-w-52">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-gray-400 text-xs">{edge.txId}</span>
        {edge.isSuspicious && (
          <span
            className="px-1.5 py-0.5 rounded text-xs font-semibold"
            style={{ background: `${nodeColor(edge.riskScore ?? 0)}22`, color: nodeColor(edge.riskScore ?? 0) }}
          >
            {edge.patternType?.replace("_", " ")}
          </span>
        )}
      </div>
      <div className="space-y-1 text-gray-400">
        <div className="flex justify-between gap-4">
          <span>From</span>
          <span className="font-mono text-white">{sourceId}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>To</span>
          <span className="font-mono text-white">{targetId}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Amount</span>
          <span className="text-white font-semibold">{edge.amount.toLocaleString()} {edge.currency}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Date</span>
          <span className="text-white">{new Date(edge.txDate).toLocaleDateString()}</span>
        </div>
        {edge.riskScore !== undefined && (
          <div className="flex justify-between gap-4">
            <span>Risk score</span>
            <span style={{ color: nodeColor(edge.riskScore) }} className="font-semibold">{edge.riskScore}</span>
          </div>
        )}
      </div>
    </div>
  );
}
