import * as vscode from 'vscode';
import { execFile } from 'child_process';

/** pid → full command line, plus parent links, from `ps`. Empty on Windows or failure. */
function processTable(): Promise<{ children: Map<number, number[]>; args: Map<number, string> }> {
  return new Promise(resolve => {
    const empty = { children: new Map(), args: new Map() };
    if (process.platform === 'win32') return resolve(empty);
    execFile('ps', ['-A', '-o', 'pid=,ppid=,args='], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(empty);
      const children = new Map<number, number[]>();
      const args = new Map<number, string>();
      for (const line of stdout.split('\n')) {
        const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
        if (!m) continue;
        const pid = Number(m[1]);
        const ppid = Number(m[2]);
        args.set(pid, m[3]);
        if (!children.has(ppid)) children.set(ppid, []);
        children.get(ppid)!.push(pid);
      }
      resolve({ children, args });
    });
  });
}

const CLAUDE_RE = /(^|[\/\s])claude(\s|$)|@anthropic-ai\/claude-code/;

function runsClaude(shellPid: number, table: Awaited<ReturnType<typeof processTable>>): boolean {
  const stack = [...(table.children.get(shellPid) ?? [])];
  const seen = new Set<number>();
  while (stack.length) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    if (CLAUDE_RE.test(table.args.get(pid) ?? '')) return true;
    stack.push(...(table.children.get(pid) ?? []));
  }
  return false;
}

/** Terminals that look like they are running the claude CLI. */
export async function claudeTerminals(): Promise<vscode.Terminal[]> {
  const table = await processTable();
  const out: vscode.Terminal[] = [];
  for (const t of vscode.window.terminals) {
    const pid = await t.processId;
    if (/claude/i.test(t.name) || (pid !== undefined && runsClaude(pid, table))) out.push(t);
  }
  return out;
}

/** Asks the user to choose a terminal (claude ones marked first). */
export async function pickTerminal(placeHolder: string): Promise<vscode.Terminal | undefined> {
  const all = vscode.window.terminals;
  if (!all.length) {
    vscode.window.showErrorMessage('No terminal is open. Start `claude` in a terminal first.');
    return undefined;
  }
  const claude = new Set(await claudeTerminals());
  const items = [...all]
    .sort((a, b) => Number(claude.has(b)) - Number(claude.has(a)))
    .map(t => ({
      label: t.name,
      description: claude.has(t) ? '$(sparkle) running claude' : t === vscode.window.activeTerminal ? 'active' : '',
      terminal: t,
    }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder });
  return pick?.terminal;
}

/** Best target terminal for a new scheduled message, asking only when ambiguous. */
export async function chooseTerminal(): Promise<vscode.Terminal | undefined> {
  const claude = await claudeTerminals();
  if (claude.length === 1) return claude[0];
  if (claude.length === 0 && vscode.window.terminals.length === 1) return vscode.window.terminals[0];
  return pickTerminal('Which terminal should the message be sent to?');
}

/**
 * Finds the terminal for a stored target: same pid first, then same name,
 * then the single claude terminal if there is exactly one.
 */
export async function findTerminal(pid: number | undefined, name: string): Promise<vscode.Terminal | undefined> {
  for (const t of vscode.window.terminals) {
    if (pid !== undefined && (await t.processId) === pid) return t;
  }
  const byName = vscode.window.terminals.filter(t => t.name === name);
  if (byName.length === 1) return byName[0];
  const claude = await claudeTerminals();
  return claude.length === 1 ? claude[0] : undefined;
}

/**
 * Types the message into the terminal as a bracketed paste (so multi-line text stays one
 * prompt), then presses Enter separately so the TUI has processed the paste first.
 */
export function deliver(terminal: vscode.Terminal, text: string): void {
  terminal.sendText(`\x1b[200~${text}\x1b[201~`, false);
  setTimeout(() => terminal.sendText('\r', false), 200);
}
