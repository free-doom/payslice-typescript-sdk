import { randomHex } from "./rand";

/**
 * Canned crypto-payout responses for mock mode (no rail, no chain, no keys), so
 * the /crypto page is fully interactive with zero setup — mirroring lib/mock.ts.
 * The shapes match the live route responses exactly.
 */

export interface PayoutResult {
  reservation_ref: string;
  payout_ref: string;
  status: string;
  recipient: string;
  token: string;
  decimals: number;
  fromBlock: number;
  explorerBase: string;
  mock: boolean;
}

export interface SettlementResult {
  status: "pending" | "confirmed";
  txHash?: string;
  blockNumber?: number;
  value?: string;
  confirmations?: number;
  explorerUrl?: string;
  note?: string; // transient scan diagnostic (live mode)
  mock: boolean;
}

const MOCK_EXPLORER = "https://sepolia.basescan.org";
const MOCK_TOKEN_DECIMALS = 6; // mock USDC/EURC
const MINOR_DECIMALS = 2; // cents
const MOCK_CONFIRMATIONS = 16;

export function mockPayout(recipient: string): PayoutResult {
  return {
    reservation_ref: `vrs_${randomHex(16)}`,
    payout_ref: `vpo_${randomHex(16)}`,
    status: "reserved",
    recipient,
    token: "0x0000000000000000000000000000000000000000",
    decimals: MOCK_TOKEN_DECIMALS,
    fromBlock: 0,
    explorerBase: MOCK_EXPLORER,
    mock: true,
  };
}

/**
 * Mock settlement resolves after `attempt` >= 2 so the UI shows the
 * reserved → confirming → confirmed transition the live flow goes through.
 */
export function mockSettlement(amountMinor: number, attempt: number): SettlementResult {
  if (attempt < 2) return { status: "pending", mock: true };
  const txHash = `0x${randomHex(32)}`;
  // cents -> token base units, e.g. $5.00 (500) -> 5_000_000 at 6 decimals.
  const value = String(amountMinor * 10 ** (MOCK_TOKEN_DECIMALS - MINOR_DECIMALS));
  return {
    status: "confirmed",
    txHash,
    blockNumber: 0, // mock: no real chain height
    value,
    confirmations: MOCK_CONFIRMATIONS,
    explorerUrl: `${MOCK_EXPLORER}/tx/${txHash}`,
    mock: true,
  };
}
