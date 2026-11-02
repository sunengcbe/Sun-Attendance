// Attendance rules. No screen or database code here, so tests/rules.test.html can check them.

export const SLOT_NAMES = ['Morning IN', 'Lunch OUT', 'Lunch IN', 'Evening OUT'];

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

// The hours that applied on a given date. An edit only counts from its own date onward.
export function shiftFor(shifts, date) {
  const sorted = [...shifts].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  let chosen = sorted[0] || null;
  for (const s of sorted) {
    if (s.effective_from <= date) chosen = s;
  }
  return chosen;
}

function scheduledTimes(shift) {
  return [shift.morning_start, shift.morning_end, shift.evening_start, shift.evening_end].map(toMinutes);
}

// Puts each scan in the nearest remaining slot by time, so a forgotten scan
// shows as missing instead of shifting everything after it.
export function assignSlots(scans, shift) {
  const sched = scheduledTimes(shift);
  const sorted = [...scans].sort((a, b) => new Date(a.scanned_at) - new Date(b.scanned_at));
  const reserved = new Set(sorted.filter(s => s.slot_override).map(s => s.slot_override - 1));
  const slots = [null, null, null, null];
  const extras = [];
  let last = -1;

  for (const scan of sorted) {
    if (scan.slot_override && !slots[scan.slot_override - 1]) {
      slots[scan.slot_override - 1] = scan;
      last = Math.max(last, scan.slot_override - 1);
      continue;
    }
    const minutes = istMinutes(scan.scanned_at);
    let best = -1;
    for (let i = last + 1; i < 4; i++) {
      if (slots[i] || reserved.has(i)) continue;
      if (best < 0 || Math.abs(sched[i] - minutes) < Math.abs(sched[best] - minutes)) best = i;
    }
    if (best < 0) {
      extras.push(scan);
    } else {
      slots[best] = scan;
      last = best;
    }
  }
  return { slots, extras };
}

function slotIsMissing(index, slots, sched, shift, date, now) {
  if (slots[index]) return false;
  if (date < now.date) return true;
  if (slots.slice(index + 1).some(Boolean)) return true;
  if (index === 0) return now.minutes > sched[0] + shift.late_buffer;
  if (index === 1) return now.minutes >= sched[2];
  if (index === 2) return now.minutes > sched[2] + shift.late_buffer;
  return false; // Evening OUT can still happen today, however late
}

// now is { date, minutes } in India time.
export function buildDay(date, scans, shifts, now) {
  const shift = shiftFor(shifts, date);
  const sched = scheduledTimes(shift);
  const { slots, extras } = assignSlots(scans, shift);
  const hasScans = scans.length > 0;

  let lateTotal = 0;
  let earlyTotal = 0;
  let overtime = 0;

  const views = slots.map((scan, i) => {
    const view = {
      index: i, name: SLOT_NAMES[i], scheduled: sched[i], scan, minutes: null,
      late: 0, early: 0, colour: null,
      missing: hasScans && slotIsMissing(i, slots, sched, shift, date, now),
    };
    if (!scan) return view;

    const minutes = istMinutes(scan.scanned_at);
    view.minutes = minutes;
    if (i === 0 || i === 2) view.late = Math.max(0, minutes - (sched[i] + shift.late_buffer));
    if (i === 1 || i === 3) view.early = Math.max(0, (sched[i] - shift.early_buffer) - minutes);
    if (i === 3) overtime = Math.max(0, minutes - sched[3]);
    lateTotal += view.late;
    earlyTotal += view.early;

    // Lunch scans never get a colour
    if (i === 0 && view.late) view.colour = 'late';
    if (i === 3 && view.early) view.colour = 'early';
    return view;
  });

  let worked = 0;
  if (slots[0] && slots[1]) worked += Math.max(0, views[1].minutes - views[0].minutes);
  if (slots[2] && slots[3]) worked += Math.max(0, views[3].minutes - views[2].minutes);

  return {
    date, shift, slots: views, extras, hasScans,
    lateTotal, earlyTotal, overtime, worked,
    hasMissing: views.some(v => v.missing),
    notArrived: !hasScans && date === now.date && now.minutes > sched[0] + shift.late_buffer,
    isIn: !!(views.filter(v => v.scan).pop()?.index % 2 === 0 && hasScans),
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
