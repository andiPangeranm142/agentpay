/** Shared wiring used by the daemon (index.ts) and the CLI (cli.ts). */

import { createAgent, type AgentDeps } from './agent.js';
import { loadConfig, loadDotenv, type AgentConfig, type LoadConfigOptions } from './config.js';
import { createPublicClientFor, Executor } from './executor.js';
import { Logger } from './logger.js';
import { withRetry } from './retry.js';
import { StateStore } from './state.js';

export interface Setup extends AgentDeps {
  config: AgentConfig;
}

export async function setupAgent(opts: LoadConfigOptions = {}): Promise<Setup> {
  loadDotenv();
  const config = loadConfig(opts);
  const logger = new Logger(config.logPath);
  const state = new StateStore(config.statePath);
  const publicClient = await createPublicClientFor(config);
  // Fail fast if the vault (or token) address holds no contract: calling
  // pay() on an empty address SUCCEEDS on the EVM (no code = no revert),
  // so without this guard a misconfigured VAULT_ADDRESS would "pay" into
  // the void and mark periods as paid.
  const retry = { maxAttempts: config.maxRetries, baseMs: config.retryBaseMs };
  const vaultCode = await withRetry(() => publicClient.getCode({ address: config.vaultAddress }), retry);
  if (!vaultCode || vaultCode === '0x') {
    throw new Error(
      `VAULT_ADDRESS ${config.vaultAddress} has no contract deployed on this chain — ` +
        `check the address (and that RPC_URL points at the right network)`,
    );
  }
  const tokenCode = await withRetry(() => publicClient.getCode({ address: config.tokenAddress }), retry);
  if (!tokenCode || tokenCode === '0x') {
    throw new Error(
      `TOKEN_ADDRESS ${config.tokenAddress} has no contract deployed on this chain — ` +
        `check the address (and that RPC_URL points at the right network)`,
    );
  }
  const executor = new Executor(publicClient, config, logger);
  return { config, logger, executor, state };
}

export function buildAgent(setup: Setup) {
  return createAgent(setup);
}
