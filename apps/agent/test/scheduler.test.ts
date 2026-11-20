import { describe, expect, it } from 'vitest';
import { isDue, nextDueAt, nextPeriodStart, parseInterval, periodKey, scheduleIntervalSeconds } from '../src/scheduler.js';
import type { Schedule, ScheduleState } from '../src/types.js';
import { emptyScheduleState } from '../src/types.js';

const base = (over: Partial<Schedule> = {}): Schedule => ({
  id: 'test',
  sessionId: 0,
  payee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  amount: '5.0',
  every: '1d',
  active: true,
  ...over,
});

describe('parseInterval', () => {
  it('parses single units', () => {
    expect(parseInterval('30s')).toBe(30);
    expect(parseInterval('5m')).toBe(300);
    expect(parseInterval('1h')).toBe(3600);
    expect(parseInterval('1d')).toBe(86400);
    expect(parseInterval('1w')).toBe(604800);
  });
  it('parses combined units', () => {
    expect(parseInterval('1d12h')).toBe(86400 + 43200);
    expect(parseInterval('1h30m')).toBe(5400);
  });
  it('is case-insensitive and tolerates spaces', () => {
    expect(parseInterval(' 1D ')).toBe(86400);
    expect(parseInterval('2H')).toBe(7200);
  });
  it('rejects invalid input', () => {
    expect(() => parseInterval('')).toThrow();
    expect(() => parseInterval('0s')).toThrow();
    expect(() => parseInterval('1x')).toThrow();
    expect(() => parseInterval('daily')).toThrow();
    expect(() => parseInterval('1')).toThrow();
    expect(() => parseInterval('-1h')).toThrow();
  });
});

describe('scheduleIntervalSeconds', () => {
  it('prefers intervalSeconds over every', () => {
    expect(scheduleIntervalSeconds(base({ every: '1d', intervalSeconds: 60 }))).toBe(60);
  });
  it('throws when neither is set', () => {
    expect(() => scheduleIntervalSeconds(base({ every: undefined }))).toThrow();
  });
  it('throws on non-positive intervalSeconds', () => {
    expect(() => scheduleIntervalSeconds(base({ intervalSeconds: 0 }))).toThrow();
    expect(() => scheduleIntervalSeconds(base({ intervalSeconds: 1.5 }))).toThrow();
  });
});

describe('periodKey / nextPeriodStart', () => {
  it('buckets timestamps into periods', () => {
    expect(periodKey(0, 3600)).toBe(0);
    expect(periodKey(3599, 3600)).toBe(0);
    expect(periodKey(3600, 3600)).toBe(1);
    expect(periodKey(86399, 86400)).toBe(0);
    expect(periodKey(86400, 86400)).toBe(1);
  });
  it('nextPeriodStart is the start of the following period', () => {
    expect(nextPeriodStart(100, 3600)).toBe(3600);
    expect(nextPeriodStart(3600, 3600)).toBe(7200);
  });
});

describe('isDue (idempotency)', () => {
  const day = base();

  it('is due when never executed', () => {
    expect(isDue(day, undefined, 1_700_000_000)).toBe(true);
    expect(isDue(day, emptyScheduleState(), 1_700_000_000)).toBe(true);
  });

  it('is NOT due twice in the same period (restart safety)', () => {
    const now = 1_700_000_000;
    const st: ScheduleState = { ...emptyScheduleState(), lastPeriodKey: periodKey(now, 86400) };
    expect(isDue(day, st, now)).toBe(false);
    // Still the same period an hour later — still not due.
    expect(isDue(day, st, now + 3600)).toBe(false);
  });

  it('is due again in the next period', () => {
    const now = 1_700_000_000;
    const st: ScheduleState = { ...emptyScheduleState(), lastPeriodKey: periodKey(now, 86400) };
    expect(isDue(day, st, nextPeriodStart(now, 86400))).toBe(true);
  });

  it('does NOT back-pay missed periods (one payment per current period)', () => {
    const now = 1_700_000_000;
    // Last paid 5 periods ago — due exactly once, for the current period.
    const st: ScheduleState = { ...emptyScheduleState(), lastPeriodKey: periodKey(now, 86400) - 5 };
    expect(isDue(day, st, now)).toBe(true);
    const after: ScheduleState = { ...st, lastPeriodKey: periodKey(now, 86400) };
    expect(isDue(day, after, now)).toBe(false);
  });

  it('inactive schedules are never due', () => {
    expect(isDue(base({ active: false }), undefined, 1_700_000_000)).toBe(false);
  });

  it('hourly schedules have independent periods', () => {
    const hourly = base({ every: '1h' });
    const now = 1_700_000_000;
    const st: ScheduleState = { ...emptyScheduleState(), lastPeriodKey: periodKey(now, 3600) };
    expect(isDue(hourly, st, now)).toBe(false);
    expect(isDue(hourly, st, now + 3600)).toBe(true);
  });
});

describe('nextDueAt', () => {
  it('returns now when due, next period start otherwise', () => {
    const now = 1_700_000_000;
    expect(nextDueAt(base(), undefined, now)).toBe(now);
    const st: ScheduleState = { ...emptyScheduleState(), lastPeriodKey: periodKey(now, 86400) };
    expect(nextDueAt(base(), st, now)).toBe(nextPeriodStart(now, 86400));
    expect(nextDueAt(base({ active: false }), undefined, now)).toBeNull();
  });
});
