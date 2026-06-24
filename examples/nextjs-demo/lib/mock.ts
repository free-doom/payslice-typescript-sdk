import type {
  Advance,
  CollectionsDue,
  ConfirmDisbursementRequest,
  Quote,
  QuoteRequest,
  VaultResponse,
} from "@payslice/sdk";

/**
 * In-memory stand-ins for the API, used when no sandbox credentials are set so
 * the demo runs with zero setup. The shapes are the SDK's real types, so the
 * route handlers are identical whether they hit this or the live sandbox.
 */

const FEE_CENTS = 300;
const ADVANCE_FRACTION = 0.5; // approve up to 50% of period salary

function now(): string {
  return new Date().toISOString();
}

function plusHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

export function mockQuote(req: QuoteRequest): Quote {
  const amount = Math.round(req.salary.amount * ADVANCE_FRACTION);
  return {
    id: `qt_${crypto.randomUUID()}`,
    user_id: req.user_id,
    company_id: req.company_id,
    approved: true,
    status: "approved",
    amount,
    currency: req.salary.currency,
    fee: FEE_CENTS,
    partner_fee_share: Math.round(FEE_CENTS * 0.3),
    decline_reasons: [],
    created_at: now(),
    expires_at: plusHours(4),
  };
}

export function mockAdvance(req: {
  quote_id: string;
  user_id: string;
  amount: number;
  currency: string;
  due_date: string;
}): Advance {
  return {
    id: `adv_${crypto.randomUUID()}`,
    quote_id: req.quote_id,
    user_id: req.user_id,
    company_id: "company_demo",
    amount: req.amount,
    currency: req.currency,
    fee: FEE_CENTS,
    partner_fee_share: Math.round(FEE_CENTS * 0.3),
    amount_outstanding: req.amount + FEE_CENTS,
    status: "approved",
    due_date: req.due_date,
    authorization_expires_at: plusHours(24),
    disbursement: {
      executed_by: "partner",
      destination_account_id: "partner_ledger_acct_demo",
    },
    created_at: now(),
    released_at: null,
  };
}

export function mockConfirm(
  advanceId: string,
  req: ConfirmDisbursementRequest,
): Advance {
  const released = req.status === "executed";
  return {
    id: advanceId,
    quote_id: `qt_${crypto.randomUUID()}`,
    user_id: "employee_demo",
    company_id: "company_demo",
    amount: 20_000,
    currency: "USD",
    fee: FEE_CENTS,
    amount_outstanding: released ? 20_000 + FEE_CENTS : 0,
    status: released ? "released" : "failed",
    due_date: "2026-07-31",
    authorization_expires_at: null,
    disbursement: {
      executed_by: "partner",
      destination_account_id: "partner_ledger_acct_demo",
      transfer_ref: req.status === "executed" ? req.transfer_ref : null,
      failure_reason: req.status === "failed" ? req.failure_reason : null,
    },
    created_at: now(),
    released_at: released ? now() : null,
  };
}

export function mockVault(): VaultResponse {
  return {
    vaults: [
      {
        balance: { amount: 5_000_000, currency: "USD" },
        available_balance: { amount: 4_820_000, currency: "USD" },
        holds: { amount: 180_000, currency: "USD" },
        pending_prefunds: [{ amount: 1_000_000, currency: "USD", expected_at: "2026-06-26" }],
        low_balance_threshold: { amount: 1_000_000, currency: "USD" },
        accrued_partner_fees: { amount: 12_900, currency: "USD" },
      },
    ],
  };
}

export function mockCollectionsDue(): CollectionsDue {
  return {
    items: [
      {
        advance_id: `adv_${crypto.randomUUID()}`,
        user_id: "employee_demo",
        company_id: "company_demo",
        amount: 20_300,
        currency: "USD",
        due_date: "2026-07-31",
      },
      {
        advance_id: `adv_${crypto.randomUUID()}`,
        user_id: "employee_two",
        company_id: "company_demo",
        amount: 15_300,
        currency: "USD",
        due_date: "2026-07-31",
      },
    ],
    totals: [{ amount: 35_600, currency: "USD" }],
    next_cursor: null,
  };
}
