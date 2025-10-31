import { NextResponse } from "next/server";
import { connectDB, ExtractedData } from "../../../../../server/db";
import { getUserId } from "@/app/lib/auth-helpers";

function toCSV(records: Array<Record<string, unknown>>): string {
  if (!records || records.length === 0) return '';
  // Collect union of keys
  const keys = Array.from(records.reduce((set, rec) => {
    Object.keys(rec || {}).forEach(k => set.add(k));
    return set;
  }, new Set<string>()));
  const header = keys.join(',');
  const rows = records.map(rec => keys.map(k => {
    const v = (rec as any)?.[k];
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Escape quotes and wrap in quotes if needed
    const escaped = s.replace(/"/g, '""');
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  }).join(','));
  return [header, ...rows].join('\n');
}

// GET /api/extractions/[id]/download?format=csv|json
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, error } = await getUserId();
    if (error || !userId) return error || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const url = new URL(req.url);
    const format = (url.searchParams.get('format') || 'json').toLowerCase();

    await connectDB();
    const doc = await ExtractedData.findOne({ _id: id, userId }).lean().exec();
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (format === 'csv') {
      const csv = toCSV((doc.records as any[]) || []);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename=extraction_${id}.csv`,
        },
      });
    }

    // Default JSON
    return new NextResponse(JSON.stringify(doc), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename=extraction_${id}.json`,
      },
    });
  } catch (err) {
    console.error('Error downloading extraction:', err);
    return NextResponse.json({ error: 'Failed to download extraction' }, { status: 500 });
  }
}

