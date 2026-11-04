import { api as liveApi, isConfigured } from './api.js';
import {
  addDays, buildDay, clearingWindow, clearsOn, formatDuration, formatMinutes,
  istDate, istMinutes, istToIso, monthTotals, ordinal, shiftFor, toMinutes,
} from './rules.js';

const demoMode = new URLSearchParams(location.search).has('demo');
const api = demoMode ? (await import('./demo.js')).demoApi : liveApi;

const app = document.getElementById('app');
const dialog = document.getElementById('dialog');
const RETENTION_DAYS = 30;
const ONLINE_WITHIN_MS = 2 * 60 * 1000;

let data = null;
let filters = { status: 'all', employee: 'all', from: null, to: null, search: '' };
let calendarMonth = null;
let enrolling = null;
let enrollTimer = null;

// --- Helpers ---
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function now() {
  const d = new Date();
  return { date: istDate(d), minutes: istMinutes(d) };
}

function prettyDate(date, withYear = false) {
  const d = new Date(date + 'T00:00:00Z');
  const opts = { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' };
  if (withYear) opts.year = 'numeric';
  return d.toLocaleDateString('en-IN', opts);
}

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}

function minutesToInput(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const shortTime = (time) => formatMinutes(toMinutes(time));

function storedGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storedSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* the reminder just stays visible */ }
}

