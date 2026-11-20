/** Retry with exponential backoff (RPC/network failures only) + failure classification. */

import type { SkipReason } from './types.js';

export interface RetryOptions {
  maxAttempts: number;
  baseMs: number;
  /** Return true if the error is transient and worth retrying. Default: isRpcError. */
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Heuristic: is this error a transient RPC/network problem (retryable)? */
export function isRpcError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; message?: string; code?: number | string };
    // viem reverts are deterministic — never retry.
    if (e.name === 'ContractFunctionRevertedError' || e.name === 'ContractFunctionExecutionError') return false;
    const msg = `${e.name ?? ''} ${e.message ?? ''}`.toLowerCase();
    if (/revert|execution reverted|invalid opcode|out of gas/.test(msg)) return false;
    if (
      /fetch failed|network|timeout|timed out|econnreset|econnrefused|enotfound|socket hang up|429|rate limit|too many requests|temporarily unavailable|bad gateway|service unavailable|gateway timeout|internal server error|connection/.test(
        msg,
      )
    ) {
      return true;
    }
    if (typeof e.code === 'number' && e.code >= 500) return true;
  }
  return false;
}

/** Run fn with exponential backoff: base * 2^attempt + jitter. Re-throws the last error. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const isRetryable = opts.isRetryable ?? isRpcError;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= opts.maxAttempts || !isRetryable(err)) throw err;
      const delay = opts.baseMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      opts.onRetry?.(attempt, err, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Map a thrown error (typically a viem revert) to a machine-readable reason.
 *
 * Order matters:
 *  1. Known custom-error names from the real AgentPayVault (viem decodes
 *     them when they are in the ABI) — exact matches, no false positives.
 *  2. Gas-funds failures (the SESSION KEY is out of native token for gas —
 *     distinct from the vault being out of tUSD8).
 *  3. Tight generic patterns, applied to the FIRST 500 chars only: viem
 *     error messages append the full call (including the ABI signature
 *     "pay(uint256 sessionId, address payee, ...)", which contains the word
 *     "payee"), so loose patterns over the whole message misclassify.
 */
export function classifyFailure(err: unknown): { reason: SkipReason; detail: string } {
  const detail = err instanceof Error ? err.message : String(err);
  if (isRpcError(err)) return { reason: 'RPC_ERROR', detail: short(detail) };
  const head = detail.slice(0, 500);
  const lower = head.toLowerCase();

  // 1. Exact custom-error names (real vault contract).
  const known: Array<[RegExp, SkipReason]> = [
    [/\bsessionexpired\b/i, 'SESSION_EXPIRED'],
    [/\bsessionisrevoked\b/i, 'SESSION_REVOKED'],
    [/\bsessionnotfound\b/i, 'SESSION_NOT_FOUND'],
    [/\bpayeenotallowed\b/i, 'PAYEE_NOT_ALLOWED'],
    [/\bexceedsdailylimit\b/i, 'DAILY_LIMIT'],
    [/\bexceedspertxlimit\b/i, 'PER_TX_LIMIT'],
    [/\binsufficientbalance\b/i, 'INSUFFICIENT_BALANCE'],
    [/\bnotsessionkey\b/i, 'SESSION_NOT_FOUND'],
    [/\bnotsessionowner\b/i, 'SESSION_NOT_FOUND'],
    [/\binvalidexpiry\b/i, 'SESSION_EXPIRED'],
  ];
  for (const [re, reason] of known) {
    if (re.test(head)) return { reason, detail: short(detail) };
  }

  // 2. Session key out of native token for gas (NOT vault tUSD8).
  if (/insufficient funds for gas|gas \* price \+ value|total cost \(gas/.test(lower)) {
    return { reason: 'INSUFFICIENT_GAS', detail: short(detail) };
  }

  // 3. Tight generic fallbacks (head only).
  if (/expir/.test(lower)) return { reason: 'SESSION_EXPIRED', detail: short(detail) };
  if (/revok/.test(lower)) return { reason: 'SESSION_REVOKED', detail: short(detail) };
  if (/session.*not.*found|invalid session|unknown session|no such session|not.*session key|caller is not/.test(lower)) {
    return { reason: 'SESSION_NOT_FOUND', detail: short(detail) };
  }
  if (/payee.*not.*allow|not.*allowlist|payee not in/.test(lower)) {
    return { reason: 'PAYEE_NOT_ALLOWED', detail: short(detail) };
  }
  if (/daily/.test(lower)) return { reason: 'DAILY_LIMIT', detail: short(detail) };
  if (/per[- ]?tx|per[- ]?transaction/.test(lower)) return { reason: 'PER_TX_LIMIT', detail: short(detail) };
  if (/insufficient|exceeds balance|not enough/.test(lower)) return { reason: 'INSUFFICIENT_BALANCE', detail: short(detail) };
  if (/limit|exceed/.test(lower)) return { reason: 'DAILY_LIMIT', detail: short(detail) };
  if (/revert/.test(lower)) return { reason: 'REVERT', detail: short(detail) };
  return { reason: 'UNKNOWN', detail: short(detail) };
}

function short(msg: string, max = 300): string {
  const oneLine = msg.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
