import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server';

describe('Configuraciones de Seguridad y CORS', () => {
  it('GET /api/health con header Origin no permitido → 403', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'http://evil.com');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Origen no permitido');
  });

  it('GET /api/health con header Origin permitido → 200', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5500');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/health sin header Origin → 200', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/health incluye headers de seguridad de helmet', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
