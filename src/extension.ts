import * as vscode from 'vscode';
import { Scheduler, ScheduledMessage, preview } from './scheduler';
import { chooseTerminal, pickTerminal } from './terminals';
import { formatRelative, formatWhen, parseWhen } from './timeParse';

let scheduler: Scheduler;

/** Gmail-style quick picks plus a free-text custom time with a live preview. */
async function askWhen(title = 'When should it be sent?'): Promise<Date | undefined> {
  const now = new Date();
  const presets: { label: string; when: Date | undefined }[] = [
    { label: 'In 30 minutes', when: parseWhen('in 30m', now) },
    { label: 'In 1 hour', when: parseWhen('in 1h', now) },
    { label: 'In 3 hours', when: parseWhen('in 3h', now) },
  ];
  if (now.getHours() < 21) presets.push({ label: 'Tonight, 9:00 PM', when: parseWhen('tonight', now) });
  presets.push({ label: 'Tomorrow, 9:00 AM', when: parseWhen('tomorrow 9am', now) });

  const items = [
    ...presets.map(p => ({ label: `$(clock) ${p.label}`, description: formatWhen(p.when!), when: p.when })),
    { label: '$(edit) Custom time…', description: 'e.g. 14:30 · in 2h · tomorrow 8am · fri 10:00', when: undefined },
  ];
  const pick = await vscode.window.showQuickPick(items, { title, placeHolder: 'Pick a send time' });
  if (!pick) return undefined;
  if (pick.when) return pick.when;

  const raw = await vscode.window.showInputBox({
    title,
    prompt: 'Send time: 14:30 · 9pm · in 2h · in 1h30m · tomorrow 8am · fri 10:00 · 2026-10-12 09:00',
    validateInput: value => {
      if (!value.trim()) return undefined;
      const d = parseWhen(value);
      if (!d) return "Couldn't understand that time";
      if (d.getTime() <= Date.now()) return 'That time is in the past';
      return { message: `→ ${formatWhen(d)} (${formatRelative(d)})`, severity: vscode.InputBoxValidationSeverity.Info };
    },
  });
  if (!raw) return undefined;
  const d = parseWhen(raw);
  return d && d.getTime() > Date.now() ? d : undefined;
}

async function scheduleText(text: string): Promise<void> {
  if (!text.trim()) {
    vscode.window.showWarningMessage('Nothing to schedule — the message is empty.');
    return;
  }
  const when = await askWhen();
  if (!when) return;
  const term = await chooseTerminal();
  if (!term) return;
  await scheduler.add({
    text,
    sendAt: when.getTime(),
    terminalPid: await term.processId,
    terminalName: term.name,
  });
  vscode.window.showInformationMessage(
    `Scheduled for ${formatWhen(when)} (${formatRelative(when)}) → terminal "${term.name}"`,
  );
}

/** Opens the text in an untitled editor; resolves with the edited text when the user clicks Save. */
async function editInEditor(initial: string): Promise<string | undefined> {
  const doc = await vscode.workspace.openTextDocument({ content: initial, language: 'markdown' });
  await vscode.window.showTextDocument(doc);
  const choice = await vscode.window.showInformationMessage(
    'Edit the scheduled message in the editor, then click Save.',
    'Save', 'Cancel',
  );
  const text = doc.getText();
  if (vscode.window.activeTextEditor?.document === doc) {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }
  return choice === 'Save' ? text : undefined;
}

async function reschedule(id: string): Promise<void> {
  const msg = scheduler.all().find(m => m.id === id);
  if (!msg) return;
  const when = await askWhen(`Reschedule: "${preview(msg.text, 40)}"`);
  if (!when) return;
  await scheduler.update(id, { sendAt: when.getTime() });
  vscode.window.showInformationMessage(`Rescheduled for ${formatWhen(when)} (${formatRelative(when)})`);
}

