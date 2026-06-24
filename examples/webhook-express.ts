/**
 * Receiving webhooks with Express.
 *
 * The single most important detail: verify against the RAW request body.
 * `express.raw()` hands you the unparsed Buffer; if you use `express.json()`
 * instead and re-serialize, the bytes won't match what Payslice signed and
 * every verification will fail.
 *
 * `path` must be the path-and-query of the endpoint URL you REGISTERED with
 * Payslice — that is what the server signs over. Here the registered URL is
 * https://partner.example/webhooks/payslice, so the signed path is
 * "/webhooks/payslice".
 */
import express from "express";
import { constructEvent, WebhookVerificationError } from "@payslice/sdk";

const app = express();
const WEBHOOK_SECRET = process.env.PAYSLICE_WEBHOOK_SECRET!;
const SIGNED_PATH = "/webhooks/payslice";

app.post(
  SIGNED_PATH,
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const event = await constructEvent({
        payload: req.body, // Buffer from express.raw — do not JSON-parse first
        headers: req.headers,
        secret: WEBHOOK_SECRET,
        path: SIGNED_PATH,
      });

      switch (event.type) {
        case "advance.released":
          console.log("released", event.data.id, event.data.disbursement?.transfer_ref);
          break;
        case "advance.failed":
          console.log("failed", event.data.id, event.data.disbursement?.failure_reason);
          break;
        case "collection.due":
          console.log("collections due", event.data.items.length);
          break;
        case "vault.low_balance":
          console.log("low balance", event.data.balance, "<", event.data.threshold);
          break;
        case "advance.approved":
          console.log("approved", event.data.id);
          break;
      }

      // Acknowledge fast (2xx); do heavy work asynchronously.
      res.status(204).end();
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        res.status(400).send("invalid signature");
        return;
      }
      throw err;
    }
  },
);

app.listen(3000, () => console.log("listening on :3000"));
