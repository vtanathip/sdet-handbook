import { useMemo, useState } from 'react'
import './App.css'

type Task = {
  id: number
  title: string
  done: boolean
}

type AppMode = 'baseline' | 'drift'

function App() {
  const params = new URLSearchParams(window.location.search)
  const initialMode: AppMode = params.get('mode') === 'drift' ? 'drift' : 'baseline'

  const [mode, setMode] = useState<AppMode>(initialMode)
  const [tasks, setTasks] = useState<Task[]>([])
  const [draft, setDraft] = useState('')
  const [pendingTaskTitle, setPendingTaskTitle] = useState('')

  const isDrift = mode === 'drift'

  const modeSummary = useMemo(() => {
    if (!isDrift) {
      return 'Stable baseline selectors and flow.'
    }

    return 'Drift enabled: text changed + test IDs renamed + confirm modal added.'
  }, [isDrift])

  const addTaskNow = (title: string) => {
    if (!title.trim()) return
    setTasks((prev) => [...prev, { id: Date.now(), title: title.trim(), done: false }])
    setDraft('')
    setPendingTaskTitle('')
  }

  const onAddClicked = () => {
    if (!draft.trim()) return

    if (isDrift) {
      setPendingTaskTitle(draft.trim())
      return
    }

    addTaskNow(draft)
  }

  const toggleDone = (id: number) => {
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, done: !task.done } : task)))
  }

  const removeTask = (id: number) => {
    setTasks((prev) => prev.filter((task) => task.id !== id))
  }

  const resetBoard = () => {
    setTasks([])
    setDraft('')
    setPendingTaskTitle('')
  }

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Playwright Test Agent Demo</p>
        <h1>{isDrift ? 'Work items' : 'Task board'}</h1>
        <p className="subtext">
          Use baseline mode to generate tests, then switch to drift mode to trigger healer updates.
        </p>
      </header>

      <section className="panel">
        <div className="row">
          <label htmlFor="mode-select">Mode</label>
          <select
            id="mode-select"
            data-testid="mode-select"
            value={mode}
            onChange={(event) => {
              const nextMode = event.target.value === 'drift' ? 'drift' : 'baseline'
              setMode(nextMode)
              setPendingTaskTitle('')
            }}
          >
            <option value="baseline">baseline</option>
            <option value="drift">drift</option>
          </select>
        </div>
        <p className="mode-summary">{modeSummary}</p>
      </section>

      <section className="panel">
        <div className="composer">
          <label htmlFor="task-input">Task title</label>
          <input
            id="task-input"
            data-testid={isDrift ? 'task-entry' : 'task-input'}
            placeholder="Write acceptance criteria"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="button-row">
            <button
              id={isDrift ? 'create-task-button' : 'add-task-button'}
              data-testid={isDrift ? 'create-task-btn' : 'add-task-btn'}
              onClick={onAddClicked}
            >
              {isDrift ? 'Create task' : 'Add task'}
            </button>
            <button data-testid="reset-board" className="ghost" onClick={resetBoard}>
              Reset board
            </button>
          </div>
        </div>

        <ul data-testid="task-list" className="task-list">
          {tasks.map((task) => (
            <li key={task.id} className="task-item">
              <label>
                <input
                  type="checkbox"
                  checked={task.done}
                  onChange={() => toggleDone(task.id)}
                />
                <span className={task.done ? 'done' : ''}>{task.title}</span>
              </label>
              <button className="ghost" onClick={() => removeTask(task.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      {pendingTaskTitle && (
        <section className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm add task">
          <div className="modal">
            <h2>Confirm action</h2>
            <p>
              Drift mode adds an extra step. Add <strong>{pendingTaskTitle}</strong> now?
            </p>
            <div className="button-row">
              <button onClick={() => addTaskNow(pendingTaskTitle)}>Proceed</button>
              <button className="ghost" onClick={() => setPendingTaskTitle('')}>
                Cancel
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  )
}

export default App
