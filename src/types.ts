/**
 * Public wire types for the Payslice partner API (`/v1`).
 *
 * These mirror the OpenAPI contract (`openapi.yaml`) 1:1, including its
 * snake_case field names, so request/response objects pass through the SDK
 * unchanged. `npm run generate` emits `src/generated/types.ts` from the same
 * spec; a CI conformance check keeps these aligned with it.
 *
 * All monetary amounts are integers in minor units (cents).
 */

// --- Shared --------------------------------------------------------------

export type CurrencyCode = string; // ISO 4217, e.g. "USD"
export type IsoDate = string; // "YYYY-MM-DD"
export type IsoDateTime = string; // RFC 3339

export interface Money {
  /** Amount in minor units (cents). */
  amount: number;
  currency: CurrencyCode;
}

// --- Quotes --------------------------------------------------------------

export type SalaryFrequency = "monthly" | "weekly";

export interface QuoteRequest {
  /** Partner's external ID for the employee. */
  user_id: string;
  /** Partner's external ID for the employer. */
  company_id: string;
  contract: {
    id: string;
    start_date: IsoDate;
    /** Null for indefinite contracts. */
    end_date?: IsoDate | null;
  };
  salary: {
    /** Gross salary per pay period, in minor units. */
    amount: number;
    currency: CurrencyCode;
    frequency: SalaryFrequency;
  };
  /** Up to the last 3 salary settlements, most recent first. */
  settlements?: Array<{
    amount: number;
    currency: CurrencyCode;
    date: IsoDate;
  }>;
}

export type QuoteStatus = "approved" | "declined" | "expired" | "used";

export type DeclineReason =
  | "tenure_too_short"
  | "final_contract_month"
  | "insufficient_settlement_history"
  | "cap_exceeded"
  | "user_advance_cap_reached";

export interface Quote {
  id: string;
  user_id: string;
  company_id: string;
  approved: boolean;
  status: QuoteStatus;
  /** Maximum advance amount in minor units. Null when declined. */
  amount?: number | null;
  currency?: CurrencyCode | null;
  /** Fee in minor units, charged on top of the advance. */
  fee?: number | null;
  /** The partner's share of `fee`, in minor units. */
  partner_fee_share?: number | null;
  decline_reasons?: DeclineReason[];
  created_at: IsoDateTime;
  /** 4 hours after creation. Quotes are single-use. */
  expires_at: IsoDateTime;
}

// --- Advances ------------------------------------------------------------

export interface PayoutDestination {
  type: "crypto_wallet";
  chain: "evm";
  /** Partner-configured network id. */
  network: string;
  /** 0x-prefixed 20-byte EVM address. */
  address: string;
}

export interface AdvanceRequest {
  quote_id: string;
  user_id: string;
  /** Must be <= the quoted amount (partial drawdown allowed). */
  amount: number;
  /** Must exactly match the quote currency. */
  currency: CurrencyCode;
  /** Employee account ref on the partner ledger (`executed_by: partner`). */
  destination_account_id?: string | null;
  /** Required for `executed_by: payslice` crypto partners. */
  payout_destination?: PayoutDestination | null;
  /** The payroll date on which the deduction is expected. */
  due_date: IsoDate;
}

export type AdvanceStatus =
  | "approved"
  | "released"
  | "canceled"
  | "failed"
  | "repaid"
  | "partially_repaid"
  | "written_off";

export type DisbursementExecutor = "partner" | "payslice";

export interface CryptoTransfer {
  chain: "evm";
  network: string;
  /** Resolved from partner config and advance currency; no FX in v1. */
  asset: "USDC" | "EURC";
  token_contract: string;
  token_decimals: number;
  amount_base_units: number;
  to_address: string;
  /** Populated after the Vault/Rail service reports final settlement. */
  tx_hash: string | null;
  confirmations: number;
}

