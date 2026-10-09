import * as vscode from 'vscode';
import { deliver, findTerminal, pickTerminal } from './terminals';
import { formatRelative, formatWhen } from './timeParse';

export interface ScheduledMessage {
  id: string;
  text: string;
  sendAt: number;
  createdAt: number;
  terminalPid?: number;
  terminalName: string;
  workspace: string;
}

const STORE_KEY = 'claudeSchedule.items';
const TICK_MS = 5_000;

/** Identifies the current window's workspace so each window only fires its own messages. */
export function workspaceKey(): string {
  return (
    vscode.workspace.workspaceFile?.toString() ??
    vscode.workspace.workspaceFolders?.[0]?.uri.toString() ??
    'no-workspace'
  );
}

export function preview(text: string, max = 60): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

export class Scheduler implements vscode.Disposable {
  private timer: NodeJS.Timeout;
  private statusBar: vscode.StatusBarItem;
  /** Overdue items already prompted about in this window, so we don't re-prompt every tick. */
  private prompted = new Set<string>();
  private firing = new Set<string>();

  constructor(private ctx: vscode.ExtensionContext) {
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBar.command = 'claudeSchedule.list';
    this.refreshStatus();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  dispose(): void {
    clearInterval(this.timer);
    this.statusBar.dispose();
  }

  all(): ScheduledMessage[] {
    return this.ctx.globalState.get<ScheduledMessage[]>(STORE_KEY, []);
  }

  mine(): ScheduledMessage[] {
    const ws = workspaceKey();
    return this.all().filter(m => m.workspace === ws).sort((a, b) => a.sendAt - b.sendAt);
  }

  private async save(items: ScheduledMessage[]): Promise<void> {
    await this.ctx.globalState.update(STORE_KEY, items);
    this.refreshStatus();
  }

  async add(msg: Omit<ScheduledMessage, 'id' | 'createdAt' | 'workspace'>): Promise<ScheduledMessage> {
    const full: ScheduledMessage = {
      ...msg,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      workspace: workspaceKey(),
    };
    await this.save([...this.all(), full]);
    return full;
  }

  async update(id: string, patch: Partial<ScheduledMessage>): Promise<void> {
    this.prompted.delete(id);
    await this.save(this.all().map(m => (m.id === id ? { ...m, ...patch } : m)));
  }

  async remove(id: string): Promise<void> {
    this.prompted.delete(id);
    await this.save(this.all().filter(m => m.id !== id));
  }

  refreshStatus(): void {
    const items = this.mine();
    if (!items.length) {
      this.statusBar.hide();
      return;
    }
    const next = items[0];
    this.statusBar.text = `$(clock) ${items.length}`;
    this.statusBar.tooltip = `Claude: ${items.length} scheduled message${items.length > 1 ? 's' : ''}\nNext: ${formatWhen(new Date(next.sendAt))} (${formatRelative(new Date(next.sendAt))}) — "${preview(next.text)}"`;
    this.statusBar.show();
  }

  /** Explicit user action: always (re-)prompts if the terminal is missing. */
  async sendNow(msg: ScheduledMessage): Promise<boolean> {
    this.prompted.delete(msg.id);
    return this.send(msg);
  }

  /** Sends a message now. Removes it from the store first so another window can't double-send. */
  async send(msg: ScheduledMessage): Promise<boolean> {
    if (this.firing.has(msg.id)) return false;
    this.firing.add(msg.id);
    try {
      if (!this.all().some(m => m.id === msg.id)) return false;
      const term = await findTerminal(msg.terminalPid, msg.terminalName);
      if (!term) return this.handleMissingTerminal(msg);
      await this.remove(msg.id);
      deliver(term, msg.text);
      vscode.window.setStatusBarMessage(`$(check) Sent scheduled message to "${term.name}"`, 8_000);
      return true;
    } finally {
      this.firing.delete(msg.id);
    }
  }

  private async handleMissingTerminal(msg: ScheduledMessage): Promise<boolean> {
    if (this.prompted.has(msg.id)) return false;
    this.prompted.add(msg.id);
    const choice = await vscode.window.showWarningMessage(
      `Scheduled Claude message is due but terminal "${msg.terminalName}" is gone: "${preview(msg.text)}"`,
      'Pick terminal', 'Copy to clipboard', 'Discard',
    );
    if (choice === 'Pick terminal') {
      const term = await pickTerminal('Send the scheduled message to which terminal?');
      if (!term) return false;
      await this.remove(msg.id);
      deliver(term, msg.text);
      vscode.window.setStatusBarMessage(`$(check) Sent scheduled message to "${term.name}"`, 8_000);
      return true;
    }
    if (choice === 'Copy to clipboard') {
      await vscode.env.clipboard.writeText(msg.text);
      await this.remove(msg.id);
    } else if (choice === 'Discard') {
      await this.remove(msg.id);
    }
    return false;
  }

  private async handleMissed(msg: ScheduledMessage): Promise<void> {
    this.prompted.add(msg.id);
    const choice = await vscode.window.showWarningMessage(
      `A scheduled Claude message was missed (due ${formatWhen(new Date(msg.sendAt))}, ${formatRelative(new Date(msg.sendAt))}): "${preview(msg.text)}"`,
      'Send now', 'Reschedule…', 'Discard',
    );
    if (choice === 'Send now') {
      await this.sendNow(msg);
    } else if (choice === 'Reschedule…') {
      await vscode.commands.executeCommand('claudeSchedule.reschedule', msg.id);
    } else if (choice === 'Discard') {
      await this.remove(msg.id);
    }
    // Dismissed: stays in the list (shown as overdue) and isn't re-prompted this session.
  }

  private async tick(): Promise<void> {
    this.refreshStatus();
    const now = Date.now();
    const graceMs =
      vscode.workspace.getConfiguration('claudeSchedule').get<number>('missedGraceMinutes', 10) * 60_000;
    for (const msg of this.mine()) {
      if (msg.sendAt > now) break;
      if (this.prompted.has(msg.id)) continue;
      if (now - msg.sendAt > graceMs) void this.handleMissed(msg);
      else void this.send(msg);
    }
  }
}
