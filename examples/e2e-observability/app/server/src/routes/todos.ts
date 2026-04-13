import { Router, Request, Response } from 'express';
import pool from '../db';
import { Todo } from '../types';

const router = Router();

function getE2eCorrelation(req: Request): string {
  const runId = req.header('x-e2e-run-id');
  const source = req.header('x-e2e-source');
  const testName = req.header('x-e2e-test-name');
  if (!runId && !source && !testName) {
    return '';
  }
  return ` [e2e run=${runId ?? '-'} source=${source ?? '-'} test=${testName ?? '-'}]`;
}

// ── GET /api/todos ──────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const e2e = getE2eCorrelation(req);
  try {
    console.log(`[todos] GET / - Executing query: SELECT * FROM todos ORDER BY created_at DESC${e2e}`);
    const { rows } = await pool.query<Todo>(
      'SELECT * FROM todos ORDER BY created_at DESC'
    );
    console.log(`[todos] GET / - Retrieved ${rows.length} todos${e2e}`);
    res.json(rows);
  } catch (err) {
    const errorMsg = (err as Error).message;
    console.error(`[todos] GET / - Query failed: ${errorMsg}${e2e}`);
    console.error(`[todos] GET / - Full error:${e2e}`, err);
    res.status(500).json({ error: 'Failed to fetch todos', details: errorMsg });
  }
});

// ── POST /api/todos ─────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const e2e = getE2eCorrelation(req);
  const { title } = req.body as { title?: unknown };
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    const { rows } = await pool.query<Todo>(
      'INSERT INTO todos (title) VALUES ($1) RETURNING *',
      [title.trim()]
    );
    console.log(`[todos] POST / - Created todo id=${rows[0].id}${e2e}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(`[todos] POST /: ${(err as Error).message}${e2e}`);
    res.status(500).json({ error: 'Failed to create todo' });
  }
});

// ── PUT /api/todos/:id ──────────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const e2e = getE2eCorrelation(req);
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
    console.log(`[todos] PUT /${id} - Updated todo${e2e}`);
    res.json(rows[0]);
  } catch (err) {
    console.error(`[todos] PUT /${id}: ${(err as Error).message}${e2e}`);
    res.status(500).json({ error: 'Failed to update todo' });
  }
});

// ── DELETE /api/todos/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  const e2e = getE2eCorrelation(req);
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
    console.log(`[todos] DELETE /${id} - Deleted todo${e2e}`);
    res.status(204).end();
  } catch (err) {
    console.error(`[todos] DELETE /${id}: ${(err as Error).message}${e2e}`);
    res.status(500).json({ error: 'Failed to delete todo' });
  }
});

export default router;
