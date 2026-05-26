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