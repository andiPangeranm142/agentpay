/** Shared wiring used by the daemon (index.ts) and the CLI (cli.ts). */

import { createAgent, type AgentDeps } from './agent.js';
import { loadConfig, loadDotenv, type AgentConfig, type LoadConfigOptions } from './config.js';
import { createPublicClientFor, Executor } from './executor.js';
import { Logger } from './logger.js';
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
  const executor = new Executor(publicClient, config, logger);
  return { config, logger, executor, state };
}

export function buildAgent(setup: Setup) {
  return createAgent(setup);
}
