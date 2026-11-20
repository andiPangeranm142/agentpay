import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent } from '../src/agent.js';
import type { AgentConfig } from '../src/config.js';
import type { Executor } from '../src/executor.js';
import type { Logger } from '../src/logger.js';
import { periodKey } from '../src/scheduler.js';
import { StateStore } from '../src/state.js';
import type { Schedule } from '../src/types.js';

// Boundary used by the live incident (Aevum testnet, 2026-11-20): a tick that
// started at 08:50:58 UTC landed its payment at 08:51:01, i.e. in the NEXT
// 60s period. The old code recorded the tick-start period, so the next tick
// paid again 22 seconds later. The fix records the LANDING period.
const BOUNDARY = 1_795_164_660; // 2026-11-20T08:51:00Z
const INTERVAL = 60;

function schedule(over: Partial<Schedule> = {}): Schedule {
  return {
    id: 'live-test',
    sessionId: 1,
    payee: '0xc592286d027E701A5bb0681675C1F4d80d2Ee8Cd',
    amount: '0.05',
    intervalSeconds: INTERVAL,
    active: true,
    ...over,
  };
}

function config(schedules: Schedule[], statePath: string): AgentConfig {
  return {
    rpcUrl: 'http://127.0.0.1:8545',
    chainId: 44005,
    vaultAddress: '0x4079f1A0f75458997DCd1A768170b96086276b47',
    tokenAddress: '0x456569838f1d43009A91ebA4263147Afd7233483',
    sessionKeys: new Map(),
    pollIntervalMs: 30000,
    statusPort: 3100,
    schedulesPath: './schedules.json',
    statePath,
    logPath: './logs/agent.log',
    maxRetries: 5,
    retryBaseMs: 1000,
    vaultDeployBlock: null,
    schedules,
  };
}

const silentLogger = {
  info() {},
  warn() {},
  error() {},
  execution() {},
} as unknown as Logger;

describe('createAgent tick — period-boundary idempotency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records the LANDING period when execution straddles a boundary, and the next tick skips', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentpay-agent-'));
    try {
      const statePath = join(dir, 'state.json');
      const state = new StateStore(statePath);
      let calls = 0;
      const executor = {
        // Simulate preflight + send taking ~7s across the boundary.
        async execute() {
          calls++;
          vi.setSystemTime((BOUNDARY + 5) * 1000);
          return { status: 'success', txHash: '0xabc', reason: undefined, detail: undefined };
        },
      } as unknown as Executor;
      const agent = createAgent({ config: config([schedule()], statePath), logger: silentLogger, executor, state });

      vi.setSystemTime((BOUNDARY - 2) * 1000); // tick starts 2s before the boundary
      await agent.tick();
      expect(calls).toBe(1);
      // The payment landed in the NEW period, so that is the recorded key.
      expect(state.getScheduleState('live-test')?.lastPeriodKey).toBe(periodKey(BOUNDARY + 5, INTERVAL));

      // Second tick, still in the landing period: must NOT execute again.
      vi.setSystemTime((BOUNDARY + 10) * 1000);
      await agent.tick();
      expect(calls).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not double-pay within one period when the tick stays inside it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentpay-agent-'));
    try {
      const statePath = join(dir, 'state.json');
      const state = new StateStore(statePath);
      let calls = 0;
      const executor = {
        async execute() {
          calls++;
          return { status: 'success', txHash: '0xabc', reason: undefined, detail: undefined };
        },
      } as unknown as Executor;
      const agent = createAgent({ config: config([schedule()], statePath), logger: silentLogger, executor, state });

      vi.setSystemTime((BOUNDARY + 10) * 1000);
      await agent.tick();
      expect(calls).toBe(1);
      vi.setSystemTime((BOUNDARY + 30) * 1000);
      await agent.tick();
      expect(calls).toBe(1);

      // Next period: due again.
      vi.setSystemTime((BOUNDARY + INTERVAL + 5) * 1000);
      await agent.tick();
      expect(calls).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a failed execution does not advance the period key, so the next tick retries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentpay-agent-'));
    try {
      const statePath = join(dir, 'state.json');
      const state = new StateStore(statePath);
      let calls = 0;
      const executor = {
        async execute() {
          calls++;
          return calls === 1
            ? { status: 'skipped', txHash: undefined, reason: 'DAILY_LIMIT', detail: undefined }
            : { status: 'success', txHash: '0xabc', reason: undefined, detail: undefined };
        },
      } as unknown as Executor;
      const agent = createAgent({ config: config([schedule()], statePath), logger: silentLogger, executor, state });

      vi.setSystemTime((BOUNDARY + 10) * 1000);
      await agent.tick();
      expect(state.getScheduleState('live-test')?.lastPeriodKey).toBeNull();
      await agent.tick();
      expect(calls).toBe(2);
      expect(state.getScheduleState('live-test')?.lastPeriodKey).toBe(periodKey(BOUNDARY + 10, INTERVAL));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
