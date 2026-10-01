// Funciones chicas sin estado: fechas, montos, texto.

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Minúsculas, sin tildes y sin signos: "Café  Martínez!" → "cafe martinez". */
export function normalizeText(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

// ---------- Montos (números enteros) ----------

/** "50.000" → 50000, "12,50" → 13, "$ 1.200" → 1200. NaN si no hay número. */
export function parseAmount(str) {
  const s = String(str ?? '').replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return NaN;
  const [int, dec = ''] = s.replace(/\./g, '').split(',');
  return Math.round(Number(`${int || 0}.${dec.replace(/\D/g, '') || 0}`));
}

export function fmtNumber(n) {
  return Math.round(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

// ---------- Fechas (texto 'YYYY-MM-DD', hora local) ----------

const pad = (n) => String(n).padStart(2, '0');

export const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
export const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr() {
  return dateStr(new Date());
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}

export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

export function monthOf(s) {
  return s.slice(0, 7);
}

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** '2026-09' → 'SEP DE 2026' (corto) o 'septiembre 2026'. */
export function fmtMonth(ym, short = false) {
  const [y, m] = ym.split('-').map(Number);
  const name = MONTHS[m - 1];
  return short ? `${name.slice(0, 3).toUpperCase()} DE ${y}` : `${name} ${y}`;
}

/** 'jueves, 20 de agosto de 2026' */
export function fmtDateLong(s) {
  const d = parseDate(s);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}

/** 'jue, 20 de ago.' */
export function fmtDateShort(s) {
  const d = parseDate(s);
  return `${WEEKDAYS[d.getDay()].slice(0, 3)}, ${d.getDate()} de ${MONTHS[d.getMonth()].slice(0, 3)}.`;
}

/** 'Hoy', 'Ayer' o 'jueves 20 de agosto'. */
export function fmtDay(s) {
  const today = todayStr();
  if (s === today) return 'Hoy';
  if (s === addDays(today, -1)) return 'Ayer';
  if (s === addDays(today, 1)) return 'Mañana';
  const d = parseDate(s);
  const year = d.getFullYear() !== new Date().getFullYear() ? ` de ${d.getFullYear()}` : '';
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}${year}`;
}

// ---------- Movimientos fijos ----------

/**
 * Primera fecha >= s en la que toca un fijo.
 * semanal: day = día de la semana (0 = domingo). mensual: day = día del mes (si el mes es más corto,
 * el último día). anual: month (1-12) y day.
 */
export function occurrenceOnOrAfter(f, s) {
  const d = parseDate(s);
  if (f.every === 'semanal') {
    d.setDate(d.getDate() + ((((Number(f.day) || 0) - d.getDay()) % 7 + 7) % 7));
    return dateStr(d);
  }
  // Con límite de vueltas: un día o mes inválido nunca puede colgar la app.
  if (f.every === 'anual') {
    for (let y = d.getFullYear(); y < d.getFullYear() + 5; y++) {
      const dim = new Date(y, f.month, 0).getDate();
      const c = new Date(y, f.month - 1, Math.min(f.day, dim));
      if (c >= d) return dateStr(c);
    }
    return addDays(s, 365);
  }
  for (let i = 0; i < 24; i++) {
    const y = d.getFullYear();
    const m = d.getMonth() + i;
    const dim = new Date(y, m + 1, 0).getDate();
    const c = new Date(y, m, Math.min(f.day, dim));
    if (c >= d) return dateStr(c);
  }
  return addDays(s, 31);
}

export function fmtEvery(f) {
  if (f.every === 'semanal') return `Cada ${WEEKDAYS[f.day]}`;
  if (f.every === 'anual') return `Cada ${f.day} de ${MONTHS[f.month - 1]}`;
  return `Todos los ${f.day}`;
}
