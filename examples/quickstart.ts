/**
 * End-to-end happy path: quote → advance → confirm disbursement.
 * Run against sandbox with PAYSLICE_KEY_ID / PAYSLICE_SECRET set.
 */
import { Payslice, QuoteExpiredError } from "@payslice/sdk";

const payslice = new Payslice({
  keyId: process.env.PAYSLICE_KEY_ID!,
  secret: process.env.PAYSLICE_SECRET!,
  baseUrl: "https://sandbox-api.payslice.com",
});

async function main() {
  // 1. Request a quote for an employee.
  const quote = await payslice.quotes.create({
    user_id: "employee_42",
    company_id: "employer_7",
    contract: { id: "contract_1", start_date: "2024-01-15" },
    salary: { amount: 500_000, currency: "USD", frequency: "monthly" },
  });

  if (!quote.approved || quote.amount == null) {
    console.log("Declined:", quote.decline_reasons);
    return;
  }
  console.log(`Approved up to ${quote.amount} ${quote.currency}, fee ${quote.fee}`);

  // 2. Draw down part of the approved amount. The SDK auto-generates an
  //    Idempotency-Key; pass your own to make a retry safe.
  try {
    const advance = await payslice.advances.create({
      quote_id: quote.id,
      user_id: quote.user_id,
      amount: Math.min(quote.amount, 20_000),
      currency: quote.currency!,
      destination_account_id: "partner_ledger_acct_99",
      due_date: "2026-07-31",
    });
    console.log(`Advance ${advance.id} is ${advance.status}`);

    // 3. After executing the transfer on your ledger, confirm it.
    const confirmed = await payslice.advances.confirmDisbursement(advance.id, {
      status: "executed",
      transfer_ref: "ledger_txn_abc123",
    });
    console.log(`Advance ${confirmed.id} is now ${confirmed.status}`);
  } catch (err) {
    if (err instanceof QuoteExpiredError) {
      console.error("Quote expired before drawdown — request a fresh quote.");
    } else {
      throw err;
    }
  }

  // List recent advances for the employer (auto-paginates).
  for await (const advance of payslice.advances.list({ company_id: "employer_7" })) {
    console.log(advance.id, advance.status, advance.amount_outstanding);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
