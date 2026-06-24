import { NextResponse } from "next/server";
import { isLive } from "@/lib/payslice";

// GET /api/mode — lets the UI show whether it's hitting the live sandbox or
// the built-in mock (no credentials configured).
export async function GET() {
  return NextResponse.json({
    live: isLive(),
    baseUrl: process.env.PAYSLICE_BASE_URL ?? "https://sandbox-api.payslice.com",
  });
}
