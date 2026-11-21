import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
  type PublicClient,
} from 'viem';
import type { AppConfig } from '../config';
import { ZERO_ADDRESS } from '../config';
import { aevumTestnet } from './chain';
import { ERC20_ABI, REGISTRY_ABI, VAULT_ABI, VAULT_V2_ABI } from './abi';
import {
  MOCK_PAYMENTS,
  MOCK_REGISTERED_PAYEES,
  MOCK_SESSIONS,
  MOCK_V2_PAYMENTS,
  MOCK_V2_SESSIONS,
  MOCK_VAULT_BALANCE,
  MOCK_WALLET_BALANCE,
} from './mock';
import type { Payment, RegisteredPayee, Session } from './types';

/**
 * DATA LAYER — the single seam between the UI and the chain.
 *
 *   VaultDataProvider  — interface every screen reads through.
 *   LiveProvider       — real viem reads against AgentPayVault + tUSD8.
 *   MockProvider       — realistic demo data, zero RPC calls.
 *
 * createProvider(config) picks the implementation from config.mode, so
 * switching mock -> live is a config change (deployments.json / env),
 * not a rewrite. Writes (deposit/withdraw/createSession/revoke) go
 * through wagmi's useWriteContract in the components, using the same
 * VAULT_ABI — they are disabled while in mock mode.
 *
 * AEVUM QUIRKS (verified against the official starter kit docs):
 *   - RPC is HTTPS-only, no WebSocket: all reads poll over HTTP (viem's
 *     default for http() transports). No watchContractEvent anywhere.
 *   - eth_getLogs is limited to 1,000 blocks per query: every event scan
 *     is chunked into <=1,000-block windows starting at the vault's
 *     deploy block (from deployments.json) — same pattern as the kit's
 *     getLogsChunked. Chunks run 8-at-a-time to stay fast.
 *   - Transactions must be LEGACY (type 0): every writeContract call in
 *     the components sets `type: 'legacy'`.
 *
 * ABI verified field-for-field against contracts/src/AgentPayVault.sol
 * (20 Nov 2026). Vault balance is a single `balances(owner)` read (the
 * mapping is public). Sessions are discovered via SessionCreated events
 * filtered by owner, then enriched with getSession +
 * remainingDailyAllowance per id.
 */

export interface VaultDataProvider {
  readonly mode: 'live' | 'mock';
  getVaultBalance(owner: Address): Promise<bigint>;
  getWalletTusd8Balance(owner: Address): Promise<bigint>;
  getAllowance(owner: Address): Promise<bigint>;
  listSessions(owner: Address): Promise<Session[]>;
  listPayments(owner: Address): Promise<Payment[]>;
  // --- v2: Confirmation of Payee (PayeeRegistry + AgentPayVaultV2) ---
  /** Registered name for (owner, payee); '' when unregistered or v2 is unconfigured. */
  getPayeeName(owner: Address, payee: Address): Promise<string>;
  /** Payees registered in the owner's registry namespace (live: event scan + nameOf). */
  listRegisteredPayees(owner: Address): Promise<RegisteredPayee[]>;
  /** Sessions on the v2 vault, with per-payee cap + spend per payee. */
  listV2Sessions(owner: Address): Promise<Session[]>;
  /** Payments on the v2 vault, enriched with the registered payee name. */
  listV2Payments(owner: Address): Promise<Payment[]>;
}

export function createProvider(config: AppConfig): VaultDataProvider {
  return config.mode === 'live' ? new LiveProvider(config) : new MockProvider();
}

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

class MockProvider implements VaultDataProvider {
  readonly mode = 'mock' as const;

  async getVaultBalance(): Promise<bigint> {
    return MOCK_VAULT_BALANCE;
  }
  async getWalletTusd8Balance(): Promise<bigint> {
    return MOCK_WALLET_BALANCE;
  }
  async getAllowance(): Promise<bigint> {
    return 0n;
  }
  async listSessions(): Promise<Session[]> {
    return MOCK_SESSIONS;
  }
  async listPayments(): Promise<Payment[]> {
    return MOCK_PAYMENTS;
  }
  async getPayeeName(_owner: Address, payee: Address): Promise<string> {
    return MOCK_REGISTERED_PAYEES.find((p) => p.payee.toLowerCase() === payee.toLowerCase())?.name ?? '';
  }
  async listRegisteredPayees(): Promise<RegisteredPayee[]> {
    return MOCK_REGISTERED_PAYEES;
  }
  async listV2Sessions(): Promise<Session[]> {
    return MOCK_V2_SESSIONS;
  }
  async listV2Payments(): Promise<Payment[]> {
    return MOCK_V2_PAYMENTS;
  }
}

