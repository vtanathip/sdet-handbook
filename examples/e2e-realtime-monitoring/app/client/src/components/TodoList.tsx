import { Todo } from '../types';
import TodoItem from './TodoItem';

interface TodoListProps {
  todos: Todo[];
  onToggle: (id: number, completed: boolean) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export default function TodoList({ todos, onToggle, onDelete }: TodoListProps) {
  if (todos.length === 0) {
    return (
      <p style={{ textAlign: 'center', color: '#a0aec0', fontSize: '0.9rem', marginTop: '24px' }}>
        No todos yet — add one above!
      </p>
    );
  }

  const pending = todos.filter((t) => !t.completed);
  const done = todos.filter((t) => t.completed);

  return (
    <ul style={styles.list} aria-label="Todo list">
      {pending.map((todo) => (
        <TodoItem key={todo.id} todo={todo} onToggle={onToggle} onDelete={onDelete} />
      ))}
      {done.length > 0 && pending.length > 0 && <li style={styles.divider} />}
      {done.map((todo) => (
        <TodoItem key={todo.id} todo={todo} onToggle={onToggle} onDelete={onDelete} />
      ))}
    </ul>
  );
}

const styles = {
  list: {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  divider: {
    borderTop: '1px dashed #e2e8f0',
    margin: '4px 0',
  },
};
