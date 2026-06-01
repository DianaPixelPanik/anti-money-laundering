"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { parseTransactionCsv } from "@/lib/parseCsv";
import { SchemaChecklist } from "./SchemaChecklist";
import type { ParseResult } from "@/lib/parseCsv";
import type { UploadResult } from "@/types/aml";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const RECENT_UPLOADS_KEY = "aml_recent_uploads";

interface RecentUpload {
  uploadId: string;
  fileName: string;
  rowCount: number;
  timestamp: string;
}

interface Props {
  onUploadComplete: (result: UploadResult) => void;
}

export function CsvUploadPanel({ onUploadComplete }: Props) {
  const { authHeaders, loading: authLoading, error: authError, refresh } = useAuth();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [recentUploads, setRecentUploads] = useState<RecentUpload[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_UPLOADS_KEY);
      if (stored) {
        setRecentUploads(JSON.parse(stored).slice(0, 3));
      }
    } catch {
      // ignore
    }
  }, []);

  const saveRecentUpload = useCallback((upload: RecentUpload) => {
    try {
      const stored = localStorage.getItem(RECENT_UPLOADS_KEY);
      const existing: RecentUpload[] = stored ? JSON.parse(stored) : [];
      const updated = [upload, ...existing.filter((u) => u.uploadId !== upload.uploadId)].slice(0, 3);
      localStorage.setItem(RECENT_UPLOADS_KEY, JSON.stringify(updated));
      setRecentUploads(updated);
    } catch {
      // ignore
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setUploadError(null);
      setParseResult(null);
      setSelectedFile(file);
      setIsParsing(true);

      const result = await parseTransactionCsv(file);
      setParseResult(result);
      setIsParsing(false);
    },
    []
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile || !parseResult) return;
    if (parseResult.validationErrors.length > 0) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const resp = await fetch(`${API_URL}/api/uploads`, {
        method: "POST",
        headers: { ...authHeaders() },
        body: formData,
      });

      if (resp.status === 401) {
        await refresh();
        throw new Error("Session expired. Please try again.");
      }

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? "Upload failed");
      }

      const data = await resp.json();

      const uploadResult: UploadResult = {
        uploadId: data.uploadId,
        fileName: selectedFile.name,
        rowCount: parseResult.rowCount,
        detectedColumns: parseResult.detectedColumns,
        validationErrors: parseResult.validationErrors,
        status: "PENDING",
      };

      saveRecentUpload({
        uploadId: data.uploadId,
        fileName: selectedFile.name,
        rowCount: parseResult.rowCount,
        timestamp: new Date().toISOString(),
      });

      onUploadComplete(uploadResult);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
      setIsUploading(false);
    }
  }, [selectedFile, parseResult, authHeaders, refresh, onUploadComplete, saveRecentUpload]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file?.name.endsWith(".csv")) {
        handleFile(file);
      } else {
        setUploadError("Please upload a .csv file");
      }
    },
    [handleFile]
  );

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] gap-3 text-slate-400">
        <div className="w-4 h-4 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
        <span className="text-sm">Connecting to API...</span>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="max-w-lg mx-auto mt-16">
        <div className="bg-red-950/40 border border-red-800 rounded-md p-5 space-y-3">
          <p className="text-red-400 text-sm font-medium">Could not connect to the API</p>
          <p className="text-red-400/70 text-xs font-mono">{authError}</p>
          <button
            onClick={refresh}
            className="px-3 py-1.5 text-xs bg-red-900/50 hover:bg-red-900 border border-red-800 text-red-300 rounded-md transition-colors cursor-pointer"
          >
            Retry connection
          </button>
        </div>
      </div>
    );
  }

  const hasErrors = (parseResult?.validationErrors.length ?? 0) > 0;
  const canUpload = parseResult && !hasErrors && !isUploading;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Page heading */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-100">Upload Transaction File</h2>
        <p className="text-slate-500 text-sm mt-0.5">
          Upload a CSV file to begin suspicious pattern analysis
        </p>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Left: drop zone + file info */}
        <div className="col-span-7 space-y-3">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => document.getElementById("csv-file-input")?.click()}
            className={`
              relative border-2 border-dashed rounded-md p-10 text-center transition-colors cursor-pointer
              ${isDragging
                ? "border-slate-500 bg-slate-800/40"
                : "border-slate-700 bg-slate-900/40 hover:border-slate-600"
              }
            `}
          >
            <input
              id="csv-file-input"
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />

            {isParsing ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                <p className="text-slate-400 text-sm">Parsing file...</p>
              </div>
            ) : isUploading ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 rounded-full border-2 border-slate-300 border-t-transparent animate-spin" />
                <p className="text-slate-300 text-sm">Uploading to analysis queue...</p>
              </div>
            ) : (
              <>
                <svg
                  className="w-10 h-10 text-slate-600 mx-auto mb-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                  />
                </svg>
                <p className="text-slate-300 text-sm font-medium mb-1">
                  Drop CSV file here or click to browse
                </p>
                <p className="text-slate-600 text-xs">Accepts .csv files only</p>
              </>
            )}
          </div>

          {/* File parse result */}
          {parseResult && selectedFile && (
            <div className="bg-slate-900/40 border border-slate-800 rounded-md overflow-hidden">
              {/* File info header */}
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg
                    className={`w-4 h-4 shrink-0 ${hasErrors ? "text-amber-400" : "text-emerald-400"}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    {hasErrors ? (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    )}
                  </svg>
                  <span className="text-slate-300 text-sm font-medium truncate max-w-xs">
                    {selectedFile.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>
                    <span className="font-mono text-slate-300">{parseResult.rowCount}</span> rows
                  </span>
                  <span>
                    <span className="font-mono text-slate-300">{parseResult.detectedColumns.length}</span> columns detected
                  </span>
                </div>
              </div>

              {/* Detected columns */}
              <div className="px-4 py-3">
                <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">Detected Columns</p>
                <div className="flex flex-wrap gap-1.5">
                  {parseResult.detectedColumns.map((col) => (
                    <span
                      key={col}
                      className="text-xs font-mono px-2 py-0.5 bg-slate-800 text-slate-300 rounded border border-slate-700"
                    >
                      {col}
                    </span>
                  ))}
                </div>
              </div>

              {/* Validation errors */}
              {hasErrors && (
                <div className="px-4 py-3 border-t border-slate-800 bg-amber-950/20">
                  <p className="text-amber-400 text-xs uppercase tracking-wider mb-2">
                    Validation Errors ({parseResult.validationErrors.length})
                  </p>
                  <ul className="space-y-1">
                    {parseResult.validationErrors.slice(0, 5).map((err, i) => (
                      <li key={i} className="text-xs text-amber-400/80 font-mono">
                        {err}
                      </li>
                    ))}
                    {parseResult.validationErrors.length > 5 && (
                      <li className="text-xs text-slate-500">
                        +{parseResult.validationErrors.length - 5} more errors
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {/* Upload button */}
              <div className="px-4 py-3 border-t border-slate-800 bg-slate-900/20">
                <button
                  onClick={handleUpload}
                  disabled={!canUpload}
                  className={`
                    w-full py-2 text-sm font-medium rounded-md transition-colors cursor-pointer
                    ${canUpload
                      ? "bg-slate-700 hover:bg-slate-600 text-slate-100 border border-slate-600"
                      : "bg-slate-800/50 text-slate-600 border border-slate-800 cursor-not-allowed"
                    }
                  `}
                >
                  {isUploading ? "Uploading..." : hasErrors ? "Fix errors to continue" : "Submit for Analysis"}
                </button>
              </div>
            </div>
          )}

          {/* Upload error */}
          {uploadError && (
            <div className="bg-red-950/40 border border-red-800 rounded-md p-3 flex items-start gap-2">
              <svg
                className="w-4 h-4 text-red-400 shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-red-400 text-xs">{uploadError}</p>
            </div>
          )}
        </div>

        {/* Right: schema checklist + recent uploads */}
        <div className="col-span-5 space-y-4">
          <SchemaChecklist />

          {/* Recent uploads */}
          {recentUploads.length > 0 && (
            <div className="bg-slate-900/40 border border-slate-800 rounded-md p-4">
              <p className="text-slate-500 text-xs uppercase tracking-wider font-medium mb-3">
                Recent Uploads
              </p>
              <ul className="space-y-2">
                {recentUploads.map((u) => (
                  <li key={u.uploadId} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-300 truncate">{u.fileName}</p>
                      <p className="text-xs text-slate-600 font-mono">{u.uploadId}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-slate-500 font-mono">{u.rowCount} rows</p>
                      <p className="text-xs text-slate-600">
                        {new Date(u.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
