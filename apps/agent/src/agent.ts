/** Agent orchestration: poll loop, per-schedule execution, status snapshot. */

import { configSummary, type AgentConfig } from './config.js';
import type { Executor } from './executor.js';
import type { Logger } from './logger.js';
import { isDue, nextDueAt, periodKey, scheduleIntervalSeconds } from './scheduler.js';
import { startStatusServer, type StatusServer } from './status-server.js';
import { StateStore } from './state.js';
import type { ExecutionRecord } from './types.js';

export interface AgentDeps {
  config: AgentConfig;
  logger: Logger;
  executor: Executor;
  state: StateStore;
}

export interface ScheduleStatus {
  id: string;
  sessionId: number;
  payee: string;
  amount: string;
  intervalSeconds: number;
  active: boolean;
  lastExecutedAt: number | null;
  lastTxHash: string | null;
  lastStatus: string | null;
  lastReason: string | null;
  nextDueAt: number | null;
}

export interface AgentStatus {
  service: string;
  startedAt: string;
  uptimeSec: number;
  config: Record<string, unknown>;
  schedules: ScheduleStatus[];
  recentExecutions: ExecutionRecord[];
}

export function createAgent({ config, logger, executor, state }: AgentDeps) {
  const startedAt = new Date();
  let timer: ReturnType<typeof setInterval> | null = null;
  let server: StatusServer | null = null;
  let tickRunning = false;

  function getStatus(): AgentStatus {
    const nowSec = Math.floor(Date.now() / 1000);
    const snap = state.snapshot();
    return {
      service: 'agentpay-agent',
      startedAt: startedAt.toISOString(),
      uptimeSec: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      config: configSummary(config),
      schedules: config.schedules.map((s) => {
        const row = snap.schedules[s.id];
        return {
          id: s.id,
          sessionId: s.sessionId,
          payee: s.payee,
          amount: s.amount,
          intervalSeconds: scheduleIntervalSeconds(s),
          active: s.active,
          lastExecutedAt: row?.lastExecutedAt ?? null,
          lastTxHash: row?.lastTxHash ?? null,
          lastStatus: row?.lastStatus ?? null,
          lastReason: row?.lastReason ?? null,
          nextDueAt: nextDueAt(s, row, nowSec),
        };
      }),
      recentExecutions: snap.executions.slice(0, 20),
    };
  }

  /** One poll tick: execute every due schedule. Never throws. */
  async function tick(): Promise<void> {
    if (tickRunning) {
      logger.warn('previous tick still running, skipping this tick');
      return;
    }
    tickRunning = true;
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      for (const schedule of config.schedules) {
        try {
          const row = state.getScheduleState(schedule.id);
          if (!isDue(schedule, row, nowSec)) continue;
          const interval = scheduleIntervalSeconds(schedule);
          const result = await executor.execute(schedule, nowSec);
          // Record the period the payment actually LANDED in, not the period
          // the tick started in. Preflight + simulate + send take seconds, so
          // a tick that starts just before a period boundary lands its payment
          // in the next period; recording the tick-start period would leave
          // the new period payable again on the very next tick (two payments
          // seconds apart — observed live on Aevum testnet, 2026-11-20). The
          // skipped old period is never back-paid, per the scheduler policy.
          const key = periodKey(Math.floor(Date.now() / 1000), interval);
          const record: ExecutionRecord = {
            timestamp: new Date().toISOString(),
            scheduleId: schedule.id,
            sessionId: schedule.sessionId,
            payee: schedule.payee,
            amount: schedule.amount,
            status: result.status,
            txHash: result.txHash,
            reason: result.reason,
            detail: result.detail,
          };
          state.recordExecution(record, key);
          logger.execution(record);
        } catch (err) {
          // One bad schedule must never kill the tick or the daemon.
          logger.error(`unexpected error executing schedule ${schedule.id}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      tickRunning = false;
    }
  }

  async function start(): Promise<void> {
    server = await startStatusServer(config.statusPort, getStatus);
    logger.info('agent started', { ...configSummary(config), statusUrl: `http://127.0.0.1:${config.statusPort}/status` });
    await tick();
    timer = setInterval(() => void tick(), config.pollIntervalMs);
  }

  async function stop(): Promise<void> {
    if (timer) clearInterval(timer);
    timer = null;
    if (server) await server.close();
    server = null;
    logger.info('agent stopped');
  }

  return { tick, start, stop, getStatus };
}