export interface Disbursement {
  executed_by?: DisbursementExecutor;
  destination_account_id?: string | null;
  payout_destination?: PayoutDestination | null;
  crypto_transfer?: CryptoTransfer | null;
  /** Partner-ledger transfer reference or final crypto transaction hash. */
  transfer_ref?: string | null;
  failure_reason?: string | null;
}

export interface Advance {
  id: string;
  quote_id: string;
  user_id: string;
  company_id: string;
  amount: number;
  currency: CurrencyCode;
  fee: number;
  partner_fee_share?: number;
  /** Amount + fee still owed, in minor units. */
  amount_outstanding?: number;
  status: AdvanceStatus;
  due_date: IsoDate;
  /** Deadline (24h) to execute a partner-ledger transfer; null otherwise. */
  authorization_expires_at?: IsoDateTime | null;
  disbursement?: Disbursement;
  created_at: IsoDateTime;
  released_at?: IsoDateTime | null;
}

export interface ListAdvancesParams {
  company_id?: string;
  user_id?: string;
  status?: AdvanceStatus;
  /** 1–100, default 25. */
  limit?: number;
  cursor?: string;
}

export interface AdvancePage {
  items: Advance[];
  next_cursor?: string | null;
}

// --- Disbursement confirmation ------------------------------------------

export type DisbursementConfirmationStatus = "executed" | "failed";

export type DisbursementFailureReason =
  | "account_closed"
  | "account_frozen"
  | "account_not_found"
  | "other";

/**
 * Disbursement confirmation body — a discriminated union on `status`,
 * mirroring the server's `oneOf`. `executed` requires `transfer_ref`;
 * `failed` requires `failure_reason`. The compiler enforces the contract,
 * so an `executed` body without a `transfer_ref` won't type-check.
 */
export type ConfirmDisbursementRequest =
  | {
      status: "executed";
      /** Partner-ledger transfer reference. */
      transfer_ref: string;
      /** Optional partner-observed execution timestamp. */
      executed_at?: IsoDateTime;
    }
  | {
      status: "failed";
      failure_reason: DisbursementFailureReason;
    };

// --- Collections ---------------------------------------------------------

export interface ListCollectionsDueParams {
  company_id?: string;
  user_id?: string;
  due_before?: IsoDate;
  /** 1–100, default 50. */
  limit?: number;
  cursor?: string;
}

export interface CollectionDueItem {
  advance_id: string;
  user_id: string;
  company_id: string;
  /** Outstanding amount incl. fee, in minor units. */
  amount: number;
  currency: CurrencyCode;
  due_date: IsoDate;
}

export interface CollectionsDue {
  items: CollectionDueItem[];
  /** Aggregate owed per currency across the returned filter. */
  totals: Money[];
  next_cursor?: string | null;
}

export type CollectionItemStatus = "collected" | "partial" | "failed";

export interface CollectionConfirmation {
  company_id: string;
  pay_date: IsoDate;
  items: Array<{
    advance_id: string;
    /** Required unless status is `failed`. */
    amount_collected?: number;
    currency: CurrencyCode;
    status: CollectionItemStatus;
    ledger_credit_ref?: string | null;
    /** Required when status is `failed`. */
    failure_reason?: string;
  }>;
}

export interface CollectionResult {
  advance_id: string;
  accepted: boolean;
  advance_status: AdvanceStatus;
  error?: string | null;
}

export interface ConfirmCollectionsResponse {
  items: CollectionResult[];
}

// --- Vault ---------------------------------------------------------------

export interface PendingPrefund extends Money {
  expected_at?: IsoDate | null;
}

export interface Vault {
  balance: Money;
  /** Balance net of approved-but-unexecuted authorizations. */
  available_balance: Money;
  /** Active authorization holds against this vault currency. */
  holds: Money;
  /** Payslice top-ups in transit to the partner's ledger. */
  pending_prefunds: PendingPrefund[];
  low_balance_threshold?: Money | null;
  /** Accumulated partner fee share awaiting the monthly payout. */
  accrued_partner_fees: Money;
}

export interface VaultResponse {
  vaults: Vault[];
}