// ---------------------------------------------------------------------------
// Live (viem reads against the frozen AgentPayVault interface)
// ---------------------------------------------------------------------------

/** Aevum rejects eth_getLogs over more than 1,000 blocks. */
const LOG_CHUNK_BLOCKS = 1000n;
/** How many chunk queries to run in parallel. */
const LOG_CHUNK_CONCURRENCY = 8;
/** Fallback scan window when no deploy block is known (10 chunks). */
const FALLBACK_LOOKBACK_BLOCKS = 10_000n;

/**
 * Run `fetchRange` over [fromBlock, toBlock] in <=1,000-block windows,
 * `LOG_CHUNK_CONCURRENCY` windows at a time, and flatten the results.
 * Same idea as the starter kit's getLogsChunked (MIT, PQA Labs) —
 * reimplemented here for this app's viem client.
 */
async function chunked<T>(
  fromBlock: bigint,
  toBlock: bigint,
  fetchRange: (from: bigint, to: bigint) => Promise<T[]>,
): Promise<T[]> {
  const ranges: Array<[bigint, bigint]> = [];
  for (let from = fromBlock; from <= toBlock; from += LOG_CHUNK_BLOCKS) {
    const to = from + LOG_CHUNK_BLOCKS - 1n > toBlock ? toBlock : from + LOG_CHUNK_BLOCKS - 1n;
    ranges.push([from, to]);
  }
  const out: T[] = [];
  for (let i = 0; i < ranges.length; i += LOG_CHUNK_CONCURRENCY) {
    const batch = await Promise.all(
      ranges.slice(i, i + LOG_CHUNK_CONCURRENCY).map(([f, t]) => fetchRange(f, t)),
    );
    for (const items of batch) out.push(...items);
  }
  return out;
}

class LiveProvider implements VaultDataProvider {
  readonly mode = 'live' as const;
  private client: PublicClient;
  private cfg: AppConfig;

  constructor(cfg: AppConfig) {
    this.cfg = cfg;
    this.client = createPublicClient({
      chain: aevumTestnet,
      transport: http(cfg.rpcUrl),
    });
  }

  /** Block range to scan for vault events: deploy block -> latest. */
  private async scanRange(): Promise<{ from: bigint; to: bigint }> {
    const to = await this.client.getBlockNumber();
    if (this.cfg.deploymentBlock !== undefined) {
      return { from: this.cfg.deploymentBlock, to };
    }
    const from = to > FALLBACK_LOOKBACK_BLOCKS ? to - FALLBACK_LOOKBACK_BLOCKS : 0n;
    return { from, to };
  }

  async getVaultBalance(owner: Address): Promise<bigint> {
    // `balances` is a public mapping on the vault: one exact read.
    return this.client.readContract({
      address: this.cfg.vaultAddress,
      abi: VAULT_ABI,
      functionName: 'balances',
      args: [owner],
    });
  }

  async getWalletTusd8Balance(owner: Address): Promise<bigint> {
    return this.client.readContract({
      address: this.cfg.tusd8Address,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [owner],
    });
  }

