"use client";

interface Props {
  label: string;
  value: string | number;
  sub?: string;
  variant?: "default" | "warning" | "danger" | "success";
}

const variantStyles: Record<NonNullable<Props["variant"]>, string> = {
  default: "text-slate-100",
  warning: "text-amber-400",
  danger: "text-red-400",
  success: "text-emerald-400",
};

export function SummaryMetricCard({ label, value, sub, variant = "default" }: Props) {
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-md px-4 py-3">
      <p className="text-slate-500 text-xs uppercase tracking-wider font-medium mb-1.5">
        {label}
      </p>
      <p className={`text-2xl font-mono font-semibold leading-none ${variantStyles[variant]}`}>
        {value}
      </p>
      {sub && (
        <p className="text-slate-600 text-xs mt-1.5 font-mono">{sub}</p>
      )}
    </div>
  );
}
