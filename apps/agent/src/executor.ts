/**
 * Payment executor: preflight checks + pay() submission via the session key.
 *
 * Safety model — the executor NEVER trusts its own checks alone:
 *  1. Preflight reads (getSession / isPayeeAllowed / remainingDailyAllowance /
 *     vault balance) skip doomed payments early with a clear reason, so the
 *     service does not burn gas on transactions that would revert.
 *  2. `simulateContract` runs the exact pay() call off-chain first (starter
 *     kit pattern) — a revert here fails before any gas is spent.
 *  3. The vault contract itself is the final enforcer: allowlist, per-tx
 *     limit, daily limit, expiry, revocation, balance. Even if every
 *     preflight read were wrong, pay() cannot overpay.
 *
 * Aevum specifics: HTTP transport only (no subscriptions), and every
 * transaction is sent as LEGACY (type 0) — `type: "legacy"`.
 */

import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseUnits,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ERC20_ABI, TOKEN_DECIMALS, VAULT_ABI } from './abi.js';
import { chainForId } from './chain.js';
import type { AgentConfig } from './config.js';
import type { Logger } from './logger.js';
import { classifyFailure, isRpcError, withRetry } from './retry.js';
import type { ExecutionStatus, Schedule, SkipReason } from './types.js';

/** Mirrors the real AgentPayVault.Session struct (see abi.ts). */
export interface SessionInfo {
  sessionKey: Address;
  owner: Address;
  payees: readonly Address[];
  perTxLimit: bigint;
  dailyLimit: bigint;
  spentToday: bigint;
  lastSpendDay: bigint;
  expiry: bigint;
  revoked: boolean;
  exists: boolean;
}

/** Preflight view results. `null` = the view call failed/unavailable (degraded mode). */
export interface PreflightData {
  session: SessionInfo | null;
  payeeAllowed: boolean | null;
  dailyRemaining: bigint | null;
  vaultBalance: bigint | null;
  /** Native-token balance of the session key (gas money). */
  sessionKeyNativeBalance: bigint | null;
}

export interface ExecuteResult {
  status: ExecutionStatus;
  txHash?: string;
  reason?: SkipReason;
  detail?: string;
}

/**
 * Pure preflight decision: given the view results, should this payment be
 * skipped (and why)? Returns null when the payment may proceed.
 * Unknown (null) fields are treated as "pass" — the on-chain pay() call is
 * the final enforcer, so degraded preflight never blocks a valid payment.
 */
export function decidePreflight(
  data: PreflightData,
  amountRaw: bigint,
  nowSec: number,
): { reason: SkipReason; detail: string } | null {
  const { session, payeeAllowed, dailyRemaining, vaultBalance, sessionKeyNativeBalance } = data;
  if (sessionKeyNativeBalance !== null && sessionKeyNativeBalance === 0n) {
    return {
      reason: 'INSUFFICIENT_GAS',
      detail: 'session key holds no native token for gas — fund it with tQDAY before it can pay',
    };
  }
  if (session) {
    if (!session.exists) return { reason: 'SESSION_NOT_FOUND', detail: 'session does not exist' };
    if (session.revoked) return { reason: 'SESSION_REVOKED', detail: 'session has been revoked by the owner' };
    if (session.expiry <= BigInt(nowSec)) {
      return {
        reason: 'SESSION_EXPIRED',
        detail: `session expired at ${new Date(Number(session.expiry) * 1000).toISOString()}`,
      };
    }
    if (amountRaw > session.perTxLimit) {
      return {
        reason: 'PER_TX_LIMIT',
        detail: `amount ${formatUnits(amountRaw, TOKEN_DECIMALS)} tUSD8 exceeds per-tx limit ${formatUnits(session.perTxLimit, TOKEN_DECIMALS)} tUSD8`,
      };
    }
  }
  if (payeeAllowed === false) return { reason: 'PAYEE_NOT_ALLOWED', detail: 'payee is not allowlisted in this session' };
  if (dailyRemaining !== null && amountRaw > dailyRemaining) {
    return {
      reason: 'DAILY_LIMIT',
      detail: `amount ${formatUnits(amountRaw, TOKEN_DECIMALS)} tUSD8 exceeds remaining daily allowance ${formatUnits(dailyRemaining, TOKEN_DECIMALS)} tUSD8`,
    };
  }
  if (vaultBalance !== null && amountRaw > vaultBalance) {
    return {
      reason: 'INSUFFICIENT_BALANCE',
      detail: `vault holds ${formatUnits(vaultBalance, TOKEN_DECIMALS)} tUSD8, payment needs ${formatUnits(amountRaw, TOKEN_DECIMALS)} tUSD8`,
    };
  }
  return null;
}

