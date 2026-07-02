import { Router, Request, Response } from 'express';
import { db } from '../database';
import { validateWeek, VALID_DAYS, ValidDay } from '../validation';

const router = Router();

// GET /weeks/planned?week=YYYY-MM-DD — verifica si la semana ya fue planificada
router.get('/weeks/planned', (req: Request, res: Response) => {
  try {
    const weekQuery = req.query.week;
    const weekParam = Array.isArray(weekQuery) ? weekQuery[0] : weekQuery;

    if (!weekParam) {
      return res.status(400).json({ error: 'El parámetro week (YYYY-MM-DD) es requerido en la query' });
    }

    const weekError = validateWeek(weekParam);
    if (weekError) {
      return res.status(400).json({ error: weekError });
    }

    const row = db
      .prepare('SELECT planned FROM weeks WHERE start_date = ?')
      .get(weekParam) as { planned: number } | undefined;

    if (!row) {
      return res.json({ planned: false });
    }

    return res.json({ planned: row.planned === 1 });
  } catch (error) {
    console.error('Error al verificar semana planificada:', error);
    res.status(500).json({ error: 'Error al verificar el estado de planificación' });
  }
});

// PATCH /weeks/plan — marca la semana como planificada y crea las cards de las actividades
router.patch('/weeks/plan', (req: Request, res: Response) => {
  try {
    const { week } = req.body as { week: unknown };

    if (week === undefined || week === null) {
      return res.status(400).json({ error: 'El campo week es requerido' });
    }

    const weekError = validateWeek(week);
    if (weekError) {
      return res.status(400).json({ error: weekError });
    }

    const weekStr = week as string;

    const planWeek = db.transaction(() => {
      // Insertar la semana si no existe y marcarla como planificada
      db.prepare('INSERT OR IGNORE INTO weeks (start_date) VALUES (?)').run(weekStr);
      db.prepare('UPDATE weeks SET planned = 1 WHERE start_date = ?').run(weekStr);

      const weekRow = db
        .prepare('SELECT id FROM weeks WHERE start_date = ?')
        .get(weekStr) as { id: number };

      const weekId = weekRow.id;

      // Obtener todas las actividades existentes
      const activities = db
        .prepare('SELECT id, days FROM activities')
        .all() as { id: number; days: string }[];

      // Para cada actividad, crear cards para los días que le corresponden
      const insertCard = db.prepare(
        'INSERT OR IGNORE INTO cards (activity_id, week_id, day) VALUES (?, ?, ?)'
      );

      for (const activity of activities) {
        let activityDays: string[] = [];
        try {
          activityDays = JSON.parse(activity.days) as string[];
        } catch {
          continue;
        }

        for (const day of VALID_DAYS) {
          if (activityDays.includes(day as ValidDay)) {
            insertCard.run(activity.id, weekId, day);
          }
        }
      }
    });

    planWeek();

    return res.json({ ok: true });
  } catch (error) {
    console.error('Error al planificar semana:', error);
    res.status(500).json({ error: 'Error al planificar la semana' });
  }
});

// GET /weeks/previous?before=YYYY-MM-DD — devuelve la semana planificada inmediatamente anterior a `before`
router.get('/weeks/previous', (req: Request, res: Response) => {
  try {
    const beforeQuery = req.query.before;
    const beforeParam = Array.isArray(beforeQuery) ? beforeQuery[0] : beforeQuery;

    if (!beforeParam || typeof beforeParam !== 'string') {
      return res.status(400).json({ error: 'El parámetro before (YYYY-MM-DD) es requerido en la query' });
    }

    const beforeError = validateWeek(beforeParam);
    if (beforeError) {
      return res.status(400).json({ error: beforeError });
    }

    const row = db
      .prepare(
        'SELECT start_date FROM weeks WHERE planned = 1 AND start_date < ? ORDER BY start_date DESC LIMIT 1'
      )
      .get(beforeParam) as { start_date: string } | undefined;

    return res.json({ week: row ? row.start_date : null });
  } catch (error) {
    console.error('Error al buscar semana anterior:', error);
    res.status(500).json({ error: 'Error al buscar semana anterior' });
  }
});

