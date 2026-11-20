import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StateStore } from '../src/state.js';
import type { ExecutionRecord } from '../src/types.js';

function record(over: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    timestamp: new Date(1_700_000_000_000).toISOString(),
    scheduleId: 'rent',
    sessionId: 0,
    payee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    amount: '5.0',
    status: 'success',
    txHash: '0xabc',
    ...over,
  };
}

describe('StateStore', () => {
  it('starts empty and persists a successful execution', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentpay-state-'));
    try {
      const path = join(dir, 'state.json');
      const store = new StateStore(path);
      expect(store.getScheduleState('rent')).toBeUndefined();
      store.recordExecution(record(), 19675);
      const row = store.getScheduleState('rent');
      expect(row?.lastPeriodKey).toBe(19675);
      expect(row?.lastExecutedAt).toBe(1_700_000_000);
      expect(row?.lastTxHash).toBe('0xabc');
      expect(row?.lastStatus).toBe('success');
      // Reload from disk: the period key survives a restart.
      const reloaded = new StateStore(path);
      expect(reloaded.getScheduleState('rent')?.lastPeriodKey).toBe(19675);
      expect(reloaded.snapshot().executions).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skipped/failed attempts do NOT advance the idempotency key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentpay-state-'));
    try {
      const path = join(dir, 'state.json');
      const store = new StateStore(path);
      store.recordExecution(record({ status: 'skipped', reason: 'DAILY_LIMIT', txHash: undefined }), 19675);
      const row = store.getScheduleState('rent');
      expect(row?.lastPeriodKey).toBeNull();
      expect(row?.lastStatus).toBe('skipped');
      expect(row?.lastReason).toBe('DAILY_LIMIT');
      // A later success in the same period still works.
      store.recordExecution(record(), 19675);
      expect(store.getScheduleState('rent')?.lastPeriodKey).toBe(19675);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('caps execution history at 200 entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentpay-state-'));
    try {
      const path = join(dir, 'state.json');
      const store = new StateStore(path);
      for (let i = 0; i < 250; i++) {
        store.recordExecution(record({ scheduleId: `s${i}` }), 1);
      }
      expect(store.snapshot().executions).toHaveLength(200);
      expect(store.snapshot().executions[0].scheduleId).toBe('s249');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes atomically (no .tmp left behind) and refuses corrupt state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentpay-state-'));
    try {
      const path = join(dir, 'state.json');
      const store = new StateStore(path);
      store.recordExecution(record(), 1);
      // No leftover tmp file after a successful save.
      expect(existsSync(`${path}.tmp`)).toBe(false);

      writeFileSync(path, '{not json');
      expect(() => new StateStore(path)).toThrow(/corrupt/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
