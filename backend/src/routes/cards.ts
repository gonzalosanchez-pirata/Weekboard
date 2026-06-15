import { Router, Request, Response } from 'express';
import { db } from '../database';
import { validateDay, validateDurationSeconds, validateWeek, validateNumericId, validatePositiveIntegerId } from '../validation';

const router = Router();

interface CardTimerRow {
  id: number;
  duration_seconds: number | null;
  remaining_seconds: number | null;
  timer_running: number;
  last_started_at: string | null;
}

// Funciones auxiliares para gestión de parámetros y base de datos
function getParamId(req: Request): string {
  const raw = (req.params as unknown as { id?: string | string[] }).id;
  if (Array.isArray(raw)) {
    return raw[0] ?? '';
  }
  return raw ?? '';
}

function getCardTimer(id: string): CardTimerRow | undefined {
  return db
    .prepare(
      `SELECT id, duration_seconds, remaining_seconds, timer_running, last_started_at
       FROM cards WHERE id = ?`
    )
    .get(id) as CardTimerRow | undefined;
}

function timerResponse(row: CardTimerRow) {
  return {
    id: row.id,
    duration_seconds: row.duration_seconds,
    remaining_seconds: row.remaining_seconds,
    timer_running: row.timer_running,
    last_started_at: row.last_started_at,
  };
}

// GET /cards?week=YYYY-MM-DD — devolver todas las cards de una semana específica
router.get('/cards', (req: Request, res: Response) => {
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

    const stmt = db.prepare(`
      SELECT cards.* 
      FROM cards 
      JOIN weeks ON cards.week_id = weeks.id 
      WHERE weeks.start_date = ?
    `);
    
    const cards = stmt.all(weekParam);

    res.json(cards);
  } catch (error) {
    console.error('Error al obtener cards:', error);
    res.status(500).json({ error: 'Error al obtener cards' });
  }
});

function resolveWeekId(weekId: unknown, week: unknown): number | null {
  if (weekId) {
    return Number(weekId);
  }
  if (typeof week === 'string' && week.length > 0) {
    db.prepare('INSERT OR IGNORE INTO weeks (start_date) VALUES (?)').run(week);
    const row = db.prepare('SELECT id FROM weeks WHERE start_date = ?').get(week) as
      | { id: number }
      | undefined;
    return row?.id ?? null;
  }
  return null;
}

// POST /cards — crear una card nueva
router.post('/cards', (req: Request, res: Response) => {
  try {
    const { activity_id, week_id, week, day } = req.body;

    if (!day) {
      return res.status(400).json({ error: 'Falta el dato obligatorio: day' });
    }

    const activityIdError = validatePositiveIntegerId(activity_id);
    if (activityIdError) {
      return res.status(400).json({ error: activityIdError });
    }

    const dayError = validateDay(day);
    if (dayError) {
      return res.status(400).json({ error: dayError });
    }

    if (week !== undefined && week !== null && week !== '') {
      const weekError = validateWeek(week);
      if (weekError) {
        return res.status(400).json({ error: weekError });
      }
    }

    const resolvedWeekId = resolveWeekId(week_id, week);
    if (!resolvedWeekId) {
      return res.status(400).json({
        error: 'Debe indicar week_id o week (YYYY-MM-DD del lunes de la semana)',
      });
    }

    const activityExists = db.prepare('SELECT id FROM activities WHERE id = ?').get(activity_id);
    if (!activityExists) {
      return res.status(400).json({ error: 'activity_id no corresponde a ninguna actividad existente' });
    }

    const stmt = db.prepare('INSERT INTO cards (activity_id, week_id, day) VALUES (?, ?, ?)');
    const result = stmt.run(activity_id, resolvedWeekId, day);

    const newCard = {
      id: result.lastInsertRowid,
      activity_id,
      week_id: resolvedWeekId,
      day,
      completed: 0 // Valor por defecto en la BD
    };

    res.status(201).json(newCard);
  } catch (error) {
    console.error('Error al crear card:', error);
    res.status(500).json({ error: 'Error al crear la card' });
  }
});

// PATCH /cards/:id/complete — marcar una card como completada o descompletada (toggle)
router.patch('/cards/:id/complete', (req: Request, res: Response) => {
  try {
    const id = getParamId(req);
    const idError = validateNumericId(id);
    if (idError) {
      return res.status(400).json({ error: idError });
    }

    // Primero verificamos si existe y obtenemos su estado actual
    const getStmt = db.prepare('SELECT completed FROM cards WHERE id = ?');
    const card = getStmt.get(id) as any;

    if (!card) {
      return res.status(404).json({ error: 'Card no encontrada' });
    }

    // Calculamos el nuevo estado (1 si es 0, y 0 si es 1)
    const newCompletedState = card.completed === 0 ? 1 : 0;

    const updateStmt = db.prepare('UPDATE cards SET completed = ? WHERE id = ?');
    updateStmt.run(newCompletedState, id);

    res.json({ id: Number(id), completed: newCompletedState });
  } catch (error) {
    console.error('Error al cambiar el estado de la card:', error);
    res.status(500).json({ error: 'Error al actualizar el estado de la card' });
  }
});

