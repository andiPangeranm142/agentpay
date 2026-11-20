/**
 * End-to-end test for the AgentPay agent service against a local anvil chain.
 *
 *   npm run e2e
 *
 * Flow:
 *   1. Spawns anvil (Shanghai hardfork, like Aevum) on a scratch port.
 *   2. Deploys a mock tUSD8 (6 decimals) + the vault.
 *      VAULT SELECTION: if the real contract artifacts exist at
 *      ../../contracts/out/AgentPayVault.sol/AgentPayVault.json they are
 *      used; otherwise the local test mock (test/mocks, NOT a copy of the
 *      production contract) is built with forge and used instead.
 *      ASSUMPTION: the vault constructor takes (address token). If the real
 *      contract's constructor differs, deployment fails with a clear message.
 *   3. Owner funds the vault, creates sessions, then runs the REAL agent
 *      tick loop and asserts on-chain outcomes:
 *      - payment lands, payee balance increases, PaymentExecuted emitted
 *      - a second tick in the same period does NOT double-pay (idempotency)
 *      - next period pays again; revoke -> skip with SESSION_REVOKED
 *      - over per-tx limit -> PER_TX_LIMIT; non-allowlisted payee ->
 *        PAYEE_NOT_ALLOWED; exhausted daily allowance -> DAILY_LIMIT
 *      - a restart (fresh agent, same state file) does not re-pay the period
 *
 * All keys are the public anvil throwaway defaults. Nothing touches testnet.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatUnits,
  http,
  parseUnits,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { anvil } from 'viem/chains';
import { ERC20_ABI, VAULT_ABI } from '../src/abi.js';
import { createAgent } from '../src/agent.js';
import type { AgentConfig } from '../src/config.js';
import { fetchPaymentEvents } from '../src/events.js';
import { Executor } from '../src/executor.js';
import { Logger } from '../src/logger.js';
import { StateStore } from '../src/state.js';
import type { Schedule } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = resolve(__dirname, '..');
const REPO_ROOT = resolve(AGENT_DIR, '../..');
const MOCKS_DIR = join(AGENT_DIR, 'test/mocks');
const ANVIL_PORT = 8560;
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;

// Anvil's public default mnemonic — accounts are DERIVED from it (never
// typed from memory: a one-character typo in a pasted key once produced a
// valid-looking but unfunded address and a confusing "insufficient funds").
const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';
const ownerAccount = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 0 });
const sessionKeyAccount = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 1 });
const payeeAccount = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 2 });
const nonPayeeAccount = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 3 });
const PAYEE = payeeAccount.address;
const NON_PAYEE = nonPayeeAccount.address;
const SESSION_KEY = toHex(sessionKeyAccount.getHdKey().privateKey!);

const FOUNDRY_BIN = join(process.env.HOME ?? '~', '.foundry/bin');
const PATH_WITH_FOUNDRY = `${FOUNDRY_BIN}:${process.env.PATH ?? ''}`;

const failures: string[] = [];
let checks = 0;
function check(name: string, cond: boolean, extra = ''): void {
  checks++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function startAnvil(): Promise<ChildProcess> {
  const proc = spawn('anvil', ['--port', String(ANVIL_PORT), '--hardfork', 'shanghai'], {
    env: { ...process.env, PATH: PATH_WITH_FOUNDRY },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const probe = createPublicClient({ transport: http(RPC_URL) });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await probe.getChainId();
      console.log(`[e2e] anvil up on ${RPC_URL}`);
      return proc;
    } catch {
      if (proc.exitCode !== null) throw new Error(`anvil exited early with code ${proc.exitCode}`);
      await sleep(250);
    }
  }
  throw new Error('anvil did not start in time');
}

interface Artifact {
  abi: readonly unknown[];
  bytecode: { object: string };
}

function loadArtifact(path: string): Artifact {
  return JSON.parse(readFileSync(path, 'utf8')) as Artifact;
}

/** Prefer the real vault artifact; fall back to the local test mock. */
function resolveVaultArtifact(): { artifact: Artifact; label: string } {
  const candidates = [
    join(REPO_ROOT, 'contracts/out/AgentPayVault.sol/AgentPayVault.json'),
    join(REPO_ROOT, 'contracts/out/AgentPayVault.json'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      console.log(`[e2e] using REAL vault artifact: ${path}`);
      return { artifact: loadArtifact(path), label: 'real AgentPayVault' };
    }
  }
  console.log('[e2e] real vault artifact not found — building + using the local test mock (test/mocks)');
  const build = spawnSync('forge', ['build'], { cwd: MOCKS_DIR, env: { ...process.env, PATH: PATH_WITH_FOUNDRY }, encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`forge build of test mocks failed:\n${build.stdout}\n${build.stderr}`);
  const mockPath = join(MOCKS_DIR, 'out/MockVault.sol/MockVault.json');
  return { artifact: loadArtifact(mockPath), label: 'MockVault (test mock)' };
}

async function main(): Promise<void> {
  let anvilProc: ChildProcess | null = null;
  try {
    anvilProc = await startAnvil();

    const publicClient = createPublicClient({ chain: anvil, transport: http(RPC_URL) });
    const ownerClient = createWalletClient({ account: ownerAccount, chain: anvil, transport: http(RPC_URL) });

    // --- Deploy mock tUSD8 + vault (legacy txs, as on Aevum) ---
    const tokenArtifact = (() => {
      const p = join(MOCKS_DIR, 'out/MockERC20.sol/MockERC20.json');
      if (!existsSync(p)) {
        const build = spawnSync('forge', ['build'], { cwd: MOCKS_DIR, env: { ...process.env, PATH: PATH_WITH_FOUNDRY }, encoding: 'utf8' });
        if (build.status !== 0) throw new Error(`forge build of test mocks failed:\n${build.stdout}\n${build.stderr}`);
      }
      return loadArtifact(p);
    })();
    const { artifact: vaultArtifact, label: vaultLabel } = resolveVaultArtifact();

    const tokenHash = await ownerClient.deployContract({
      abi: tokenArtifact.abi as never,
      bytecode: tokenArtifact.bytecode.object as Hex,
      type: 'legacy',
    });
    const tokenReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenHash });
    const token = tokenReceipt.contractAddress!;
    console.log(`[e2e] mock tUSD8 deployed at ${token}`);

    let vaultHash: Hex;
    try {
      // ASSUMPTION: vault constructor is (address token).
      vaultHash = await ownerClient.deployContract({
        abi: vaultArtifact.abi as never,
        bytecode: vaultArtifact.bytecode.object as Hex,
        args: [token],
        type: 'legacy',
      });
    } catch (err) {
      throw new Error(
        `vault deployment with constructor (address token) failed for ${vaultLabel}: ${(err as Error).message}\n` +
          `If the real AgentPayVault constructor differs, update scripts/e2e.ts accordingly.`,
      );
    }
    const vaultReceipt = await publicClient.waitForTransactionReceipt({ hash: vaultHash });
    const vault = vaultReceipt.contractAddress!;
    console.log(`[e2e] vault (${vaultLabel}) deployed at ${vault}`);

    const t = (human: string) => parseUnits(human, 6);
    const bal = (addr: Address) =>
      publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [addr] });

    // Mint + fund the vault with 1,000 tUSD8.
    await ownerClient.writeContract({
      address: token,
      abi: tokenArtifact.abi as never,
      functionName: 'mint',
      args: [ownerAccount.address, t('1000000')],
      type: 'legacy',
    });
    await ownerClient.writeContract({
      address: token,
      abi: tokenArtifact.abi as never,
      functionName: 'approve',
      args: [vault, t('1000000')],
      type: 'legacy',
    });
    await ownerClient.writeContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [t('1000')],
      type: 'legacy',
    });
    check('vault funded with 1,000 tUSD8', (await bal(vault)) === t('1000'));

    // --- Session 0: payee allowlisted, per-tx 10, daily 25, expiry +1h ---
    const now = Math.floor(Date.now() / 1000);
    const createHash = await ownerClient.writeContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'createSession',
      args: [sessionKeyAccount.address, [PAYEE], t('10'), t('25'), BigInt(now + 3600)],
      type: 'legacy',
    });
    const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
    let session0 = 0n;
    for (const log of createReceipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: VAULT_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === 'SessionCreated') session0 = decoded.args.sessionId as bigint;
      } catch {
        /* not our event */
      }
    }
    check('session 0 created', session0 === 0n, `sessionId=${session0}`);

    // --- Agent setup (real code path, temp state) ---
    const workdir = mkdtempSync(join(tmpdir(), 'agentpay-e2e-'));
    const schedules: Schedule[] = [
      { id: 'e2e-rent', sessionId: 0, payee: PAYEE, amount: '5.0', intervalSeconds: 10, active: true },
      { id: 'e2e-over-tx', sessionId: 0, payee: PAYEE, amount: '21.0', intervalSeconds: 10, active: true },
      { id: 'e2e-bad-payee', sessionId: 0, payee: NON_PAYEE, amount: '1.0', intervalSeconds: 10, active: true },
    ];
    const schedulesPath = join(workdir, 'schedules.json');
    writeFileSync(schedulesPath, JSON.stringify(schedules, null, 2));
    const config: AgentConfig = {
      rpcUrl: RPC_URL,
      chainId: 31337,
      vaultAddress: vault,
      tokenAddress: token,
      sessionKeys: new Map([[0, SESSION_KEY]]),
      pollIntervalMs: 30_000,
      statusPort: 3199,
      schedulesPath,
      statePath: join(workdir, 'state.json'),
      logPath: join(workdir, 'agent.log'),
      maxRetries: 3,
      retryBaseMs: 100,
      vaultDeployBlock: vaultReceipt.blockNumber,
      schedules,
    };
    const logger = new Logger(config.logPath);
    const state = new StateStore(config.statePath);
    const executor = new Executor(publicClient, config, logger);
    const agent = createAgent({ config, logger, executor, state });

    const payeeBefore = await bal(PAYEE);

    // --- Tick 1: rent pays; over-tx + bad-payee skip with clear reasons ---
    console.log('[e2e] tick 1 (first period)');
    await agent.tick();
    check('payee received 5.0 tUSD8', (await bal(PAYEE)) - payeeBefore === t('5'));
    check('vault balance decreased by 5.0', (await bal(vault)) === t('995'));
    const st1 = state.snapshot();
    check('rent recorded success with tx hash', st1.schedules['e2e-rent']?.lastStatus === 'success' && !!st1.schedules['e2e-rent']?.lastTxHash);
    check('over-tx skipped PER_TX_LIMIT', st1.schedules['e2e-over-tx']?.lastReason === 'PER_TX_LIMIT');
    check('bad-payee skipped PAYEE_NOT_ALLOWED', st1.schedules['e2e-bad-payee']?.lastReason === 'PAYEE_NOT_ALLOWED');

    // --- Tick 2 in the SAME period: idempotency (no double-pay) ---
    console.log('[e2e] tick 2 (same period — must not double-pay)');
    await agent.tick();
    check('no double-pay in same period', (await bal(PAYEE)) - payeeBefore === t('5'));

    // --- Restart with the same state file: still no double-pay ---
    console.log('[e2e] simulated restart (fresh agent, same state file)');
    const state2 = new StateStore(config.statePath);
    const agent2 = createAgent({ config, logger, executor, state: state2 });
    await agent2.tick();
    check('restart does not re-pay the period', (await bal(PAYEE)) - payeeBefore === t('5'));

    // --- Advance 11s of WALL time: the agent schedules on the wall clock
    // (correct for production — bills are wall-clock bills), so chain time
    // travel would not make a new period due. Sleeping 11s guarantees
    // crossing into the next 10s period (periods are epoch-aligned). ---
    console.log('[e2e] waiting 11s (next period)');
    await sleep(11_000);
    await agent.tick();
    check('second period pays 5.0 more', (await bal(PAYEE)) - payeeBefore === t('10'));

    // --- Revoke session 0: next period skips with SESSION_REVOKED ---
    console.log('[e2e] revoking session 0');
    await ownerClient.writeContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'revokeSession',
      args: [0n],
      type: 'legacy',
    });
    await sleep(11_000);
    await agent.tick();
    check('revoked session is skipped, no payment', (await bal(PAYEE)) - payeeBefore === t('10'));
    check(
      'revoked skip reason is SESSION_REVOKED',
      state.snapshot().schedules['e2e-rent']?.lastReason === 'SESSION_REVOKED',
      `got ${state.snapshot().schedules['e2e-rent']?.lastReason}`,
    );

    // --- Session 1: daily limit 12, per-tx 10 — second payment exceeds daily ---
    console.log('[e2e] session 1 (daily limit 12 tUSD8)');
    const now2 = Math.floor(Date.now() / 1000);
    await ownerClient.writeContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'createSession',
      args: [sessionKeyAccount.address, [PAYEE], t('10'), t('12'), BigInt(now2 + 3600)],
      type: 'legacy',
    });
    config.sessionKeys.set(1, SESSION_KEY);
    config.schedules = [
      { id: 'e2e-daily', sessionId: 1, payee: PAYEE, amount: '8.0', intervalSeconds: 10, active: true },
    ];
    const agent3 = createAgent({ config, logger, executor, state });
    await agent3.tick();
    check('daily session pays first 8.0', (await bal(PAYEE)) - payeeBefore === t('18'));
    await sleep(11_000);
    await agent3.tick();
    check('daily allowance exhausted -> no second payment', (await bal(PAYEE)) - payeeBefore === t('18'));
    check(
      'daily skip reason is DAILY_LIMIT',
      state.snapshot().schedules['e2e-daily']?.lastReason === 'DAILY_LIMIT',
      `got ${state.snapshot().schedules['e2e-daily']?.lastReason}`,
    );

    // --- Audit trail: chunked PaymentExecuted reader finds all 3 payments ---
    const events = await fetchPaymentEvents(publicClient, vault, vaultReceipt.blockNumber);
    check('audit trail has 3 PaymentExecuted events', events.length === 3, `got ${events.length}`);
    const totalPaid = events.reduce((sum, e) => sum + e.amount, 0n);
    check('audit trail total is 18.0 tUSD8', totalPaid === t('18'), `got ${formatUnits(totalPaid, 6)}`);

    console.log(`\n[e2e] ${checks - failures.length}/${checks} checks passed${failures.length > 0 ? ` — FAILURES: ${failures.join(', ')}` : ''}`);
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    anvilProc?.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(`[e2e] FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
