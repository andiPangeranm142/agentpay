import { describe, expect, it, vi } from 'vitest';
import { decidePreflight, type PreflightData, type SessionInfo } from '../src/executor.js';
import { chunkRanges } from '../src/events.js';
import { classifyFailure, isRpcError, withRetry } from '../src/retry.js';

const session = (over: Partial<SessionInfo> = {}): SessionInfo => ({
  sessionKey: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  payees: ['0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'],
  perTxLimit: 10_000_000n, // 10 tUSD8
  dailyLimit: 25_000_000n,
  spentToday: 0n,
  lastSpendDay: 0n,
  expiry: 2_000_000_000n,
  revoked: false,
  exists: true,
  ...over,
});

const data = (over: Partial<PreflightData> = {}): PreflightData => ({
  session: session(),
  payeeAllowed: true,
  dailyRemaining: 25_000_000n,
  vaultBalance: 1_000_000_000n,
  sessionKeyNativeBalance: 1_000_000_000_000_000_000n,
  ...over,
});

const NOW = 1_700_000_000;

describe('decidePreflight', () => {
  it('passes a healthy payment', () => {
    expect(decidePreflight(data(), 5_000_000n, NOW)).toBeNull();
  });
  it('skips a nonexistent session', () => {
    const r = decidePreflight(data({ session: session({ exists: false }) }), 1_000_000n, NOW);
    expect(r?.reason).toBe('SESSION_NOT_FOUND');
  });
  it('skips a revoked session', () => {
    const r = decidePreflight(data({ session: session({ revoked: true }) }), 1_000_000n, NOW);
    expect(r?.reason).toBe('SESSION_REVOKED');
  });
  it('skips an expired session', () => {
    const r = decidePreflight(data({ session: session({ expiry: 1_699_999_999n }) }), 1_000_000n, NOW);
    expect(r?.reason).toBe('SESSION_EXPIRED');
  });
  it('skips when the amount exceeds the per-tx limit', () => {
    const r = decidePreflight(data(), 10_000_001n, NOW);
    expect(r?.reason).toBe('PER_TX_LIMIT');
  });
  it('allows exactly the per-tx limit', () => {
    expect(decidePreflight(data(), 10_000_000n, NOW)).toBeNull();
  });
  it('skips a non-allowlisted payee', () => {
    expect(decidePreflight(data({ payeeAllowed: false }), 1_000_000n, NOW)?.reason).toBe('PAYEE_NOT_ALLOWED');
  });
  it('skips when the daily allowance is exhausted', () => {
    expect(decidePreflight(data({ dailyRemaining: 4_000_000n }), 5_000_000n, NOW)?.reason).toBe('DAILY_LIMIT');
  });
  it('skips on insufficient vault balance', () => {
    expect(decidePreflight(data({ vaultBalance: 4_000_000n }), 5_000_000n, NOW)?.reason).toBe('INSUFFICIENT_BALANCE');
  });
  it('skips when the session key has no native token for gas', () => {
    const r = decidePreflight(data({ sessionKeyNativeBalance: 0n }), 1_000_000n, NOW);
    expect(r?.reason).toBe('INSUFFICIENT_GAS');
    expect(r?.detail).toMatch(/tQDAY/);
  });
  it('degrades gracefully when views are unavailable (on-chain pay() enforces)', () => {
    expect(decidePreflight({ session: null, payeeAllowed: null, dailyRemaining: null, vaultBalance: null, sessionKeyNativeBalance: null }, 5_000_000n, NOW)).toBeNull();
  });
  it('checks revocation before expiry before limits', () => {
    const r = decidePreflight(
      data({ session: session({ revoked: true, expiry: 1n }), payeeAllowed: false }),
      999_000_000n,
      NOW,
    );
    expect(r?.reason).toBe('SESSION_REVOKED');
  });
});

