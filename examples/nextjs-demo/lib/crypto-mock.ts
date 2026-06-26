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
  mock: boolean;
}

function hex(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const MOCK_EXPLORER = "https://sepolia.basescan.org";

export function mockPayout(recipient: string): PayoutResult {
  return {
    reservation_ref: `vrs_${hex(16)}`,
    payout_ref: `vpo_${hex(16)}`,
    status: "reserved",
    recipient,
    token: "0x0000000000000000000000000000000000000000",
    decimals: 6,
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
  const txHash = `0x${hex(32)}`;
  return {
    status: "confirmed",
    txHash,
    blockNumber: 43_300_000 + attempt,
    value: String(amountMinor * 10_000), // cents -> 6-decimal base units
    confirmations: 16,
    explorerUrl: `${MOCK_EXPLORER}/tx/${txHash}`,
    mock: true,
  };
}
