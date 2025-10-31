import { NextResponse } from "next/server";
import { connectDB, ExtractedData } from "../../../../../server/db";
import { getUserId } from "@/app/lib/auth-helpers";

// GET /api/agents/[id]/extractions
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId, error } = await getUserId();
    if (error || !userId) return error || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    await connectDB();

    const url = new URL(_req.url);
    const dataType = url.searchParams.get('dataType') || undefined;
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
    const skip = (page - 1) * limit;

    const query: any = { userId, agentId: id };
    if (dataType) query.dataType = dataType;
    if (from || to) {
      query.extractedAt = {};
      if (from) query.extractedAt.$gte = new Date(from);
      if (to) query.extractedAt.$lte = new Date(to);
    }

    const [items, total] = await Promise.all([
      ExtractedData.find(query)
        .sort({ extractedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      ExtractedData.countDocuments(query),
    ]);

    return NextResponse.json({
      success: true,
      items,
      page,
      limit,
      total,
    });
  } catch (err) {
    console.error('Error listing extractions:', err);
    return NextResponse.json({ error: 'Failed to list extractions' }, { status: 500 });
  }
}
