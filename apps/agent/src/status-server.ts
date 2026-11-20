/** Tiny localhost-only HTTP status endpoint. No dependencies, no secrets served. */

import { createServer, type Server } from 'node:http';
import type { AgentStatus } from './agent.js';

export interface StatusServer {
  close(): Promise<void>;
}

export function startStatusServer(port: number, getStatus: () => AgentStatus): Promise<StatusServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method === 'GET' && req.url === '/status') {
        res.writeHead(200);
        res.end(JSON.stringify(getStatus(), null, 2));
        return;
      }
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200);
        res.end(JSON.stringify({ service: 'agentpay-agent', status: '/status', health: '/health' }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    });
    server.on('error', reject);
    // Localhost only — status data is not sensitive, but there is no reason
    // to expose it on the network.
    server.listen(port, '127.0.0.1', () => resolve({
      close: () =>
        new Promise<void>((done) => {
          server.close(() => done());
        }),
    }));
  });
}