/** Probe the RPC's chain id and build clients for the real chain (starter kit pattern). */
export async function createPublicClientFor(config: AgentConfig): Promise<PublicClient> {
  const probe = createPublicClient({ transport: http(config.rpcUrl) });
  const probedChainId = await probe.getChainId();
  if (probedChainId !== config.chainId) {
    // Trust the chain, not the env var: a wrong CHAIN_ID would sign
    // transactions for the wrong chain. Warn loudly instead of failing.
    console.warn(
      `[warn] CHAIN_ID env (${config.chainId}) != RPC chain id (${probedChainId}); using ${probedChainId}`,
    );
  }
  const chain = chainForId(probedChainId, config.rpcUrl);
  return createPublicClient({ chain, transport: http(config.rpcUrl) });
}

export class Executor {
  private readonly walletClients = new Map<number, WalletClient<Transport, Chain, Account>>();

  constructor(
    private readonly publicClient: PublicClient,
    private readonly config: AgentConfig,
    private readonly logger: Logger,
  ) {}

  private walletClientFor(sessionId: number): WalletClient<Transport, Chain, Account> | null {
    const cached = this.walletClients.get(sessionId);
    if (cached) return cached;
    const key = this.config.sessionKeys.get(sessionId);
    if (!key) return null;
    const chain = this.publicClient.chain;
    if (!chain) throw new Error('public client has no chain configured');
    const account = privateKeyToAccount(key as Hex);
    const client = createWalletClient({
      account,
      chain,
      transport: http(this.config.rpcUrl),
    });
    this.walletClients.set(sessionId, client);
    return client;
  }

