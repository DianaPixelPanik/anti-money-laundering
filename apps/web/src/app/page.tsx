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
            <span className="text-red-400 text-sm">⚠</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">AML Detector</h1>
            <p className="text-xs text-gray-400">Suspicious Pattern Analysis</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">
              Powered by Claude + IsolationForest
            </span>
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
