/** Persistent execution state (idempotency store). Atomic write via tmp + rename. */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  emptyAgentState,
  emptyScheduleState,
  type AgentState,
  type ExecutionRecord,
  type ScheduleState,
} from './types.js';

export const MAX_EXECUTION_HISTORY = 200;

export class StateStore {
  private state: AgentState;

  constructor(private readonly filePath: string) {
    this.state = this.load();
  }

  private load(): AgentState {
    if (!existsSync(this.filePath)) return emptyAgentState();
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as AgentState;
      if (raw.version !== 1 || typeof raw.schedules !== 'object' || !Array.isArray(raw.executions)) {
        throw new Error('unexpected state shape');
      }
      return raw;
    } catch (err) {
      // A corrupt state file must never crash the agent — but it MUST NOT be
      // silently trusted either: starting from empty state could double-pay
      // a period that was already paid. Fail loudly so an operator can fix
      // or deliberately reset the file.
      throw new Error(
        `state file ${this.filePath} is corrupt and cannot be trusted ` +
          `(refusing to start to avoid double-payments): ${(err as Error).message}. ` +
          `Restore it from backup, or delete it ONLY after confirming no payment ` +
          `for the current period has already been made.`,
      );
    }
  }

  /** Persist atomically: write tmp file in the same dir, then rename over. */
  save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    renameSync(tmp, this.filePath);
  }

  snapshot(): AgentState {
    return JSON.parse(JSON.stringify(this.state)) as AgentState;
  }

  getScheduleState(scheduleId: string): ScheduleState | undefined {
    return this.state.schedules[scheduleId];
  }

  /** Record an execution attempt (any outcome) + update the schedule row. */
  recordExecution(record: ExecutionRecord, periodKey: number | null): void {
    const row = this.state.schedules[record.scheduleId] ?? emptyScheduleState();
    row.lastAttemptAt = Math.floor(Date.parse(record.timestamp) / 1000);
    row.lastStatus = record.status;
    row.lastReason = record.reason ?? null;
    row.lastDetail = record.detail ?? null;
    if (record.status === 'success') {
      // Only successful payments advance the idempotency key — a failed or
      // skipped period stays payable on the next tick.
      row.lastPeriodKey = periodKey;
      row.lastExecutedAt = row.lastAttemptAt;
      row.lastTxHash = record.txHash ?? null;
    }
    this.state.schedules[record.scheduleId] = row;
    this.state.executions.unshift(record);
    if (this.state.executions.length > MAX_EXECUTION_HISTORY) {
      this.state.executions.length = MAX_EXECUTION_HISTORY;
    }
    this.save();
  }
}
