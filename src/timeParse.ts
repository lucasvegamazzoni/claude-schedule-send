// Pure time parsing/formatting — no vscode import so it can be unit-tested with plain node.

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const UNIT_MS: Record<string, number> = {
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  d: 86_400_000, day: 86_400_000, days: 86_400_000,
};

/** Parses "9am", "9:15pm", "14:30", "21". Returns [hours, minutes] or undefined. */
function parseClock(s: string): [number, number] | undefined {
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = m[3];
  // A bare number like "21" is only accepted as a clock time with a colon or am/pm,
  // except when it is clearly a 24h hour (13-23).
  if (!m[2] && !ampm && h < 13) return undefined;
  if (min > 59) return undefined;
  if (ampm) {
    if (h < 1 || h > 12) return undefined;
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
  } else if (h > 23) {
    return undefined;
  }
  return [h, min];
}

function at(base: Date, [h, min]: [number, number], addDays = 0): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(h, min, 0, 0);
  return d;
}

/**
 * Parses a human send time relative to `now`. Returns undefined if not understood.
 * Supported: "in 2h", "45m", "in 1h30m", "in 90 minutes", "14:30", "9pm",
 * "tonight", "tomorrow", "tomorrow 9am", "fri 10:00", "2026-10-10 09:00".
 */
export function parseWhen(input: string, now: Date = new Date()): Date | undefined {
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return undefined;

  // Relative durations: "in 2h", "1h30m", "in 90 minutes", "in 1 day"
  const rel = s.replace(/^in /, '');
  const parts = [...rel.matchAll(/(\d+(?:\.\d+)?) ?([a-z]+)/g)];
  if (parts.length && parts.map(p => p[0]).join('').replace(/ /g, '') === rel.replace(/ /g, '')) {
    let ms = 0;
    for (const [, n, unit] of parts) {
      const u = UNIT_MS[unit];
      if (!u) { ms = -1; break; }
      ms += Number(n) * u;
    }
    if (ms > 0) return new Date(now.getTime() + ms);
  }

  // ISO-ish absolute: "2026-10-10 09:00" or "2026-10-10T09:00"
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[ t](.+)$/);
  if (iso) {
    const clock = parseClock(iso[4]);
    if (!clock) return undefined;
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return at(d, clock);
  }

  if (s === 'tonight') return at(now, [21, 0]);
  if (s === 'tomorrow') return at(now, [9, 0], 1);

  const tm = s.match(/^tomorrow (?:at )?(.+)$/);
  if (tm) {
    const clock = parseClock(tm[1]);
    return clock ? at(now, clock, 1) : undefined;
  }

  // Weekday: "fri 9am", "friday at 10:00" → next occurrence strictly in the future
  const wd = s.match(/^([a-z]+) (?:at )?(.+)$/);
  if (wd) {
    const idx = WEEKDAYS.findIndex(w => wd[1].startsWith(w) && w.length <= wd[1].length);
    const clock = parseClock(wd[2]);
    if (idx >= 0 && clock) {
      let add = (idx - now.getDay() + 7) % 7;
      let d = at(now, clock, add);
      if (d <= now) d = at(now, clock, add + 7);
      return d;
    }
    return undefined;
  }

  // Plain clock time: today, or tomorrow if already passed
  const clock = parseClock(s.replace(/^at /, ''));
  if (clock) {
    const d = at(now, clock);
    return d <= now ? at(now, clock, 1) : d;
  }
  return undefined;
}

/** "Fri 10 Oct, 09:00" */
export function formatWhen(d: Date): string {
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** "in 2h 5m", "in 45s", "3m ago" */
export function formatRelative(d: Date, now: Date = new Date()): string {
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  let txt: string;
  if (abs < 60_000) txt = `${Math.round(abs / 1000)}s`;
  else {
    const totalMin = Math.round(abs / 60_000);
    const days = Math.floor(totalMin / 1440);
    const hrs = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    txt = [days && `${days}d`, hrs && `${hrs}h`, mins && `${mins}m`].filter(Boolean).join(' ');
  }
  return diff >= 0 ? `in ${txt}` : `${txt} ago`;
}