  async getAllowance(owner: Address): Promise<bigint> {
    return this.client.readContract({
      address: this.cfg.tusd8Address,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner, this.cfg.vaultAddress],
    });
  }

  async listSessions(owner: Address): Promise<Session[]> {
    const { from, to } = await this.scanRange();
    const created = await chunked(from, to, (f, t) =>
      this.client.getLogs({
        address: this.cfg.vaultAddress,
        event: parseAbiItem(
          'event SessionCreated(uint256 indexed sessionId, address indexed owner, address indexed sessionKey, uint256 perTxLimit, uint256 dailyLimit, uint64 expiry)',
        ),
        args: { owner },
        fromBlock: f,
        toBlock: t,
      }),
    );

    const sessions = await Promise.all(
      created.map(async (log) => {
        const id = log.args.sessionId ?? 0n;
        const [s, remaining] = await Promise.all([
          this.client.readContract({
            address: this.cfg.vaultAddress,
            abi: VAULT_ABI,
            functionName: 'getSession',
            args: [id],
          }),
          this.client.readContract({
            address: this.cfg.vaultAddress,
            abi: VAULT_ABI,
            functionName: 'remainingDailyAllowance',
            args: [id],
          }),
        ]);
        return {
          id,
          owner: s.owner,
          sessionKey: s.sessionKey,
          payees: [...s.payees],
          perTxLimit: s.perTxLimit,
          dailyLimit: s.dailyLimit,
          expiry: Number(s.expiry),
          revoked: s.revoked,
          remainingDaily: remaining,
          version: 1,
        } satisfies Session;
      }),
    );
    // Newest first.
    return sessions.sort((a, b) => (a.id > b.id ? -1 : 1));
  }

  async listPayments(owner: Address): Promise<Payment[]> {
    // Discover the owner's session ids first, then filter PaymentExecuted
    // by those ids (avoids showing other users' payments).
    const sessions = await this.listSessions(owner);
    if (sessions.length === 0) return [];
    const ids = sessions.map((s) => s.id);
    const { from, to } = await this.scanRange();

    const logs = await chunked(from, to, (f, t) =>
      this.client.getLogs({
        address: this.cfg.vaultAddress,
        event: parseAbiItem(
          'event PaymentExecuted(uint256 indexed sessionId, address indexed payee, uint256 amount, uint256 timestamp)',
        ),
        args: { sessionId: ids },
        fromBlock: f,
        toBlock: t,
      }),
    );

    return logs
      .map((l) => ({
        sessionId: l.args.sessionId ?? 0n,
        payee: (l.args.payee ?? '0x0000000000000000000000000000000000000000') as Address,
        amount: l.args.amount ?? 0n,
        timestamp: Number(l.args.timestamp ?? 0n),
        txHash: l.transactionHash,
        version: 1 as const,
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  // --- v2: Confirmation of Payee -------------------------------------------

  private get v2Configured(): boolean {
    return this.cfg.vaultV2Address !== ZERO_ADDRESS;
  }

  private get registryConfigured(): boolean {
    return this.cfg.registryAddress !== ZERO_ADDRESS;
  }

  /** Block range for v2 event scans: v2 deploy block -> latest. */
  private async v2ScanRange(): Promise<{ from: bigint; to: bigint }> {
    const to = await this.client.getBlockNumber();
    if (this.cfg.v2DeploymentBlock !== undefined) {
      return { from: this.cfg.v2DeploymentBlock, to };
    }
    const from = to > FALLBACK_LOOKBACK_BLOCKS ? to - FALLBACK_LOOKBACK_BLOCKS : 0n;
    return { from, to };
  }

  async getPayeeName(owner: Address, payee: Address): Promise<string> {
    if (!this.registryConfigured) return '';
    try {
      return await this.client.readContract({
        address: this.cfg.registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'nameOf',
        args: [owner, payee],
      });
    } catch {
      return '';
    }
  }

  async listRegisteredPayees(owner: Address): Promise<RegisteredPayee[]> {
    if (!this.registryConfigured) return [];
    const { from, to } = await this.v2ScanRange();

    // Registry events are per-owner (owner is indexed). Rebuild the
    // namespace in chronological order: register/update set the name,
    // remove deletes it. Sort by (blockNumber, logIndex) across event
    // types — the three scans return independent lists.
    type RegLog = {
      payee: Address;
      name: string | null; // null = removed
      txHash: `0x${string}`;
      blockNumber: bigint;
      logIndex: number;
    };
    const logs = await chunked(from, to, async (f, t) => {
      const [registered, updated, removed] = await Promise.all([
        this.client.getLogs({
          address: this.cfg.registryAddress,
          event: parseAbiItem(
            'event PayeeRegistered(address indexed owner, address indexed payee, string name)',
          ),
          args: { owner },
          fromBlock: f,
          toBlock: t,
        }),
        this.client.getLogs({
          address: this.cfg.registryAddress,
          event: parseAbiItem(
            'event PayeeUpdated(address indexed owner, address indexed payee, string oldName, string newName)',
          ),
          args: { owner },
          fromBlock: f,
          toBlock: t,
        }),
        this.client.getLogs({
          address: this.cfg.registryAddress,
          event: parseAbiItem(
            'event PayeeRemoved(address indexed owner, address indexed payee, string oldName)',
          ),
          args: { owner },
          fromBlock: f,
          toBlock: t,
        }),
      ]);
      const out: RegLog[] = [];
      for (const l of registered) {
        if (l.args.payee && l.args.name !== undefined) {
          out.push({
            payee: l.args.payee,
            name: l.args.name,
            txHash: l.transactionHash,
            blockNumber: l.blockNumber,
            logIndex: l.logIndex,
          });
        }
      }
      for (const l of updated) {
        if (l.args.payee && l.args.newName !== undefined) {
          out.push({
            payee: l.args.payee,
            name: l.args.newName,
            txHash: l.transactionHash,
            blockNumber: l.blockNumber,
            logIndex: l.logIndex,
          });
        }
      }
      for (const l of removed) {
        if (l.args.payee) {
          out.push({
            payee: l.args.payee,
            name: null,
            txHash: l.transactionHash,
            blockNumber: l.blockNumber,
            logIndex: l.logIndex,
          });
        }
      }
      return out;
    });

    logs.sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex - b.logIndex
        : a.blockNumber < b.blockNumber
          ? -1
          : 1,
    );
    const names = new Map<string, { payee: Address; txHash: `0x${string}` }>();
    for (const l of logs) {
      const key = l.payee.toLowerCase();
      if (l.name === null) names.delete(key);
      else names.set(key, { payee: l.payee, txHash: l.txHash });
    }

    // nameOf is the source of truth — confirm each surviving entry live
    // (drops anything removed after the scan window, and proves the
    // registry still holds the name right now).
    const entries: Array<RegisteredPayee | null> = await Promise.all(
      [...names.values()].map(async (v) => {
        const liveName = await this.getPayeeName(owner, v.payee);
        if (!liveName) return null;
        return { payee: v.payee, name: liveName, txHash: v.txHash } satisfies RegisteredPayee;
      }),
    );
    return entries.filter((e): e is RegisteredPayee => e !== null);
  }

  async listV2Sessions(owner: Address): Promise<Session[]> {
    if (!this.v2Configured) return [];
    const { from, to } = await this.v2ScanRange();
    const created = await chunked(from, to, (f, t) =>
      this.client.getLogs({
        address: this.cfg.vaultV2Address,
        event: parseAbiItem(
          'event SessionCreated(uint256 indexed sessionId, address indexed owner, address indexed sessionKey, uint256 perTxLimit, uint256 dailyLimit, uint256 perPayeeCap, uint64 expiry)',
        ),
        args: { owner },
        fromBlock: f,
        toBlock: t,
      }),
    );

    const sessions = await Promise.all(
      created.map(async (log) => {
        const id = log.args.sessionId ?? 0n;
        const [s, remaining] = await Promise.all([
          this.client.readContract({
            address: this.cfg.vaultV2Address,
            abi: VAULT_V2_ABI,
            functionName: 'getSession',
            args: [id],
          }),
          this.client.readContract({
            address: this.cfg.vaultV2Address,
            abi: VAULT_V2_ABI,
            functionName: 'remainingDailyAllowance',
            args: [id],
          }),
        ]);
        const payeeSpend = await Promise.all(
          [...s.payees].map(async (payee) => {
            const [spent, payeeRemaining, name] = await Promise.all([
              this.client.readContract({
                address: this.cfg.vaultV2Address,
                abi: VAULT_V2_ABI,
                functionName: 'spentPerPayee',
                args: [id, payee],
              }),
              this.client.readContract({
                address: this.cfg.vaultV2Address,
                abi: VAULT_V2_ABI,
                functionName: 'remainingPayeeAllowance',
                args: [id, payee],
              }),
              this.getPayeeName(owner, payee),
            ]);
            return {
              payee,
              name: name || undefined,
              spent,
              cap: s.perPayeeCap,
              remaining: payeeRemaining,
            };
          }),
        );
        return {
          id,
          owner: s.owner,
          sessionKey: s.sessionKey,
          payees: [...s.payees],
          perTxLimit: s.perTxLimit,
          dailyLimit: s.dailyLimit,
          perPayeeCap: s.perPayeeCap,
          expiry: Number(s.expiry),
          revoked: s.revoked,
          remainingDaily: remaining,
          version: 2 as const,
          payeeSpend,
        } satisfies Session;
      }),
    );
    return sessions.sort((a, b) => (a.id > b.id ? -1 : 1));
  }

  async listV2Payments(owner: Address): Promise<Payment[]> {
    if (!this.v2Configured) return [];
    const sessions = await this.listV2Sessions(owner);
    if (sessions.length === 0) return [];
    const ids = sessions.map((s) => s.id);
    const { from, to } = await this.v2ScanRange();

    const logs = await chunked(from, to, (f, t) =>
      this.client.getLogs({
        address: this.cfg.vaultV2Address,
        event: parseAbiItem(
          'event PaymentExecuted(uint256 indexed sessionId, address indexed payee, uint256 amount, uint256 timestamp)',
        ),
        args: { sessionId: ids },
        fromBlock: f,
        toBlock: t,
      }),
    );

    // Every payment that reached PaymentExecuted passed the name check
    // (the vault reverts before emitting otherwise) — enrich with the
    // registered name so the UI can show what was verified.
    const payments = await Promise.all(
      logs.map(async (l) => {
        const payee = (l.args.payee ??
          '0x0000000000000000000000000000000000000000') as Address;
        const name = await this.getPayeeName(owner, payee);
        return {
          sessionId: l.args.sessionId ?? 0n,
          payee,
          amount: l.args.amount ?? 0n,
          timestamp: Number(l.args.timestamp ?? 0n),
          txHash: l.transactionHash,
          version: 2 as const,
          payeeName: name || undefined,
          nameVerified: true,
        } satisfies Payment;
      }),
    );
    return payments.sort((a, b) => b.timestamp - a.timestamp);
  }
}
