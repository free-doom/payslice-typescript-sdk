import { NextResponse } from "next/server";
import { errorResponse, getClient, isLive } from "@/lib/payslice";
import { mockVault } from "@/lib/mock";

// GET /api/vault — Payslice vault balances on the partner ledger.
export async function GET() {
  if (!isLive()) {
    return NextResponse.json(mockVault());
  }

  try {
    const vault = await getClient().vault.get();
    return NextResponse.json(vault);
  } catch (err) {
    return errorResponse(err);
  }
}
