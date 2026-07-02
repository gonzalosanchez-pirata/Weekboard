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

// ---------------------------------------------------------------------------
// GET /api/weeks/previous
// ---------------------------------------------------------------------------

describe('GET /api/weeks/previous', () => {
  it('devuelve { week: null } si no hay semanas planificadas anteriores', async () => {
    const res = await request(app).get(`/api/weeks/previous?before=${VALID_WEEK}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ week: null });
  });

  it('devuelve la semana planificada anterior más reciente', async () => {
    db.prepare('INSERT INTO weeks (start_date, planned) VALUES (?, 1)').run('2026-06-08');
    db.prepare('INSERT INTO weeks (start_date, planned) VALUES (?, 1)').run('2026-06-15');

    const res = await request(app).get(`/api/weeks/previous?before=${VALID_WEEK}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ week: '2026-06-15' });
  });

  it('ignora semanas no planificadas (planned=0)', async () => {
    db.prepare('INSERT INTO weeks (start_date, planned) VALUES (?, 0)').run('2026-06-15');

    const res = await request(app).get(`/api/weeks/previous?before=${VALID_WEEK}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ week: null });
  });

  it('ignora semanas con start_date igual o posterior a before', async () => {
    db.prepare('INSERT INTO weeks (start_date, planned) VALUES (?, 1)').run(VALID_WEEK);
    db.prepare('INSERT INTO weeks (start_date, planned) VALUES (?, 1)').run('2026-06-29');

    const res = await request(app).get(`/api/weeks/previous?before=${VALID_WEEK}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ week: null });
  });

  it('devuelve 400 si el parámetro before tiene formato inválido', async () => {
    const res = await request(app).get('/api/weeks/previous?before=invalid-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('devuelve 400 si falta el parámetro before', async () => {
    const res = await request(app).get('/api/weeks/previous');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/weeks/confirm
// ---------------------------------------------------------------------------

describe('PATCH /api/weeks/confirm', () => {
  it('semana nueva: devuelve 200 { ok: true } e inserta con planned=1', async () => {
    const res = await request(app).patch('/api/weeks/confirm').send({ week: VALID_WEEK });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const row = db
      .prepare('SELECT planned FROM weeks WHERE start_date = ?')
      .get(VALID_WEEK) as { planned: number };
    expect(row).toBeDefined();
    expect(row.planned).toBe(1);
  });

  it('semana preexistente: idempotente, devuelve 200 y planned sigue siendo 1', async () => {
    db.prepare('INSERT INTO weeks (start_date, planned) VALUES (?, 0)').run(VALID_WEEK);

    const res = await request(app).patch('/api/weeks/confirm').send({ week: VALID_WEEK });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const row = db
      .prepare('SELECT planned FROM weeks WHERE start_date = ?')
      .get(VALID_WEEK) as { planned: number };
    expect(row.planned).toBe(1);
  });

  it('doble llamada no genera duplicados y sigue en planned=1', async () => {
    await request(app).patch('/api/weeks/confirm').send({ week: VALID_WEEK });
    const res = await request(app).patch('/api/weeks/confirm').send({ week: VALID_WEEK });
    expect(res.status).toBe(200);

    const rows = db
      .prepare('SELECT id FROM weeks WHERE start_date = ?')
      .all(VALID_WEEK) as { id: number }[];
    expect(rows.length).toBe(1);
  });

  it('devuelve 400 si falta el campo week', async () => {
    const res = await request(app).patch('/api/weeks/confirm').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('devuelve 400 si el campo week tiene formato inválido', async () => {
    const res = await request(app).patch('/api/weeks/confirm').send({ week: '22-06-2026' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/weeks/copy
// ---------------------------------------------------------------------------

describe('PATCH /api/weeks/copy', () => {
  const SOURCE_WEEK = '2026-06-15';

  it('copia cards correctamente y resetea timers y completado', async () => {
    db.prepare('INSERT INTO weeks (start_date, planned) VALUES (?, 1)').run(SOURCE_WEEK);
    const sourceId = (
      db.prepare('SELECT id FROM weeks WHERE start_date = ?').get(SOURCE_WEEK) as { id: number }
    ).id;

    createActivity(['monday']);
    const actId = (db.prepare('SELECT id FROM activities').get() as { id: number }).id;

    db.prepare(
      'INSERT INTO cards (activity_id, week_id, day, duration_seconds, remaining_seconds, timer_running, last_started_at, completed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(actId, sourceId, 'monday', 3600, 1800, 1, '2026-06-15T10:00:00Z', 1);

    const res = await request(app).patch('/api/weeks/copy').send({ sourceWeek: SOURCE_WEEK, targetWeek: VALID_WEEK });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const targetId = (
      db.prepare('SELECT id FROM weeks WHERE start_date = ?').get(VALID_WEEK) as { id: number }
    ).id;
    const copiedCards = db
      .prepare('SELECT * FROM cards WHERE week_id = ?')
      .all(targetId) as Array<{
        completed: number;
        duration_seconds: number;
        remaining_seconds: number;
        timer_running: number;
        last_started_at: string | null;
      }>;

    expect(copiedCards.length).toBe(1);
    expect(copiedCards[0].completed).toBe(0);
    expect(copiedCards[0].duration_seconds).toBe(3600);
    expect(copiedCards[0].remaining_seconds).toBe(3600); // reset a duration
    expect(copiedCards[0].timer_running).toBe(0);
    expect(copiedCards[0].last_started_at).toBeNull();
  });

  it('idempotente: segunda copia no duplica cards', async () => {
    db.prepare('INSERT INTO weeks (start_date) VALUES (?)').run(SOURCE_WEEK);
    const sourceId = (
      db.prepare('SELECT id FROM weeks WHERE start_date = ?').get(SOURCE_WEEK) as { id: number }
    ).id;
    createActivity(['monday']);
    const actId = (db.prepare('SELECT id FROM activities').get() as { id: number }).id;
    db.prepare('INSERT INTO cards (activity_id, week_id, day) VALUES (?, ?, ?)').run(actId, sourceId, 'monday');

    await request(app).patch('/api/weeks/copy').send({ sourceWeek: SOURCE_WEEK, targetWeek: VALID_WEEK });
    await request(app).patch('/api/weeks/copy').send({ sourceWeek: SOURCE_WEEK, targetWeek: VALID_WEEK });

    const targetId = (
      db.prepare('SELECT id FROM weeks WHERE start_date = ?').get(VALID_WEEK) as { id: number }
    ).id;
    const count = db
      .prepare('SELECT COUNT(*) AS cnt FROM cards WHERE week_id = ?')
      .get(targetId) as { cnt: number };
    expect(count.cnt).toBe(1);
  });

  it('sourceWeek inexistente: responde 200 y no crea nada', async () => {
    const res = await request(app).patch('/api/weeks/copy').send({ sourceWeek: SOURCE_WEEK, targetWeek: VALID_WEEK });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const targetRow = db.prepare('SELECT id FROM weeks WHERE start_date = ?').get(VALID_WEEK) as { id: number } | undefined;
    if (targetRow) {
      const count = db
        .prepare('SELECT COUNT(*) AS cnt FROM cards WHERE week_id = ?')
        .get(targetRow.id) as { cnt: number };
      expect(count.cnt).toBe(0);
    }
  });

  it('devuelve 400 si falta sourceWeek o targetWeek', async () => {
    const res1 = await request(app).patch('/api/weeks/copy').send({ targetWeek: VALID_WEEK });
    expect(res1.status).toBe(400);

    const res2 = await request(app).patch('/api/weeks/copy').send({ sourceWeek: SOURCE_WEEK });
    expect(res2.status).toBe(400);
  });

  it('devuelve 400 si alguna semana tiene formato inválido', async () => {
    const res = await request(app).patch('/api/weeks/copy').send({ sourceWeek: 'not-a-date', targetWeek: VALID_WEEK });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/weeks/cards
// ---------------------------------------------------------------------------

describe('DELETE /api/weeks/cards', () => {
  it('elimina todas las cards de la semana indicada', async () => {
    db.prepare('INSERT INTO weeks (start_date) VALUES (?)').run(VALID_WEEK);
    const weekId = (
      db.prepare('SELECT id FROM weeks WHERE start_date = ?').get(VALID_WEEK) as { id: number }
    ).id;
    createActivity(['monday', 'tuesday']);
    const actId = (db.prepare('SELECT id FROM activities').get() as { id: number }).id;
    db.prepare('INSERT INTO cards (activity_id, week_id, day) VALUES (?, ?, ?)').run(actId, weekId, 'monday');
    db.prepare('INSERT INTO cards (activity_id, week_id, day) VALUES (?, ?, ?)').run(actId, weekId, 'tuesday');

    const res = await request(app).delete(`/api/weeks/cards?week=${VALID_WEEK}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const remaining = db
      .prepare('SELECT COUNT(*) AS cnt FROM cards WHERE week_id = ?')
      .get(weekId) as { cnt: number };
    expect(remaining.cnt).toBe(0);
  });

  it('idempotente: responde 200 si la semana no tiene cards', async () => {
    const res = await request(app).delete(`/api/weeks/cards?week=${VALID_WEEK}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('no afecta cards de otras semanas', async () => {
    const OTHER_WEEK = '2026-06-15';
    db.prepare('INSERT INTO weeks (start_date) VALUES (?)').run(VALID_WEEK);
    db.prepare('INSERT INTO weeks (start_date) VALUES (?)').run(OTHER_WEEK);
    const weekId = (
      db.prepare('SELECT id FROM weeks WHERE start_date = ?').get(VALID_WEEK) as { id: number }
    ).id;
    const otherId = (
      db.prepare('SELECT id FROM weeks WHERE start_date = ?').get(OTHER_WEEK) as { id: number }
    ).id;
    createActivity(['monday']);
    const actId = (db.prepare('SELECT id FROM activities').get() as { id: number }).id;
    db.prepare('INSERT INTO cards (activity_id, week_id, day) VALUES (?, ?, ?)').run(actId, weekId, 'monday');
    db.prepare('INSERT INTO cards (activity_id, week_id, day) VALUES (?, ?, ?)').run(actId, otherId, 'monday');

    await request(app).delete(`/api/weeks/cards?week=${VALID_WEEK}`);

    const otherCount = db
      .prepare('SELECT COUNT(*) AS cnt FROM cards WHERE week_id = ?')
      .get(otherId) as { cnt: number };
    expect(otherCount.cnt).toBe(1);
  });

  it('devuelve 400 si falta el parámetro week', async () => {
    const res = await request(app).delete('/api/weeks/cards');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('devuelve 400 si el parámetro week tiene formato inválido', async () => {
    const res = await request(app).delete('/api/weeks/cards?week=invalid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
