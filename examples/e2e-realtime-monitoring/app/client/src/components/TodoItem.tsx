import { Todo } from '../types';

interface TodoItemProps {
  todo: Todo;
  onToggle: (id: number, completed: boolean) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export default function TodoItem({ todo, onToggle, onDelete }: TodoItemProps) {
  return (
    <li style={styles.item}>
      <label style={styles.label}>
        <input
          type="checkbox"
          checked={todo.completed}
          onChange={(e) => onToggle(todo.id, e.target.checked)}
          style={styles.checkbox}
          aria-label={`Mark "${todo.title}" as ${todo.completed ? 'incomplete' : 'complete'}`}
        />
        <span
          style={{
            ...styles.title,
            ...(todo.completed ? styles.completed : {}),
          }}
        >
          {todo.title}
        </span>
      </label>
      <button
        onClick={() => onDelete(todo.id)}
        style={styles.deleteBtn}
        aria-label={`Delete "${todo.title}"`}
        title="Delete"
      >
        ✕
      </button>
    </li>
  );
}

const styles = {
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    background: '#f7fafc',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
    gap: '12px',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flex: 1,
    cursor: 'pointer',
    minWidth: 0,
  },
  checkbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
    flexShrink: 0,
    accentColor: '#4f46e5',
  },
  title: {
    fontSize: '0.95rem',
    color: '#2d3748',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    transition: 'color 0.15s',
  },
  completed: {
    textDecoration: 'line-through',
    color: '#a0aec0',
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#cbd5e0',
    fontSize: '0.85rem',
    padding: '2px 6px',
    borderRadius: '4px',
    flexShrink: 0,
    lineHeight: 1,
  },
};
