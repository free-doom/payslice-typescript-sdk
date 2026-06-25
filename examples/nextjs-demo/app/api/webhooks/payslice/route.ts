import { NextRequest, NextResponse } from "next/server";
import { constructEvent, WebhookVerificationError } from "@payslice/sdk";

// POST /api/webhooks/payslice — receive and verify webhook deliveries.
//
// CRITICAL: verify against the RAW request body. `await req.text()` gives the
// unparsed bytes; never JSON.parse first and re-serialize, or the signature
// won't match. App Router does not buffer/parse the body for us here, so this
// is exactly the raw payload Payslice signed.
export async function POST(req: NextRequest) {
  const secret = process.env.PAYSLICE_WEBHOOK_SECRET;
  if (!secret) {
    // Fail clearly instead of attempting verification with an empty key.
    return NextResponse.json(
      { error: "PAYSLICE_WEBHOOK_SECRET is not set; cannot verify webhooks." },
      { status: 503 },
    );
  }

  const raw = await req.text();

  try {
    const event = await constructEvent({
      payload: raw,
      headers: req.headers,
      secret,
      // The URL you registered with Payslice; the SDK derives the signed path.
      endpointUrl: process.env.PAYSLICE_WEBHOOK_URL,
    });

    switch (event.type) {
      case "advance.approved":
        console.log("advance.approved", event.data.id);
        break;
      case "advance.released":
        console.log("advance.released", event.data.id, event.data.disbursement?.transfer_ref);
        break;
      case "advance.failed":
        console.log("advance.failed", event.data.id, event.data.disbursement?.failure_reason);
        break;
      case "collection.due":
        console.log("collection.due", event.data.items.length, "items");
        break;
      case "vault.low_balance":
        console.log("vault.low_balance", event.data.balance, "<", event.data.threshold);
        break;
    }

    // Acknowledge fast; do heavy work asynchronously in a real app.
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return new NextResponse("invalid signature", { status: 400 });
    }
    throw err;
  }
}
