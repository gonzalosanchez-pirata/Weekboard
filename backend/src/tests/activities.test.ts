import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import { db } from '../database';

beforeEach(() => {
  db.exec('DELETE FROM cards');
  db.exec('DELETE FROM activities');
  db.exec('DELETE FROM weeks');
});

describe('GET /api/activities', () => {
  it('devuelve array vacío cuando no hay actividades', async () => {
    const res = await request(app).get('/api/activities');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('devuelve las actividades existentes', async () => {
    db.prepare('INSERT INTO activities (name, color, days) VALUES (?, ?, ?)')
      .run('Estudiar', '#ff0000', JSON.stringify(['monday']));

    const res = await request(app).get('/api/activities');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Estudiar');
  });
});

describe('POST /api/activities', () => {
  it('crea una actividad correctamente', async () => {
    const res = await request(app)
      .post('/api/activities')
      .send({ name: 'Estudiar', color: '#ff0000', days: ['monday'] });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Estudiar');
    expect(res.body.id).toBeDefined();
  });

  it('devuelve 400 si falta el nombre', async () => {
    const res = await request(app)
      .post('/api/activities')
      .send({ color: '#ff0000', days: ['monday'] });

    expect(res.status).toBe(400);
  });

  it('devuelve 400 si days no es array', async () => {
    const res = await request(app)
      .post('/api/activities')
      .send({ name: 'Estudiar', color: '#ff0000', days: 'monday' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/activities/:id', () => {
  it('elimina una actividad existente', async () => {
    const result = db.prepare('INSERT INTO activities (name, color, days) VALUES (?, ?, ?)')
      .run('Estudiar', '#ff0000', JSON.stringify(['monday']));

    const res = await request(app)
      .delete(`/api/activities/${result.lastInsertRowid}`);

    expect(res.status).toBe(204);
  });

  it('devuelve 404 si la actividad no existe', async () => {
    const res = await request(app).delete('/api/activities/9999');
    expect(res.status).toBe(404);
  });
});