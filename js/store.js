// Única capa que toca localStorage. Todo se guarda en una sola clave.
import { DEFAULT_CATEGORIES } from './data.js';
import { uid, todayStr, addDays, monthOf, normalizeText, occurrenceOnOrAfter, daysBetween } from './util.js';

const KEY = 'appfinanzas.v1';
let saveFailed = false;

function emptyState() {
  return {
    version: 1,
    movements: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    rules: [],
    recurring: [],
    pending: [],
    budgets: [],
    settings: {
      currency: '$',
      hideAmounts: false,
      lastBackup: null, // ISO
      backupSnoozeUntil: null, // 'YYYY-MM-DD'
      lastImport: null, // 'YYYY-MM-DD HH:MM' del último movimiento importado del atajo (Plan B)
      createdAt: todayStr(),
    },
  };
}

const arr = (v) => (Array.isArray(v) ? v : []);
const isColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

/** Completa y limpia datos viejos o importados. */
function normalize(data) {
  const base = emptyState();
  if (!data || typeof data !== 'object') return base;
  const cats = Array.isArray(data.categories) ? data.categories : base.categories;
  return {
    version: 1,
    movements: arr(data.movements)
      .filter((m) => m && Number.isFinite(Number(m.amount)) && /^\d{4}-\d{2}-\d{2}$/.test(m.date))
      .map((m) => ({
        ...m,
        type: m.type === 'ingreso' ? 'ingreso' : 'gasto',
        amount: Math.round(Number(m.amount)),
        desc: String(m.desc ?? ''),
        categoryId: m.categoryId ?? null,
        tags: arr(m.tags).map(String),
        source: m.source || 'app',
      })),
    categories: cats
      .filter((c) => c && c.id && c.name)
      .map((c) => ({
        id: String(c.id),
        name: String(c.name),
        color: isColor(c.color) ? c.color : '#94a3b8',
        icon: String(c.icon || 'dots'),
        type: c.type === 'ingreso' ? 'ingreso' : 'gasto',
      })),
    rules: arr(data.rules).filter((r) => r && r.pattern && r.categoryId),
    recurring: arr(data.recurring).filter((f) => f && f.id && f.nextDate),
    pending: arr(data.pending).filter((p) => p && p.recurringId && p.dueDate),
    budgets: arr(data.budgets).filter((b) => b && b.categoryId && b.limit > 0),
    settings: { ...base.settings, ...(data.settings || {}) },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyState();
  }
}

export const state = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveFailed = false;
  } catch {
    saveFailed = true;
  }
}

export function lastSaveFailed() {
  return saveFailed;
}

// ---------- Categorías ----------

export function getCategory(id) {
  return state.categories.find((c) => c.id === id) || null;
}

export function categoriesOf(type) {
  return state.categories.filter((c) => c.type === type);
}

export function addCategory({ name, color, icon, type }) {
  const c = { id: uid(), name, color, icon, type };
  state.categories.push(c);
  save();
  return c;
}

// ---------- Movimientos ----------

export function addMovement(data) {
  const m = {
    id: uid(),
    type: data.type,
    amount: Math.round(data.amount),
    date: data.date || todayStr(),
    desc: data.desc || '',
    categoryId: data.categoryId ?? null,
    source: data.source || 'app',
    createdAt: new Date().toISOString(),
  };
  if (data.recurringId) m.recurringId = data.recurringId;
  state.movements.push(m);
  save();
  return m;
}

export function addMovements(list) {
  const out = list.map((d) => {
    const m = { id: uid(), tags: [], createdAt: new Date().toISOString(), ...d, amount: Math.round(d.amount) };
    state.movements.push(m);
    return m;
  });
  save();
  return out;
}

export function getMovement(id) {
  return state.movements.find((m) => m.id === id) || null;
}

export function updateMovement(id, patch) {
  const m = getMovement(id);
  if (m) Object.assign(m, patch);
  save();
}

export function deleteMovement(id) {
  state.movements = state.movements.filter((m) => m.id !== id);
  save();
}

