"use client";

import { useCallback, useState } from "react";
import Papa from "papaparse";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface Props {
  onUploadComplete: (uploadId: string) => void;
}

export function UploadZone({ onUploadComplete }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ headers: string[]; rows: any[] } | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);

      // Client-side CSV preview
      Papa.parse(file, {
        header: true,
        preview: 5,
        complete: (results) => {
          setPreview({
            headers: results.meta.fields ?? [],
            rows: results.data as any[],
          });
        },
      });

      // Upload to API
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const resp = await fetch(`${API_URL}/api/uploads`, {
          method: "POST",
          headers: { "x-tenant-id": "default" },
          body: formData,
        });

        if (!resp.ok) {
          const err = await resp.json();
          throw new Error(err.error ?? "Upload failed");
        }

        const data = await resp.json();
        onUploadComplete(data.uploadId);
      } catch (err) {
        setError(String(err));
        setIsUploading(false);
      }
    },
    [onUploadComplete]
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

  return (
    <div className="max-w-3xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-10">
        <h2 className="text-3xl font-bold text-white mb-3">
          Upload Transaction Data
        </h2>
        <p className="text-gray-400 text-lg">
          Drop your CSV file to detect suspicious patterns with AI
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
            <div className="text-5xl mb-4">📊</div>
            <p className="text-xl text-white font-medium mb-2">
              Drop CSV file here
            </p>
            <p className="text-gray-400 text-sm">or click to browse</p>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
          ⚠ {error}
        </div>
      )}

      {/* CSV Preview */}
      {preview && !isUploading && (
        <div className="mt-6 bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
            <span className="text-green-400 text-sm">✓</span>
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
