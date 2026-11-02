// Made-up data for trying the app without an account. Open index.html?demo=1. Nothing is saved.
import { addDays, istDate, istToIso } from './rules.js';

const SHIFT = { morning_start: '09:00', morning_end: '14:00', evening_start: '15:00', evening_end: '20:00', late_buffer: 5, early_buffer: 10 };
const NAMES = ['Asha', 'Bala', 'Chitra', 'Devan', 'Esha', 'Farid'];

let nextId = 1000;
let seed = 7;
function rand(n) {
  seed = (seed * 16807) % 2147483647;
  return seed % n;
}

const today = istDate(new Date());
const nowMinutes = (() => { const t = new Date(Date.now() + 19800000); return t.getUTCHours() * 60 + t.getUTCMinutes(); })();

const data = {
  settings: { ...SHIFT, last_seen: new Date(Date.now() - 20000).toISOString() },
  employees: NAMES.map((name, i) => ({ id: i + 1, name, finger_id: i + 1, registered: true, deleted_at: null, created_at: addDays(today, -60) + 'T00:00:00Z' })),
  shifts: [], scans: [], edits: [], commands: [],
};

data.shifts = data.employees.map(e => ({ employee_id: e.id, effective_from: addDays(today, -60), ...SHIFT }));
data.employees.push({ id: 7, name: 'Gopal', finger_id: 7, registered: true, deleted_at: new Date(Date.now() - 2 * 86400000).toISOString(), created_at: addDays(today, -60) + 'T00:00:00Z' });
data.shifts.push({ employee_id: 7, effective_from: addDays(today, -60), ...SHIFT });

for (let d = 28; d >= 0; d--) {
  const date = addDays(today, -d);
  for (const emp of data.employees) {
    if (emp.deleted_at) continue;
    if (rand(12) === 0) continue; // no scans that day
    const times = [
      9 * 60 - 5 + rand(10) + (rand(5) === 0 ? 5 + rand(25) : 0),
      14 * 60 - 5 + rand(8),
      15 * 60 - 5 + rand(9) + (rand(6) === 0 ? 8 : 0),
      20 * 60 - 8 + rand(10) + (rand(5) === 0 ? 20 + rand(40) : 0) - (rand(7) === 0 ? 30 : 0),
    ];
    const forgot = rand(14) === 0 ? 1 + rand(2) : -1;
    times.forEach((m, i) => {
      if (i === forgot) return;
      if (d === 0 && m > nowMinutes) return;
      data.scans.push({ id: nextId++, employee_id: emp.id, scanned_at: istToIso(date, m), source: 'device', slot_override: null });
    });
  }
}

const copy = () => JSON.parse(JSON.stringify(data));

export const demoApi = {
  demo: true,
  async init() { return true; },
  async signIn() {},
  async signOut() {},
  async changePassword() {},
  async loadAll() {
    data.settings.last_seen = new Date(Date.now() - 20000).toISOString();
    return copy();
  },

  async startEnroll(name) {
    const fingerId = Math.max(...data.employees.map(e => e.finger_id)) + 1;
    const employee = { id: nextId++, name, finger_id: fingerId, registered: false, deleted_at: null, created_at: new Date().toISOString() };
    data.employees.push(employee);
    data.shifts.push({ employee_id: employee.id, effective_from: today, ...SHIFT });
    return runEnroll(employee);
  },
  async retryEnroll(employeeId) {
    return runEnroll(data.employees.find(e => e.id === employeeId));
  },
  async softDelete(employeeId) {
    const e = data.employees.find(x => x.id === employeeId);
    if (e.registered) e.deleted_at = new Date().toISOString();
    else data.employees = data.employees.filter(x => x !== e);
  },
  async restore(employeeId) {
    data.employees.find(e => e.id === employeeId).deleted_at = null;
  },
  async renameEmployee(employeeId, name) {
    data.employees.find(e => e.id === employeeId).name = name;
  },

  async saveShift(employeeId, date, values) {
    data.shifts = data.shifts.filter(s => !(s.employee_id === employeeId && s.effective_from === date));
    data.shifts.push({ employee_id: employeeId, effective_from: date, ...values });
  },
  async saveDefaults(values) {
    Object.assign(data.settings, values);
  },

  async addScan(employeeId, iso, slot, reason) {
    data.scans.push({ id: nextId++, employee_id: employeeId, scanned_at: iso, source: 'manual', slot_override: slot });
    data.edits.push({ id: nextId++, employee_id: employeeId, action: 'added', new_at: iso, reason, edited_at: new Date().toISOString() });
  },
  async changeScan(scan, iso, slot, reason) {
    const row = data.scans.find(s => s.id === scan.id);
    data.edits.push({ id: nextId++, employee_id: scan.employee_id, action: 'changed', old_at: row.scanned_at, new_at: iso, reason, edited_at: new Date().toISOString() });
    row.scanned_at = iso;
    row.slot_override = slot;
  },
  async removeScan(scan, reason) {
    data.scans = data.scans.filter(s => s.id !== scan.id);
    data.edits.push({ id: nextId++, employee_id: scan.employee_id, action: 'removed', old_at: scan.scanned_at, reason, edited_at: new Date().toISOString() });
  },
};

// Pretends to be the machine walking through registration
function runEnroll(employee) {
  const cmd = { id: nextId++, kind: 'enroll', finger_id: employee.finger_id, employee_id: employee.id, name: employee.name, status: 'pending', step: null, message: null };
  data.commands.push(cmd);
  [['place', 2000], ['lift', 4500], ['again', 6500], ['saving', 8500]].forEach(([step, at]) => {
    setTimeout(() => { cmd.status = 'running'; cmd.step = step; }, at);
  });
  setTimeout(() => { cmd.status = 'done'; cmd.step = 'done'; employee.registered = true; }, 10000);
  return cmd.id;
}
