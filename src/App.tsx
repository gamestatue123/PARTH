import { useEffect, useMemo, useState } from 'react'

type Mode = 'student' | 'worker' | 'custom'
type Tone = 'Calm' | 'Neutral' | 'Technical'
type TaskState = 'Idle' | 'Queued' | 'Running' | 'Suspended' | 'Completed'
type PresetSound = 'Neural pulse' | 'Soft bell' | 'Mechanical click' | 'Ambient tone'
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
  state: TaskState
  mode: Mode
  deadline?: string
  createdAt: string
  completedAt?: string
  totalFocusSeconds: number
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
  adaptivePomodoro: boolean
  volume: number
  focusMode: boolean
  presetSound: PresetSound
  customSoundPath: string
  useCustomSound: boolean
}

interface State {
  tasks: Task[]
  sessions: Session[]
  settings: Settings
  timer: {
    phase: 'focus' | 'break'
    running: boolean
    remaining: number
    total: number
  }
  activeTaskId?: string
  streak: number
  onboardingDone: boolean
  rules: RuleTemplate[]
}

const STORAGE_KEY = 'parth.neural.v2'
const syncChannel = new BroadcastChannel('parth-sync')

const defaultSettings: Settings = {
  mode: 'student',
  tone: 'Calm',
  pomodoro: {
    student: { focus: 25, break: 5 },
    worker: { focus: 50, break: 10 },
    custom: { focus: 35, break: 8 }
  },
  neuralIntensity: 0.7,
  notificationStrength: 0.55,
  adaptivePomodoro: true,
  volume: 0.65,
  focusMode: false,
  presetSound: 'Neural pulse',
  customSoundPath: '/sounds/custom/your-sound.mp3',
  useCustomSound: false
}

const initialState: State = {
  tasks: [],
  sessions: [],
  settings: defaultSettings,
  timer: { phase: 'focus', running: false, remaining: 25 * 60, total: 25 * 60 },
  activeTaskId: undefined,
  streak: 0,
  onboardingDone: false,
  rules: ['missed_deadline_requeue', 'early_break_reduce_next', 'streak_extend_session']
}

const uid = () => Math.random().toString(36).slice(2, 10)
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function normalizeState(candidate: State): State {
  return {
    ...candidate,
    settings: {
      ...defaultSettings,
      ...candidate.settings,
      pomodoro: {
        ...defaultSettings.pomodoro,
        ...(candidate.settings?.pomodoro ?? {})
      }
    }
  }
}

