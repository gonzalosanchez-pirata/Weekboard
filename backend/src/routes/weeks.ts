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

export default router;
