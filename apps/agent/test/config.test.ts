import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSchedules, parseSessionKeys } from '../src/config.js';

const ANVIL_KEY_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_KEY_1 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

describe('parseSessionKeys', () => {
  it('parses SESSION_KEYS_JSON', () => {
    const keys = parseSessionKeys({ SESSION_KEYS_JSON: JSON.stringify({ 0: ANVIL_KEY_0, 3: ANVIL_KEY_1 }) });
    expect(keys.get(0)).toBe(ANVIL_KEY_0);
    expect(keys.get(3)).toBe(ANVIL_KEY_1);
    expect(keys.size).toBe(2);
  });
  it('parses per-session SESSION_KEY_<id> vars', () => {
    const keys = parseSessionKeys({ SESSION_KEY_0: ANVIL_KEY_0, SESSION_KEY_2: ANVIL_KEY_1, OTHER: 'x' });
    expect(keys.get(0)).toBe(ANVIL_KEY_0);
    expect(keys.get(2)).toBe(ANVIL_KEY_1);
  });
  it('prefers SESSION_KEYS_JSON when both styles are set', () => {
    const keys = parseSessionKeys({ SESSION_KEYS_JSON: JSON.stringify({ 0: ANVIL_KEY_0 }), SESSION_KEY_0: ANVIL_KEY_1 });
    expect(keys.get(0)).toBe(ANVIL_KEY_0);
  });
  it('accepts keys without the 0x prefix', () => {
    const keys = parseSessionKeys({ SESSION_KEY_0: ANVIL_KEY_0.slice(2) });
    expect(keys.get(0)).toBe(ANVIL_KEY_0);
  });
  it('rejects malformed keys and JSON', () => {
    expect(() => parseSessionKeys({ SESSION_KEYS_JSON: '{bad' })).toThrow(/not valid JSON/);
    expect(() => parseSessionKeys({ SESSION_KEYS_JSON: '{"0":"0x1234"}' })).toThrow(/32-byte/);
    expect(() => parseSessionKeys({ SESSION_KEY_0: 'not-a-key' })).toThrow(/32-byte/);
    expect(() => parseSessionKeys({ SESSION_KEYS_JSON: '[]' })).toThrow(/JSON object/);
  });
  it('returns an empty map when nothing is set', () => {
    expect(parseSessionKeys({}).size).toBe(0);
  });
});

describe('loadSchedules', () => {
  function writeSchedules(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'agentpay-sched-'));
    const path = join(dir, 'schedules.json');
    writeFileSync(path, content);
    return path;
  }

  const good = JSON.stringify([
    { id: 'rent', sessionId: 0, payee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', amount: '5.0', every: '1d', active: true },
    { id: 'hourly', sessionId: 1, payee: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', amount: '0.5', intervalSeconds: 3600, active: false },
  ]);

  it('loads and validates a good file', () => {
    const path = writeSchedules(good);
    try {
      const schedules = loadSchedules(path);
      expect(schedules).toHaveLength(2);
      expect(schedules[0].id).toBe('rent');
    } finally {
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  const badCases: Array<[string, RegExp]> = [
    ['not json', /not valid JSON/],
    ['{}', /must contain a JSON array/],
    [JSON.stringify([{ id: 'a', sessionId: 0, payee: '0x123', amount: '1', every: '1d', active: true }]), /payee/],
    [JSON.stringify([{ id: 'a', sessionId: 0, payee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', amount: '0', every: '1d', active: true }]), /amount.*> 0/],
    [JSON.stringify([{ id: 'a', sessionId: 0, payee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', amount: 'abc', every: '1d', active: true }]), /amount/],
    [JSON.stringify([{ id: 'a', sessionId: 0, payee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', amount: '1', active: true }]), /every.*intervalSeconds/],
    [JSON.stringify([{ id: 'a', sessionId: -1, payee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', amount: '1', every: '1d', active: true }]), /sessionId/],
    [
      JSON.stringify([
        { id: 'dup', sessionId: 0, payee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', amount: '1', every: '1d', active: true },
        { id: 'dup', sessionId: 0, payee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', amount: '1', every: '1d', active: true },
      ]),
      /duplicate schedule id/,
    ],
  ];
  for (const [content, pattern] of badCases) {
    it(`rejects: ${content.slice(0, 60)}…`, () => {
      const path = writeSchedules(content);
      try {
        expect(() => loadSchedules(path)).toThrow(pattern);
      } finally {
        rmSync(join(path, '..'), { recursive: true, force: true });
      }
    });
  }

  it('rejects a missing file with a helpful message', () => {
    expect(() => loadSchedules('/tmp/does-not-exist-agentpay.json')).toThrow(/not found/);
  });
});
