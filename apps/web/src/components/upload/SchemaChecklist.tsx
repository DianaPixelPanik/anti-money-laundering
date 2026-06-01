"use client";

import { downloadSampleCsv } from "@/lib/parseCsv";

const REQUIRED_FIELDS = ["tx_id", "from_account", "to_account", "amount", "date"];
const OPTIONAL_FIELDS = ["currency", "type", "country", "description"];

export function SchemaChecklist() {
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-md p-4 space-y-4">
      {/* Required fields */}
      <div>
        <p className="text-slate-500 text-xs uppercase tracking-wider font-medium mb-2">
          Required Fields
        </p>
        <ul className="space-y-1.5">
          {REQUIRED_FIELDS.map((field) => (
            <li key={field} className="flex items-center gap-2">
              <svg
                className="w-3.5 h-3.5 text-emerald-400 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <code className="text-xs font-mono text-slate-300">{field}</code>
            </li>
          ))}
        </ul>
      </div>

      {/* Divider */}
      <div className="border-t border-slate-800" />

      {/* Optional fields */}
      <div>
        <p className="text-slate-500 text-xs uppercase tracking-wider font-medium mb-2">
          Optional Fields
        </p>
        <ul className="space-y-1.5">
          {OPTIONAL_FIELDS.map((field) => (
            <li key={field} className="flex items-center gap-2">
              <svg
                className="w-3.5 h-3.5 text-slate-600 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <code className="text-xs font-mono text-slate-500">{field}</code>
            </li>
          ))}
        </ul>
      </div>

      {/* Divider */}
      <div className="border-t border-slate-800" />

      {/* Download sample */}
      <button
        onClick={downloadSampleCsv}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md text-xs text-slate-300 transition-colors cursor-pointer"
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
          />
        </svg>
        Download sample CSV
      </button>

      {/* Privacy note */}
      <p className="text-slate-600 text-xs leading-relaxed">
        Files are processed locally for this demo. No data is stored after analysis.
      </p>
    </div>
  );
}
