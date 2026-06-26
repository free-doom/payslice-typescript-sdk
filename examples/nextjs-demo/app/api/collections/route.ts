import { NextResponse } from "next/server";
import { errorResponse, getClient, isLive } from "@/lib/payslice";
import { mockCollectionsDue } from "@/lib/mock";

// GET /api/collections — outstanding amounts due for collection at payroll.
export async function GET() {
  if (!isLive()) {
    return NextResponse.json(mockCollectionsDue());
  }

  try {
    // listDuePage returns one page (with per-page `totals`). For the full set,
    // iterate: `for await (const item of getClient().collections.listDue()) {}`
    const due = await getClient().collections.listDuePage({ limit: 25 });
    return NextResponse.json(due);
  } catch (err) {
    return errorResponse(err);
  }
}