async function act(fn, success) {
  try {
    await fn();
    await reload();
    render();
    if (success) toast(success);
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}

// --- Data ---
async function reload() {
  data = await api.loadAll();
}

const activeStaff = () => data.employees.filter(e => e.registered && !e.deleted_at);
const employeeShifts = (id) => data.shifts.filter(s => s.employee_id === id);

function employeeDays(employee, from, to) {
  const shifts = employeeShifts(employee.id);
  if (!shifts.length) return [];
  const byDate = {};
  for (const scan of data.scans) {
    if (scan.employee_id !== employee.id) continue;
    (byDate[istDate(scan.scanned_at)] ||= []).push(scan);
  }
  const current = now();
  const joined = istDate(employee.created_at);
  const days = [];
  for (let date = to; date >= from; date = addDays(date, -1)) {
    if (date < joined && !byDate[date]) continue;
    days.push({ employee, ...buildDay(date, byDate[date] || [], shifts, current) });
  }
  return days;
}

function allDays(from, to) {
  return activeStaff().flatMap(e => employeeDays(e, from, to));
}

const machineOnline = () => data.settings.last_seen && Date.now() - new Date(data.settings.last_seen) < ONLINE_WITHIN_MS;

function lastSeenText() {
  if (!data.settings.last_seen) return 'Machine has not connected yet';
  if (machineOnline()) return 'Machine online';
  const mins = Math.round((Date.now() - new Date(data.settings.last_seen)) / 60000);
  if (mins < 60) return `Machine offline, last seen ${mins} min ago`;
  if (mins < 1440) return `Machine offline, last seen ${Math.round(mins / 60)} hr ago`;
  return `Machine offline, last seen ${Math.round(mins / 1440)} days ago`;
}

const SUN_ICON = '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.500" fill="currentColor"/><path d="M12 2v2.500M12 19.500V22M2 12h2.500M19.500 12H22M4.900 4.900l1.800 1.800M17.300 17.300l1.800 1.800M4.900 19.100l1.800-1.800M17.300 6.700l1.800-1.800"/></svg>';

const avatar = (name) => `<span class="avatar" aria-hidden="true">${esc(name.trim().charAt(0).toUpperCase())}</span>`;

const machineStatus = () => `<span class="status"><span class="dot ${machineOnline() ? 'on' : ''}"></span>${esc(lastSeenText())}</span>`;

// --- Components ---
function cellHtml(day, cell) {
  const time = cell.scan
    ? `<span class="t ${cell.colour || ''}">${formatMinutes(cell.minutes)}</span>`
    : `<span class="t none">${cell.missing ? 'Missing' : '–'}</span>`;
  let note = '';
  if (cell.late) note = `<span class="note late">${cell.late} min late</span>`;
  if (cell.early) note = `<span class="note early">${cell.early} min early</span>`;
  const isLast = cell === day.cells[day.cells.length - 1];
  if (isLast && cell.scan && cell.kind === 'out' && day.overtime) note = `<span class="note">+${formatDuration(day.overtime)}</span>`;
  const value = cell.scan ? cell.minutes : toMinutes(day.shift.evening_end);
  const scanLabel = cell.scan ? formatMinutes(cell.minutes) : 'no scan';
  return `<button class="slot ${cell.kind} ${cell.colour || ''} ${cell.missing ? 'missing' : ''}" data-action="edit-scan" data-employee="${day.employee.id}" data-date="${day.date}" data-scan="${cell.scan ? cell.scan.id : ''}" data-minutes="${value}"
    aria-label="${esc(day.employee.name)}, ${cell.label}, ${scanLabel}. Edit"><small>${cell.label}</small>${time}${note}</button>`;
}

function addCellHtml(day) {
  const value = day.date === now().date ? now().minutes : toMinutes(day.shift.evening_end);
  return `<button class="slot add" data-action="edit-scan" data-employee="${day.employee.id}" data-date="${day.date}" data-scan="" data-minutes="${value}"
    aria-label="Add a scan for ${esc(day.employee.name)}"><small>Add</small><span class="t none">+</span></button>`;
}

function dayHtml(day, showName, canAdd = true) {
  const title = showName
    ? `<a class="who" href="#/employee/${day.employee.id}">${avatar(day.employee.name)}${esc(day.employee.name)}</a><span class="sub">${prettyDate(day.date)}</span>`
    : `<span><b>${prettyDate(day.date)}</b></span><span class="sub">${day.worked ? formatDuration(day.worked) + ' worked' : ''}</span>`;

  if (!day.hasScans) {
    return `<article class="day" id="day-${day.date}"><div class="day-top">${title}</div>
      <div class="no-scans">${day.notArrived ? 'Not arrived yet' : (day.date === now().date ? 'No scans yet' : 'No scans')}
      ${canAdd ? `<button class="btn small" data-action="edit-scan" data-employee="${day.employee.id}" data-date="${day.date}" data-scan="" data-minutes="${toMinutes(day.shift.morning_start)}">Add scan</button>` : ''}</div></article>`;
  }

  const foot = showName && day.worked ? `<div class="day-foot"><span>${formatDuration(day.worked)} worked</span></div>` : '';
  const open = day.cells[day.cells.length - 1].scan === null;
  return `<article class="day" id="day-${day.date}"><div class="day-top">${title}</div>
    <div class="slots">${day.cells.map(c => cellHtml(day, c)).join('')}${open || !canAdd ? '' : addCellHtml(day)}</div>
    ${foot}</article>`;
}

function reminderHtml() {
  const today = now().date;
  const { from, to } = clearingWindow(today);
  const dates = data.scans.map(s => istDate(s.scanned_at)).filter(d => d >= from && d <= to).sort();
  if (!dates.length) return '';
  const first = dates[0];
  const last = dates[dates.length - 1];
  if ((storedGet('downloaded-through') || '') >= last) return '';
  return `<section class="card banner">
    <p><b>Download before these records clear.</b><br>
    <span class="sub">${prettyDate(first)} to ${prettyDate(last)} will clear soon, starting ${prettyDate(clearsOn(first))}.</span></p>
    <div class="row-btns">
      <button class="btn small" data-action="export-excel" data-from="${first}" data-to="${last}">Download Excel</button>
      <button class="btn small" data-action="export-pdf" data-from="${first}" data-to="${last}">Download PDF</button>
    </div></section>`;
}

// --- Screens ---
function viewToday() {
  const today = now().date;
  const days = allDays(today, today);
  const present = days.filter(d => d.isIn).length;
  const late = days.filter(d => d.lateTotal);
  const early = days.filter(d => d.earlyTotal);
  const missing = days.filter(d => d.hasMissing || d.notArrived);
  const exceptions = days.filter(d => d.lateTotal || d.earlyTotal || d.hasMissing || d.notArrived);
  const normal = days.filter(d => !exceptions.includes(d));

  return `<div class="head"><div><h1>Today</h1><div class="sub">${prettyDate(today, true)}</div></div>${machineStatus()}</div>
    ${reminderHtml()}
    <div class="stats">
      <a class="stat in" href="#/attendance" data-filter="all"><b>${present}</b><span>In now</span></a>
      <a class="stat late" href="#/attendance" data-filter="late"><b>${late.length}</b><span>Late</span></a>
      <a class="stat early" href="#/attendance" data-filter="early"><b>${early.length}</b><span>Early</span></a>
      <a class="stat missing" href="#/attendance" data-filter="missing"><b>${missing.length}</b><span>Missing</span></a>
    </div>
    ${exceptions.length ? `<h2>Needs attention</h2>${exceptions.map(d => dayHtml(d, true, false)).join('')}` : ''}
    ${normal.length ? `<h2 style="margin-top:16px">Everyone else</h2>${normal.map(d => dayHtml(d, true, false)).join('')}` : ''}
    ${days.length ? '' : '<p class="empty">No staff yet. Add someone from the Staff page.</p>'}`;
}

function filteredDays() {
  const today = now().date;
  const from = filters.from || addDays(today, -6);
  const to = filters.to || today;
  const search = filters.search.trim().toLowerCase();
  return allDays(from, to)
    .filter(d => filters.employee === 'all' || String(d.employee.id) === filters.employee)
    .filter(d => !search || d.employee.name.toLowerCase().includes(search))
    .filter(d => filters.status === 'all'
      || (filters.status === 'late' && d.lateTotal)
      || (filters.status === 'early' && d.earlyTotal)
      || (filters.status === 'missing' && d.hasMissing))
    .sort((a, b) => b.date.localeCompare(a.date) || a.employee.name.localeCompare(b.employee.name));
}

function attendanceList() {
  const days = filteredDays();
  return days.length ? days.map(d => dayHtml(d, true)).join('') : '<p class="empty">Nothing matches these filters.</p>';
}

function viewAttendance() {
  const today = now().date;
  const oldest = addDays(today, -RETENTION_DAYS);
  const from = filters.from || addDays(today, -6);
  const to = filters.to || today;
  const chips = [['all', 'All'], ['late', 'Late'], ['early', 'Early'], ['missing', 'Missing']];
  return `<div class="head"><h1>Attendance</h1>
      <div class="row-btns">
        <button class="btn small" data-action="export-excel" data-from="${from}" data-to="${to}">Excel</button>
        <button class="btn small" data-action="export-pdf" data-from="${from}" data-to="${to}">PDF</button>
      </div></div>
    <div class="chips">${chips.map(([k, label]) => `<button class="chip" data-action="status-filter" data-status="${k}" aria-pressed="${filters.status === k}">${label}</button>`).join('')}</div>
    <div class="filters">
      <label>From<input type="date" id="f-from" min="${oldest}" max="${today}" value="${from}"></label>
      <label>To<input type="date" id="f-to" min="${oldest}" max="${today}" value="${to}"></label>
      <label>Employee<select id="f-employee">
        <option value="all">Everyone</option>
        ${activeStaff().map(e => `<option value="${e.id}" ${filters.employee === String(e.id) ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
      </select></label>
      <label>Search name<input type="search" id="f-search" value="${esc(filters.search)}" autocomplete="off"></label>
    </div>
    <div id="attendance-list">${attendanceList()}</div>`;
}

function calendarHtml(employee) {
  const today = now().date;
  const month = calendarMonth || today.slice(0, 7);
  const first = `${month}-01`;
  const next = addDays(first, 32).slice(0, 7) + '-01';
  const last = addDays(next, -1);
  const oldest = addDays(today, -RETENTION_DAYS);
  const days = {};
  employeeDays(employee, first > oldest ? first : oldest, last < today ? last : today).forEach(d => { days[d.date] = d; });

  const offset = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7;
  let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<div class="dow">${d}</div>`).join('');
  cells += '<div></div>'.repeat(offset);
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const d = days[date];
    const n = Number(date.slice(8));
    if (!d || !d.hasScans) { cells += `<span class="d">${n}</span>`; continue; }
    const morningLate = d.lateTotal > 0;
    const eveningEarly = d.earlyTotal > 0;
    cells += `<a href="#" data-action="goto-day" data-date="${date}">${n}<br>${morningLate ? '<i class="late"></i>' : ''}${eveningEarly ? '<i class="early"></i>' : ''}${d.hasMissing ? '<i class="miss"></i>' : ''}</a>`;
  }

  const label = new Date(first + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const canBack = first > oldest;
  const canNext = next <= today;
  return `<div class="cal-head">
      <button class="btn small" data-action="cal-move" data-month="${addDays(first, -1).slice(0, 7)}" ${canBack ? '' : 'disabled'} aria-label="Previous month">‹</button>
      <b>${label}</b>
      <button class="btn small" data-action="cal-move" data-month="${next.slice(0, 7)}" ${canNext ? '' : 'disabled'} aria-label="Next month">›</button>
    </div><div class="cal">${cells}</div>`;
}

function shiftForm(values, id) {
  return `<form id="${id}"><div class="grid2">
      <label>Start time<input type="time" name="morning_start" value="${values.morning_start.slice(0, 5)}" required></label>
      <label>Finish time<input type="time" name="evening_end" value="${values.evening_end.slice(0, 5)}" required></label>
      <input type="hidden" name="morning_end" value="${values.morning_end.slice(0, 5)}">
      <input type="hidden" name="evening_start" value="${values.evening_start.slice(0, 5)}">
      <label>Late buffer (min)<input type="number" name="late_buffer" min="0" max="120" value="${values.late_buffer}" required></label>
      <label>Early buffer (min)<input type="number" name="early_buffer" min="0" max="120" value="${values.early_buffer}" required></label>
    </div>`;
}

function readShiftForm(form) {
  const f = new FormData(form);
  return {
    morning_start: f.get('morning_start'), morning_end: f.get('morning_end'),
    evening_start: f.get('evening_start'), evening_end: f.get('evening_end'),
    late_buffer: Number(f.get('late_buffer')), early_buffer: Number(f.get('early_buffer')),
  };
}

function viewEmployee(id) {
  const employee = data.employees.find(e => String(e.id) === id && !e.deleted_at);
  if (!employee) return '<p class="empty">This employee was not found.</p>';

  const today = now().date;
  const month = calendarMonth || today.slice(0, 7);
  const first = `${month}-01`;
  const last = addDays(addDays(first, 32).slice(0, 7) + '-01', -1);
  const oldest = addDays(today, -RETENTION_DAYS);
  const days = employeeDays(employee, first > oldest ? first : oldest, last < today ? last : today);
  const t = monthTotals(days);
  const current = shiftFor(employeeShifts(employee.id), today);
  const edits = data.edits.filter(e => e.employee_id === employee.id).slice(-8).reverse();

  return `<div class="head"><div><h1>${esc(employee.name)}</h1>
      <div class="sub">${shortTime(current.morning_start)} – ${shortTime(current.evening_end)}</div></div>
      <a class="btn small" href="#/staff">Back</a></div>
    <section class="card">${calendarHtml(employee)}</section>
    <section class="card"><div class="totals">
      <div><b>${formatDuration(t.worked)}</b><span>Worked</span></div>
      <div><b>${t.late}m</b><span>Late</span></div>
      <div><b>${t.early}m</b><span>Early</span></div>
      <div><b>${formatDuration(t.overtime)}</b><span>Overtime</span></div>
    </div></section>
    ${days.map(d => dayHtml(d, false)).join('') || '<p class="empty">No records this month.</p>'}
    <section class="card" style="margin-top:12px"><h2>Working hours</h2>
      ${shiftForm(current, 'shift-form')}
      <p class="sub">Changes apply from today. Past days keep their old hours.</p>
      <button class="btn primary" type="submit">Save hours</button></form></section>
    ${edits.length ? `<section class="card"><h2>Change history</h2><ul class="history">${edits.map(editHtml).join('')}</ul></section>` : ''}
    <section class="card"><h2>Employee</h2><div class="row-btns">
      <button class="btn" data-action="rename" data-id="${employee.id}">Rename</button>
      <button class="btn danger" data-action="delete-employee" data-id="${employee.id}">Delete employee</button>
    </div></section>`;
}

function fullStamp(iso) {
  return `${prettyDate(istDate(iso))}, ${formatMinutes(istMinutes(iso))}`;
}

function editHtml(edit) {
  const text = {
    added: `Added ${fullStamp(edit.new_at || edit.old_at)}`,
    changed: `Changed ${fullStamp(edit.old_at)} to ${edit.new_at ? formatMinutes(istMinutes(edit.new_at)) : ''}`,
    removed: `Removed ${fullStamp(edit.old_at || edit.new_at)}`,
  }[edit.action];
  return `<li>${esc(text)}${edit.reason ? ` – ${esc(edit.reason)}` : ''}</li>`;
}

function viewStaff() {
  const staff = activeStaff().sort((a, b) => a.name.localeCompare(b.name));
  const incomplete = data.employees.filter(e => !e.registered && !e.deleted_at);
  return `<div class="head"><h1>Staff</h1><a class="btn primary small" href="#/add">Add employee</a></div>
    <section class="card">
      ${staff.map(e => {
        const s = shiftFor(employeeShifts(e.id), now().date);
        return `<a class="list-row" href="#/employee/${e.id}"><span class="who">${avatar(e.name)}<span><b>${esc(e.name)}</b><br>
          <span class="sub">${shortTime(s.morning_start)} – ${shortTime(s.evening_end)}</span></span></span><span class="sub">›</span></a>`;
      }).join('') || '<p class="empty">No staff yet.</p>'}
    </section>
    ${incomplete.length ? `<section class="card"><h2>Registration not finished</h2>
      ${incomplete.map(e => `<div class="list-row"><b>${esc(e.name)}</b><span class="row-btns">
        <button class="btn small" data-action="enroll-retry" data-id="${e.id}">Try again</button>
        <button class="btn small danger" data-action="enroll-cancel" data-id="${e.id}">Cancel</button></span></div>`).join('')}
    </section>` : ''}`;
}

const ENROLL_STEPS = [
  ['queue', 'Sending to the machine'],
  ['place', 'Place finger on the sensor'],
  ['lift', 'Lift finger'],
  ['again', 'Place the same finger again'],
  ['saving', 'Saving fingerprint'],
];

function viewAdd() {
  if (!enrolling) {
    return `<div class="head"><h1>Add employee</h1><a class="btn small" href="#/staff">Back</a></div>
      <section class="card"><form id="add-form">
        <label>Name<input name="name" maxlength="16" required autocomplete="off" autofocus></label>
        <p class="sub">Up to 16 characters, so it fits the LCD. They will need to be at the machine.</p>
        ${machineOnline() ? '' : `<p class="error">${esc(lastSeenText())}. Registration will wait up to 10 minutes for it.</p>`}
        <button class="btn primary" type="submit">Start registration</button>
      </form></section>`;
  }

  const cmd = data.commands.find(c => c.id === enrolling.commandId);
  const status = cmd?.status;
  const order = ENROLL_STEPS.map(s => s[0]);
  const at = status === 'done' ? order.length : Math.max(0, order.indexOf(cmd?.step));
  const stepsHtml = ENROLL_STEPS.map(([key, label], i) => {
    const state = i < at ? 'done' : (i === at && status !== 'failed' ? 'active' : '');
    return `<li class="${state}">${label}</li>`;
  }).join('');

  let footer = '<p class="sub">Follow the steps on the machine\'s LCD.</p>';
  if (status === 'done') {
    footer = `<p><b>${esc(enrolling.name)} is registered.</b></p>
      <div class="row-btns"><a class="btn primary" href="#/employee/${cmd.employee_id}" data-action="enroll-finish">Set their hours</a>
      <a class="btn" href="#/add" data-action="enroll-finish">Add another</a></div>`;
  } else if (status === 'failed') {
    footer = `<p class="error">${esc(cmd.message || 'Registration failed.')}</p>
      <div class="row-btns"><button class="btn primary" data-action="enroll-retry" data-id="${cmd.employee_id}">Try again</button>
      <button class="btn danger" data-action="enroll-cancel" data-id="${cmd.employee_id}">Cancel</button></div>`;
  }

  return `<div class="head"><h1>Registering ${esc(enrolling.name)}</h1></div>
    <section class="card"><ul class="steps">${stepsHtml}</ul>${footer}</section>`;
}

function viewSettings() {
  const today = now().date;
  const deleted = data.employees.filter(e => e.deleted_at);
  return `<div class="head"><h1>Settings</h1>${machineStatus()}</div>
    <section class="card"><h2>Default hours and buffers</h2>
      <p class="sub">New employees start with these.</p>
      ${shiftForm(data.settings, 'defaults-form')}
      <label class="check"><input type="checkbox" name="apply_all"> Also apply to everyone from today</label>
      <button class="btn primary" type="submit">Save</button></form></section>
    <section class="card"><h2>Download records</h2>
      <p class="sub">Each day's records clear after 30 days. Download a copy to keep them.</p>
      <div class="grid2">
        <label>From<input type="date" id="dl-from" min="${addDays(today, -RETENTION_DAYS)}" max="${today}" value="${addDays(today, -RETENTION_DAYS)}"></label>
        <label>To<input type="date" id="dl-to" min="${addDays(today, -RETENTION_DAYS)}" max="${today}" value="${today}"></label>
      </div>
      <div class="row-btns"><button class="btn" data-action="export-custom" data-kind="excel">Download Excel</button>
      <button class="btn" data-action="export-custom" data-kind="pdf">Download PDF</button></div></section>
    <section class="card"><h2>Recently deleted</h2>
      ${deleted.map(e => {
        const left = Math.max(0, Math.ceil(7 - (Date.now() - new Date(e.deleted_at)) / 86400000));
        return `<div class="list-row"><span><b>${esc(e.name)}</b><br><span class="sub">Removed for good in ${left} day${left === 1 ? '' : 's'}</span></span>
          <button class="btn small" data-action="restore" data-id="${e.id}">Restore</button></div>`;
      }).join('') || '<p class="sub">Nobody.</p>'}
    </section>
    <section class="card"><h2>Account</h2><div class="row-btns">
      <button class="btn" data-action="change-password">Change password</button>
      <button class="btn" data-action="sign-out">Sign out</button></div></section>`;
}

const NAV = [
  ['today', 'Today', '<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/><circle cx="12" cy="12" r="4"/>'],
  ['attendance', 'Attendance', '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'],
  ['staff', 'Staff', '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.5 2.5-6 6-6s6 2.5 6 6M16 5a3.5 3.5 0 0 1 0 6.5M18 14.5c1.900.8 3 2.800 3 5.500"/>'],
  ['settings', 'Settings', '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'],
];

function route() {
  const [, page = 'today', id] = location.hash.split('/');
  return { page, id };
}

function render() {
  const { page, id } = route();
  const screens = {
    today: viewToday, attendance: viewAttendance, staff: viewStaff, add: viewAdd,
    settings: viewSettings, employee: () => viewEmployee(id),
  };
  const view = screens[page] || viewToday;
  const activeTab = page === 'employee' || page === 'add' ? 'staff' : page;
  app.innerHTML = `${api.demo ? '<div class="demo-note">Demo with made-up data. Nothing is saved.</div>' : ''}
    <div class="topbar">${SUN_ICON}Sun Attendance</div>
    <div class="shell"><nav class="nav" aria-label="Main">
      <div class="nav-brand">${SUN_ICON}Sun Attendance</div>
      ${NAV.map(([key, label, icon]) => `<a href="#/${key}" ${activeTab === key ? 'aria-current="page"' : ''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>${label}</a>`).join('')}
    </nav><main>${view()}</main></div>`;
}

function viewLogin(message = '') {
  app.innerHTML = `<div class="login-page"><div class="login">${SUN_ICON}<h1>Sun Attendance</h1><p class="sub">Sign in to continue.</p>
    <form id="login-form">
      <label>Email<input type="email" name="email" autocomplete="username" required></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
      <p class="error" id="login-error">${esc(message)}</p>
      <button class="btn primary" type="submit" style="width:100%">Sign in</button>
    </form></div></div>`;
}

// --- Editing a scan ---
function openScanEditor(employeeId, date, scanId, minutes) {
  const employee = data.employees.find(e => e.id === employeeId);
  const scan = data.scans.find(s => s.id === scanId);

  dialog.innerHTML = `<form id="scan-form" data-employee="${employeeId}" data-date="${date}" data-scan="${scan ? scan.id : ''}">
    <h2>${esc(employee.name)}</h2><p class="sub">${prettyDate(date, true)}</p>
    <label>Time<input type="time" name="time" value="${minutesToInput(minutes)}" required></label>
    <label>Reason (optional)<input name="reason" maxlength="120" autocomplete="off"></label>
    <p class="sub">IN and OUT follow the order of the day's scans.${scan ? ' The machine time is kept in the change history.' : ''}</p>
    <div class="dialog-btns">
      ${scan ? '<button class="btn danger" type="button" data-action="remove-scan">Remove</button>' : ''}
      <span class="spacer"></span>
      <button class="btn" type="button" data-action="close-dialog">Cancel</button>
      <button class="btn primary" type="submit">${scan ? 'Save' : 'Add scan'}</button>
    </div></form>`;
  dialog.showModal();
}

function openDeleteDialog(id) {
  const employee = data.employees.find(e => e.id === id);
  dialog.innerHTML = `<form id="delete-form" data-id="${id}"><h2>Delete ${esc(employee.name)}?</h2>
    <p class="sub">They can't scan from now on. Their records and fingerprint are removed for good after 7 days. You can restore them from Settings until then.</p>
    <label>Type <b>${esc(employee.name)}</b> to confirm<input name="confirm" autocomplete="off" required></label>
    <div class="dialog-btns"><span class="spacer"></span>
      <button class="btn" type="button" data-action="close-dialog">Cancel</button>
      <button class="btn danger" type="submit">Delete</button></div></form>`;
  dialog.showModal();
}

function openRenameDialog(id) {
  const employee = data.employees.find(e => e.id === id);
  dialog.innerHTML = `<form id="rename-form" data-id="${id}"><h2>Rename</h2>
    <label>Name<input name="name" maxlength="16" value="${esc(employee.name)}" required></label>
    <div class="dialog-btns"><span class="spacer"></span>
      <button class="btn" type="button" data-action="close-dialog">Cancel</button>
      <button class="btn primary" type="submit">Save</button></div></form>`;
  dialog.showModal();
}

function openPasswordDialog() {
  dialog.innerHTML = `<form id="password-form"><h2>Change password</h2>
    <label>New password<input type="password" name="password" minlength="8" autocomplete="new-password" required></label>
    <div class="dialog-btns"><span class="spacer"></span>
      <button class="btn" type="button" data-action="close-dialog">Cancel</button>
      <button class="btn primary" type="submit">Save</button></div></form>`;
  dialog.showModal();
}

// --- Downloads ---
function exportRows(from, to) {
  return allDays(from, to)
    .filter(d => d.hasScans)
    .sort((a, b) => a.date.localeCompare(b.date) || a.employee.name.localeCompare(b.employee.name));
}

function cellText(cell) {
  if (!cell) return '';
  if (cell.scan) return formatMinutes(cell.minutes);
  return cell.missing ? 'Missing' : '';
}

// Enough IN/OUT columns for the busiest day in the download
function exportColumns(rows) {
  const pairs = Math.max(1, ...rows.map(d => Math.ceil(d.cells.length / 2)));
  const labels = [];
  for (let i = 1; i <= pairs; i++) labels.push(`${ordinal(i)} IN`, `${ordinal(i)} OUT`);
  return labels;
}

function rememberDownload(to) {
  const previous = storedGet('downloaded-through') || '';
  if (to > previous) storedSet('downloaded-through', to);
}

function exportExcel(from, to) {
  const load = window.XLSX ? Promise.resolve() : new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the Excel tool. Check your internet connection.'));
    document.head.appendChild(s);
  });
  load.then(() => {
    const days = exportRows(from, to);
    const columns = exportColumns(days);
    const rows = days.map(d => ({
      Date: d.date,
      Employee: d.employee.name,
      ...Object.fromEntries(columns.map((label, i) => [label, cellText(d.cells[i])])),
      'Worked (min)': d.worked,
      'Late (min)': d.lateTotal,
      'Early (min)': d.earlyTotal,
      'Overtime (min)': d.overtime,
    }));
    const book = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(book, window.XLSX.utils.json_to_sheet(rows), 'Attendance');
    window.XLSX.writeFile(book, `attendance-${from}-to-${to}.xlsx`);
    rememberDownload(to);
    render();
  }).catch(e => toast(e.message));
}

