import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { startApiServer, setState } from '../../src/bot/api/server.js';
import { loadState } from '../../src/bot/storage/state.js';

let server: unknown;
let baseUrl: string;

describe('API Routes', () => {
  beforeAll(async () => {
    const state = loadState();
    setState(state);
    
    server = await startApiServer({
      port: 3849,
      apiKey: 'test-api-key',
      corsOrigin: '*',
    });
    baseUrl = 'http://localhost:3849';
  });

  afterAll(() => {
    if (server && typeof server === 'object' && 'stop' in server) {
      (server as { stop: () => void }).stop();
    }
  });

  describe('GET /health', () => {
    it('returns ok status', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('ok');
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('GET /status', () => {
    it('returns status without auth', async () => {
      const res = await fetch(`${baseUrl}/status`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.running).toBe(false);
      expect(json.emergencyStop).toBeDefined();
      expect(json.mode).toBeDefined();
      expect(json.pairs).toBeDefined();
    });
  });

  describe('GET /trades', () => {
    it('returns empty trades for today', async () => {
      const res = await fetch(`${baseUrl}/trades`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.trades).toBeDefined();
      expect(Array.isArray(json.trades)).toBe(true);
    });
  });

  describe('POST /emergency-stop', () => {
    it('requires auth', async () => {
      const res = await fetch(`${baseUrl}/emergency-stop`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('returns current status with valid auth', async () => {
      const res = await fetch(`${baseUrl}/emergency-stop`, {
        method: 'POST',
        headers: { 'X-API-Key': 'test-api-key' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.emergencyStop).toBeDefined();
    });

    it('can stop with valid auth', async () => {
      const res = await fetch(`${baseUrl}/emergency-stop`, {
        method: 'POST',
        headers: { 
          'X-API-Key': 'test-api-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'stop' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.emergencyStop).toBe(true);
    });
  });

  describe('POST /config', () => {
    it('requires auth', async () => {
      const res = await fetch(`${baseUrl}/config`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('rejects invalid config keys', async () => {
      const res = await fetch(`${baseUrl}/config`, {
        method: 'POST',
        headers: { 
          'X-API-Key': 'test-api-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ INVALID_KEY: 'value' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });
  });

  describe('404 handling', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await fetch(`${baseUrl}/unknown-route`);
      expect(res.status).toBe(404);
    });
  });
});
