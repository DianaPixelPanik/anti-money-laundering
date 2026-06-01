"use client";

import { useState } from "react";
import { CsvUploadPanel } from "@/components/upload/CsvUploadPanel";
import { InvestigationDashboard } from "@/components/dashboard/InvestigationDashboard";
import type { UploadResult } from "@/types/aml";

export default function HomePage() {
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  return (
    <div className="min-h-screen bg-[#070b12]">
      {/* Header bar */}
      <header className="border-b border-slate-800 bg-slate-900/60">
        <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center justify-between">
          {/* Left: brand */}
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded border border-slate-700 bg-slate-800 flex items-center justify-center shrink-0">
              <svg
                className="w-4 h-4 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                />
              </svg>
            </div>
            <div>
              <p className="text-slate-100 text-sm font-semibold leading-none">AML Detector</p>
              <p className="text-slate-500 text-xs mt-0.5">Compliance Intelligence Platform</p>
            </div>
          </div>

        </div>
      </header>

      {/* Main content */}
      <main className="max-w-screen-xl mx-auto px-6 py-6">
        {!uploadResult ? (
          <CsvUploadPanel onUploadComplete={setUploadResult} />
        ) : (
          <InvestigationDashboard
            uploadResult={uploadResult}
            onNewUpload={() => setUploadResult(null)}
          />
        )}
      </main>
    </div>
  );
}
