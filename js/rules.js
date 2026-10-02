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

// ---------- Tickets (texto copiado de un ticket con "Escanear texto" del iPhone) ----------

/** Parece un ticket si menciona CUIT o tiene una línea de TOTAL. */
export const looksLikeTicket = (text) => /\bcuit\b|^\s*(sub\s*)?total\b/im.test(text);

// Renglones de un ticket que no son productos (se comparan sin tildes y en minúscula).
const TICKET_SKIP =
  /\b(sub ?total|total|iva|cuit|vuelto|efectivo|tarjeta|debito|credito|cambio|recibido|su pago|pago|ingresos brutos|ii ?bb|consumidor final|cons\.? ?final|resp(onsable)?\.? ?inscripto|monotributo|cajero|caja|ticket|factura|comprobante|nro|p\.? ?v\.?|cant(idad)?|items?|redondeo|saldo|cae|importe|percepcion|retencion|descuento|dto|bonif(icacion)?|promo(cion)?|ahorro|fecha|hora)\b/;

/** Limpia una línea de ticket. Devuelve el texto listo para parseLine, o null si hay que ignorarla. */
function ticketLine(raw) {
  let s = raw.trim();
  const n = normalizeText(s);
  if (!/[a-z]{2}/.test(n)) return null; // sin palabras: cantidades ("2 x 1.250"), fechas, códigos
  if (TICKET_SKIP.test(n)) return null;
  s = s
    .replace(/\([^)]*\)/g, ' ') // "(21,00)" = alícuota de IVA
    .replace(/\b\d+([.,]\d+)?\s*(kg|gr?|un|u)?\s*[xX*]\s*\$?\s*\d[\d.]*(,\d+)?/gi, ' ') // "2 x 1.250,00", "1,250 kg x 9.800,00"
    .replace(/\b\d{6,}\b/g, ' ') // códigos de barra / de producto
    .replace(/(\s+[A-Za-z*%]{1,3})+\s*$/, '') // letras sueltas al final ("2.500,00 A")
    .replace(/\s+/g, ' ')
    .trim();
  if (/-\s*\$?\s*\d[\d.,]*$/.test(s)) return null; // montos en negativo: descuentos
  return s;
}

/** Fecha impresa en el ticket (dd/mm/aaaa), para usarla en todos los productos. */
function ticketDate(text, today) {
  const m = text.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})\b/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  const c = new Date(y, Number(m[2]) - 1, Number(m[1]));
  if (c.getMonth() !== Number(m[2]) - 1) return null;
  const d = dateStr(c);
  return d <= today && d >= addDays(today, -366) ? d : null;
}

/**
 * Todas las líneas: { items: [...], errors: ['línea que no se entendió'], ticket, total }.
 * Si el texto parece un ticket, se saltean totales, impuestos, pagos y descuentos, se limpian los
 * renglones de productos y todos toman la fecha impresa en el ticket.
 */
export function parseBatch(text, today = todayStr()) {
  const items = [];
  const errors = [];
  const ticket = looksLikeTicket(String(text));
  const tDate = ticket ? ticketDate(String(text), today) : null;
  let total = null; // el TOTAL impreso en el ticket (ya con descuentos)
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    if (ticket && total === null && /^\s*total\b/i.test(raw)) {
      const t = parseLine(raw, today);
      if (!t.error) total = t.amount;
    }
    const line = ticket ? ticketLine(raw) : raw;
    if (line === null) continue;
    const r = parseLine(line, today);
    if (r.error) {
      if (!ticket) errors.push(raw.trim());
      continue;
    }
    if (tDate) r.date = tDate;
    items.push(r);
  }
  return { items, errors, ticket, total };
}
