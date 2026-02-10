# PARTH — Programmable Abstraction for Real-Time Task Handling

PARTH is a neural-inspired focus operating system with real execution flow, adaptive sessions, and premium responsive UI.

## Highlights

- Cognitive runtime model with task states (`Idle`, `Queued`, `Running`, `Suspended`, `Completed`).
- Single active execution engine with automatic suspension on task switch.
- Adaptive Pomodoro logic influenced by behavior, complexity, and time of day.
- Immersive neural UI with responsive layouts (mobile/tablet/desktop) and motion tied to focus state.
- Focus mode with minimized peripheral panels.
- Completion audio engine with both preset sounds and custom sound file support.
- Automation templates for deadline re-queue, early-break reduction, and streak extension.
- Analytics for completion counts, streak, focus hours, peak hour, and completion rate.
- Cross-tab sync using `BroadcastChannel` and persistence using `localStorage`.

## Custom sounds

1. Put your sound files in:

```text
public/sounds/custom/
```

2. In the app settings, enable custom sound and set path like:

```text
/sounds/custom/my-bell.mp3
```

## Run

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 4173
```

## Build

```bash
npm run build
```