/** Movimientos de un mes ('YYYY-MM'), del más nuevo al más viejo. */
export function movementsOf(ym) {
  return state.movements
    .filter((m) => m.date.startsWith(ym))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function totalsOf(ym) {
  let gastos = 0;
  let ingresos = 0;
  for (const m of state.movements) {
    if (!m.date.startsWith(ym)) continue;
    if (m.type === 'ingreso') ingresos += m.amount;
    else gastos += m.amount;
  }
  return { gastos, ingresos, balance: ingresos - gastos };
}

/** Map categoryId → gastado en el mes. excludeId: no contar ese movimiento (al editarlo). */
export function spentByCategory(ym, excludeId = null) {
  const map = new Map();
  for (const m of state.movements) {
    if (m.type !== 'gasto' || !m.date.startsWith(ym) || m.id === excludeId) continue;
    map.set(m.categoryId, (map.get(m.categoryId) || 0) + m.amount);
  }
  return map;
}

/** Categorías más usadas en los últimos 90 días. */
export function frequentCategories(type, n = 4) {
  const since = addDays(todayStr(), -90);
  const count = new Map();
  for (const m of state.movements) {
    if (m.type !== type || !m.categoryId || m.date < since) continue;
    count.set(m.categoryId, (count.get(m.categoryId) || 0) + 1);
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => getCategory(id))
    .filter(Boolean)
    .slice(0, n);
}

// ---------- Reglas aprendidas ----------

/** Guarda "descripción → categoría" para la próxima vez (reemplaza la anterior con el mismo texto). */
export function learnRule(desc, categoryId) {
  const pattern = normalizeText(desc);
  if (!pattern || !categoryId) return;
  state.rules = state.rules.filter((r) => r.pattern !== pattern);
  state.rules.push({ id: uid(), pattern, categoryId, source: 'aprendida' });
  save();
}

// ---------- Presupuestos ----------

export function getBudget(categoryId) {
  return state.budgets.find((b) => b.categoryId === categoryId)?.limit || 0;
}

export function setBudget(categoryId, limit) {
  state.budgets = state.budgets.filter((b) => b.categoryId !== categoryId);
  if (limit > 0) state.budgets.push({ categoryId, limit: Math.round(limit) });
  save();
}

/** Estado del presupuesto de una categoría en un mes, sumando `extra` (un gasto por guardar). */
export function budgetStatus(categoryId, ym, extra = 0, excludeId = null) {
  const limit = getBudget(categoryId);
  if (!limit) return null;
  const spent = (spentByCategory(ym, excludeId).get(categoryId) || 0) + extra;
  return { limit, spent, pct: spent / limit, remaining: limit - spent };
}

// ---------- Movimientos fijos ----------

export function getRecurring(id) {
  return state.recurring.find((f) => f.id === id) || null;
}

/** f: { name, type, amount, variable, categoryId, every, day, month? }. `from`: primera fecha posible. */
export function addRecurring(f, from = todayStr()) {
  const r = { id: uid(), active: true, ...f };
  r.nextDate = occurrenceOnOrAfter(r, from);
  state.recurring.push(r);
  save();
  return r;
}

export function updateRecurring(id, patch) {
  const f = getRecurring(id);
  if (!f) return;
  const wasActive = f.active;
  Object.assign(f, patch);
  // Si cambió la periodicidad, o se reanuda después de una pausa, la próxima fecha arranca desde hoy.
  if ('every' in patch || 'day' in patch || 'month' in patch || (!wasActive && f.active)) {
    f.nextDate = occurrenceOnOrAfter(f, todayStr());
  }
  save();
}

export function deleteRecurring(id) {
  state.recurring = state.recurring.filter((f) => f.id !== id);
  state.pending = state.pending.filter((p) => p.recurringId !== id);
  save();
}

/** Arma la bandeja "Para confirmar": un pendiente por cada ciclo vencido, con su fecha original. */
export function processRecurring(today = todayStr()) {
  let changed = false;
  for (const f of state.recurring) {
    if (!f.active) continue;
    let guard = 0;
    while (f.nextDate <= today && guard++ < 120) {
      state.pending.push({
        id: uid(),
        recurringId: f.id,
        dueDate: f.nextDate,
        amount: f.variable ? null : f.amount,
      });
      f.nextDate = occurrenceOnOrAfter(f, addDays(f.nextDate, 1));
      changed = true;
    }
  }
  if (changed) save();
}

/** Pendientes para mostrar hoy (sin los pospuestos). */
export function duePending(today = todayStr()) {
  return state.pending
    .filter((p) => !p.snoozeUntil || p.snoozeUntil <= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function confirmPending(id, amount) {
  const p = state.pending.find((x) => x.id === id);
  const f = p && getRecurring(p.recurringId);
  if (!p || !f) return null;
  state.pending = state.pending.filter((x) => x.id !== id);
  return addMovement({
    type: f.type,
    amount,
    date: p.dueDate,
    desc: f.name,
    categoryId: f.categoryId,
    source: 'fijo',
    recurringId: f.id,
  });
}

export function skipPending(id) {
  state.pending = state.pending.filter((x) => x.id !== id);
  save();
}

export function snoozePending(id) {
  const p = state.pending.find((x) => x.id === id);
  if (p) p.snoozeUntil = addDays(todayStr(), 1);
  save();
}

// ---------- Ajustes y backup ----------

export function setSetting(key, value) {
  state.settings[key] = value;
  save();
}

/** Días desde el último backup si ya toca recordarlo (cada 14 días), o 0. */
export function backupReminderDays(today = todayStr()) {
  if (!state.movements.length) return 0;
  const { lastBackup, backupSnoozeUntil, createdAt } = state.settings;
  if (backupSnoozeUntil && today < backupSnoozeUntil) return 0;
  const since = lastBackup ? lastBackup.slice(0, 10) : createdAt || today;
  const days = daysBetween(since, today);
  return days >= 14 ? days : 0;
}

export function exportData() {
  return JSON.stringify({ app: 'appfinanzas', exportedAt: new Date().toISOString(), ...state }, null, 2);
}

/** Reemplaza todos los datos por los del backup. Devuelve false si el archivo no sirve. */
export function importData(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.movements)) return false;
  const next = normalize(obj);
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, next);
  save();
  return true;
}

export function currentMonth() {
  return monthOf(todayStr());
}
