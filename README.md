# Claude Schedule Send

Schedule-send for the `claude` CLI running in VS Code's integrated terminal. You write the message now, pick a time, and at that time it is typed into the Claude session and submitted.

## Use
- **Cmd+Alt+Enter**, or the palette command **Claude: Schedule Message**: type a message, pick a time, done. If you have text selected in an editor, it is pre-filled.
- **Claude: Schedule Message from Editor**: schedules the selection, or the whole active editor if nothing is selected. Use this for long or multi-line prompts.
- **Claude: Scheduled Messages**, or click `⏰ N` in the status bar: lets you Send now / Edit / Reschedule / Change terminal / Cancel.

Time picks: In 30 min · In 1 h · In 3 h · Tonight 9 PM · Tomorrow 9 AM · Custom. The Custom box accepts `14:30`, `9pm`, `in 2h`, `in 1h30m`, `tomorrow 8am`, `fri 10:00` and `2026-10-12 09:00`, and shows a live preview of the time it parsed.

## How it works
- Target terminal: the extension looks for the terminal whose process tree contains `claude`. If there are several, or none, it asks you to pick.
- Delivery: the message is sent as a bracketed paste and Enter is pressed after it. Multi-line text arrives as one prompt. If Claude is mid-task, Claude Code queues the message as usual.
- Persistence: messages are kept in VS Code global state, so they survive reloads and restarts. A check runs every 5 s. Only the window for the workspace a message was scheduled in sends it.
- Missed messages: if a message is more than `claudeSchedule.missedGraceMinutes` (default 10) overdue, because VS Code was closed or the laptop was asleep, you're asked to Send now / Reschedule / Discard. It is never sent stale automatically.
- If the target terminal no longer exists, you can pick another one, copy the message to the clipboard, or discard it.
- To make the shortcut work while the terminal has focus, the command is added once to `terminal.integrated.commandsToSkipShell` in your user settings. You can turn this off with `claudeSchedule.enableKeybindingInTerminal`.

Caveat: if you are halfway through typing in Claude's prompt when a scheduled message fires, the scheduled text is appended to your draft and the combined text is sent.

## Build
```
npm install && npm test && npm run package
code --install-extension claude-schedule-send-0.1.0.vsix
```
