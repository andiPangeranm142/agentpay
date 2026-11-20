/** Environment + schedules.json loading and validation. Never logs secrets. */

import { existsSync, readFileSync } from 'node:fs';
import { isAddress, isHex, parseUnits, type Address, type Hex } from 'viem';
import { scheduleIntervalSeconds } from './scheduler.js';
import type { Schedule } from './types.js';

export const DEFAULT_RPC_URL = 'https://rpc-test.qday.info';
export const DEFAULT_CHAIN_ID = 44005;
export const DEFAULT_TOKEN_ADDRESS = '0x456569838f1d43009A91ebA4263147Afd7233483' as Address;

export interface AgentConfig {
  rpcUrl: string;
  chainId: number;
  vaultAddress: Address;
  tokenAddress: Address;
  /** sessionId -> private key. NEVER log these. */
  sessionKeys: Map<number, Hex>;
  pollIntervalMs: number;
  statusPort: number;
  schedulesPath: string;
  statePath: string;
  logPath: string;
  maxRetries: number;
  retryBaseMs: number;
  /** First block to scan for PaymentExecuted history (vault deploy block). */
  vaultDeployBlock: bigint | null;
  schedules: Schedule[];
}

/** Minimal .env parser (KEY=VALUE, # comments, optional quotes). Only fills unset vars. */
export function loadDotenv(filePath = '.env'): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function parsePrivateKey(raw: string, label: string): Hex {
  const key = (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex;
  if (!isHex(key) || key.length !== 66) {
    throw new Error(`${label} must be a 32-byte hex private key (0x + 64 hex chars)`);
  }
  return key;
}

/**
 * Session keys come from env only, in one of two styles:
 *   SESSION_KEYS_JSON={"0":"0x...","1":"0x..."}   (wins when both are set)
 *   SESSION_KEY_0=0x...  SESSION_KEY_1=0x...
 */
export function parseSessionKeys(env: NodeJS.ProcessEnv = process.env): Map<number, Hex> {
  const keys = new Map<number, Hex>();
  const json = env.SESSION_KEYS_JSON?.trim();
  if (json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('SESSION_KEYS_JSON is not valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('SESSION_KEYS_JSON must be a JSON object mapping sessionId -> private key');
    }
    for (const [id, raw] of Object.entries(parsed)) {
      const sessionId = Number(id);
      if (!Number.isInteger(sessionId) || sessionId < 0) {
        throw new Error(`SESSION_KEYS_JSON: invalid session id "${id}"`);
      }
      if (typeof raw !== 'string') throw new Error(`SESSION_KEYS_JSON: key for session ${id} must be a string`);
      keys.set(sessionId, parsePrivateKey(raw, `SESSION_KEYS_JSON[${id}]`));
    }
    return keys;
  }
  for (const [name, value] of Object.entries(env)) {
    const m = /^SESSION_KEY_(\d+)$/.exec(name);
    if (m && value) keys.set(Number(m[1]), parsePrivateKey(value, name));
  }
  return keys;
}

function parseSchedule(raw: unknown, index: number): Schedule {
  const label = `schedules[${index}]`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${label}: must be an object`);
  }
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || !s.id.trim()) throw new Error(`${label}: "id" must be a non-empty string`);
  if (!Number.isInteger(s.sessionId) || (s.sessionId as number) < 0) {
    throw new Error(`${label} ("${s.id}"): "sessionId" must be a non-negative integer`);
  }
  if (typeof s.payee !== 'string' || !isAddress(s.payee)) {
    throw new Error(`${label} ("${s.id}"): "payee" must be a valid address`);
  }
  if (typeof s.amount !== 'string' || s.amount.trim() === '') {
    throw new Error(`${label} ("${s.id}"): "amount" must be a decimal string in tUSD8, e.g. "5.0"`);
  }
  const amountStr: string = s.amount;
  let amountRaw: bigint;
  try {
    amountRaw = parseUnits(amountStr, 6);
  } catch {
    throw new Error(`${label} ("${s.id}"): "amount" is not a valid decimal: "${amountStr}"`);
  }
  if (amountRaw <= 0n) throw new Error(`${label} ("${s.id}"): "amount" must be > 0`);
  if (s.every !== undefined && typeof s.every !== 'string') {
    throw new Error(`${label} ("${s.id}"): "every" must be a string like "1d" or "30m"`);
  }
  if (s.intervalSeconds !== undefined) {
    const secs: unknown = s.intervalSeconds;
    if (typeof secs !== 'number' || !Number.isInteger(secs) || secs <= 0) {
      throw new Error(`${label} ("${s.id}"): "intervalSeconds" must be a positive integer`);
    }
  }
  if (typeof s.active !== 'boolean') throw new Error(`${label} ("${s.id}"): "active" must be a boolean`);
  const schedule: Schedule = {
    id: s.id,
    sessionId: s.sessionId as number,
    payee: s.payee as Address,
    amount: s.amount,
    active: s.active,
  };
  if (s.every !== undefined) schedule.every = s.every as string;
  if (s.intervalSeconds !== undefined) schedule.intervalSeconds = s.intervalSeconds as number;
  if (typeof s.note === 'string') schedule.note = s.note;
  // Throws on missing/invalid interval.
  scheduleIntervalSeconds(schedule);
  return schedule;
}

/** Load + validate schedules.json. Throws with a clear message on any problem. */
export function loadSchedules(path: string): Schedule[] {
  if (!existsSync(path)) {
    throw new Error(`schedules file not found: ${path} (copy schedules.example.json to get started)`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`schedules file ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`schedules file ${path} must contain a JSON array`);
  const schedules = parsed.map((raw, i) => parseSchedule(raw, i));
  const ids = new Set<string>();
  for (const s of schedules) {
    if (ids.has(s.id)) throw new Error(`duplicate schedule id: "${s.id}"`);
    ids.add(s.id);
  }
  return schedules;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
}

