// Talks to Supabase. demo.js offers the same functions with made-up data.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';

export const isConfigured = !SUPABASE_URL.includes('YOUR_PROJECT');

let db = null;

function loadLib() {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIB;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// Supabase returns at most 1000 rows at a time
async function fetchAll(table, order) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = check(await db.from(table).select('*').order(order).range(from, from + 999));
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export const api = {
  demo: false,

  async init() {
    await loadLib();
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data } = await db.auth.getSession();
    return !!data.session;
  },

  async signIn(email, password) {
    check(await db.auth.signInWithPassword({ email, password }));
    await db.rpc('run_cleanup');
  },

  async signOut() {
    await db.auth.signOut();
  },

  async changePassword(password) {
    check(await db.auth.updateUser({ password }));
  },

  async loadAll() {
    const [settingsRows, employees, shifts, scans, edits, commands] = await Promise.all([
      db.from('settings').select('morning_start,morning_end,evening_start,evening_end,late_buffer,early_buffer,last_seen').eq('id', 1).then(check),
      fetchAll('employees', 'id'),
      fetchAll('shifts', 'effective_from'),
      fetchAll('scans', 'scanned_at'),
      fetchAll('scan_edits', 'edited_at'),
      fetchAll('commands', 'id'),
    ]);
    return { settings: settingsRows[0], employees, shifts, scans, edits, commands };
  },

  async startEnroll(name) {
    return check(await db.rpc('start_enroll', { p_name: name }));
  },
  async retryEnroll(employeeId) {
    return check(await db.rpc('retry_enroll', { p_employee_id: employeeId }));
  },
  async softDelete(employeeId) {
    check(await db.rpc('soft_delete_employee', { p_id: employeeId }));
  },
  async restore(employeeId) {
    check(await db.rpc('restore_employee', { p_id: employeeId }));
  },
  async renameEmployee(employeeId, name) {
    check(await db.from('employees').update({ name }).eq('id', employeeId));
  },

  async saveShift(employeeId, date, values) {
    check(await db.from('shifts').upsert({ employee_id: employeeId, effective_from: date, ...values }));
  },
  async saveDefaults(values) {
    check(await db.from('settings').update(values).eq('id', 1));
  },

  async addScan(employeeId, iso, slot, reason) {
    check(await db.from('scans').insert({ employee_id: employeeId, scanned_at: iso, source: 'manual', slot_override: slot }));
    check(await db.from('scan_edits').insert({ employee_id: employeeId, action: 'added', new_at: iso, reason }));
  },
  async changeScan(scan, iso, slot, reason) {
    check(await db.from('scans').update({ scanned_at: iso, slot_override: slot }).eq('id', scan.id));
    check(await db.from('scan_edits').insert({ employee_id: scan.employee_id, action: 'changed', old_at: scan.scanned_at, new_at: iso, reason }));
  },
  async removeScan(scan, reason) {
    check(await db.from('scans').delete().eq('id', scan.id));
    check(await db.from('scan_edits').insert({ employee_id: scan.employee_id, action: 'removed', old_at: scan.scanned_at, reason }));
  },
};