// PATCH /cards/:id/duration — configurar duración del cronómetro
router.patch('/cards/:id/duration', (req: Request, res: Response) => {
  try {
    const id = getParamId(req);
    const idError = validateNumericId(id);
    if (idError) {
      return res.status(400).json({ error: idError });
    }
    const { duration_seconds } = req.body;

    const durationError = validateDurationSeconds(duration_seconds);
    if (durationError) {
      return res.status(400).json({ error: durationError });
    }

    const card = getCardTimer(id);
    if (!card) {
      return res.status(404).json({ error: 'Card no encontrada' });
    }

    db.prepare(
      `UPDATE cards
       SET duration_seconds = ?, remaining_seconds = ?, timer_running = 0, last_started_at = NULL
       WHERE id = ?`
    ).run(duration_seconds, duration_seconds, id);

    const updated = getCardTimer(id)!;
    res.json(timerResponse(updated));
  } catch (error) {
    console.error('Error al configurar duración:', error);
    res.status(500).json({ error: 'Error al configurar la duración' });
  }
});

// PATCH /cards/:id/timer/start — iniciar cronómetro
router.patch('/cards/:id/timer/start', (req: Request, res: Response) => {
  try {
    const id = getParamId(req);
    const idError = validateNumericId(id);
    if (idError) {
      return res.status(400).json({ error: idError });
    }

    const card = getCardTimer(id);
    if (!card) {
      return res.status(404).json({ error: 'Card no encontrada' });
    }

    if (card.timer_running === 1) {
      return res.status(400).json({ error: 'El cronómetro ya está en ejecución' });
    }

    if (card.duration_seconds === null) {
      return res.status(400).json({
        error: 'Debe configurar la duración antes de iniciar el cronómetro',
      });
    }

    if (card.remaining_seconds === null || card.remaining_seconds <= 0) {
      return res.status(400).json({
        error: 'No se puede iniciar el cronómetro sin tiempo restante',
      });
    }

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE cards SET timer_running = 1, last_started_at = ? WHERE id = ?'
    ).run(now, id);

    const updated = getCardTimer(id)!;
    res.json(timerResponse(updated));
  } catch (error) {
    console.error('Error al iniciar cronómetro:', error);
    res.status(500).json({ error: 'Error al iniciar el cronómetro' });
  }
});

// PATCH /cards/:id/timer/pause — pausar cronómetro
router.patch('/cards/:id/timer/pause', (req: Request, res: Response) => {
  try {
    const id = getParamId(req);
    const idError = validateNumericId(id);
    if (idError) {
      return res.status(400).json({ error: idError });
    }

    const card = getCardTimer(id);
    if (!card) {
      return res.status(404).json({ error: 'Card no encontrada' });
    }

    if (card.timer_running !== 1) {
      return res.status(400).json({ error: 'El cronómetro no está en ejecución' });
    }

    const elapsed = Math.floor(
      (Date.now() - new Date(card.last_started_at!).getTime()) / 1000
    );
    const newRemaining = Math.max(0, (card.remaining_seconds ?? 0) - elapsed);

    db.prepare(
      `UPDATE cards
       SET remaining_seconds = ?, timer_running = 0, last_started_at = NULL
       WHERE id = ?`
    ).run(newRemaining, id);

    const updated = getCardTimer(id)!;
    res.json(timerResponse(updated));
  } catch (error) {
    console.error('Error al pausar cronómetro:', error);
    res.status(500).json({ error: 'Error al pausar el cronómetro' });
  }
});

// PATCH /cards/:id/timer/reset — resetear cronómetro
router.patch('/cards/:id/timer/reset', (req: Request, res: Response) => {
  try {
    const id = getParamId(req);
    const idError = validateNumericId(id);
    if (idError) {
      return res.status(400).json({ error: idError });
    }

    const card = getCardTimer(id);
    if (!card) {
      return res.status(404).json({ error: 'Card no encontrada' });
    }

    if (card.duration_seconds === null) {
      return res.status(400).json({
        error: 'Debe configurar la duración antes de resetear el cronómetro',
      });
    }

    db.prepare(
      `UPDATE cards
       SET remaining_seconds = duration_seconds, timer_running = 0, last_started_at = NULL
       WHERE id = ?`
    ).run(id);

    const updated = getCardTimer(id)!;
    res.json(timerResponse(updated));
  } catch (error) {
    console.error('Error al resetear cronómetro:', error);
    res.status(500).json({ error: 'Error al resetear el cronómetro' });
  }
});

// DELETE /cards/:id — eliminar una card
router.delete('/cards/:id', (req: Request, res: Response) => {
  try {
    const id = getParamId(req);
    const idError = validateNumericId(id);
    if (idError) {
      return res.status(400).json({ error: idError });
    }

    const stmt = db.prepare('DELETE FROM cards WHERE id = ?');
    const result = stmt.run(id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Card no encontrada' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error al eliminar card:', error);
    res.status(500).json({ error: 'Error al eliminar la card' });
  }
});

export default router;
