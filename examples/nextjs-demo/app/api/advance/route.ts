import { NextRequest, NextResponse } from "next/server";
import type { AdvanceRequest } from "@payslice/sdk";
import { errorResponse, getClient, isLive } from "@/lib/payslice";
import { mockAdvance } from "@/lib/mock";

// POST /api/advance — draw down funds against an approved quote.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as AdvanceRequest;

  if (!isLive()) {
    return NextResponse.json(mockAdvance(body));
  }

  try {
    // The SDK auto-generates an Idempotency-Key. In a real integration pass a
    // stable one (e.g. your order id) so a retry replays instead of double-paying:
    //   getClient().advances.create(body, { idempotencyKey: orderId })
    const advance = await getClient().advances.create(body);
    return NextResponse.json(advance);
  } catch (err) {
    return errorResponse(err);
  }
}
