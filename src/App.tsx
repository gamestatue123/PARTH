import { useEffect, useMemo, useState } from 'react'

type Mode = 'student' | 'worker' | 'custom'
type Tone = 'Calm' | 'Neutral' | 'Technical'
type TaskState = 'Idle' | 'Queued' | 'Running' | 'Suspended' | 'Completed'
type Sound = 'Neural pulse' | 'Soft bell' | 'Mechanical click' | 'Ambient tone'
type RuleTemplate =
  | 'missed_deadline_requeue'
  | 'early_break_reduce_next'
  | 'streak_extend_session'

interface Task {
  id: string
  name: string
  category: string
  priorityWeight: number
  estimatedFocusCost: number
  deadline?: string
  state: TaskState
  mode: Mode
  intensity: number
  createdAt: string
  completedAt?: string
  totalFocusSeconds: number
  scheduledFor?: string
}

interface Session {
  taskId: string
  startedAt: string
  endedAt?: string
  plannedSeconds: number
  completedSeconds: number
  completed: boolean
  interrupted: boolean
}

interface Settings {
  mode: Mode
  tone: Tone
  pomodoro: Record<Mode, { focus: number; break: number }>
  neuralIntensity: number
  notificationStrength: number
  sound: Sound
  volume: number
  adaptivePomodoro: boolean
  focusStyle: 'Deep' | 'Balanced' | 'Sprint'
  focusMode: boolean
}

interface State {
  tasks: Task[]
  sessions: Session[]
  settings: Settings
  activeTaskId?: string
  timer: {
    phase: 'focus' | 'break'
    remaining: number
    total: number
    running: boolean
  }
  streak: number
  onboardingDone: boolean
  rules: RuleTemplate[]
}

const STORAGE_KEY = 'parth.neural.v1'
const channel = new BroadcastChannel('parth-sync')

const defaultSettings: Settings = {
  mode: 'student',
  tone: 'Calm',
  pomodoro: {
    student: { focus: 25, break: 5 },
    worker: { focus: 50, break: 10 },
    custom: { focus: 35, break: 8 }
  },
  neuralIntensity: 0.7,
  notificationStrength: 0.5,
  sound: 'Neural pulse',
  volume: 0.5,
  adaptivePomodoro: true,
  focusStyle: 'Balanced',
  focusMode: false
}

const initialState: State = {
  tasks: [],
  sessions: [],
  settings: defaultSettings,
  timer: { phase: 'focus', remaining: 25 * 60, total: 25 * 60, running: false },
  streak: 0,
  onboardingDone: false,
  rules: ['missed_deadline_requeue', 'early_break_reduce_next', 'streak_extend_session']
}

const uid = () => Math.random().toString(36).slice(2, 10)

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

const playTone = (sound: Sound, volume: number) => {
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const frequencies: Record<Sound, number> = {
    'Neural pulse': 520,
    'Soft bell': 640,
    'Mechanical click': 320,
    'Ambient tone': 460
  }
  osc.frequency.value = frequencies[sound]
  osc.type = sound === 'Mechanical click' ? 'square' : 'sine'
  gain.gain.value = volume * 0.2
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + 0.25)
}

