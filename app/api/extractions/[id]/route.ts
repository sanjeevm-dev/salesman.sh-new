import { NextResponse } from "next/server";
import { connectDB, ExtractedData } from "../../../../server/db";
import { getUserId } from "@/app/lib/auth-helpers";

// GET /api/extractions/[id]
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, error } = await getUserId();
    if (error || !userId) return error || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    await connectDB();
    const doc = await ExtractedData.findOne({ _id: id, userId }).lean().exec();
    if (!doc) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, extraction: doc });
  } catch (err) {
    console.error('Error loading extraction:', err);
    return NextResponse.json({ error: 'Failed to load extraction' }, { status: 500 });
  }
}

