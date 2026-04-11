import { useEffect, useState } from 'react';
import { Todo } from './types';
import AddTodo from './components/AddTodo';
import TodoList from './components/TodoList';

const API = '/api/todos';

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch all todos ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch(API)
      .then((r) => {
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        return r.json() as Promise<Todo[]>;
      })
      .then((data) => setTodos(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // ── Create ───────────────────────────────────────────────────────────────
  async function handleAdd(title) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) return;
    const todo = (await res.json()) as Todo;
    setTodos((prev) => [todo, ...prev]);
  }

  // ── Toggle completed ─────────────────────────────────────────────────────
  async function handleToggle(id: number, completed: boolean) {
    const res = await fetch(`${API}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed }),
    });
    if (!res.ok) return;
    const updated = (await res.json()) as Todo;
    setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  async function handleDelete(id: number) {
    const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
    if (!res.ok) return;
    setTodos((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.heading}>📝 Todo List</h1>
        <p style={styles.subtitle}>Performance Testing Environment · Datadog APM enabled</p>

        <AddTodo onAdd={handleAdd} />

        {loading && <p style={styles.status}>Loading…</p>}
        {error && <p style={{ ...styles.status, color: '#e53e3e' }}>Error: {error}</p>}
        {!loading && !error && (
          <TodoList todos={todos} onToggle={handleToggle} onDelete={handleDelete} />
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '40px 16px',
    background: '#f0f2f5',
  },
  card: {
    background: '#ffffff',
    borderRadius: '12px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    padding: '32px',
    width: '100%',
    maxWidth: '560px',
  },
  heading: {
    fontSize: '1.75rem',
    fontWeight: 700,
    color: '#1a202c',
    marginBottom: '4px',
  },
  subtitle: {
    fontSize: '0.8rem',
    color: '#718096',
    marginBottom: '24px',
  },
  status: {
    textAlign: 'center',
    marginTop: '24px',
    color: '#718096',
    fontSize: '0.9rem',
  },
};