// PATCH /weeks/confirm — marca la semana como planificada (sin crear cards)
router.patch('/weeks/confirm', (req: Request, res: Response) => {
  try {
    const { week } = req.body as { week: unknown };

    if (!week || typeof week !== 'string') {
      return res.status(400).json({ error: 'El campo week es requerido' });
    }

    const weekError = validateWeek(week);
    if (weekError) {
      return res.status(400).json({ error: weekError });
    }

    const tx = db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO weeks (start_date) VALUES (?)').run(week);
      db.prepare('UPDATE weeks SET planned = 1 WHERE start_date = ?').run(week);
    });
    tx();

    return res.json({ ok: true });
  } catch (error) {
    console.error('Error al confirmar semana:', error);
    res.status(500).json({ error: 'Error al confirmar semana' });
  }
});

// PATCH /weeks/copy — copia las cards de sourceWeek a targetWeek, reseteando timers y completado
router.patch('/weeks/copy', (req: Request, res: Response) => {
  try {
    const { sourceWeek, targetWeek } = req.body as { sourceWeek: unknown; targetWeek: unknown };

    if (!sourceWeek || typeof sourceWeek !== 'string' || !targetWeek || typeof targetWeek !== 'string') {
      return res.status(400).json({ error: 'Los campos sourceWeek y targetWeek son requeridos' });
    }

    const sourceError = validateWeek(sourceWeek);
    const targetError = validateWeek(targetWeek);
    if (sourceError || targetError) {
      return res.status(400).json({ error: 'Formato de semana inválido (YYYY-MM-DD)' });
    }

    const tx = db.transaction(() => {
      const sourceRow = db
        .prepare('SELECT id FROM weeks WHERE start_date = ?')
        .get(sourceWeek) as { id: number } | undefined;
      if (!sourceRow) return;

      // Asegurar que la semana destino existe (sin marcarla como planificada todavía)
      db.prepare('INSERT OR IGNORE INTO weeks (start_date) VALUES (?)').run(targetWeek);
      const targetRow = db
        .prepare('SELECT id FROM weeks WHERE start_date = ?')
        .get(targetWeek) as { id: number };

      // Copiar cards reseteando timer y estado completado
      db.prepare(`
        INSERT OR IGNORE INTO cards
          (activity_id, week_id, day, duration_seconds, remaining_seconds, timer_running, last_started_at, completed)
        SELECT activity_id, ?, day, duration_seconds, duration_seconds, 0, NULL, 0
        FROM cards
        WHERE week_id = ?
      `).run(targetRow.id, sourceRow.id);
    });
    tx();

    return res.json({ ok: true });
  } catch (error) {
    console.error('Error al copiar semana:', error);
    res.status(500).json({ error: 'Error al copiar semana' });
  }
});

// DELETE /weeks/cards?week=YYYY-MM-DD — elimina todas las cards de la semana indicada
router.delete('/weeks/cards', (req: Request, res: Response) => {
  try {
    const weekQuery = req.query.week;
    const weekParam = Array.isArray(weekQuery) ? weekQuery[0] : weekQuery;

    if (!weekParam || typeof weekParam !== 'string') {
      return res.status(400).json({ error: 'El parámetro week (YYYY-MM-DD) es requerido en la query' });
    }

    const weekError = validateWeek(weekParam);
    if (weekError) {
      return res.status(400).json({ error: weekError });
    }

    const tx = db.transaction(() => {
      const row = db
        .prepare('SELECT id FROM weeks WHERE start_date = ?')
        .get(weekParam) as { id: number } | undefined;
      if (row) {
        db.prepare('DELETE FROM cards WHERE week_id = ?').run(row.id);
      }
    });
    tx();

    return res.json({ ok: true });
  } catch (error) {
    console.error('Error al eliminar cards de la semana:', error);
    res.status(500).json({ error: 'Error al eliminar cards' });
  }
});

export default router;
