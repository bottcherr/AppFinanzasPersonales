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

// ---------- Tickets (texto de una foto o de "Escanear texto" del iPhone) ----------

/** Parece un ticket si menciona CUIT o tiene una línea de TOTAL. */
export const looksLikeTicket = (text) => /\bc\.?\s?u\.?\s?i\.?\s?t\b|^\W{0,4}\s*(sub\s*)?total\b/im.test(text);

// Renglones de un ticket que no son productos (se comparan con normalizeText: sin tildes ni signos).
const TICKET_SKIP = new RegExp(
  '\\b(' +
    [
      'sub ?total', 'total', 'iva', 'cuit', 'c u i t', 'vuelto', 'efectivo', 'tarjeta', 'debito', 'credito', 'cambio',
      'recibi', 'recibimos', 'recibido', 'su pago', 'pagos?', 'suma', 'ingresos brutos', 'ing brutos', 'brutos', 'ii ?bb',
      'consumidor', 'resp(onsable)? ?inscripto', 'monotributo', 'cajero', 'caja', 'ticket', 'tique', 'factura',
      'comprobante', 'nro', 'p v', 'cant(idad)?', 'items?', 'redondeo', 'saldo', 'cae', 'importe', 'percepcion',
      'retencion', 'descuento', 'dto', 'bonif(icacion)?', 'promo(cion)?', 'ahorro', 'fecha', 'hora', 'domicilio',
      'direccion', 'c p', 'actividades', 'registro', 'regimen', 'transparencia', 'tributos', 'indirectos', 'contenido',
      'ley', 'gracias', 'tel(efono)?',
    ].join('|') +
    ')\\b',
);

// Un precio de ticket siempre tiene centavos: "1.250,00", "1250,00", "-500,00".
const MONEY = /(-\s*)?\$?\s*(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(?!\d)/g;

/** Arregla confusiones típicas del lector de fotos en los precios. */
function fixOcr(s) {
  return s
    .replace(/(\d)\s*\)\s*(\d{2})(?!\d)/g, '$1,$2') // "6000) 00" → "6000,00"
    .replace(/(\d)\s+,\s*(\d{2})(?!\d)|(\d),\s+(\d{2})(?!\d)/g, (m, a, b, c, d) => `${a ?? c},${b ?? d}`) // "6000 ,00"
    .replace(/[\dOo]+(?:\.[\dOo]{3})*,[\dOo]{2}(?![\dOo])/g, (m) => (/\d/.test(m) ? m.replace(/[Oo]/g, '0') : m)); // "1OOO,OO"
}

/** Saca la basura del principio (letras sueltas que mete el fondo de la foto) y los signos de las puntas. */
function cleanDesc(s) {
  const words = s.trim().split(/\s+/);
  while (words.length > 1 && (words[0].length <= 2 || !/[A-Za-zÀ-ÿ0-9]/.test(words[0]))) words.shift();
  return words.join(' ').replace(/^[^A-Za-zÀ-ÿ0-9]+|[^A-Za-zÀ-ÿ0-9%)]+$/g, '').trim();
}

/**
 * Una línea de ticket: { skip } (no es un producto), { desc } (nombre sin precio: el precio vino en el
 * renglón de abajo), { amount } (precio solo) o { desc, amount }.
 */
function ticketLine(raw) {
  let s = fixOcr(raw.trim());
  const n = normalizeText(s);
  if (!/[a-z]{2}|\d/.test(n) || TICKET_SKIP.test(n)) return { skip: true };
  s = s
    .replace(/\([^)]*\)/g, ' ') // "(21,00)" = alícuota de IVA
    .replace(/\b\d+([.,]\d+)?\s*(kg|gr?|un|u)?\s*\(?\d*\)?\s*[xX*]\s*\$?\s*\d[\d.]*(,\d+)?/gi, ' ') // "2 x 1.250,00"
    .replace(/\b\d{6,}\b/g, ' '); // códigos de barra / de producto
  const all = [...s.matchAll(MONEY)];
  const m = all[all.length - 1];
  if (!m) {
    const desc = cleanDesc(s);
    return /[A-Za-zÀ-ÿ]{3}/.test(desc) ? { desc } : { skip: true };
  }
  if (m[1]) return { skip: true }; // en negativo: descuento
  const amount = parseAmount(`${m[2]},${m[3]}`);
  if (!(amount > 0)) return { skip: true };
  const desc = cleanDesc(s.slice(0, m.index));
  return /[A-Za-zÀ-ÿ]{2}/.test(desc) ? { desc, amount } : { amount };
}

/** El TOTAL impreso (el último precio del renglón que dice TOTAL, no SUBTOTAL). */
function ticketTotal(raw) {
  const s = fixOcr(raw);
  const n = normalizeText(s);
  if (!/(^|\s)total\b/.test(n) || /sub ?total/.test(n)) return null;
  const all = [...s.matchAll(MONEY)];
  const m = all[all.length - 1];
  return m && !m[1] ? parseAmount(`${m[2]},${m[3]}`) : null;
}

/** Fecha del ticket: la del renglón que dice "Fecha"; si no hay, la más reciente (no la de inicio de actividades). */
function ticketDate(lines, today) {
  let best = null;
  for (const line of lines) {
    for (const m of line.matchAll(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})\b/g)) {
      let y = Number(m[3]);
      if (y < 100) y += 2000;
      const c = new Date(y, Number(m[2]) - 1, Number(m[1]));
      if (c.getMonth() !== Number(m[2]) - 1) continue;
      const d = dateStr(c);
      if (d > today || d < addDays(today, -366)) continue;
      if (/fecha/i.test(line)) return d;
      if (!best || d > best) best = d;
    }
  }
  return best;
}

/**
 * Todas las líneas: { items: [...], errors: ['línea que no se entendió'], ticket, total }.
 * Si el texto parece un ticket, se saltean totales, impuestos, pagos y descuentos, se limpian los
 * renglones de productos (tolerando la basura que mete el lector de fotos) y todos toman la fecha del ticket.
 */
export function parseBatch(text, today = todayStr()) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  const ticket = looksLikeTicket(String(text));
  if (!ticket) {
    const items = [];
    const errors = [];
    for (const raw of lines) {
      const r = parseLine(raw, today);
      if (r.error) errors.push(raw.trim());
      else items.push(r);
    }
    return { items, errors, ticket, total: null };
  }

  const date = ticketDate(lines, today) || today;
  const items = [];
  let total = null;
  let pending = null; // nombre de producto esperando su precio en el renglón de abajo
  for (const raw of lines) {
    if (total === null) total = ticketTotal(raw);
    const r = ticketLine(raw);
    if (r.skip) {
      pending = null;
    } else if (r.desc && r.amount) {
      items.push({ desc: r.desc, amount: r.amount, type: 'gasto', date, time: null });
      pending = null;
    } else if (r.desc) {
      pending = r.desc;
    } else if (pending) {
      items.push({ desc: pending, amount: r.amount, type: 'gasto', date, time: null });
      pending = null;
    }
  }
  return { items, errors: [], ticket, total };
}
