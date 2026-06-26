import { NextRequest, NextResponse } from "next/server";
import type { QuoteRequest } from "@payslice/sdk";
import { errorResponse, getClient, isLive } from "@/lib/payslice";
import { mockQuote } from "@/lib/mock";

// POST /api/quote — request an advance quote for an employee.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as QuoteRequest;

  if (!isLive()) {
    return NextResponse.json(mockQuote(body));
  }

  try {
    const quote = await getClient().quotes.create(body);
    return NextResponse.json(quote);
  } catch (err) {
    return errorResponse(err);
  }
}
