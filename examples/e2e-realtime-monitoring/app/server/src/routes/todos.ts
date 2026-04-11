import { Router, Request, Response } from 'express';
import pool from '../db';
import { Todo } from '../types';

const router = Router();

// ── GET /api/todos ──────────────────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query<Todo>(
      'SELECT * FROM todos ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('[todos] GET /:', (err as Error).message);
    res.status(500).json({ error: 'Failed to fetch todos' });
  }
});

// ── POST /api/todos ─────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { title } = req.body as { title?: unknown };
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    const { rows } = await pool.query<Todo>(
      'INSERT INTO todos (title) VALUES ($1) RETURNING *',
      [title.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[todos] POST /:', (err as Error).message);
    res.status(500).json({ error: 'Failed to create todo' });
  }
});

// ── PUT /api/todos/:id ──────────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  const { completed, title } = req.body as { completed?: unknown; title?: unknown };

  try {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (completed !== undefined) {
      fields.push(`completed = $${fields.length + 1}`);
      values.push(Boolean(completed));
    }
    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: 'title must be a non-empty string' });
      }
      fields.push(`title = $${fields.length + 1}`);
      values.push(title.trim());
    }
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    const { rows } = await pool.query<Todo>(
      `UPDATE todos SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Todo not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(`[todos] PUT /${id}:`, (err as Error).message);
    res.status(500).json({ error: 'Failed to update todo' });
  }
});

// ── DELETE /api/todos/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM todos WHERE id = $1',
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Todo not found' });
    res.status(204).end();
  } catch (err) {
    console.error(`[todos] DELETE /${id}:`, (err as Error).message);
    res.status(500).json({ error: 'Failed to delete todo' });
  }
});

export default router;
