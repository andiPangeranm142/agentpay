/** AgentPay agent daemon: polls schedules and executes due payments. */

import { buildAgent, setupAgent } from './setup.js';

async function main(): Promise<void> {
  const setup = await setupAgent();
  const agent = buildAgent(setup);
  const shutdown = async (signal: string) => {
    setup.logger.info(`received ${signal}, shutting down`);
    await agent.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  await agent.start();
}

main().catch((err) => {
  console.error(`[fatal] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