  /** Read a view with RPC retry; returns null (and logs a warning) on any failure. */
  private async readView<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await withRetry(fn, {
        maxAttempts: this.config.maxRetries,
        baseMs: this.config.retryBaseMs,
        onRetry: (attempt, err, delayMs) =>
          this.logger.warn(`RPC retry ${attempt} for ${label}`, { delayMs, error: String(err) }),
      });
    } catch (err) {
      this.logger.warn(`preflight view ${label} unavailable, continuing in degraded mode`, {
        error: String(err).slice(0, 200),
      });
      return null;
    }
  }

  private async preflight(schedule: Schedule, sessionKeyAddress: Address): Promise<PreflightData> {
    const { vaultAddress, tokenAddress } = this.config;
    const sessionId = BigInt(schedule.sessionId);
    const [session, payeeAllowed, dailyRemaining, vaultBalance, sessionKeyNativeBalance] = await Promise.all([
      this.readView('getSession', async () => {
        const raw = (await this.publicClient.readContract({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: 'getSession',
          args: [sessionId],
        })) as unknown;
        // viem returns struct results either as a positional tuple (array)
        // or as an object with named properties, depending on version and
        // ABI shape — accept both.
        const byIndex = (i: number) => (Array.isArray(raw) ? raw[i] : undefined);
        const byName = (name: string) =>
          raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>)[name] : undefined;
        const pick = <T>(i: number, name: string): T => {
          const v = byIndex(i) ?? byName(name);
          if (v === undefined) throw new Error(`getSession: missing field ${name} (index ${i})`);
          return v as T;
        };
        return {
          sessionKey: pick<Address>(0, 'sessionKey'),
          owner: pick<Address>(1, 'owner'),
          payees: pick<readonly Address[]>(2, 'payees'),
          perTxLimit: pick<bigint>(3, 'perTxLimit'),
          dailyLimit: pick<bigint>(4, 'dailyLimit'),
          spentToday: pick<bigint>(5, 'spentToday'),
          lastSpendDay: pick<bigint>(6, 'lastSpendDay'),
          expiry: pick<bigint>(7, 'expiry'),
          revoked: pick<boolean>(8, 'revoked'),
          exists: pick<boolean>(9, 'exists'),
        } satisfies SessionInfo;
      }),
      this.readView('isPayeeAllowed', () =>
        this.publicClient.readContract({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: 'isPayeeAllowed',
          args: [sessionId, schedule.payee],
        }),
      ),
      this.readView('remainingDailyAllowance', () =>
        this.publicClient.readContract({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: 'remainingDailyAllowance',
          args: [sessionId],
        }),
      ),
      this.readView('vaultBalance', () =>
        this.publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [vaultAddress],
        }),
      ),
      this.readView('sessionKeyNativeBalance', () =>
        this.publicClient.getBalance({ address: sessionKeyAddress }),
      ),
    ]);
    return { session, payeeAllowed, dailyRemaining, vaultBalance, sessionKeyNativeBalance };
  }

  /**
   * Execute one due payment. NEVER throws for an expected failure — every
   * outcome is returned as an ExecuteResult (skip / fail / success) so the
   * agent loop keeps running. Only truly unexpected bugs propagate.
   */
  async execute(schedule: Schedule, nowSec: number): Promise<ExecuteResult> {
    const amountRaw = parseUnits(schedule.amount, TOKEN_DECIMALS);
    const wallet = this.walletClientFor(schedule.sessionId);
    if (!wallet) {
      return {
        status: 'skipped',
        reason: 'NO_SESSION_KEY',
        detail: `no session key configured for session ${schedule.sessionId} (SESSION_KEYS_JSON / SESSION_KEY_${schedule.sessionId})`,
      };
    }

    const data = await this.preflight(schedule, wallet.account.address);
    const skip = decidePreflight(data, amountRaw, nowSec);
    if (skip) return { status: 'skipped', ...skip };

    // Simulate the exact call first: a revert here costs no gas and gives
    // the precise reason (covers races between preflight and mining).
    try {
      await withRetry(
        () =>
          this.publicClient.simulateContract({
            account: wallet.account.address,
            address: this.config.vaultAddress,
            abi: VAULT_ABI,
            functionName: 'pay',
            args: [BigInt(schedule.sessionId), schedule.payee, amountRaw],
          }),
        { maxAttempts: this.config.maxRetries, baseMs: this.config.retryBaseMs },
      );
    } catch (err) {
      if (isRpcError(err)) {
        return { status: 'failed', reason: 'RPC_ERROR', detail: `simulation failed after retries: ${String(err).slice(0, 200)}` };
      }
      const { reason, detail } = classifyFailure(err);
      return { status: 'skipped', reason, detail: `simulation reverted: ${detail}` };
    }

    // Send as a LEGACY (type 0) transaction — required on Aevum.
    let txHash: `0x${string}`;
    try {
      txHash = await withRetry(
        () =>
          wallet.writeContract({
            address: this.config.vaultAddress,
            abi: VAULT_ABI,
            functionName: 'pay',
            args: [BigInt(schedule.sessionId), schedule.payee, amountRaw],
            type: 'legacy',
          }),
        {
          maxAttempts: this.config.maxRetries,
          baseMs: this.config.retryBaseMs,
          onRetry: (attempt, err, delayMs) =>
            this.logger.warn(`RPC retry ${attempt} sending pay() for ${schedule.id}`, { delayMs, error: String(err) }),
        },
      );
    } catch (err) {
      const { reason, detail } = classifyFailure(err);
      return { status: 'failed', reason, detail: `send failed: ${detail}` };
    }

    try {
      const receipt = await withRetry(
        () => this.publicClient.waitForTransactionReceipt({ hash: txHash }),
        { maxAttempts: this.config.maxRetries, baseMs: this.config.retryBaseMs },
      );
      if (receipt.status === 'reverted') {
        return {
          status: 'failed',
          reason: 'REVERT',
          detail: `transaction ${txHash} reverted on-chain`,
          txHash,
        };
      }
      return { status: 'success', txHash };
    } catch (err) {
      // The tx was broadcast but the receipt is unknown (RPC down mid-wait).
      // Report as failed WITHOUT marking the period paid — but the tx may
      // still land. The next tick will retry the same period; the on-chain
      // daily limit bounds the damage, and the operator sees the tx hash.
      return {
        status: 'failed',
        reason: 'RPC_ERROR',
        detail: `tx ${txHash} sent but receipt unconfirmed after retries (check explorer before re-running)`,
        txHash,
      };
    }
  }
}
