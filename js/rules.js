// Motor de categorización (reglas locales, sin IA ni azar) y lector de la carga en lote.
import { BASE_KEYWORDS } from './data.js';
import { normalizeText, parseAmount, todayStr, dateStr, addDays } from './util.js';

/**
 * Categoría sugerida para una descripción, o null (= Sin clasificar).
 * 1) reglas aprendidas (correcciones del usuario), 2) reglas base de data.js.
 */
export function suggestCategory(desc, type, state) {
  const text = normalizeText(desc);
  if (!text) return null;
  const valid = new Set(state.categories.filter((c) => c.type === type).map((c) => c.id));
  const padded = ` ${text} `;

  let best = null;
  let bestLen = 0;
  for (const r of state.rules) {
    if (!valid.has(r.categoryId)) continue;
    if (r.pattern === text) return r.categoryId;
    if (padded.includes(` ${r.pattern} `) && r.pattern.length > bestLen) {
      best = r.categoryId;
      bestLen = r.pattern.length;
    }
  }
  if (best) return best;

  for (const [catId, words] of Object.entries(BASE_KEYWORDS)) {
    if (!valid.has(catId)) continue;
    for (const w of words) {
      const hit = w.length <= 3 ? padded.includes(` ${w} `) : padded.includes(` ${w}`);
      if (hit && w.length > bestLen) {
        best = catId;
        bestLen = w.length;
      }
    }
  }
  return best;
}

/**
 * Lee una línea de la carga en lote. Formato: `[fecha] [hora] descripción monto`.
 *   "Almuerzo 50.000"            gasto de hoy
 *   "Sueldo +1.500.000"          ingreso (también vale "+Sueldo 1.500.000")
 *   "12/03 Farmacia 12.300"      con fecha (dd/mm o dd/mm/aaaa)
 *   "30/09/2026 09:05 Café 4500" con fecha y hora (así escribe el atajo del Plan B)
 * Devuelve { desc, amount, type, date, time } o { error } si no encuentra el monto.
 */
export function parseLine(line, today = todayStr()) {
  let s = line.trim();
  let date = today;
  let time = null;

  const d = s.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\s+/);
  if (d) {
    const day = Number(d[1]);
    const month = Number(d[2]);
    let year = d[3] ? Number(d[3]) : Number(today.slice(0, 4));
    if (year < 100) year += 2000;
    const c = new Date(year, month - 1, day);
    if (c.getMonth() === month - 1 && day >= 1) {
      date = dateStr(c);
      // "30/12" escrito el 2 de enero es del año pasado.
      if (!d[3] && date > addDays(today, 1)) date = dateStr(new Date(year - 1, month - 1, day));
      s = s.slice(d[0].length);
    }
  }

  const t = s.match(/^(\d{1,2}):(\d{2})\s+/);
  if (t) {
    time = `${t[1].padStart(2, '0')}:${t[2]}`;
    s = s.slice(t[0].length);
  }

  let type = 'gasto';
  if (s.startsWith('+')) {
    type = 'ingreso';
    s = s.slice(1).trim();
  }

  const a = s.match(/(?:^|\s)([+-])?\s*\$?\s*(\d[\d.]*(?:,\d+)?)\s*$/);
  if (!a) return { error: true };
  const amount = parseAmount(a[2]);
  if (!(amount > 0)) return { error: true };
  if (a[1] === '+') type = 'ingreso';
  const desc = s.slice(0, a.index).trim().replace(/[:\-–]+$/, '').trim();
  return { desc, amount, type, date, time };
}

/** Todas las líneas: { items: [...], errors: ['línea que no se entendió'] }. */
export function parseBatch(text, today = todayStr()) {
  const items = [];
  const errors = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const r = parseLine(raw, today);
    if (r.error) errors.push(raw.trim());
    else items.push(r);
  }
  return { items, errors };
}
