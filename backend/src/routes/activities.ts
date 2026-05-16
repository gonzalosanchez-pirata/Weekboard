import { Router, Request, Response } from 'express';
import { db } from '../database';

const router = Router();

// GET /activities — devolver todas las actividades
router.get('/activities', (req: Request, res: Response) => {
  try {
    const stmt = db.prepare('SELECT * FROM activities ORDER BY created_at DESC');
    const activities = stmt.all();
    
    // Parsear el string JSON de 'days' de vuelta a un arreglo
    const formattedActivities = activities.map((activity: any) => ({
      ...activity,
      days: JSON.parse(activity.days)
    }));

    res.json(formattedActivities);
  } catch (error) {
    console.error('Error al obtener actividades:', error);
    res.status(500).json({ error: 'Error al obtener actividades' });
  }
});

// POST /activities — crear una actividad nueva
router.post('/activities', (req: Request, res: Response) => {
  try {
    const { name, color, days } = req.body;

    // Validación básica
    if (!name || !days || !Array.isArray(days)) {
      return res.status(400).json({ error: 'Faltan datos obligatorios o el formato de days es incorrecto' });
    }

    // Guardar el array como string JSON
    const daysString = JSON.stringify(days);

    const stmt = db.prepare('INSERT INTO activities (name, color, days) VALUES (?, ?, ?)');
    const result = stmt.run(name, color, daysString);

    // Devolver la actividad recién creada
    const newActivity = {
      id: result.lastInsertRowid,
      name,
      color,
      days,
      // Usar la fecha actual como aproximación de created_at para la respuesta inmediata
      created_at: new Date().toISOString() 
    };

    res.status(201).json(newActivity);
  } catch (error) {
    console.error('Error al crear la actividad:', error);
    res.status(500).json({ error: 'Error al crear la actividad' });
  }
});

// PUT /activities/:id — editar una actividad existente
router.put('/activities/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, color, days } = req.body;

    if (!name || !days || !Array.isArray(days)) {
      return res.status(400).json({ error: 'Faltan datos obligatorios o el formato de days es incorrecto' });
    }

    const daysString = JSON.stringify(days);

    const stmt = db.prepare('UPDATE activities SET name = ?, color = ?, days = ? WHERE id = ?');
    const result = stmt.run(name, color, daysString, id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Actividad no encontrada' });
    }

    res.json({ id: Number(id), name, color, days });
  } catch (error) {
    console.error('Error al actualizar la actividad:', error);
    res.status(500).json({ error: 'Error al actualizar la actividad' });
  }
});

// DELETE /activities/:id — eliminar una actividad
router.delete('/activities/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const stmt = db.prepare('DELETE FROM activities WHERE id = ?');
    const result = stmt.run(id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Actividad no encontrada' });
    }

    // 204 No Content es el código estándar cuando se borra exitosamente y no hay cuerpo de respuesta
    res.status(204).send();
  } catch (error) {
    console.error('Error al eliminar la actividad:', error);
    res.status(500).json({ error: 'Error al eliminar la actividad' });
  }
});

export default router;
