/** Structured logging: human-readable line on stdout + JSON line appended to a file. */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExecutionRecord } from './types.js';

export type LogLevel = 'info' | 'warn' | 'error';

export class Logger {
  constructor(private readonly filePath: string | null) {
    if (filePath) mkdirSync(dirname(filePath), { recursive: true });
  }

  log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
    const timestamp = new Date().toISOString();
    const flat = Object.entries(fields)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    const line = `[${timestamp}] ${level.toUpperCase()} ${message}${flat ? ` ${flat}` : ''}`;
    if (level === 'error') console.error(line);
    else console.log(line);
    if (this.filePath) {
      try {
        appendFileSync(this.filePath, `${JSON.stringify({ timestamp, level, message, ...fields })}\n`);
      } catch {
        // Logging must never crash the agent.
      }
    }
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.log('info', message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.log('warn', message, fields);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.log('error', message, fields);
  }

  /** One line per execution attempt: timestamp, schedule, session, payee, amount, outcome, tx hash or reason. */
  execution(record: ExecutionRecord): void {
    const fields: Record<string, unknown> = {
      scheduleId: record.scheduleId,
      sessionId: record.sessionId,
      payee: record.payee,
      amount: `${record.amount} tUSD8`,
      status: record.status,
    };
    if (record.txHash) fields.txHash = record.txHash;
    if (record.reason) fields.reason = record.reason;
    if (record.detail) fields.detail = record.detail;
    const level: LogLevel = record.status === 'success' ? 'info' : record.status === 'skipped' ? 'warn' : 'error';
    this.log(level, `payment ${record.status}: ${record.scheduleId}`, fields);
  }
}