function App() {
  const [state, setState] = useState<State>(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialState
    try {
      return JSON.parse(raw) as State
    } catch {
      return initialState
    }
  })
  const [quickTitle, setQuickTitle] = useState('')
  const [advancedTask, setAdvancedTask] = useState({
    name: '',
    category: 'General',
    priorityWeight: 3,
    estimatedFocusCost: 3,
    deadline: '',
    mode: state.settings.mode as Mode,
    intensity: 0.7
  })

  const activeTask = state.tasks.find((t) => t.id === state.activeTaskId)

  const modeProfile = state.settings.pomodoro[state.settings.mode]
  const completionRatio = state.timer.total === 0 ? 0 : 1 - state.timer.remaining / state.timer.total
  const neuralSpeed =
    state.timer.running && state.timer.phase === 'focus'
      ? 0.7 + state.settings.neuralIntensity * 1.4
      : 0.25 + state.settings.neuralIntensity * 0.45

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    channel.postMessage(state)
  }, [state])

  useEffect(() => {
    const onMessage = (event: MessageEvent<State>) => {
      setState((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(event.data)) return prev
        return event.data
      })
    }
    channel.addEventListener('message', onMessage)
    return () => channel.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      setState((prev) => {
        if (!prev.timer.running) return prev
        if (prev.timer.remaining > 0) {
          return { ...prev, timer: { ...prev.timer, remaining: prev.timer.remaining - 1 } }
        }

        if (prev.timer.phase === 'focus') {
          const finishedSession: Session | undefined = prev.activeTaskId
            ? {
                taskId: prev.activeTaskId,
                startedAt: new Date(Date.now() - prev.timer.total * 1000).toISOString(),
                endedAt: new Date().toISOString(),
                plannedSeconds: prev.timer.total,
                completedSeconds: prev.timer.total,
                completed: true,
                interrupted: false
              }
            : undefined

          if (finishedSession) playTone(prev.settings.sound, prev.settings.volume)

          return {
            ...prev,
            sessions: finishedSession ? [...prev.sessions, finishedSession] : prev.sessions,
            streak: prev.streak + 1,
            tasks: prev.tasks.map((task) =>
              task.id === prev.activeTaskId
                ? {
                    ...task,
                    totalFocusSeconds: task.totalFocusSeconds + prev.timer.total,
                    state: 'Completed',
                    completedAt: new Date().toISOString()
                  }
                : task
            ),
            timer: {
              phase: 'break',
              running: true,
              remaining: prev.settings.pomodoro[prev.settings.mode].break * 60,
              total: prev.settings.pomodoro[prev.settings.mode].break * 60
            },
            activeTaskId: undefined
          }
        }

        return {
          ...prev,
          timer: {
            phase: 'focus',
            running: false,
            remaining: prev.settings.pomodoro[prev.settings.mode].focus * 60,
            total: prev.settings.pomodoro[prev.settings.mode].focus * 60
          }
        }
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  const analytics = useMemo(() => {
    const completed = state.sessions.filter((s) => s.completed).length
    const focusHours = (state.sessions.reduce((acc, s) => acc + s.completedSeconds, 0) / 3600).toFixed(1)
    const byHour = Array.from({ length: 24 }, (_, hour) => {
      const count = state.sessions.filter((s) => new Date(s.startedAt).getHours() === hour).length
      return { hour, count }
    })
    const peakHour = byHour.reduce((a, b) => (b.count > a.count ? b : a), byHour[0])

    return { completed, focusHours, peakHour: `${peakHour.hour}:00` }
  }, [state.sessions])

  const getAdaptiveFocus = () => {
    if (!state.settings.adaptivePomodoro) return modeProfile.focus * 60
    const recent = state.sessions.slice(-6)
    const completionRate = recent.length
      ? recent.filter((s) => s.completed).length / recent.length
      : 1
    const avgTaskCost =
      state.tasks.length > 0
        ? state.tasks.reduce((acc, t) => acc + t.estimatedFocusCost, 0) / state.tasks.length
        : 3
    let minutes = modeProfile.focus
    if (completionRate > 0.8 && state.rules.includes('streak_extend_session')) minutes += 5
    if (completionRate < 0.5 && state.rules.includes('early_break_reduce_next')) minutes -= 5
    if (avgTaskCost >= 4) minutes += 5
    const hour = new Date().getHours()
    if (hour >= 22 || hour < 7) minutes -= 5
    return clamp(minutes, 15, 70) * 60
  }

  const startTask = (taskId: string) => {
    const total = getAdaptiveFocus()
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => {
        if (t.id === prev.activeTaskId && t.state === 'Running') return { ...t, state: 'Suspended' }
        if (t.id === taskId) return { ...t, state: 'Running' }
        return t
      }),
      activeTaskId: taskId,
      timer: { phase: 'focus', running: true, remaining: total, total }
    }))
  }

  const pauseOrResume = () => {
    setState((prev) => ({
      ...prev,
      timer: { ...prev.timer, running: !prev.timer.running },
      tasks: prev.tasks.map((t) =>
        t.id === prev.activeTaskId
          ? { ...t, state: prev.timer.running ? 'Suspended' : 'Running' }
          : t
      )
    }))
  }

  const addQuickTask = () => {
    if (!quickTitle.trim()) return
    const task: Task = {
      id: uid(),
      name: quickTitle.trim(),
      category: 'General',
      priorityWeight: 3,
      estimatedFocusCost: 3,
      state: 'Queued',
      mode: state.settings.mode,
      intensity: state.settings.neuralIntensity,
      createdAt: new Date().toISOString(),
      totalFocusSeconds: 0
    }
    setState((prev) => ({ ...prev, tasks: [...prev.tasks, task] }))
    setQuickTitle('')
  }

  const addAdvancedTask = () => {
    if (!advancedTask.name.trim()) return
    const task: Task = {
      id: uid(),
      name: advancedTask.name.trim(),
      category: advancedTask.category,
      priorityWeight: advancedTask.priorityWeight,
      estimatedFocusCost: advancedTask.estimatedFocusCost,
      deadline: advancedTask.deadline || undefined,
      state: 'Queued',
      mode: advancedTask.mode,
      intensity: advancedTask.intensity,
      createdAt: new Date().toISOString(),
      totalFocusSeconds: 0
    }
    setState((prev) => ({ ...prev, tasks: [...prev.tasks, task] }))
    setAdvancedTask((s) => ({ ...s, name: '', deadline: '' }))
  }

  const applyDeadlineRules = () => {
    if (!state.rules.includes('missed_deadline_requeue')) return
    const now = Date.now()
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => {
        if (t.deadline && new Date(t.deadline).getTime() < now && t.state !== 'Completed') {
          return { ...t, state: 'Queued' }
        }
        return t
      })
    }))
  }

  useEffect(() => {
    const timer = setInterval(applyDeadlineRules, 30_000)
    return () => clearInterval(timer)
  })

  const sortedTasks = [...state.tasks].sort((a, b) => {
    if (a.state === 'Running') return -1
    if (b.state === 'Running') return 1
    if (a.state === 'Queued' && b.state !== 'Queued') return -1
    if (b.state === 'Queued' && a.state !== 'Queued') return 1
    return b.priorityWeight - a.priorityWeight
  })

  return (
    <div className={`app mode-${state.settings.mode} ${state.settings.focusMode ? 'focus-mode' : ''}`}>
      <div className="neural-layer" style={{ ['--speed' as string]: neuralSpeed, ['--intensity' as string]: state.settings.neuralIntensity }} />
      {!state.onboardingDone && (
        <section className="onboarding panel">
          <h1>PARTH — Neural Focus OS</h1>
          <p>Pick your mode, choose your sound, create your first task, then execute.</p>
          <div className="row">
            <select value={state.settings.mode} onChange={(e) => setState((prev) => ({ ...prev, settings: { ...prev.settings, mode: e.target.value as Mode } }))}>
              <option value="student">Student Mode</option>
              <option value="worker">Worker Mode</option>
              <option value="custom">Custom Mode</option>
            </select>
            <select value={state.settings.sound} onChange={(e) => setState((prev) => ({ ...prev, settings: { ...prev.settings, sound: e.target.value as Sound } }))}>
              <option>Neural pulse</option><option>Soft bell</option><option>Mechanical click</option><option>Ambient tone</option>
            </select>
            <button onClick={() => playTone(state.settings.sound, state.settings.volume)}>Preview sound</button>
            <button className="primary" onClick={() => setState((prev) => ({ ...prev, onboardingDone: true }))}>Start PARTH</button>
          </div>
        </section>
      )}

      <header className="panel topbar">
        <div>
          <h2>{activeTask?.name ?? 'Ready for next execution'}</h2>
          <p>{activeTask ? activeTask.state : 'Queued / Idle'} · {state.settings.tone} tone · Sync enabled</p>
        </div>
        <div className="timer-loop">
          <div className="ring" style={{ ['--progress' as string]: completionRatio }}>
            <strong>{formatTime(state.timer.remaining)}</strong>
            <small>{state.timer.phase.toUpperCase()}</small>
          </div>
          <button className="primary" onClick={activeTask ? pauseOrResume : () => sortedTasks[0] && startTask(sortedTasks[0].id)}>
            {activeTask ? (state.timer.running ? 'Pause' : 'Resume') : 'Start'}
          </button>
        </div>
      </header>

      <main className="grid">
        <section className="panel">
          <h3>Task Runtime</h3>
          <div className="row">
            <input placeholder="Quick add task" value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)} />
            <button onClick={addQuickTask}>Add</button>
          </div>
          <div className="advanced">
            <input placeholder="Task name" value={advancedTask.name} onChange={(e) => setAdvancedTask((s) => ({ ...s, name: e.target.value }))} />
            <input placeholder="Category" value={advancedTask.category} onChange={(e) => setAdvancedTask((s) => ({ ...s, category: e.target.value }))} />
            <label>Priority {advancedTask.priorityWeight}<input type="range" min={1} max={5} value={advancedTask.priorityWeight} onChange={(e) => setAdvancedTask((s) => ({ ...s, priorityWeight: Number(e.target.value) }))} /></label>
            <label>Focus cost {advancedTask.estimatedFocusCost}<input type="range" min={1} max={5} value={advancedTask.estimatedFocusCost} onChange={(e) => setAdvancedTask((s) => ({ ...s, estimatedFocusCost: Number(e.target.value) }))} /></label>
            <input type="datetime-local" value={advancedTask.deadline} onChange={(e) => setAdvancedTask((s) => ({ ...s, deadline: e.target.value }))} />
            <select value={advancedTask.mode} onChange={(e) => setAdvancedTask((s) => ({ ...s, mode: e.target.value as Mode }))}>
              <option value="student">Student</option><option value="worker">Worker</option><option value="custom">Custom</option>
            </select>
            <button onClick={addAdvancedTask}>Create advanced task</button>
          </div>
          <ul className="tasks">
            {sortedTasks.map((task) => (
              <li key={task.id}>
                <div>
                  <strong>{task.name}</strong>
                  <small>{task.category} · P{task.priorityWeight} · Cost {task.estimatedFocusCost} · {task.state}</small>
                </div>
                <div className="row">
                  {task.state !== 'Completed' && <button onClick={() => startTask(task.id)}>{task.state === 'Running' ? 'Running' : 'Run'}</button>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h3>Customization + Modes</h3>
          <label>Mode<select value={state.settings.mode} onChange={(e) => setState((prev) => ({ ...prev, settings: { ...prev.settings, mode: e.target.value as Mode } }))}><option value="student">Student</option><option value="worker">Worker</option><option value="custom">Custom</option></select></label>
          <label>Language Tone<select value={state.settings.tone} onChange={(e) => setState((prev) => ({ ...prev, settings: { ...prev.settings, tone: e.target.value as Tone } }))}><option>Calm</option><option>Neutral</option><option>Technical</option></select></label>
          <label>Focus minutes ({state.settings.mode})<input type="number" min={10} max={90} value={state.settings.pomodoro[state.settings.mode].focus} onChange={(e) => setState((prev) => ({ ...prev, settings: { ...prev.settings, pomodoro: { ...prev.settings.pomodoro, [prev.settings.mode]: { ...prev.settings.pomodoro[prev.settings.mode], focus: Number(e.target.value) } } } }))} /></label>
          <label>Break minutes<input type="number" min={3} max={30} value={state.settings.pomodoro[state.settings.mode].break} onChange={(e) => setState((prev) => ({ ...prev, settings: { ...prev.settings, pomodoro: { ...prev.settings.pomodoro, [prev.settings.mode]: { ...prev.settings.pomodoro[prev.settings.mode], break: Number(e.target.value) } } } }))} /></label>
          <label>Neural intensity<input type="range" min={0.1} max={1} step={0.05} value={state.settings.neuralIntensity} onChange={(e) => setState((prev) => ({ ...prev, settings: { ...prev.settings, neuralIntensity: Number(e.target.value) } }))} /></label>
          <label>Notification strength<input type="range" min={0} max={1} step={0.05} value={state.settings.notificationStrength} onChange={(e) => setState((prev) => ({ ...prev, settings: { ...prev.settings, notificationStrength: Number(e.target.value) } }))} /></label>
          <label>Sound<select value={state.settings.sound} onChange={(e) => setState((prev) => ({ ...prev, settings: { ...prev.settings, sound: e.target.value as Sound } }))}><option>Neural pulse</option><option>Soft bell</option><option>Mechanical click</option><option>Ambient tone</option></select></label>
          <label>Volume<input type="range" min={0} max={1} step={0.05} value={state.settings.volume} onChange={(e) => setState((prev) => ({ ...prev, settings: { ...prev.settings, volume: Number(e.target.value) } }))} /></label>
          <div className="row">
            <button onClick={() => playTone(state.settings.sound, state.settings.volume)}>Preview</button>
            <button onClick={() => setState((prev) => ({ ...prev, settings: { ...prev.settings, adaptivePomodoro: !prev.settings.adaptivePomodoro } }))}>Adaptive {state.settings.adaptivePomodoro ? 'On' : 'Off'}</button>
            <button onClick={() => setState((prev) => ({ ...prev, settings: { ...prev.settings, focusMode: !prev.settings.focusMode } }))}>{state.settings.focusMode ? 'Exit Focus' : 'Enter Focus'}</button>
          </div>
        </section>

        <section className="panel">
          <h3>Automation + Analytics</h3>
          <p>Templates active:</p>
          <div className="row wrap">
            {(['missed_deadline_requeue', 'early_break_reduce_next', 'streak_extend_session'] as RuleTemplate[]).map((rule) => (
              <button key={rule} onClick={() => setState((prev) => ({ ...prev, rules: prev.rules.includes(rule) ? prev.rules.filter((r) => r !== rule) : [...prev.rules, rule] }))}>
                {prevLabel(rule)} {state.rules.includes(rule) ? '✓' : ''}
              </button>
            ))}
          </div>
          <div className="analytics">
            <article><strong>{analytics.completed}</strong><small>Sessions completed</small></article>
            <article><strong>{state.streak}</strong><small>Focus streak</small></article>
            <article><strong>{analytics.focusHours}</strong><small>Focus hours</small></article>
            <article><strong>{analytics.peakHour}</strong><small>Peak focus hour</small></article>
          </div>
        </section>
      </main>
    </div>
  )
}

function prevLabel(rule: RuleTemplate) {
  if (rule === 'missed_deadline_requeue') return 'Missed deadline → Re-queue'
  if (rule === 'early_break_reduce_next') return 'Early break → Reduce next'
  return 'Streak maintained → Extend session'
}

export default App