function exportPdf(from, to) {
  const rows = exportRows(from, to);
  const columns = exportColumns(rows);
  document.getElementById('print-area').innerHTML = `<h2>Attendance ${prettyDate(from, true)} to ${prettyDate(to, true)}</h2>
    <table><thead><tr><th>Date</th><th>Employee</th>${columns.map(c => `<th>${c}</th>`).join('')}<th>Worked</th><th>Late</th><th>Early</th><th>Overtime</th></tr></thead>
    <tbody>${rows.map(d => `<tr><td>${d.date}</td><td>${esc(d.employee.name)}</td>
      ${columns.map((c, i) => `<td class="${d.cells[i]?.colour || ''}">${cellText(d.cells[i])}</td>`).join('')}
      <td>${formatDuration(d.worked)}</td><td>${d.lateTotal}m</td><td>${d.earlyTotal}m</td><td>${formatDuration(d.overtime)}</td></tr>`).join('')}</tbody></table>`;
  rememberDownload(to);
  window.print();
  render();
}

// --- Registration progress ---
function watchEnroll() {
  clearInterval(enrollTimer);
  enrollTimer = setInterval(async () => {
    if (!enrolling) { clearInterval(enrollTimer); return; }
    try {
      await reload();
      const cmd = data.commands.find(c => c.id === enrolling.commandId);
      if (cmd?.status === 'done' || cmd?.status === 'failed') clearInterval(enrollTimer);
      if (route().page === 'add') render();
    } catch { /* try again on the next tick */ }
  }, 2000);
}

