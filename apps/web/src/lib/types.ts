import type { Address } from 'viem';

/** tUSD8 has 6 decimals. */
export const TUSD8_DECIMALS = 6;

export type SessionStatus = 'active' | 'expired' | 'revoked';

export interface Session {
  id: bigint;
  owner: Address;
  sessionKey: Address;
  payees: Address[];
  perTxLimit: bigint;
  dailyLimit: bigint;
  /** Unix seconds. */
  expiry: number;
  revoked: boolean;
  /** Remaining spendable today (from remainingDailyAllowance). */
  remainingDaily: bigint;
  /** Optional human label — mock data only; live sessions have none. */
  label?: string;
  /** Vault version this session belongs to (1 = AgentPayVault, 2 = AgentPayVaultV2). */
  version?: 1 | 2;
  /** v2 only: cumulative cap per payee over the session's life. */
  perPayeeCap?: bigint;
  /** v2 only: per-payee spend vs cap (from spentPerPayee / remainingPayeeAllowance). */
  payeeSpend?: PayeeSpend[];
}

/** Per-payee spend against the session's per-payee cap (v2). */
export interface PayeeSpend {
  payee: Address;
  /** Registered name, when the payee is registered in the owner's namespace. */
  name?: string;
  spent: bigint;
  cap: bigint;
  remaining: bigint;
}

/** A payee registered in an owner's PayeeRegistry namespace (v2). */
export interface RegisteredPayee {
  payee: Address;
  name: string;
  /** Tx that registered (or last updated) the name, when known. */
  txHash?: `0x${string}`;
}

/**
 * A payment attempt that the vault REJECTED on-chain (reverted tx, status
 * 0x0). Reverted transactions emit no events, so these are recorded
 * evidence — each entry links to the explorer receipt, which is the
 * authoritative proof. Never generated from mock data.
 */
export interface RejectedPayment {
  txHash: `0x${string}`;
  block: number;
  /** Unix seconds (block time). */
  timestamp: number;
  sessionId: bigint;
  payee: Address;
  amount: bigint;
  attemptedName: string;
  /** On-chain revert reason (custom error name). */
  reason: 'PayeeNameMismatch' | 'PayeeNotRegistered';
  /** Plain-language explanation of what the check caught. */
  explanation: string;
}

export interface Payment {
  sessionId: bigint;
  payee: Address;
  amount: bigint;
  /** Unix seconds (from the event's timestamp arg). */
  timestamp: number;
  txHash: `0x${string}`;
  /** Optional human label — mock data only. */
  label?: string;
  /** Vault version this payment went through (1 = AgentPayVault, 2 = AgentPayVaultV2). */
  version?: 1 | 2;
  /** v2 only: registered payee name that the payment's name check matched. */
  payeeName?: string;
  /** v2 only: true when the payment passed the Confirmation of Payee check. */
  nameVerified?: boolean;
}

export function sessionStatus(s: Session, nowSec = Date.now() / 1000): SessionStatus {
  if (s.revoked) return 'revoked';
  if (s.expiry <= nowSec) return 'expired';
  return 'active';
}

/** Amount already spent today, derived from the daily limit + remaining. */
export function spentToday(s: Session): bigint {
  const spent = s.dailyLimit - s.remainingDaily;
  return spent < 0n ? 0n : spent;
}
