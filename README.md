# PARTH — Programmable Abstraction for Real-Time Task Handling

A cross-platform neural-inspired focus and task execution system.

## What is implemented

- **Cognitive runtime model** with task states: Idle, Queued, Running, Suspended, Completed.
- **Single-running-task execution engine** with automatic suspension when switching tasks.
- **Adaptive Pomodoro engine** (student / worker / custom profiles, plus behavior-based adaptation).
- **Neural-responsive UI** with motion speed tied to focus activity and intensity controls.
- **Focus mode** immersive layout with reduced peripheral UI.
- **Session completion feedback**: neural-style visual loop completion and selectable audio tones.
- **Modes system** (Student, Worker, Custom) altering rhythm and visual tone.
- **Advanced customization**: timings, neural intensity, notification strength, tone, sound, volume.
- **Automation templates** for missed deadlines, early breaks, and streak-based extension.
- **Analytics**: sessions completed, streak, focus hours, and peak hour.
- **Cross-tab sync** using `BroadcastChannel` plus persistence in `localStorage`.

## Run

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 4173
```

## Build

```bash
npm run build
```
