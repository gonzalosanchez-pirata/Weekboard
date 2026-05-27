import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import { db } from '../database';

beforeEach(() => {
  db.exec('DELETE FROM cards');
  db.exec('DELETE FROM activities');
  db.exec('DELETE FROM weeks');
});

function createActivity() {
  return db.prepare('INSERT INTO activities (name, color, days) VALUES (?, ?, ?)')
    .run('Estudiar', '#ff0000', JSON.stringify(['monday']));
}

function createWeek() {
  return db.prepare('INSERT INTO weeks (start_date) VALUES (?)')
    .run('2026-05-18');
}

function createCard() {
  const activity = createActivity();
  const week = createWeek();
  return db.prepare('INSERT INTO cards (activity_id, week_id, day) VALUES (?, ?, ?)')
    .run(activity.lastInsertRowid, week.lastInsertRowid, 'monday');
}

describe('GET /api/cards', () => {
  it('devuelve 400 si falta el parámetro week', async () => {
    const res = await request(app).get('/api/cards');
    expect(res.status).toBe(400);
  });

  it('devuelve array vacío si no hay cards para esa semana', async () => {
    const res = await request(app).get('/api/cards?week=2026-05-18');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('devuelve las cards de la semana correcta', async () => {
    const activity = createActivity();
    const week = createWeek();
    db.prepare('INSERT INTO cards (activity_id, week_id, day) VALUES (?, ?, ?)')
      .run(activity.lastInsertRowid, week.lastInsertRowid, 'monday');

    const res = await request(app).get('/api/cards?week=2026-05-18');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('POST /api/cards', () => {
  it('crea una card con week como fecha', async () => {
    const activity = createActivity();

    const res = await request(app)
      .post('/api/cards')
      .send({ activity_id: activity.lastInsertRowid, week: '2026-05-18', day: 'monday' });

    expect(res.status).toBe(201);
    expect(res.body.day).toBe('monday');
  });

  it('devuelve 400 si falta activity_id', async () => {
    const res = await request(app)
      .post('/api/cards')
      .send({ week: '2026-05-18', day: 'monday' });

    expect(res.status).toBe(400);
  });

  it('devuelve 400 si falta week y week_id', async () => {
    const activity = createActivity();

    const res = await request(app)
      .post('/api/cards')
      .send({ activity_id: activity.lastInsertRowid, day: 'monday' });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/cards/:id/complete', () => {
  it('invierte el estado completed de una card', async () => {
    const activity = createActivity();
    const week = createWeek();
    const card = db.prepare('INSERT INTO cards (activity_id, week_id, day) VALUES (?, ?, ?)')
      .run(activity.lastInsertRowid, week.lastInsertRowid, 'monday');

    const res = await request(app)
      .patch(`/api/cards/${card.lastInsertRowid}/complete`);

    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(1);
  });

  it('devuelve 404 si la card no existe', async () => {
    const res = await request(app).patch('/api/cards/9999/complete');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/cards/:id', () => {
  it('elimina una card existente', async () => {
    const activity = createActivity();
    const week = createWeek();
    const card = db.prepare('INSERT INTO cards (activity_id, week_id, day) VALUES (?, ?, ?)')
      .run(activity.lastInsertRowid, week.lastInsertRowid, 'monday');

    const res = await request(app)
      .delete(`/api/cards/${card.lastInsertRowid}`);

    expect(res.status).toBe(204);
  });

  it('devuelve 404 si la card no existe', async () => {
    const res = await request(app).delete('/api/cards/9999');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/cards/:id/duration', () => {
  it('configura duration_seconds y remaining_seconds', async () => {
    const card = createCard();

    const res = await request(app)
      .patch(`/api/cards/${card.lastInsertRowid}/duration`)
      .send({ duration_seconds: 300 });

    expect(res.status).toBe(200);
    expect(res.body.duration_seconds).toBe(300);
    expect(res.body.remaining_seconds).toBe(300);
    expect(res.body.timer_running).toBe(0);
    expect(res.body.last_started_at).toBeNull();
  });

  it('detiene el cronómetro si estaba corriendo', async () => {
    const card = createCard();
    const id = card.lastInsertRowid;

    await request(app).patch(`/api/cards/${id}/duration`).send({ duration_seconds: 300 });
    await request(app).patch(`/api/cards/${id}/timer/start`);

    const res = await request(app)
      .patch(`/api/cards/${id}/duration`)
      .send({ duration_seconds: 600 });

    expect(res.status).toBe(200);
    expect(res.body.duration_seconds).toBe(600);
    expect(res.body.remaining_seconds).toBe(600);
    expect(res.body.timer_running).toBe(0);
    expect(res.body.last_started_at).toBeNull();
  });

  it.each([59, 90000, 1.5])('devuelve 400 si duration_seconds es inválido (%s)', async (value) => {
    const card = createCard();

    const res = await request(app)
      .patch(`/api/cards/${card.lastInsertRowid}/duration`)
      .send({ duration_seconds: value });

    expect(res.status).toBe(400);
  });

  it('devuelve 404 si la card no existe', async () => {
    const res = await request(app)
      .patch('/api/cards/9999/duration')
      .send({ duration_seconds: 300 });

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/cards/:id/timer/start', () => {
  it('inicia el cronómetro con duración configurada', async () => {
    const card = createCard();
    const id = card.lastInsertRowid;

    await request(app).patch(`/api/cards/${id}/duration`).send({ duration_seconds: 300 });

    const res = await request(app).patch(`/api/cards/${id}/timer/start`);

    expect(res.status).toBe(200);
    expect(res.body.timer_running).toBe(1);
    expect(res.body.last_started_at).toBeTruthy();
  });

  it('devuelve 400 si no hay duración configurada', async () => {
    const card = createCard();

    const res = await request(app).patch(`/api/cards/${card.lastInsertRowid}/timer/start`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('duración');
  });

  it('devuelve 400 si remaining_seconds es 0', async () => {
    const card = createCard();
    const id = card.lastInsertRowid;

    db.prepare(
      'UPDATE cards SET duration_seconds = 300, remaining_seconds = 0 WHERE id = ?'
    ).run(id);

    const res = await request(app).patch(`/api/cards/${id}/timer/start`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('tiempo restante');
  });

  it('devuelve 404 si la card no existe', async () => {
    const res = await request(app).patch('/api/cards/9999/timer/start');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/cards/:id/timer/pause', () => {
  it('pausa el cronómetro y actualiza remaining_seconds', async () => {
    const card = createCard();
    const id = card.lastInsertRowid;

    await request(app).patch(`/api/cards/${id}/duration`).send({ duration_seconds: 300 });
    await request(app).patch(`/api/cards/${id}/timer/start`);

    const res = await request(app).patch(`/api/cards/${id}/timer/pause`);

    expect(res.status).toBe(200);
    expect(res.body.timer_running).toBe(0);
    expect(res.body.last_started_at).toBeNull();
    expect(res.body.remaining_seconds).toBeLessThanOrEqual(300);
  });

  it('devuelve 400 si el cronómetro no está corriendo', async () => {
    const card = createCard();
    const id = card.lastInsertRowid;

    await request(app).patch(`/api/cards/${id}/duration`).send({ duration_seconds: 300 });

    const res = await request(app).patch(`/api/cards/${id}/timer/pause`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('no está en ejecución');
  });

  it('devuelve 404 si la card no existe', async () => {
    const res = await request(app).patch('/api/cards/9999/timer/pause');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/cards/:id/timer/reset', () => {
  it('restaura remaining_seconds a duration_seconds', async () => {
    const card = createCard();
    const id = card.lastInsertRowid;

    await request(app).patch(`/api/cards/${id}/duration`).send({ duration_seconds: 300 });
    db.prepare('UPDATE cards SET remaining_seconds = 100 WHERE id = ?').run(id);

    const res = await request(app).patch(`/api/cards/${id}/timer/reset`);

    expect(res.status).toBe(200);
    expect(res.body.remaining_seconds).toBe(300);
    expect(res.body.duration_seconds).toBe(300);
    expect(res.body.timer_running).toBe(0);
    expect(res.body.last_started_at).toBeNull();
  });

  it('devuelve 400 si no hay duración configurada', async () => {
    const card = createCard();

    const res = await request(app).patch(`/api/cards/${card.lastInsertRowid}/timer/reset`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('duración');
  });

  it('devuelve 404 si la card no existe', async () => {
    const res = await request(app).patch('/api/cards/9999/timer/reset');
    expect(res.status).toBe(404);
  });
});