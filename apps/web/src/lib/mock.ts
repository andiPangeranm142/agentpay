import { parseUnits, type Address } from 'viem';
import type { Payment, RegisteredPayee, Session } from './types';

/**
 * Realistic demo data for MOCK MODE (no contracts deployed yet).
 * Clearly labeled in the UI as "Demo data". Timestamps are relative to
 * "now" so the demo always looks alive.
 */

const A = (s: string) => s as Address;
const u = (v: string) => parseUnits(v, 6);

const now = () => Math.floor(Date.now() / 1000);
const DAY = 86_400;

export const MOCK_VAULT_BALANCE = u('1250.50');
export const MOCK_WALLET_BALANCE = u('320.00');

export const MOCK_SESSIONS: Session[] = [
  {
    id: 0n,
    owner: A('0x32fA73e4Eb17d13873D074cdc44105625D48eCD6'),
    sessionKey: A('0x1111111111111111111111111111111111111111'),
    payees: [
      A('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
      A('0xB0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49'),
      A('0xC0b86991c6218b36c1d19D4a2e9Eb0cE3606eB50'),
    ],
    perTxLimit: u('50'),
    dailyLimit: u('120'),
    expiry: now() + 24 * DAY,
    revoked: false,
    remainingDaily: u('78.25'),
    label: 'Monthly bills — electricity, water, internet',
  },
  {
    id: 1n,
    owner: A('0x32fA73e4Eb17d13873D074cdc44105625D48eCD6'),
    sessionKey: A('0x2222222222222222222222222222222222222222'),
    payees: [A('0xD0b86991c6218b36c1d19D4a2e9Eb0cE3606eB51')],
    perTxLimit: u('25'),
    dailyLimit: u('25'),
    expiry: now() + 2 * DAY,
    revoked: false,
    remainingDaily: u('25'),
    label: 'Streaming subscriptions',
  },
  {
    id: 2n,
    owner: A('0x32fA73e4Eb17d13873D074cdc44105625D48eCD6'),
    sessionKey: A('0x3333333333333333333333333333333333333333'),
    payees: [A('0xE0b86991c6218b36c1d19D4a2e9Eb0cE3606eB52')],
    perTxLimit: u('100'),
    dailyLimit: u('200'),
    expiry: now() + 60 * DAY,
    revoked: true,
    remainingDaily: u('200'),
    label: 'Old trial session (revoked)',
  },
];

export const MOCK_PAYMENTS: Payment[] = [
  {
    sessionId: 0n,
    payee: A('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    amount: u('24.75'),
    timestamp: now() - 2 * 3600,
    txHash: '0x9f2c1a7e4b8d3f6a5c0e1b2d3f4a5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
    label: 'PLN • Electricity bill',
  },
  {
    sessionId: 0n,
    payee: A('0xB0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49'),
    amount: u('17.00'),
    timestamp: now() - 5 * 3600,
    txHash: '0x8e1b0a6d3c7c2e5f4b9d0a1c2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f',
    label: 'PDAM • Water bill',
  },
  {
    sessionId: 0n,
    payee: A('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    amount: u('24.75'),
    timestamp: now() - 26 * 3600,
    txHash: '0x7d0a9f5c2b6b1d4e3a8c9f0b1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e',
    label: 'PLN • Electricity bill',
  },
  {
    sessionId: 1n,
    payee: A('0xD0b86991c6218b36c1d19D4a2e9Eb0cE3606eB51'),
    amount: u('12.99'),
    timestamp: now() - 30 * 3600,
    txHash: '0x6c9f8e4b1a5a0c3d2f7b8e9a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d',
    label: 'StreamCo • Monthly plan',
  },
  {
    sessionId: 0n,
    payee: A('0xC0b86991c6218b36c1d19D4a2e9Eb0cE3606eB50'),
    amount: u('31.50'),
    timestamp: now() - 50 * 3600,
    txHash: '0x5b8e7d3a0f494b2c1e6a7d8f9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c',
    label: 'NetLink • Internet bill',
  },
];

/**
 * Mock v2 (Confirmation of Payee) data — demo only, clearly bannered
 * "Demo data" in the UI. Mirrors the shape of the real testnet run so the
 * Payees tab is fully reviewable with no contracts deployed.
 */

export const MOCK_REGISTERED_PAYEES: RegisteredPayee[] = [
  {
    payee: A('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    name: 'PLN — Electricity',
    txHash: '0x9f2c1a7e4b8d3f6a5c0e1b2d3f4a5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
  },
  {
    payee: A('0xB0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49'),
    name: 'PDAM — Water',
    txHash: '0x8e1b0a6d3c7c2e5f4b9d0a1c2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f',
  },
];

export const MOCK_V2_SESSIONS: Session[] = [
  {
    id: 0n,
    owner: A('0x32fA73e4Eb17d13873D074cdc44105625D48eCD6'),
    sessionKey: A('0x1111111111111111111111111111111111111111'),
    payees: [
      A('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
      A('0xB0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49'),
    ],
    perTxLimit: u('50'),
    dailyLimit: u('120'),
    perPayeeCap: u('80'),
    expiry: now() + 24 * DAY,
    revoked: false,
    remainingDaily: u('78.25'),
    version: 2,
    label: 'Monthly bills — name-checked',
    payeeSpend: [
      {
        payee: A('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
        name: 'PLN — Electricity',
        spent: u('41.75'),
        cap: u('80'),
        remaining: u('38.25'),
      },
      {
        payee: A('0xB0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49'),
        name: 'PDAM — Water',
        spent: u('17.00'),
        cap: u('80'),
        remaining: u('63.00'),
      },
    ],
  },
];

export const MOCK_V2_PAYMENTS: Payment[] = [
  {
    sessionId: 0n,
    payee: A('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    amount: u('24.75'),
    timestamp: now() - 2 * 3600,
    txHash: '0x9f2c1a7e4b8d3f6a5c0e1b2d3f4a5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
    label: 'PLN • Electricity bill',
    version: 2,
    payeeName: 'PLN — Electricity',
    nameVerified: true,
  },
  {
    sessionId: 0n,
    payee: A('0xB0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49'),
    amount: u('17.00'),
    timestamp: now() - 5 * 3600,
    txHash: '0x8e1b0a6d3c7c2e5f4b9d0a1c2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f',
    label: 'PDAM • Water bill',
    version: 2,
    payeeName: 'PDAM — Water',
    nameVerified: true,
  },
];
