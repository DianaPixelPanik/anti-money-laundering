"use client";

import { useCallback, useState } from "react";
import Papa from "papaparse";
import { useAuth } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Props {
  onUploadComplete: (uploadId: string) => void;
}

export function UploadZone({ onUploadComplete }: Props) {
  const { authHeaders, loading: authLoading, error: authError, refresh } = useAuth();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ headers: string[]; rows: any[] } | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);

      Papa.parse(file, {
        header: true,
        preview: 5,
        complete: (results) => {
          setPreview({ headers: results.meta.fields ?? [], rows: results.data as any[] });
        },
      });

      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const resp = await fetch(`${API_URL}/api/uploads`, {
          method: "POST",
          headers: { ...authHeaders() },
          body: formData,
        });

        if (resp.status === 401) {
          // Token expired or invalid — refresh and ask user to retry
          await refresh();
          throw new Error("Session expired. Please try again.");
        }

        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(body.error ?? "Upload failed");
        }

        const data = await resp.json();
        onUploadComplete(data.uploadId);
      } catch (err) {
        setError(String(err));
        setIsUploading(false);
      }
    },
    [authHeaders, onUploadComplete, refresh]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file?.name.endsWith(".csv")) handleFile(file);
      else setError("Please upload a CSV file");
    },
    [handleFile]
  );

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] gap-3 text-gray-400">
        <div className="w-5 h-5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
        Connecting to API...
      </div>
    );
  }

  if (authError) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="p-6 bg-red-900/30 border border-red-700 rounded-xl text-center space-y-3">
          <p className="text-red-300 font-medium">Could not connect to the API</p>
          <p className="text-red-400 text-sm">{authError}</p>
          <button
            onClick={refresh}
            className="px-4 py-2 text-sm bg-red-800/50 hover:bg-red-800 text-red-200 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-10">
        <h2 className="text-3xl font-bold text-white mb-3">
          Upload Transaction Data
        </h2>
        <p className="text-gray-400 text-lg">
          Drop your CSV file to run detection rules and risk scoring
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`
          relative border-2 border-dashed rounded-2xl p-16 text-center transition-all cursor-pointer
          ${isDragging
            ? "border-red-400 bg-red-500/10"
            : "border-gray-700 bg-gray-900/50 hover:border-gray-600 hover:bg-gray-900"
          }
        `}
        onClick={() => document.getElementById("csv-input")?.click()}
      >
        <input
          id="csv-input"
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />

        {isUploading ? (
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full border-2 border-red-400 border-t-transparent animate-spin" />
            <p className="text-gray-300">Uploading and queuing analysis...</p>
          </div>
        ) : (
          <>
            <svg className="w-14 h-14 text-gray-600 mb-4 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-xl text-white font-medium mb-2">
              Drop CSV file here
            </p>
            <p className="text-gray-400 text-sm">or click to browse</p>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm flex items-start gap-2">
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          {error}
        </div>
      )}

      {/* CSV Preview */}
      {preview && !isUploading && (
        <div className="mt-6 bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
            <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span className="text-gray-300 text-sm font-medium">
              CSV Preview (first 5 rows)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-800/50">
                <tr>
                  {preview.headers.map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-gray-400 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i} className="border-t border-gray-800/50">
                    {preview.headers.map((h) => (
                      <td key={h} className="px-3 py-2 text-gray-300 font-mono">
                        {String(row[h] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Required columns hint */}
      <div className="mt-6 p-4 bg-gray-900/50 border border-gray-800 rounded-xl">
        <p className="text-gray-400 text-sm font-medium mb-2">Required CSV columns:</p>
        <div className="flex flex-wrap gap-2">
          {["tx_id", "from_account", "to_account", "amount", "date"].map((col) => (
            <code key={col} className="text-xs bg-gray-800 text-blue-300 px-2 py-1 rounded">
              {col}
            </code>
          ))}
          <span className="text-gray-500 text-xs flex items-center">
            + optional: currency, type, country, description
          </span>
        </div>
      </div>
    </div>
  );
}
