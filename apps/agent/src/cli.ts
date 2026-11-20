/**
 * AgentPay agent CLI.
 *
 *   npm run status     — schedules + last executions from local state (no chain access)
 *   npm run validate   — validate env + schedules.json without starting the daemon
 *   npm run run-once   — execute a single poll tick, then exit
 *   npx tsx src/cli.ts history [--from-block N] [--session N] [--payee 0x...]
 *                      — on-chain PaymentExecuted audit trail (chunked ≤1,000 blocks)
 */

import { existsSync } from 'node:fs';
import { formatUnits, isAddress } from 'viem';
import { TOKEN_DECIMALS } from './abi.js';
import { loadConfig, loadDotenv, loadSchedules } from './config.js';
import { fetchPaymentEvents } from './events.js';
import { createPublicClientFor } from './executor.js';
import { nextDueAt, scheduleIntervalSeconds } from './scheduler.js';
import { buildAgent, setupAgent } from './setup.js';
import { StateStore } from './state.js';
import { emptyAgentState } from './types.js';

const USAGE = `Usage: npx tsx src/cli.ts <command> [options]

Commands:
  status      Show schedules + last executions from local state (offline).
  validate    Validate .env + schedules.json without starting the daemon.
  run-once    Execute a single poll tick, then exit.
  history     Read the on-chain PaymentExecuted audit trail (chunked ≤1,000 blocks).
              Options: --from-block N  --to-block N  --session N  --payee 0x...
`;

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function fmtTime(unixSec: number | null): string {
  if (unixSec === null) return '-';
  return new Date(unixSec * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

async function cmdStatus(): Promise<number> {
  loadDotenv();
  const schedulesPath = process.env.SCHEDULES_PATH?.trim() || './schedules.json';
  const statePath = process.env.STATE_PATH?.trim() || './state/agent-state.json';
  let schedules;
  try {
    schedules = loadSchedules(schedulesPath);
  } catch (err) {
    console.error(`[status] ${(err as Error).message}`);
    return 1;
  }
  let snap = emptyAgentState();
  if (existsSync(statePath)) {
    try {
      snap = new StateStore(statePath).snapshot();
    } catch (err) {
      console.error(`[status] ${(err as Error).message}`);
      return 1;
    }
  }
  const nowSec = Math.floor(Date.now() / 1000);
  console.log(`\nAgentPay agent — ${schedules.length} schedule(s) — state: ${statePath}\n`);
  console.log(
    `${pad('ID', 18)} ${pad('SESSION', 8)} ${pad('AMOUNT', 12)} ${pad('EVERY', 8)} ${pad('ACTIVE', 7)} ${pad('LAST EXECUTED', 20)} ${pad('LAST', 9)} ${pad('NEXT DUE', 20)}`,
  );
  for (const s of schedules) {
    const row = snap.schedules[s.id];
    console.log(
      `${pad(s.id, 18)} ${pad(String(s.sessionId), 8)} ${pad(`${s.amount} tUSD8`, 12)} ${pad(`${scheduleIntervalSeconds(s)}s`, 8)} ${pad(s.active ? 'yes' : 'no', 7)} ${pad(fmtTime(row?.lastExecutedAt ?? null), 20)} ${pad(row?.lastStatus ?? '-', 9)} ${pad(fmtTime(nextDueAt(s, row, nowSec)), 20)}`,
    );
    if (row?.lastReason) console.log(`${' '.repeat(18)} last reason: ${row.lastReason}${row.lastDetail ? ` — ${row.lastDetail}` : ''}`);
    if (row?.lastTxHash) console.log(`${' '.repeat(18)} last tx: ${row.lastTxHash}`);
  }
  console.log(`\nRecent executions (${snap.executions.length}):`);
  for (const e of snap.executions.slice(0, 10)) {
    console.log(
      `  ${e.timestamp}  ${pad(e.scheduleId, 18)} ${pad(e.status, 8)} ${e.amount} tUSD8 -> ${e.payee}${e.txHash ? `  tx ${e.txHash}` : ''}${e.reason ? `  [${e.reason}]` : ''}`,
    );
  }
  console.log('');
  return 0;
}

async function cmdValidate(): Promise<number> {
  loadDotenv();
  let config;
  try {
    config = loadConfig({ requireVault: false });
  } catch (err) {
    console.error(`[validate] FAIL: ${(err as Error).message}`);
    return 1;
  }
  let ok = true;
  const warn = (msg: string) => {
    ok = false;
    console.error(`[validate] WARN: ${msg}`);
  };
  console.log(`[validate] RPC: ${config.rpcUrl} (chain ${config.chainId})`);
  console.log(`[validate] vault: ${config.vaultAddress}`);
  console.log(`[validate] token: ${config.tokenAddress}`);
  console.log(`[validate] schedules: ${config.schedules.length} (${config.schedules.filter((s) => s.active).length} active)`);
  console.log(`[validate] session keys configured for sessions: ${[...config.sessionKeys.keys()].sort((a, b) => a - b).join(', ') || '(none)'}`);
  if (config.vaultAddress === '0x0000000000000000000000000000000000000000') {
    warn('VAULT_ADDRESS is not set — deploy the vault and set it before starting the daemon.');
  }
  for (const s of config.schedules) {
    if (s.active && !config.sessionKeys.has(s.sessionId)) {
      warn(`schedule "${s.id}" is active but no session key is configured for session ${s.sessionId}.`);
    }
  }
  if (config.schedules.length === 0) warn('no schedules defined.');
  console.log(ok ? '[validate] OK' : '[validate] completed with warnings (see above)');
  return ok ? 0 : 1;
}

async function cmdRunOnce(): Promise<number> {
  const setup = await setupAgent();
  const agent = buildAgent(setup);
  await agent.tick();
  return 0;
}

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

async function cmdHistory(args: string[]): Promise<number> {
  const setup = await setupAgent({ loadSchedules: false });
  const client = await createPublicClientFor(setup.config);
  const head = await client.getBlockNumber();
  const fromRaw = flagValue(args, '--from-block');
  const toRaw = flagValue(args, '--to-block');
  const sessionRaw = flagValue(args, '--session');
  const payeeRaw = flagValue(args, '--payee');
  const fromBlock = fromRaw
    ? BigInt(fromRaw)
    : (setup.config.vaultDeployBlock ?? (head > 5000n ? head - 5000n : 0n));
  const toBlock = toRaw ? BigInt(toRaw) : head;
  if (payeeRaw && !isAddress(payeeRaw)) {
    console.error(`[history] --payee must be a valid address: "${payeeRaw}"`);
    return 1;
  }
  console.log(`[history] scanning PaymentExecuted blocks ${fromBlock}..${toBlock} (chunked ≤1,000 blocks)...`);
  const events = await fetchPaymentEvents(client, setup.config.vaultAddress, fromBlock, {
    toBlock,
    sessionId: sessionRaw ? BigInt(sessionRaw) : undefined,
    payee: payeeRaw as `0x${string}` | undefined,
    retry: { maxAttempts: setup.config.maxRetries, baseMs: setup.config.retryBaseMs },
  });
  for (const e of events) {
    console.log(
      `block ${e.blockNumber}  session ${e.sessionId}  ${formatUnits(e.amount, TOKEN_DECIMALS)} tUSD8 -> ${e.payee}  tx ${e.txHash}`,
    );
  }
  console.log(`${events.length} payment(s) between blocks ${fromBlock} and ${toBlock}.`);
  return 0;
}

async function main(): Promise<number> {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'status':
      return cmdStatus();
    case 'validate':
      return cmdValidate();
    case 'run-once':
      return cmdRunOnce();
    case 'history':
      return cmdHistory(args);
    default:
      console.error(USAGE);
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[fatal] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