async function beginEnroll(name, start) {
  try {
    const commandId = await start();
    enrolling = { commandId, name };
    await reload();
    location.hash = '#/add';
    render();
    watchEnroll();
  } catch (e) {
    toast(e.message);
  }
}

// --- Events ---
document.addEventListener('click', async (event) => {
  const stat = event.target.closest('.stat');
  if (stat) filters = { ...filters, status: stat.dataset.filter, from: now().date, to: now().date, employee: 'all', search: '' };

  const el = event.target.closest('[data-action]');
  if (!el) return;
  const { action } = el.dataset;
  const id = Number(el.dataset.id);

  if (action === 'edit-scan') openScanEditor(Number(el.dataset.employee), el.dataset.date, Number(el.dataset.scan) || null, Number(el.dataset.minutes));
  if (action === 'close-dialog') dialog.close();
  if (action === 'status-filter') { filters.status = el.dataset.status; render(); }
  if (action === 'cal-move') { calendarMonth = el.dataset.month; render(); }
  if (action === 'goto-day') {
    event.preventDefault();
    document.getElementById(`day-${el.dataset.date}`)?.scrollIntoView({ behavior: 'smooth' });
  }
  if (action === 'delete-employee') openDeleteDialog(id);
  if (action === 'rename') openRenameDialog(id);
  if (action === 'change-password') openPasswordDialog();
  if (action === 'restore') act(() => api.restore(id), 'Restored');
  if (action === 'export-excel') exportExcel(el.dataset.from, el.dataset.to);
  if (action === 'export-pdf') exportPdf(el.dataset.from, el.dataset.to);
  if (action === 'export-custom') {
    const from = document.getElementById('dl-from').value;
    const to = document.getElementById('dl-to').value;
    if (from > to) { toast('From must be before To'); return; }
    (el.dataset.kind === 'excel' ? exportExcel : exportPdf)(from, to);
  }
  if (action === 'sign-out') { await api.signOut(); data = null; viewLogin(); }
  if (action === 'enroll-finish') enrolling = null;
  if (action === 'enroll-retry') {
    const employee = data.employees.find(e => e.id === id);
    beginEnroll(employee.name, () => api.retryEnroll(id));
  }
  if (action === 'enroll-cancel') {
    enrolling = null;
    clearInterval(enrollTimer);
    await act(() => api.softDelete(id), 'Cancelled');
    location.hash = '#/staff';
  }
  if (action === 'remove-scan') {
    const form = el.closest('form');
    const scan = data.scans.find(s => s.id === Number(form.dataset.scan));
    const reason = form.elements.reason.value.trim() || null;
    dialog.close();
    act(() => api.removeScan(scan, reason), 'Scan removed');
  }
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;

  if (form.id === 'login-form') {
    const f = new FormData(form);
    try {
      await api.signIn(f.get('email'), f.get('password'));
      await reload();
      render();
      goLive();
    } catch (e) {
      document.getElementById('login-error').textContent = e.message;
    }
  }

  if (form.id === 'add-form') {
    const name = new FormData(form).get('name').trim();
    if (name) beginEnroll(name, () => api.startEnroll(name));
  }

  if (form.id === 'shift-form') {
    const employeeId = Number(route().id);
    await act(() => api.saveShift(employeeId, now().date, readShiftForm(form)), 'Hours saved');
  }

  if (form.id === 'defaults-form') {
    const values = readShiftForm(form);
    const applyAll = form.elements.apply_all.checked;
    await act(async () => {
      await api.saveDefaults(values);
      if (applyAll) await Promise.all(activeStaff().map(e => api.saveShift(e.id, now().date, values)));
    }, applyAll ? 'Saved for everyone' : 'Saved');
  }

  if (form.id === 'scan-form') {
    const f = new FormData(form);
    const [h, m] = f.get('time').split(':').map(Number);
    const iso = istToIso(form.dataset.date, h * 60 + m);
    const reason = f.get('reason').trim() || null;
    const employeeId = Number(form.dataset.employee);
    const scan = data.scans.find(s => s.id === Number(form.dataset.scan));
    dialog.close();
    await act(() => (scan ? api.changeScan(scan, iso, reason) : api.addScan(employeeId, iso, reason)), 'Saved');
  }

  if (form.id === 'delete-form') {
    const id = Number(form.dataset.id);
    const employee = data.employees.find(e => e.id === id);
    if (form.elements.confirm.value.trim() !== employee.name) {
      toast('The name does not match');
      return;
    }
    dialog.close();
    location.hash = '#/staff';
    await act(() => api.softDelete(id), `${employee.name} deleted`);
  }

  if (form.id === 'rename-form') {
    const id = Number(form.dataset.id);
    const name = form.elements.name.value.trim();
    dialog.close();
    if (name) await act(() => api.renameEmployee(id, name), 'Name changed');
  }

  if (form.id === 'password-form') {
    const password = form.elements.password.value;
    dialog.close();
    await act(() => api.changePassword(password), 'Password changed');
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'f-search') {
    filters.search = event.target.value;
    document.getElementById('attendance-list').innerHTML = attendanceList();
  }
});

