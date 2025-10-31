"use client";

import { useEffect, useState, useCallback } from "react";

type Extraction = {
  _id: string;
  dataType: string;
  totalCount: number;
  extractedAt: string;
};

interface Props {
  agentId: string;
}

export default function ExtractionResultsViewer({ agentId }: Props) {
  const [items, setItems] = useState<Extraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(20);
  const [dataType, setDataType] = useState<string>("");

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (dataType) params.set('dataType', dataType);
      const res = await fetch(`/api/agents/${agentId}/extractions?` + params.toString());
      if (!res.ok) throw new Error('Failed to load extractions');
      const data = await res.json();
      setItems((data.items || []).map((d: any) => ({
        _id: d._id,
        dataType: d.dataType,
        totalCount: d.totalCount,
        extractedAt: d.extractedAt,
      })));
      setTotal(data.total || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [agentId, page, limit, dataType]);

  useEffect(() => { setLoading(true); fetchData(); }, [fetchData]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500"
          placeholder="Filter by data type"
          value={dataType}
          onChange={(e) => { setDataType(e.target.value); setPage(1); }}
        />
      </div>
      <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-xl overflow-hidden">
        <div className="p-3 border-b border-white/[0.08]">
          <h3 className="text-white font-semibold">Extractions</h3>
        </div>
        {loading ? (
          <div className="p-6 text-gray-400">Loading...</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-gray-400">No extractions found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-gray-400">
                <tr>
                  <th className="px-4 py-2">Data Type</th>
                  <th className="px-4 py-2">Total</th>
                  <th className="px-4 py-2">Extracted At</th>
                  <th className="px-4 py-2">Download</th>
                </tr>
              </thead>
              <tbody className="text-gray-200">
                {items.map((it) => (
                  <tr key={it._id} className="border-t border-white/[0.06]">
                    <td className="px-4 py-2">{it.dataType}</td>
                    <td className="px-4 py-2">{it.totalCount}</td>
                    <td className="px-4 py-2">{new Date(it.extractedAt).toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <a className="text-blue-400 hover:text-blue-300" href={`/api/extractions/${it._id}/download?format=json`}>
                          JSON
                        </a>
                        <a className="text-blue-400 hover:text-blue-300" href={`/api/extractions/${it._id}/download?format=csv`}>
                          CSV
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="p-3 border-t border-white/[0.08] flex items-center justify-between text-xs text-gray-400">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button disabled={page<=1} onClick={() => setPage((p) => Math.max(1, p-1))} className="px-2 py-1 bg-white/[0.05] border border-white/[0.08] rounded disabled:opacity-50">Prev</button>
            <button disabled={page>=totalPages} onClick={() => setPage((p) => Math.min(totalPages, p+1))} className="px-2 py-1 bg-white/[0.05] border border-white/[0.08] rounded disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}

