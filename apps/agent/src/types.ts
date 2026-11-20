/** Shared types for the AgentPay agent service. */

export interface Schedule {
  /** Stable id, used as the idempotency key in persisted state. */
  id: string;
  /** Vault session id whose session key will sign the payment. */
  sessionId: number;
  /** Recipient address (must be allowlisted in the session). */
  payee: `0x${string}`;
  /** Amount in tUSD8 (human units, 6 decimals), e.g. "5.0". */
  amount: string;
  /** Human interval, e.g. "30s", "1h", "1d", "1w", "1d12h". */
  every?: string;
  /** Interval in seconds. Wins over `every` when both are set. */
  intervalSeconds?: number;
  /** Inactive schedules are never executed. */
  active: boolean;
  /** Optional free-text note for humans. */
  note?: string;
}

export type ExecutionStatus = 'success' | 'skipped' | 'failed';

/** Skip / failure reasons. `ok` is only used internally (never persisted). */
export type SkipReason =
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'SESSION_NOT_FOUND'
  | 'PAYEE_NOT_ALLOWED'
  | 'PER_TX_LIMIT'
  | 'DAILY_LIMIT'
  | 'INSUFFICIENT_BALANCE'
  | 'INSUFFICIENT_GAS'
  | 'NO_SESSION_KEY'
  | 'RPC_ERROR'
  | 'REVERT'
  | 'UNKNOWN';

export interface ExecutionRecord {
  /** ISO timestamp of the attempt. */
  timestamp: string;
  scheduleId: string;
  sessionId: number;
  payee: string;
  /** Human tUSD8 amount. */
  amount: string;
  status: ExecutionStatus;
  /** Present on success. */
  txHash?: string;
  /** Machine-readable reason for skipped/failed attempts. */
  reason?: SkipReason;
  /** Human-readable detail (revert reason, RPC error message, ...). */
  detail?: string;
}

export interface ScheduleState {
  /** Period key (floor(now / intervalSeconds)) of the last successful payment. */
  lastPeriodKey: number | null;
  /** Unix seconds of the last successful payment. */
  lastExecutedAt: number | null;
  lastTxHash: string | null;
  lastStatus: ExecutionStatus | null;
  lastReason: SkipReason | null;
  lastDetail: string | null;
  /** Unix seconds of the last attempt (any outcome). */
  lastAttemptAt: number | null;
}

export interface AgentState {
  version: 1;
  schedules: Record<string, ScheduleState>;
  /** Most recent executions, newest first (capped). */
  executions: ExecutionRecord[];
}

export function emptyScheduleState(): ScheduleState {
  return {
    lastPeriodKey: null,
    lastExecutedAt: null,
    lastTxHash: null,
    lastStatus: null,
    lastReason: null,
    lastDetail: null,
    lastAttemptAt: null,
  };
}

export function emptyAgentState(): AgentState {
  return { version: 1, schedules: {}, executions: [] };
}