function App() {
  const [state, setState] = useState<State>(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialState
    try {
      return normalizeState(JSON.parse(raw) as State)
    } catch {
      return initialState
    }
  })

  const [quickTask, setQuickTask] = useState('')
  const [advancedTask, setAdvancedTask] = useState({
    name: '',
    category: 'General',
    priorityWeight: 3,
    estimatedFocusCost: 3,
    deadline: '',
    mode: state.settings.mode as Mode
  })

  const activeTask = state.tasks.find((task) => task.id === state.activeTaskId)

  const uiPulse =
    state.timer.running && state.timer.phase === 'focus'
      ? 0.75 + state.settings.neuralIntensity * 1.5
      : 0.25 + state.settings.neuralIntensity * 0.5

  const ringProgress = state.timer.total ? 1 - state.timer.remaining / state.timer.total : 0

  const analytics = useMemo(() => {
    const completedSessions = state.sessions.filter((session) => session.completed)
    const totalFocusSeconds = completedSessions.reduce((acc, session) => acc + session.completedSeconds, 0)
    const byHour = Array.from({ length: 24 }, (_, hour) => {
      const count = state.sessions.filter((session) => new Date(session.startedAt).getHours() === hour).length
      return { hour, count }
    })
    const peak = byHour.reduce((best, current) => (current.count > best.count ? current : best), byHour[0])

    return {
      sessionsCompleted: completedSessions.length,
      focusHours: (totalFocusSeconds / 3600).toFixed(1),
      peakHour: `${String(peak.hour).padStart(2, '0')}:00`,
      completionRate:
        state.sessions.length === 0
          ? 100
          : Math.round((completedSessions.length / state.sessions.length) * 100)
    }
  }, [state.sessions])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    syncChannel.postMessage(state)
  }, [state])

  useEffect(() => {
    const syncHandler = (event: MessageEvent<State>) => {
      setState((prev) => {
        const incoming = normalizeState(event.data)
        if (JSON.stringify(prev) === JSON.stringify(incoming)) return prev
        return incoming
      })
    }

    syncChannel.addEventListener('message', syncHandler)
    return () => syncChannel.removeEventListener('message', syncHandler)
  }, [])

  const previewAudio = () => {
    if (state.settings.useCustomSound) {
      const audio = new Audio(state.settings.customSoundPath)
      audio.volume = state.settings.volume
      void audio.play()
      return
    }

    const context = new AudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()

    const frequencies: Record<PresetSound, number> = {
      'Neural pulse': 520,
      'Soft bell': 660,
      'Mechanical click': 310,
      'Ambient tone': 430
    }

    oscillator.frequency.value = frequencies[state.settings.presetSound]
    oscillator.type = state.settings.presetSound === 'Mechanical click' ? 'square' : 'sine'
    gain.gain.value = state.settings.volume * 0.22
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.23)
  }

  const getAdaptiveFocusSeconds = () => {
    const modeProfile = state.settings.pomodoro[state.settings.mode]
    if (!state.settings.adaptivePomodoro) return modeProfile.focus * 60

    const recentSessions = state.sessions.slice(-6)
    const completionRate =
      recentSessions.length === 0
        ? 1
        : recentSessions.filter((session) => session.completed).length / recentSessions.length

    const averageTaskCost =
      state.tasks.length === 0
        ? 3
        : state.tasks.reduce((acc, task) => acc + task.estimatedFocusCost, 0) / state.tasks.length

    let adaptiveMinutes = modeProfile.focus

    if (completionRate < 0.5 && state.rules.includes('early_break_reduce_next')) adaptiveMinutes -= 5
    if (completionRate > 0.8 && state.rules.includes('streak_extend_session')) adaptiveMinutes += 5
    if (averageTaskCost >= 4) adaptiveMinutes += 5

    const hour = new Date().getHours()
    if (hour >= 22 || hour < 7) adaptiveMinutes -= 5

    return clamp(adaptiveMinutes, 15, 70) * 60
  }

  useEffect(() => {
    const interval = setInterval(() => {
      setState((prev) => {
        if (!prev.timer.running) return prev

        if (prev.timer.remaining > 0) {
          return {
            ...prev,
            timer: { ...prev.timer, remaining: prev.timer.remaining - 1 }
          }
        }

        if (prev.timer.phase === 'focus') {
          const now = new Date().toISOString()
          const finishedSession: Session | undefined = prev.activeTaskId
            ? {
                taskId: prev.activeTaskId,
                startedAt: new Date(Date.now() - prev.timer.total * 1000).toISOString(),
                endedAt: now,
                plannedSeconds: prev.timer.total,
                completedSeconds: prev.timer.total,
                completed: true,
                interrupted: false
              }
            : undefined

          return {
            ...prev,
            sessions: finishedSession ? [...prev.sessions, finishedSession] : prev.sessions,
            streak: prev.streak + 1,
            tasks: prev.tasks.map((task) =>
              task.id === prev.activeTaskId
                ? {
                    ...task,
                    state: 'Completed',
                    totalFocusSeconds: task.totalFocusSeconds + prev.timer.total,
                    completedAt: now
                  }
                : task
            ),
            activeTaskId: undefined,
            timer: {
              phase: 'break',
              running: true,
              remaining: prev.settings.pomodoro[prev.settings.mode].break * 60,
              total: prev.settings.pomodoro[prev.settings.mode].break * 60
            }
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

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (state.timer.phase === 'break' && state.timer.remaining === state.timer.total && state.timer.running) {
      previewAudio()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.timer.phase, state.timer.remaining, state.timer.total, state.timer.running])

  const applyMissedDeadlineRule = () => {
    if (!state.rules.includes('missed_deadline_requeue')) return
    const now = Date.now()

    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) => {
        if (task.deadline && new Date(task.deadline).getTime() < now && task.state !== 'Completed') {
          return { ...task, state: 'Queued' }
        }
        return task
      })
    }))
  }

  useEffect(() => {
    const tick = setInterval(applyMissedDeadlineRule, 30_000)
    return () => clearInterval(tick)
  })

  const createQuickTask = () => {
    if (!quickTask.trim()) return

    const task: Task = {
      id: uid(),
      name: quickTask.trim(),
      category: 'General',
      priorityWeight: 3,
      estimatedFocusCost: 3,
      state: 'Queued',
      mode: state.settings.mode,
      createdAt: new Date().toISOString(),
      totalFocusSeconds: 0
    }

    setState((prev) => ({ ...prev, tasks: [...prev.tasks, task] }))
    setQuickTask('')
  }

  const createAdvancedTask = () => {
    if (!advancedTask.name.trim()) return

    const task: Task = {
      id: uid(),
      name: advancedTask.name.trim(),
      category: advancedTask.category,
      priorityWeight: advancedTask.priorityWeight,
      estimatedFocusCost: advancedTask.estimatedFocusCost,
      state: 'Queued',
      mode: advancedTask.mode,
      deadline: advancedTask.deadline || undefined,
      createdAt: new Date().toISOString(),
      totalFocusSeconds: 0
    }

    setState((prev) => ({ ...prev, tasks: [...prev.tasks, task] }))
    setAdvancedTask((prev) => ({ ...prev, name: '', deadline: '' }))
  }

  const runTask = (taskId: string) => {
    const total = getAdaptiveFocusSeconds()

    setState((prev) => ({
      ...prev,
      activeTaskId: taskId,
      tasks: prev.tasks.map((task) => {
        if (task.id === prev.activeTaskId && task.state === 'Running') return { ...task, state: 'Suspended' }
        if (task.id === taskId) return { ...task, state: 'Running' }
        return task
      }),
      timer: { phase: 'focus', running: true, remaining: total, total }
    }))
  }

  const pauseOrResume = () => {
    setState((prev) => ({
      ...prev,
      timer: { ...prev.timer, running: !prev.timer.running },
      tasks: prev.tasks.map((task) =>
        task.id === prev.activeTaskId
          ? { ...task, state: prev.timer.running ? 'Suspended' : 'Running' }
          : task
      )
    }))
  }

  const sortedTasks = [...state.tasks].sort((a, b) => {
    if (a.state === 'Running') return -1
    if (b.state === 'Running') return 1
    if (a.state === 'Queued' && b.state !== 'Queued') return -1
    if (b.state === 'Queued' && a.state !== 'Queued') return 1
    return b.priorityWeight - a.priorityWeight
  })

  return (
    <div className={`app mode-${state.settings.mode} ${state.settings.focusMode ? 'focus-mode' : ''}`}>
      <div className="neural-grid" style={{ ['--velocity' as string]: uiPulse, ['--intensity' as string]: state.settings.neuralIntensity }} />

      {!state.onboardingDone && (
        <section className="onboarding glass">
          <h1>PARTH · Neural Runtime</h1>
          <p>Configure your mental operating mode and start immediate execution.</p>
          <div className="row wrap">
            <select value={state.settings.mode} onChange={(event) => setState((prev) => ({ ...prev, settings: { ...prev.settings, mode: event.target.value as Mode } }))}>
              <option value="student">Student Mode</option>
              <option value="worker">Worker Mode</option>
              <option value="custom">Custom Mode</option>
            </select>
            <select value={state.settings.tone} onChange={(event) => setState((prev) => ({ ...prev, settings: { ...prev.settings, tone: event.target.value as Tone } }))}>
              <option>Calm</option>
              <option>Neutral</option>
              <option>Technical</option>
            </select>
            <button onClick={previewAudio}>Preview Sound</button>
            <button className="primary" onClick={() => setState((prev) => ({ ...prev, onboardingDone: true }))}>Initialize PARTH</button>
          </div>
        </section>
      )}

      <header className="hero glass">
        <div>
          <span className="status-pill">{state.timer.running ? 'Focused Execution' : 'Ready State'}</span>
          <h2>{activeTask?.name ?? 'Select one task and enter cognitive flow'}</h2>
          <p>
            {activeTask ? `${activeTask.state} · ${activeTask.category}` : 'No active process'} · {state.settings.mode.toUpperCase()} MODE · {state.settings.tone} Language Tone
          </p>
        </div>

        <div className="ring-wrap">
          <div className="ring" style={{ ['--progress' as string]: ringProgress }}>
            <strong>{formatTime(state.timer.remaining)}</strong>
            <small>{state.timer.phase.toUpperCase()}</small>
          </div>
          <button className="primary" onClick={activeTask ? pauseOrResume : () => sortedTasks[0] && runTask(sortedTasks[0].id)}>
            {activeTask ? (state.timer.running ? 'Pause' : 'Resume') : 'Start Session'}
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="glass task-runtime">
          <h3>Task Runtime</h3>
          <div className="row">
            <input
              placeholder="Quick add task"
              value={quickTask}
              onChange={(event) => setQuickTask(event.target.value)}
            />
            <button onClick={createQuickTask}>Add</button>
          </div>

          <div className="advanced-grid">
            <input
              placeholder="Task name"
              value={advancedTask.name}
              onChange={(event) => setAdvancedTask((prev) => ({ ...prev, name: event.target.value }))}
            />
            <input
              placeholder="Category"
              value={advancedTask.category}
              onChange={(event) => setAdvancedTask((prev) => ({ ...prev, category: event.target.value }))}
            />
            <label>
              Priority {advancedTask.priorityWeight}
              <input
                type="range"
                min={1}
                max={5}
                value={advancedTask.priorityWeight}
                onChange={(event) => setAdvancedTask((prev) => ({ ...prev, priorityWeight: Number(event.target.value) }))}
              />
            </label>
            <label>
              Focus Cost {advancedTask.estimatedFocusCost}
              <input
                type="range"
                min={1}
                max={5}
                value={advancedTask.estimatedFocusCost}
                onChange={(event) => setAdvancedTask((prev) => ({ ...prev, estimatedFocusCost: Number(event.target.value) }))}
              />
            </label>
            <input
              type="datetime-local"
              value={advancedTask.deadline}
              onChange={(event) => setAdvancedTask((prev) => ({ ...prev, deadline: event.target.value }))}
            />
            <select
              value={advancedTask.mode}
              onChange={(event) => setAdvancedTask((prev) => ({ ...prev, mode: event.target.value as Mode }))}
            >
              <option value="student">Student</option>
              <option value="worker">Worker</option>
              <option value="custom">Custom</option>
            </select>
            <button onClick={createAdvancedTask}>Create Advanced Task</button>
          </div>

          <ul className="task-list">
            {sortedTasks.map((task) => (
              <li key={task.id} className={task.id === state.activeTaskId ? 'active' : ''}>
                <div>
                  <strong>{task.name}</strong>
                  <small>
                    {task.category} · P{task.priorityWeight} · Cost {task.estimatedFocusCost} · {task.state}
                  </small>
                </div>
                {task.state !== 'Completed' && <button onClick={() => runTask(task.id)}>Run</button>}
              </li>
            ))}
          </ul>
        </section>

        <section className="glass control-center">
          <h3>Modes + Signals</h3>

          <label>
            Mode
            <select value={state.settings.mode} onChange={(event) => setState((prev) => ({ ...prev, settings: { ...prev.settings, mode: event.target.value as Mode } }))}>
              <option value="student">Student</option>
              <option value="worker">Worker</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          <label>
            Language Tone
            <select value={state.settings.tone} onChange={(event) => setState((prev) => ({ ...prev, settings: { ...prev.settings, tone: event.target.value as Tone } }))}>
              <option>Calm</option>
              <option>Neutral</option>
              <option>Technical</option>
            </select>
          </label>

          <label>
            Focus Minutes
            <input
              type="number"
              min={10}
              max={90}
              value={state.settings.pomodoro[state.settings.mode].focus}
              onChange={(event) => setState((prev) => ({
                ...prev,
                settings: {
                  ...prev.settings,
                  pomodoro: {
                    ...prev.settings.pomodoro,
                    [prev.settings.mode]: {
                      ...prev.settings.pomodoro[prev.settings.mode],
                      focus: Number(event.target.value)
                    }
                  }
                }
              }))}
            />
          </label>

          <label>
            Break Minutes
            <input
              type="number"
              min={3}
              max={30}
              value={state.settings.pomodoro[state.settings.mode].break}
              onChange={(event) => setState((prev) => ({
                ...prev,
                settings: {
                  ...prev.settings,
                  pomodoro: {
                    ...prev.settings.pomodoro,
                    [prev.settings.mode]: {
                      ...prev.settings.pomodoro[prev.settings.mode],
                      break: Number(event.target.value)
                    }
                  }
                }
              }))}
            />
          </label>

          <label>
            Neural Intensity
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={state.settings.neuralIntensity}
              onChange={(event) => setState((prev) => ({ ...prev, settings: { ...prev.settings, neuralIntensity: Number(event.target.value) } }))}
            />
          </label>

          <label>
            Notification Strength
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={state.settings.notificationStrength}
              onChange={(event) => setState((prev) => ({ ...prev, settings: { ...prev.settings, notificationStrength: Number(event.target.value) } }))}
            />
          </label>

          <label>
            Preset Sound
            <select value={state.settings.presetSound} onChange={(event) => setState((prev) => ({ ...prev, settings: { ...prev.settings, presetSound: event.target.value as PresetSound } }))}>
              <option>Neural pulse</option>
              <option>Soft bell</option>
              <option>Mechanical click</option>
              <option>Ambient tone</option>
            </select>
          </label>

          <label>
            Custom Sound Path (from /public)
            <input
              placeholder="/sounds/custom/your-sound.mp3"
              value={state.settings.customSoundPath}
              onChange={(event) => setState((prev) => ({ ...prev, settings: { ...prev.settings, customSoundPath: event.target.value } }))}
            />
          </label>

          <label>
            Volume
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={state.settings.volume}
              onChange={(event) => setState((prev) => ({ ...prev, settings: { ...prev.settings, volume: Number(event.target.value) } }))}
            />
          </label>

          <div className="row wrap">
            <button onClick={() => setState((prev) => ({ ...prev, settings: { ...prev.settings, adaptivePomodoro: !prev.settings.adaptivePomodoro } }))}>
              Adaptive {state.settings.adaptivePomodoro ? 'On' : 'Off'}
            </button>
            <button onClick={() => setState((prev) => ({ ...prev, settings: { ...prev.settings, useCustomSound: !prev.settings.useCustomSound } }))}>
              {state.settings.useCustomSound ? 'Using Custom Sound' : 'Using Preset Sound'}
            </button>
            <button onClick={() => setState((prev) => ({ ...prev, settings: { ...prev.settings, focusMode: !prev.settings.focusMode } }))}>
              {state.settings.focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'}
            </button>
            <button onClick={previewAudio}>Preview Sound</button>
          </div>
        </section>

        <section className="glass analytics-panel">
          <h3>Automation + Insights</h3>

          <div className="rule-grid">
            {(Object.freeze(['missed_deadline_requeue', 'early_break_reduce_next', 'streak_extend_session']) as RuleTemplate[]).map((rule) => (
              <button
                key={rule}
                onClick={() => setState((prev) => ({
                  ...prev,
                  rules: prev.rules.includes(rule)
                    ? prev.rules.filter((entry) => entry !== rule)
                    : [...prev.rules, rule]
                }))}
              >
                {ruleLabel(rule)} {state.rules.includes(rule) ? '✓' : ''}
              </button>
            ))}
          </div>

          <div className="insight-grid">
            <article>
              <strong>{analytics.sessionsCompleted}</strong>
              <small>Sessions Completed</small>
            </article>
            <article>
              <strong>{state.streak}</strong>
              <small>Focus Streak</small>
            </article>
            <article>
              <strong>{analytics.focusHours}</strong>
              <small>Focus Hours</small>
            </article>
            <article>
              <strong>{analytics.peakHour}</strong>
              <small>Peak Hour</small>
            </article>
            <article>
              <strong>{analytics.completionRate}%</strong>
              <small>Completion Rate</small>
            </article>
          </div>

          <div className="sound-folder-help">
            <h4>Custom Sound Folder</h4>
            <p>Drop files in <code>public/sounds/custom/</code> then set path above, e.g. <code>/sounds/custom/my-bell.mp3</code>.</p>
          </div>
        </section>
      </main>
    </div>
  )
}

function ruleLabel(rule: RuleTemplate) {
  if (rule === 'missed_deadline_requeue') return 'Missed deadline → Re-queue'
  if (rule === 'early_break_reduce_next') return 'Early break → Reduce next session'
  return 'Streak maintained → Extend next session'
}

export default App
