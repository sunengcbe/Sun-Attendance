// Attendance rules. No screen or database code here, so tests/rules.test.html can check them.

const IST_MS = 5.5 * 60 * 60 * 1000;

export function istDate(value) {
  return new Date(new Date(value).getTime() + IST_MS).toISOString().slice(0, 10);
}

// Minutes since midnight in India time. Seconds are ignored.
export function istMinutes(value) {
  const t = new Date(new Date(value).getTime() + IST_MS);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

export function istToIso(date, minutes) {
  return new Date(Date.parse(date + 'T00:00:00Z') + minutes * 60000 - IST_MS).toISOString();
}

export function addDays(date, days) {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

export function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function ordinal(n) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return n + suffix;
}

// The hours that applied on a given date. An edit only counts from its own date onward.
export function shiftFor(shifts, date) {
  const sorted = [...shifts].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  let chosen = sorted[0] || null;
  for (const s of sorted) {
    if (s.effective_from <= date) chosen = s;
  }
  return chosen;
}

// Scans alternate IN, OUT, IN, OUT in time order: 1st IN, 1st OUT, 2nd IN, 2nd OUT...
// Only the day's first IN can be late, and only its last OUT can be early or overtime.
// now is { date, minutes } in India time.
export function buildDay(date, scans, shifts, now) {
  const shift = shiftFor(shifts, date);
  const start = toMinutes(shift.morning_start);
  const end = toMinutes(shift.evening_end);
  const sorted = [...scans].sort((a, b) => new Date(a.scanned_at) - new Date(b.scanned_at));
  const isToday = date === now.date;
  const outPending = sorted.length % 2 === 1;

  const cells = sorted.map((scan, i) => ({
    scan,
    kind: i % 2 === 0 ? 'in' : 'out',
    label: `${ordinal(Math.floor(i / 2) + 1)} ${i % 2 === 0 ? 'IN' : 'OUT'}`,
    minutes: istMinutes(scan.scanned_at),
    late: 0, early: 0, colour: null, missing: false,
  }));

  let late = 0;
  let early = 0;
  let overtime = 0;

  if (cells.length) {
    const first = cells[0];
    first.late = late = Math.max(0, first.minutes - (start + shift.late_buffer));
    if (late) first.colour = 'late';
  }

  // Until the day's finishing time has passed, an OUT could just be a break
  const dayOver = !isToday || now.minutes >= end;
  if (cells.length && !outPending) {
    const last = cells[cells.length - 1];
    overtime = Math.max(0, last.minutes - end);
    if (dayOver) {
      last.early = early = Math.max(0, (end - shift.early_buffer) - last.minutes);
      if (early) last.colour = 'early';
    }
  }

  // An IN with no OUT after it: still at work today, a forgotten scan on a past day
  const missing = outPending && !isToday;
  if (outPending) {
    cells.push({
      scan: null, kind: 'out', label: `${ordinal(Math.ceil(sorted.length / 2))} OUT`,
      minutes: null, late: 0, early: 0, colour: null, missing,
    });
  }

  let worked = 0;
  for (let i = 0; i + 1 < sorted.length; i += 2) {
    worked += Math.max(0, cells[i + 1].minutes - cells[i].minutes);
  }

  return {
    date, shift, cells, hasScans: sorted.length > 0,
    lateTotal: late, earlyTotal: early, overtime, worked,
    hasMissing: missing,
    notArrived: !sorted.length && isToday && now.minutes > start + shift.late_buffer,
    isIn: isToday && outPending,
  };
}

export function monthTotals(days) {
  return days.reduce((t, d) => ({
    worked: t.worked + d.worked,
    late: t.late + d.lateTotal,
    early: t.early + d.earlyTotal,
    overtime: t.overtime + d.overtime,
    daysPresent: t.daysPresent + (d.hasScans ? 1 : 0),
    missing: t.missing + (d.hasMissing ? 1 : 0),
  }), { worked: 0, late: 0, early: 0, overtime: 0, daysPresent: 0, missing: 0 });
}

// Which dates the 30-day clear removes soon: a day goes once it is over 30 days old.
export function clearingWindow(today) {
  return { from: addDays(today, -30), to: addDays(today, -23) };
}
export function clearsOn(date) {
  return addDays(date, 31);
}