describe('classifyFailure', () => {
  const cases: Array<[string, string]> = [
    ['SessionExpired()', 'SESSION_EXPIRED'],
    ['session has expired', 'SESSION_EXPIRED'],
    ['SessionIsRevoked()', 'SESSION_REVOKED'],
    ['SessionRevoked()', 'SESSION_REVOKED'],
    ['session is revoked', 'SESSION_REVOKED'],
    ['SessionNotFound()', 'SESSION_NOT_FOUND'],
    ['invalid session', 'SESSION_NOT_FOUND'],
    ['caller is not the session key', 'SESSION_NOT_FOUND'],
    ['NotSessionKey()', 'SESSION_NOT_FOUND'],
    ['PayeeNotAllowed()', 'PAYEE_NOT_ALLOWED'],
    ['PayeeNotAllowlisted()', 'PAYEE_NOT_ALLOWED'],
    ['payee not in allowlist', 'PAYEE_NOT_ALLOWED'],
    ['ExceedsDailyLimit()', 'DAILY_LIMIT'],
    ['DailyLimitExceeded()', 'DAILY_LIMIT'],
    ['exceeds daily limit', 'DAILY_LIMIT'],
    ['ExceedsPerTxLimit()', 'PER_TX_LIMIT'],
    ['PerTxLimitExceeded()', 'PER_TX_LIMIT'],
    ['amount exceeds per-tx limit', 'PER_TX_LIMIT'],
    ['InsufficientBalance()', 'INSUFFICIENT_BALANCE'],
    ['ERC20: transfer amount exceeds balance', 'INSUFFICIENT_BALANCE'],
    ['insufficient vault balance', 'INSUFFICIENT_BALANCE'],
    ['fetch failed', 'RPC_ERROR'],
    ['HTTP request failed. Status: 429', 'RPC_ERROR'],
    ['execution reverted: unknown custom error', 'REVERT'],
    // Session key out of gas money — must NOT be confused with vault balance.
    ['Insufficient funds for gas * price + value', 'INSUFFICIENT_GAS'],
    ['The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account', 'INSUFFICIENT_GAS'],
    // viem appends the ABI signature ("address payee") to every error — the
    // word "payee" alone must never classify as PAYEE_NOT_ALLOWED.
    ['The total cost (gas * gas fee + value) exceeds the balance. Contract Call: function pay(uint256 sessionId, address payee, uint256 amount)', 'INSUFFICIENT_GAS'],
  ];
  for (const [msg, reason] of cases) {
    it(`"${msg}" -> ${reason}`, () => {
      expect(classifyFailure(new Error(msg)).reason).toBe(reason);
    });
  }
  it('unknown errors -> UNKNOWN', () => {
    expect(classifyFailure(new Error('something weird happened')).reason).toBe('UNKNOWN');
  });
});

describe('isRpcError', () => {
  it('treats reverts as non-retryable', () => {
    const e = new Error('execution reverted');
    e.name = 'ContractFunctionRevertedError';
    expect(isRpcError(e)).toBe(false);
    expect(isRpcError(new Error('execution reverted: SessionExpired()'))).toBe(false);
  });
  it('treats network failures as retryable', () => {
    expect(isRpcError(new Error('fetch failed'))).toBe(true);
    expect(isRpcError(new Error('socket hang up'))).toBe(true);
    expect(isRpcError(new Error('429 Too Many Requests'))).toBe(true);
  });
});

describe('withRetry', () => {
  it('returns on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    await expect(withRetry(fn, { maxAttempts: 3, baseMs: 1 })).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('retries RPC errors with backoff and then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue('ok');
    await expect(withRetry(fn, { maxAttempts: 5, baseMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it('does NOT retry reverts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('execution reverted: SessionExpired()'));
    await expect(withRetry(fn, { maxAttempts: 5, baseMs: 1 })).rejects.toThrow('SessionExpired');
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('gives up after maxAttempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fetch failed'));
    await expect(withRetry(fn, { maxAttempts: 3, baseMs: 1 })).rejects.toThrow('fetch failed');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('chunkRanges (Aevum 1,000-block eth_getLogs limit)', () => {
  it('returns a single window for a small range', () => {
    expect(chunkRanges(100n, 150n)).toEqual([[100n, 150n]]);
  });
  it('splits exactly at 1,000-block boundaries', () => {
    expect(chunkRanges(0n, 999n)).toEqual([[0n, 999n]]);
    expect(chunkRanges(0n, 1000n)).toEqual([
      [0n, 999n],
      [1000n, 1000n],
    ]);
  });
  it('splits a large range into 1,000-block windows', () => {
    const ranges = chunkRanges(0n, 2500n);
    expect(ranges).toEqual([
      [0n, 999n],
      [1000n, 1999n],
      [2000n, 2500n],
    ]);
    // Windows are contiguous and cover the whole range.
    expect(ranges[0][0]).toBe(0n);
    expect(ranges[ranges.length - 1][1]).toBe(2500n);
  });
  it('returns no windows for an empty range', () => {
    expect(chunkRanges(100n, 99n)).toEqual([]);
  });
  it('rejects steps over the Aevum limit', () => {
    expect(() => chunkRanges(0n, 10n, 1001n)).toThrow(/step must be between 1 and 1000/);
    expect(() => chunkRanges(0n, 10n, 0n)).toThrow();
  });
});
