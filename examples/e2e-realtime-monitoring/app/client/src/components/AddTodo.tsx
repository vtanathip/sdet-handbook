import { useState } from 'react';

interface AddTodoProps {
  onAdd: (title: string) => Promise<void>;
}

export default function AddTodo({ onAdd }: AddTodoProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const title = value.trim();
    if (!title) return;
    setBusy(true);
    await onAdd(title);
    setValue('');
    setBusy(false);
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <input
        type="text"
        placeholder="What needs to be done?"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy}
        style={styles.input}
        maxLength={500}
        aria-label="New todo title"
      />
      <button type="submit" disabled={busy || !value.trim()} style={styles.button}>
        {busy ? '…' : 'Add'}
      </button>
    </form>
  );
}

const styles = {
  form: {
    display: 'flex',
    gap: '8px',
    marginBottom: '24px',
  },
  input: {
    flex: 1,
    padding: '10px 14px',
    fontSize: '0.95rem',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  button: {
    padding: '10px 20px',
    background: '#4f46e5',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    fontSize: '0.95rem',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
};
