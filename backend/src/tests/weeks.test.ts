import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import { db } from '../database';

beforeEach(() => {
  db.exec('DELETE FROM cards');
  db.exec('DELETE FROM activities');
  db.exec('DELETE FROM weeks');
});

const VALID_WEEK = '2026-06-22'; // lunes válido para tests

function createActivity(days = ['monday', 'wednesday', 'friday']) {
  return db
    .prepare('INSERT INTO activities (name, color, days) VALUES (?, ?, ?)')
    .run('Test Activity', '#ff0000', JSON.stringify(days));
}

// ---------------------------------------------------------------------------
// GET /api/weeks/planned
// ---------------------------------------------------------------------------

describe('GET /api/weeks/planned', () => {
  it('devuelve { planned: false } si la semana no existe en la DB', async () => {
    const res = await request(app).get(`/api/weeks/planned?week=${VALID_WEEK}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ planned: false });
  });

  it('devuelve { planned: true } si la semana tiene planned=1', async () => {
    db.prepare('INSERT INTO weeks (start_date, planned) VALUES (?, 1)').run(VALID_WEEK);

    const res = await request(app).get(`/api/weeks/planned?week=${VALID_WEEK}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ planned: true });
  });

  it('devuelve { planned: false } si la semana existe pero planned=0', async () => {
    db.prepare('INSERT INTO weeks (start_date, planned) VALUES (?, 0)').run(VALID_WEEK);

    const res = await request(app).get(`/api/weeks/planned?week=${VALID_WEEK}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ planned: false });
  });

  it('devuelve 400 si el parámetro week tiene formato inválido', async () => {
    const res = await request(app).get('/api/weeks/planned?week=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('devuelve 400 si falta el parámetro week', async () => {
    const res = await request(app).get('/api/weeks/planned');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/weeks/plan
// ---------------------------------------------------------------------------

describe('PATCH /api/weeks/plan', () => {
  it('plan exitoso devuelve 200 con { ok: true } y marca planned=1 en la DB', async () => {
    const res = await request(app)
      .patch('/api/weeks/plan')
      .send({ week: VALID_WEEK });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const row = db
      .prepare('SELECT planned FROM weeks WHERE start_date = ?')
      .get(VALID_WEEK) as { planned: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.planned).toBe(1);
  });

  it('plan exitoso crea cards para actividades existentes en los días correctos', async () => {
    createActivity(['monday', 'wednesday']);

    const res = await request(app)
      .patch('/api/weeks/plan')
      .send({ week: VALID_WEEK });

    expect(res.status).toBe(200);

    const cards = db
      .prepare(`
        SELECT cards.day FROM cards
        JOIN weeks ON cards.week_id = weeks.id
        WHERE weeks.start_date = ?
        ORDER BY cards.day
      `)
      .all(VALID_WEEK) as { day: string }[];

    const days = cards.map((c) => c.day).sort();
    expect(days).toEqual(['monday', 'wednesday'].sort());
  });

  it('plan con múltiples actividades crea todas las cards correspondientes', async () => {
    createActivity(['monday']);
    createActivity(['tuesday', 'thursday']);

    const res = await request(app)
      .patch('/api/weeks/plan')
      .send({ week: VALID_WEEK });

    expect(res.status).toBe(200);

    const count = db
      .prepare(`
        SELECT COUNT(*) AS cnt FROM cards
        JOIN weeks ON cards.week_id = weeks.id
        WHERE weeks.start_date = ?
      `)
      .get(VALID_WEEK) as { cnt: number };

    expect(count.cnt).toBe(3); // 1 + 2
  });

  it('plan es idempotente: llamar dos veces sigue devolviendo 200 y planned=1', async () => {
    const res1 = await request(app)
      .patch('/api/weeks/plan')
      .send({ week: VALID_WEEK });
    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .patch('/api/weeks/plan')
      .send({ week: VALID_WEEK });
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ ok: true });

    const row = db
      .prepare('SELECT planned FROM weeks WHERE start_date = ?')
      .get(VALID_WEEK) as { planned: number } | undefined;
    expect(row!.planned).toBe(1);
  });

  it('plan idempotente: llamar dos veces no duplica cards', async () => {
    createActivity(['monday', 'tuesday']);

    await request(app).patch('/api/weeks/plan').send({ week: VALID_WEEK });
    await request(app).patch('/api/weeks/plan').send({ week: VALID_WEEK });

    const count = db
      .prepare(`
        SELECT COUNT(*) AS cnt FROM cards
        JOIN weeks ON cards.week_id = weeks.id
        WHERE weeks.start_date = ?
      `)
      .get(VALID_WEEK) as { cnt: number };

    expect(count.cnt).toBe(2); // no duplicados
  });

  it('devuelve 400 si el campo week tiene formato inválido', async () => {
    const res = await request(app)
      .patch('/api/weeks/plan')
      .send({ week: '22-06-2026' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('devuelve 400 si el body está vacío (sin campo week)', async () => {
    const res = await request(app)
      .patch('/api/weeks/plan')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('devuelve 400 si week es null', async () => {
    const res = await request(app)
      .patch('/api/weeks/plan')
      .send({ week: null });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