async function manage(msg: ScheduledMessage): Promise<void> {
  const action = await vscode.window.showQuickPick(
    [
      { label: '$(send) Send now', id: 'send' },
      { label: '$(edit) Edit text', id: 'edit' },
      { label: '$(clock) Reschedule', id: 'reschedule' },
      { label: '$(terminal) Change terminal', id: 'terminal', description: msg.terminalName },
      { label: '$(trash) Cancel message', id: 'cancel' },
    ],
    { title: `"${preview(msg.text, 50)}" — ${formatWhen(new Date(msg.sendAt))}` },
  );
  switch (action?.id) {
    case 'send':
      await scheduler.sendNow(msg);
      break;
    case 'edit': {
      const text = await editInEditor(msg.text);
      if (text !== undefined && text.trim()) await scheduler.update(msg.id, { text });
      break;
    }
    case 'reschedule':
      await reschedule(msg.id);
      break;
    case 'terminal': {
      const term = await pickTerminal('Send this message to which terminal?');
      if (term) await scheduler.update(msg.id, { terminalPid: await term.processId, terminalName: term.name });
      break;
    }
    case 'cancel':
      await scheduler.remove(msg.id);
      vscode.window.setStatusBarMessage('$(trash) Scheduled message cancelled', 5_000);
      break;
  }
}

async function list(): Promise<void> {
  const items = scheduler.mine();
  if (!items.length) {
    const choice = await vscode.window.showInformationMessage('No scheduled Claude messages.', 'Schedule one');
    if (choice) await vscode.commands.executeCommand('claudeSchedule.schedule');
    return;
  }
  const now = new Date();
  const pick = await vscode.window.showQuickPick(
    items.map(m => {
      const when = new Date(m.sendAt);
      const overdue = m.sendAt <= now.getTime();
      return {
        label: `${overdue ? '$(warning)' : '$(clock)'} ${formatWhen(when)} · ${formatRelative(when, now)}`,
        description: `→ ${m.terminalName}`,
        detail: preview(m.text, 100),
        msg: m,
      };
    }),
    { title: 'Scheduled Claude messages', placeHolder: 'Select a message to send, edit, reschedule or cancel' },
  );
  if (pick) await manage(pick.msg);
}

/** Lets the keybinding work while the terminal is focused (otherwise the key goes to the shell). */
async function ensureSkipShell(): Promise<void> {
  if (!vscode.workspace.getConfiguration('claudeSchedule').get<boolean>('enableKeybindingInTerminal', true)) return;
  const cfg = vscode.workspace.getConfiguration('terminal.integrated');
  const current = cfg.inspect<string[]>('commandsToSkipShell')?.globalValue ?? [];
  if (!current.includes('claudeSchedule.schedule')) {
    await cfg.update('commandsToSkipShell', [...current, 'claudeSchedule.schedule'], vscode.ConfigurationTarget.Global);
  }
}

export function activate(ctx: vscode.ExtensionContext): void {
  scheduler = new Scheduler(ctx);
  ctx.subscriptions.push(
    scheduler,
    vscode.commands.registerCommand('claudeSchedule.schedule', async () => {
      const editor = vscode.window.activeTextEditor;
      const selection = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
      if (selection.includes('\n')) return scheduleText(selection);
      const text = await vscode.window.showInputBox({
        title: 'Schedule a message to Claude',
        prompt: 'Message to send later (for multi-line prompts use "Claude: Schedule Message from Editor")',
        value: selection,
      });
      if (text !== undefined) await scheduleText(text);
    }),
    vscode.commands.registerCommand('claudeSchedule.scheduleFromEditor', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        const doc = await vscode.workspace.openTextDocument({ content: '', language: 'markdown' });
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage('Write your message here, then run "Claude: Schedule Message from Editor" again.');
        return;
      }
      const text = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
      await scheduleText(text);
    }),
    vscode.commands.registerCommand('claudeSchedule.list', list),
    vscode.commands.registerCommand('claudeSchedule.reschedule', reschedule),
  );
  void ensureSkipShell();
}

export function deactivate(): void {}
