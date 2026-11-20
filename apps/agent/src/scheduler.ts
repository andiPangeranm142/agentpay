/** Pure scheduler logic: interval parsing, due/period math. No I/O, fully unit-tested. */

import type { Schedule, ScheduleState } from './types.js';

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
};

/**
 * Parse a human interval like "30s", "1h", "1d", "1w", "1d12h" into seconds.
 * @throws on empty/invalid input.
 */
export function parseInterval(value: string): number {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) throw new Error('empty interval');
  const re = /(\d+)\s*([smhdw])/g;
  let total = 0;
  let matched = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    total += Number(m[1]) * UNIT_SECONDS[m[2]];
    matched += m[0];
  }
  // The whole string must be consumed by number+unit groups (ignoring spaces).
  if (matched.replace(/\s/g, '') !== trimmed.replace(/\s/g, '') || total <= 0) {
    throw new Error(`invalid interval: "${value}" (expected e.g. "30s", "1h", "1d", "1w")`);
  }
  return total;
}

/** Resolve a schedule's effective interval in seconds. intervalSeconds wins over `every`. */
export function scheduleIntervalSeconds(schedule: Schedule): number {
  if (schedule.intervalSeconds !== undefined) {
    if (!Number.isInteger(schedule.intervalSeconds) || schedule.intervalSeconds <= 0) {
      throw new Error(`schedule "${schedule.id}": intervalSeconds must be a positive integer`);
    }
    return schedule.intervalSeconds;
  }
  if (schedule.every !== undefined) return parseInterval(schedule.every);
  throw new Error(`schedule "${schedule.id}": set "every" or "intervalSeconds"`);
}

/**
 * Idempotency key for a due period: the period index since the Unix epoch.
 * At most ONE payment may be executed per (schedule, periodKey) — this is
 * what makes restarts safe: state records the last paid period key, and a
 * tick whose period key is already recorded is skipped.
 */
export function periodKey(nowSec: number, intervalSec: number): number {
  return Math.floor(nowSec / intervalSec);
}

/** Unix seconds when the current period ends (= next period start). */
export function nextPeriodStart(nowSec: number, intervalSec: number): number {
  return (periodKey(nowSec, intervalSec) + 1) * intervalSec;
}

/**
 * Is this schedule due for a payment right now?
 * Due = active AND its current period has not been paid yet.
 * Missed periods are NOT back-paid: if the agent was down for 3 periods, it
 * pays once for the current period (a bill is "pay once per period", and
 * back-paying would overpay the payee).
 */
export function isDue(schedule: Schedule, state: ScheduleState | undefined, nowSec: number): boolean {
  if (!schedule.active) return false;
  const interval = scheduleIntervalSeconds(schedule);
  return state?.lastPeriodKey !== periodKey(nowSec, interval);
}

/** Unix seconds of the next payment attempt for a schedule (informational). */
export function nextDueAt(
  schedule: Schedule,
  state: ScheduleState | undefined,
  nowSec: number,
): number | null {
  if (!schedule.active) return null;
  const interval = scheduleIntervalSeconds(schedule);
  if (isDue(schedule, state, nowSec)) return nowSec;
  return nextPeriodStart(nowSec, interval);
}
