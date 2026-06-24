import { NextRequest, NextResponse } from "next/server";
import type { ConfirmDisbursementRequest } from "@payslice/sdk";
import { errorResponse, getClient, isLive } from "@/lib/payslice";
import { mockConfirm } from "@/lib/mock";

// POST /api/advance/[id]/confirm — report the result of executing the transfer.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as ConfirmDisbursementRequest;

  if (!isLive()) {
    return NextResponse.json(mockConfirm(id, body));
  }

  try {
    const advance = await getClient().advances.confirmDisbursement(id, body);
    return NextResponse.json(advance);
  } catch (err) {
    return errorResponse(err);
  }
}
