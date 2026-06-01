"use client";

import { useState } from "react";
import { UploadZone } from "@/components/UploadZone";
import { AnalysisDashboard } from "@/components/AnalysisDashboard";

export default function HomePage() {
  const [uploadId, setUploadId] = useState<string | null>(null);

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/40 flex items-center justify-center">
            <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">AML Detector</h1>
            <p className="text-xs text-gray-400">Suspicious Pattern Analysis</p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {!uploadId ? (
          <UploadZone onUploadComplete={setUploadId} />
        ) : (
          <AnalysisDashboard
            uploadId={uploadId}
            onReset={() => setUploadId(null)}
          />
        )}
      </div>
    </main>
  );
}