document.addEventListener('change', (event) => {
  const map = { 'f-from': 'from', 'f-to': 'to', 'f-employee': 'employee' };
  const key = map[event.target.id];
  if (key) {
    filters[key] = event.target.value;
    render();
  }
});

window.addEventListener('hashchange', () => {
  const { page } = route();
  if (page !== 'employee') calendarMonth = null;
  if (data) {
    render();
    window.scrollTo(0, 0);
  }
});

// Keep the numbers fresh, without disturbing a form you are typing in
let refreshing = false;
let refreshAgain = false;

async function refresh() {
  if (!data) return;
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    await reload();
    const tag = document.activeElement?.tagName;
    const busy = dialog.open || tag === 'INPUT' || tag === 'SELECT';
    const { page } = route();
    if (!busy && page !== 'add') render();
  } catch { /* try again next time */ }
  refreshing = false;
  if (refreshAgain) { refreshAgain = false; refresh(); }
}

// New scans arrive within seconds. The timer is a backup if the live connection drops.
let subscribed = false;
function goLive() {
  if (subscribed) return;
  subscribed = true;
  api.subscribe(() => refresh());
}

setInterval(() => { if (!document.hidden) refresh(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

// --- Start ---
async function start() {
  if (!api.demo && !isConfigured) {
    app.innerHTML = '<div class="login"><h1>Sun Attendance</h1><p class="sub">The database is not connected yet. Open index.html?demo=1 to try the demo.</p></div>';
    return;
  }
  try {
    const signedIn = await api.init();
    if (!signedIn) { viewLogin(); return; }
    await reload();
    render();
    goLive();
  } catch (e) {
    viewLogin(e.message);
  }
}

start();