export interface LoadConfigOptions {
  /** Skip loading schedules.json (e.g. CLI commands that only need paths). */
  loadSchedules?: boolean;
  /** Allow a zero/placeholder vault address (e.g. `validate` before deploy). */
  requireVault?: boolean;
}

export function loadConfig(opts: LoadConfigOptions = {}): AgentConfig {
  const { loadSchedules: wantSchedules = true, requireVault = true } = opts;
  const rpcUrl = process.env.RPC_URL?.trim() || DEFAULT_RPC_URL;
  const chainId = intEnv('CHAIN_ID', DEFAULT_CHAIN_ID);
  const vaultRaw = process.env.VAULT_ADDRESS?.trim() ?? '';
  if (requireVault && (!vaultRaw || !isAddress(vaultRaw) || vaultRaw === '0x0000000000000000000000000000000000000000')) {
    throw new Error('VAULT_ADDRESS is not set to a deployed vault address (see .env.example)');
  }
  const vaultAddress = (isAddress(vaultRaw) ? vaultRaw : '0x0000000000000000000000000000000000000000') as Address;
  const tokenRaw = process.env.TOKEN_ADDRESS?.trim() || DEFAULT_TOKEN_ADDRESS;
  if (!isAddress(tokenRaw)) throw new Error(`TOKEN_ADDRESS is not a valid address: "${tokenRaw}"`);
  const schedulesPath = process.env.SCHEDULES_PATH?.trim() || './schedules.json';
  return {
    rpcUrl,
    chainId,
    vaultAddress,
    tokenAddress: tokenRaw as Address,
    sessionKeys: parseSessionKeys(),
    pollIntervalMs: intEnv('POLL_INTERVAL_MS', 30_000),
    statusPort: intEnv('STATUS_PORT', 3100),
    schedulesPath,
    statePath: process.env.STATE_PATH?.trim() || './state/agent-state.json',
    logPath: process.env.LOG_PATH?.trim() || './logs/agent.log',
    maxRetries: intEnv('MAX_RETRIES', 5),
    retryBaseMs: intEnv('RETRY_BASE_MS', 1000),
    vaultDeployBlock: process.env.VAULT_DEPLOY_BLOCK?.trim()
      ? BigInt(process.env.VAULT_DEPLOY_BLOCK.trim())
      : null,
    schedules: wantSchedules ? loadSchedules(schedulesPath) : [],
  };
}

/** Redacted config summary for logs/status — session keys are NEVER included. */
export function configSummary(config: AgentConfig): Record<string, unknown> {
  return {
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    vaultAddress: config.vaultAddress,
    tokenAddress: config.tokenAddress,
    sessionKeySessions: [...config.sessionKeys.keys()].sort((a, b) => a - b),
    pollIntervalMs: config.pollIntervalMs,
    statusPort: config.statusPort,
    schedules: config.schedules.length,
    activeSchedules: config.schedules.filter((s) => s.active).length,
  };
}
