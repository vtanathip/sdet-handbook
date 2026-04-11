const { Router } = require('express');
const pool = require('../db');

const router = Router();

// ── GET /api/todos ──────────────────────────────────────────────────────────
// Returns all todos ordered by most recently created first.
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM todos ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('[todos] GET /:', err.message);
    res.status(500).json({ error: 'Failed to fetch todos' });
  }
});

// ── POST /api/todos ─────────────────────────────────────────────────────────
// Creates a new todo. Body: { title: string }
router.post('/', async (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO todos (title) VALUES ($1) RETURNING *',
      [title.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[todos] POST /:', err.message);
    res.status(500).json({ error: 'Failed to create todo' });
  }
});

// ── PUT /api/todos/:id ──────────────────────────────────────────────────────
// Toggles completed or updates title. Body: { completed?: boolean, title?: string }
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  const { completed, title } = req.body;

  try {
    // Build SET clause dynamically so either field can be updated independently
    const fields = [];
    const values = [];
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
    const { rows } = await pool.query(
      `UPDATE todos SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Todo not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(`[todos] PUT /${id}:`, err.message);
    res.status(500).json({ error: 'Failed to update todo' });
  }
});

// ── DELETE /api/todos/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
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
    console.error(`[todos] DELETE /${id}:`, err.message);
    res.status(500).json({ error: 'Failed to delete todo' });
  }
});

module.exports = router;
