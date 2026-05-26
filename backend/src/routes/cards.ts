import { Router, Request, Response } from 'express';
import { db } from '../database';
import { validateDay, validateWeek } from '../validation';

const router = Router();

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

    if (!activity_id || !day) {
      return res.status(400).json({ error: 'Faltan datos obligatorios: activity_id, day' });
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
    const { id } = req.params;

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

// DELETE /cards/:id — eliminar una card
router.delete('/cards/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;

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
