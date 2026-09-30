// Pantallas y router por hash. Cada render reemplaza root.innerHTML y define sus acciones (data-action).
import * as store from './store.js';
import { state } from './store.js';
import { icon } from './icons.js';
import { COLORS, CATEGORY_ICONS, UNCLASSIFIED } from './data.js';
import { suggestCategory, parseBatch } from './rules.js';
import {
  esc, normalizeText, parseAmount, fmtNumber, todayStr, addDays, parseDate, monthOf, addMonths,
  daysInMonth, fmtMonth, fmtDateLong, fmtDateShort, fmtDay, occurrenceOnOrAfter, fmtEvery, WEEKDAYS, MONTHS,
} from './util.js';

const root = document.getElementById('app');
const sheet = document.getElementById('sheet');

let viewMonth = store.currentMonth();
let draft = null; // movimiento que se está anotando o editando
let keepDraft = false; // al navegar, usar el draft que ya está armado
let batch = null; // carga en lote: { text, items?, errors?, source, importMark? }
let fdraft = null; // fijo que se está editando
let histFilter = { q: '', cat: '', tag: '' };
let catTab = 'gasto';
let currentHash = null;
let depth = 0; // cuántas pantallas se apilaron con navigate() (para el botón atrás)
let actions = {};
let toastTimer;

// ---------- Formato ----------

const cur = () => state.settings.currency || '$';

function money(n, sign = '') {
  if (state.settings.hideAmounts) return `${sign}${esc(cur())} ••••`;
  return `${sign}${esc(cur())} ${fmtNumber(Math.abs(n))}`;
}

function signed(m) {
  return money(m.amount, m.type === 'ingreso' ? '+' : '-');
}

function catOf(id) {
  return (id && store.getCategory(id)) || UNCLASSIFIED;
}

function catIcon(c, cls = '') {
  return `<span class="cat-ico ${cls}" style="--c:${c.color}">${icon(c.icon)}</span>`;
}

const pctText = (p) => `${Math.round(p * 100)} %`;
const tone = (p) => (p > 1 ? 'over' : p >= 0.8 ? 'warn' : 'ok');

function bar(p, t = tone(p)) {
  return `<div class="bar ${t}"><i style="width:${Math.min(100, Math.max(0, p * 100)).toFixed(1)}%"></i></div>`;
}

function formatAmountInput(input) {
  const digits = input.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 12);
  input.value = digits ? fmtNumber(Number(digits)) : '';
  return digits ? Number(digits) : 0;
}

function focusEnd(sel) {
  const el = root.querySelector(sel);
  if (!el) return;
  el.focus({ preventScroll: true });
  try {
    el.setSelectionRange(el.value.length, el.value.length);
  } catch {
    /* inputs sin selección */
  }
}

// ---------- Navegación ----------

function navigate(path, { replace = false } = {}) {
  const h = '#' + path;
  if (replace) history.replaceState(null, '', h);
  else if (location.hash !== h) {
    history.pushState(null, '', h);
    depth++;
  }
  route();
}

function goBack(fallback = '/') {
  if (depth > 0) {
    depth--;
    history.back();
  } else navigate(fallback, { replace: true });
}

window.addEventListener('popstate', () => location.hash !== currentHash && route());
window.addEventListener('hashchange', () => location.hash !== currentHash && route());

function mount(html, screenActions = {}, handlers = {}) {
  root.innerHTML = html;
  actions = screenActions;
  root.oninput = handlers.input || null;
  root.onchange = handlers.change || null;
  root.onkeydown = handlers.keydown || null;
  root.onsubmit =
    handlers.submit ||
    ((e) => {
      e.preventDefault();
    });
}

const COMMON = {
  to: (el) => navigate(el.dataset.to),
  tab: (el) => {
    depth = 0;
    navigate(el.dataset.to, { replace: true });
  },
  back: (el) => goBack(el.dataset.fallback || '/'),
  'month-prev': () => {
    viewMonth = addMonths(viewMonth, -1);
    route(true);
  },
  'month-next': () => {
    viewMonth = addMonths(viewMonth, 1);
    route(true);
  },
  'open-mov': (el) => navigate(`/mov/${el.dataset.id}`),
  'toggle-hide': () => {
    store.setSetting('hideAmounts', !state.settings.hideAmounts);
    route(true);
  },
};

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !root.contains(el)) return;
  const fn = actions[el.dataset.action] || COMMON[el.dataset.action];
  if (fn) {
    e.preventDefault();
    fn(el, e);
  }
});

function route(soft = false) {
  currentHash = location.hash;
  closeSheet();
  store.processRecurring();
  const h = location.hash.slice(1) || '/';
  const [path, qs] = h.split('?');
  const params = new URLSearchParams(qs || '');
  const [a, b] = path.split('/').filter(Boolean);
  if (!soft) window.scrollTo(0, 0);
  switch (a) {
    case undefined:
      return renderHome();
    case 'nuevo':
      return openNew(params, 'app');
    case 'rapido':
      return openRapido(params);
    case 'mov':
      return openEdit(b);
    case 'movimientos':
      return renderHistory();
    case 'analisis':
      return renderInsights();
    case 'ajustes':
      return renderSettings();
    case 'lote':
      return renderBatch();
    case 'fijos':
      return renderRecurring();
    case 'fijo':
      return renderRecurringForm(b);
    case 'pendientes':
      return renderPending();
    case 'categorias':
      return renderCategories();
    case 'sin-clasificar':
      return renderUnclassified();
    case 'reglas':
      return renderRules();
    case 'atajo':
      return renderShortcutHelp();
    default:
      return navigate('/', { replace: true });
  }
}

// ---------- Piezas comunes ----------

function tabbar(active) {
  const tabs = [
    ['/', 'home', 'Inicio'],
    ['/movimientos', 'list', 'Movimientos'],
    ['/analisis', 'chart', 'Análisis'],
    ['/ajustes', 'sliders', 'Ajustes'],
  ];
  return `<nav class="tabbar">${tabs
    .map(
      ([to, ic, label]) =>
        `<button class="tab${active === to ? ' on' : ''}" data-action="tab" data-to="${to}" aria-label="${label}">${icon(ic)}</button>`,
    )
    .join('')}</nav>`;
}

function fab(label = false) {
  return `<button class="fab${label ? ' wide' : ''}" data-action="to" data-to="/nuevo" aria-label="Anotar">${icon('plus')}${label ? '<span>Anotar</span>' : ''}</button>`;
}

function monthNav() {
  return `<div class="month-nav">
    <button class="icon-btn sm" data-action="month-prev" aria-label="Mes anterior">${icon('chev-left')}</button>
    <span>${fmtMonth(viewMonth, true)}</span>
    <button class="icon-btn sm" data-action="month-next" aria-label="Mes siguiente">${icon('chev-right')}</button>
  </div>`;
}

function topbar(title, { back = '/', right = '' } = {}) {
  return `<header class="topbar">
    <button class="icon-btn" data-action="back" data-fallback="${back}" aria-label="Atrás">${icon('chev-left')}</button>
    <h1 class="topbar-title">${title}</h1>
    <div class="topbar-right">${right}</div>
  </header>`;
}

function movRow(m) {
  const c = catOf(m.categoryId);
  const meta = [`<span class="${m.categoryId ? '' : 'warn-text'}">${esc(c.name)}</span>`];
  for (const t of m.tags || []) meta.push(`<span class="tag">#${esc(t)}</span>`);
  if (m.source === 'fijo') meta.push('<span class="badge">Fijo</span>');
  return `<button class="mov" data-action="open-mov" data-id="${m.id}">
    ${catIcon(c)}
    <span class="mov-main"><b>${esc(m.desc || c.name)}</b><small>${meta.join(' ')}</small></span>
    <span class="mov-amt ${m.type}">${signed(m)}</span>
  </button>`;
}

function movementList(list) {
  const groups = new Map();
  for (const m of list) {
    if (!groups.has(m.date)) groups.set(m.date, []);
    groups.get(m.date).push(m);
  }
  return [...groups]
    .map(([date, ms]) => {
      const total = ms.reduce((s, m) => s + (m.type === 'ingreso' ? m.amount : -m.amount), 0);
      return `<div class="day">
        <div class="day-head"><span>${esc(fmtDay(date))}</span><span>${money(total, total < 0 ? '-' : '+')}</span></div>
        <div class="card list">${ms.map(movRow).join('')}</div>
      </div>`;
    })
    .join('');
}

/** Caja "Tu presupuesto" con lo que queda en la categoría, sumando `extra` (el gasto por guardar). */
function budgetBox(catId, ym, extra = 0, excludeId = null) {
  if (!catId) return '';
  const st = store.budgetStatus(catId, ym, extra, excludeId);
  if (!st) return '';
  const c = catOf(catId);
  const t = tone(st.pct);
  const tag = { ok: 'Seguro', warn: 'Cuidado', over: 'Excedido' }[t];
  const text =
    st.remaining >= 0
      ? `Te quedarán <b>${money(st.remaining)}</b> en ${esc(c.name)} este mes.`
      : `Te pasás por <b>${money(-st.remaining)}</b> en ${esc(c.name)} este mes.`;
  return `<div class="budget-box ${t}">
    <div class="bb-head"><span>Tu presupuesto</span><span class="bb-tag">${tag}</span></div>
    ${bar(st.pct, t)}
    <p>${text}</p>
  </div>`;
}

/** Aviso de presupuesto después de guardar un gasto (80 % o más). */
function budgetAlert(m) {
  if (!m || m.type !== 'gasto' || !m.categoryId) return null;
  const st = store.budgetStatus(m.categoryId, monthOf(m.date));
  if (!st || st.pct < 0.8) return null;
  const name = catOf(m.categoryId).name;
  if (st.pct > 1) return { tone: 'over', text: `${name}: ${pctText(st.pct)} del límite. Te pasaste por ${cur()} ${fmtNumber(-st.remaining)}.` };
  return { tone: 'warn', text: `${name}: ${pctText(st.pct)} del límite` };
}

function budgetRows(ym) {
  const spent = store.spentByCategory(ym);
  return state.budgets
    .map((b) => {
      const c = store.getCategory(b.categoryId);
      if (!c) return null;
      const s = spent.get(b.categoryId) || 0;
      return { c, spent: s, limit: b.limit, pct: s / b.limit };
    })
    .filter(Boolean)
    .sort((a, b) => b.pct - a.pct);
}

// ---------- Hojas, avisos y animaciones ----------

function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function checkSave() {
  if (store.lastSaveFailed()) toast('No se pudo guardar en el dispositivo');
}

/** Animación breve al guardar, con el aviso de presupuesto si corresponde. */
function celebrate(title, alert = null) {
  document.querySelector('.celebrate')?.remove();
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.innerHTML = `<div class="celebrate-card">
    <svg class="check-anim" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M15 27l7 7 15-16"/></svg>
    <b>${esc(title)}</b>
    ${alert ? `<p class="alert-${alert.tone}">${esc(alert.text)}</p>` : ''}
  </div>`;
  document.body.appendChild(el);
  if (navigator.vibrate) navigator.vibrate(12);
  const stay = alert ? 2300 : 1000;
  setTimeout(() => el.classList.add('out'), stay);
  setTimeout(() => el.remove(), stay + 350);
}

function openDialog() {
  if (!sheet.open) sheet.showModal();
}

function closeSheet() {
  sheet.onclose = null;
  sheet.oninput = null;
  sheet.onsubmit = null;
  if (sheet.open) sheet.close();
}

/** Hoja de opciones desde abajo. list: [{ label, danger?, run }] */
function openSheet(title, list) {
  sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-body">
    <p class="sheet-title">${esc(title)}</p>
    ${list.map((a, i) => `<button class="sheet-btn${a.danger ? ' danger' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}
    <button class="sheet-btn cancel" data-i="cancel">Cancelar</button>
  </div>`;
  sheet.onclick = (e) => {
    if (e.target === sheet) return closeSheet();
    const b = e.target.closest('[data-i]');
    if (!b) return;
    closeSheet();
    if (b.dataset.i !== 'cancel') list[Number(b.dataset.i)].run();
  };
  openDialog();
}

/** Confirmación en una hoja de la app (nunca window.confirm). Resuelve al tocar el botón. */
function ask(message, { ok = 'Aceptar', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (answer) => {
      if (settled) return;
      settled = true;
      closeSheet();
      resolve(answer);
    };
    sheet.className = 'sheet';
    sheet.innerHTML = `<div class="sheet-body">
      <p class="sheet-message">${esc(message)}</p>
      <button class="sheet-btn${danger ? ' danger' : ' primary'}" data-answer="yes">${esc(ok)}</button>
      <button class="sheet-btn cancel" data-answer="no">Cancelar</button>
    </div>`;
    sheet.onclick = (e) => {
      if (e.target === sheet) return done(false);
      const b = e.target.closest('[data-answer]');
      if (b) done(b.dataset.answer === 'yes');
    };
    if (sheet.open) sheet.close();
    sheet.showModal();
    sheet.onclose = () => !sheet.open && done(false);
  });
}

/** Pedir un texto (o un monto con amount: true). Devuelve el texto/número, o null si se canceló. */
function promptSheet(title, { value = '', placeholder = '', amount = false, ok = 'Guardar', hint = '' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (answer) => {
      if (settled) return;
      settled = true;
      closeSheet();
      resolve(answer);
    };
    sheet.className = 'sheet';
    sheet.innerHTML = `<form class="sheet-body">
      <p class="sheet-title">${esc(title)}</p>
      ${hint ? `<p class="sheet-hint">${esc(hint)}</p>` : ''}
      <input class="sheet-input${amount ? ' amount' : ''}" id="pinput" autocomplete="off" value="${esc(amount && value ? fmtNumber(value) : value)}"
        placeholder="${esc(placeholder)}" ${amount ? 'inputmode="numeric"' : 'autocapitalize="sentences"'} enterkeyhint="done">
      <button class="sheet-btn primary" type="submit">${esc(ok)}</button>
      <button class="sheet-btn cancel" type="button" data-answer="no">Cancelar</button>
    </form>`;
    const input = sheet.querySelector('#pinput');
    sheet.oninput = () => amount && formatAmountInput(input);
    sheet.onsubmit = (e) => {
      e.preventDefault();
      done(amount ? parseAmount(input.value) || 0 : input.value.trim());
    };
    sheet.onclick = (e) => {
      if (e.target === sheet || e.target.closest('[data-answer]')) done(null);
    };
    if (sheet.open) sheet.close();
    sheet.showModal();
    sheet.onclose = () => !sheet.open && done(null);
    input.focus();
  });
}

// ---------- Selector de categoría ----------

function catChip(c, selected) {
  return `<button type="button" class="chip-cat${c.id === selected ? ' on' : ''}" data-action="pick-cat" data-id="${c.id}">${catIcon(c, 'sm')}<span>${esc(c.name)}</span></button>`;
}

function categoryPicker(type, selected, query = '', suggested = null) {
  const q = normalizeText(query);
  const all = store.categoriesOf(type).filter((c) => !q || normalizeText(c.name).includes(q));
  let html = '';
  if (!q) {
    const sug = suggested && store.getCategory(suggested);
    if (sug) html += `<p class="label">${icon('sparkles')} Sugerida</p><div class="chip-grid">${catChip(sug, selected)}</div>`;
    const freq = store.frequentCategories(type).filter((c) => c.id !== suggested);
    if (freq.length) html += `<p class="label">Frecuentes</p><div class="chip-grid">${freq.map((c) => catChip(c, selected)).join('')}</div>`;
  }
  html += `<p class="label">${q ? 'Resultados' : type === 'ingreso' ? 'Ingresos' : 'Gastos'}</p>
    <div class="cat-list">${all
      .map(
        (c) => `<button type="button" class="cat-item${c.id === selected ? ' on' : ''}" data-action="pick-cat" data-id="${c.id}">
          ${catIcon(c)}<span>${esc(c.name)}</span>${c.id === selected ? icon('check') : ''}</button>`,
      )
      .join('')}
      <button type="button" class="cat-item add" data-action="cat-new">${icon('plus')}<span>Nueva categoría${q ? ` “${esc(query)}”` : ''}</span></button>
    </div>`;
  return html;
}

function nextColor() {
  const used = new Set(state.categories.map((c) => c.color));
  return COLORS.find((c) => !used.has(c)) || COLORS[state.categories.length % COLORS.length];
}

async function createCategoryQuick(type, name = '') {
  const n = await promptSheet('Nueva categoría', { value: name, placeholder: 'Nombre', ok: 'Crear' });
  if (!n) return null;
  const c = store.addCategory({ name: n.slice(0, 30), color: nextColor(), icon: 'tag', type });
  checkSave();
  return c;
}

/** Hoja con buscador. Resuelve con el id elegido, o undefined si se canceló. */
function pickCategory(type, selected, suggested = null) {
  return new Promise((resolve) => {
    let query = '';
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      closeSheet();
      resolve(v);
    };
    sheet.className = 'sheet';
    sheet.innerHTML = `<div class="sheet-body tall">
      <p class="sheet-title">Categoría</p>
      <label class="search">${icon('search')}<input id="pq" placeholder="Buscar categoría" autocomplete="off"></label>
      <div id="plist" class="picker">${categoryPicker(type, selected, '', suggested)}</div>
      <button class="sheet-btn cancel" data-action="cancel">Cancelar</button>
    </div>`;
    sheet.oninput = (e) => {
      if (e.target.id !== 'pq') return;
      query = e.target.value;
      sheet.querySelector('#plist').innerHTML = categoryPicker(type, selected, query, suggested);
    };
    sheet.onclick = async (e) => {
      if (e.target === sheet) return finish(undefined);
      const b = e.target.closest('[data-action]');
      if (!b) return;
      if (b.dataset.action === 'pick-cat') finish(b.dataset.id);
      else if (b.dataset.action === 'cancel') finish(undefined);
      else if (b.dataset.action === 'cat-new') {
        settled = true;
        closeSheet();
        const c = await createCategoryQuick(type, query);
        resolve(c ? c.id : undefined);
      }
    };
    if (sheet.open) sheet.close();
    sheet.showModal();
    sheet.onclose = () => !sheet.open && finish(undefined);
  });
}

// ---------- Inicio ----------

function safeToSpend(ym) {
  const dim = daysInMonth(ym);
  const left = dim - Number(todayStr().slice(8)) + 1;
  let amount;
  let basis;
  if (state.budgets.length) {
    const spent = store.spentByCategory(ym);
    amount = state.budgets.reduce((s, b) => s + Math.max(0, b.limit - (spent.get(b.categoryId) || 0)), 0);
    basis = 'Lo que queda de tus presupuestos';
  } else {
    amount = Math.max(0, store.totalsOf(ym).balance);
    basis = 'Tu balance del mes';
  }
  return { amount, perDay: amount / left, left, basis };
}

function renderHome() {
  const ym = viewMonth;
  const isCurrent = ym === store.currentMonth();
  const t = store.totalsOf(ym);
  const list = store.movementsOf(ym);
  const pending = store.duePending();
  const backupDays = store.backupReminderDays();
  const budgets = budgetRows(ym);
  const over = budgets.filter((b) => b.pct > 1);
  const unclassified = list.filter((m) => !m.categoryId).length;
  const avail = t.ingresos > 0 ? Math.max(0, t.balance / t.ingresos) : 0;
  const hide = state.settings.hideAmounts;
  const safe = isCurrent ? safeToSpend(ym) : null;

  const banners = [];
  if (pending.length)
    banners.push(`<button class="banner accent" data-action="to" data-to="/pendientes">${icon('inbox')}
      <span><b>Para confirmar (${pending.length})</b><small>Movimientos fijos vencidos</small></span>${icon('chev-right')}</button>`);
  if (over.length)
    banners.push(`<button class="banner danger" data-action="to" data-to="/analisis">${icon('alert')}
      <span><b>Te pasaste en ${esc(over.map((b) => b.c.name).join(', '))}</b><small>${over
        .map((b) => `${esc(b.c.name)}: ${pctText(b.pct)}`)
        .join(' · ')}</small></span>${icon('chev-right')}</button>`);
  if (unclassified)
    banners.push(`<button class="banner" data-action="to" data-to="/sin-clasificar">${icon('help')}
      <span><b>${unclassified} sin clasificar</b><small>Tocá para asignarles categoría</small></span>${icon('chev-right')}</button>`);
  if (backupDays)
    banners.push(`<div class="banner">${icon('download')}
      <span><b>Hace ${backupDays} días que no hacés backup</b><small>Los datos viven solo en este celular</small></span>
      <button class="btn sm" data-action="backup-now">Exportar</button>
      <button class="btn sm ghost" data-action="backup-later">Luego</button></div>`);

  const budgetSection = budgets.length
    ? `<section class="card pad">
        <div class="sec-head"><h2>Presupuestos</h2><button class="link" data-action="to" data-to="/analisis">Ver todo</button></div>
        ${budgets
          .slice(0, 5)
          .map(
            (b) => `<div class="hb-row">${catIcon(b.c, 'sm')}<div class="hb-main">
              <div class="hb-top"><span>${esc(b.c.name)}</span><span>${money(b.spent)} <small>/ ${money(b.limit)}</small></span></div>
              ${bar(b.pct)}</div></div>`,
          )
          .join('')}
      </section>`
    : `<button class="card pad hint-card" data-action="to" data-to="/analisis">${icon('pie')}
        <span><b>Poné un límite por categoría</b><small>Así la app te avisa si te estás pasando</small></span>${icon('chev-right')}</button>`;

  mount(
    `<div class="screen">
      <header class="home-top">
        <div class="brand">
          <span class="logo">${icon('trend')}</span>
          <div><h1 class="brand-title">Finanzas</h1>${monthNav()}</div>
        </div>
        <button class="icon-btn" data-action="toggle-hide" aria-label="${hide ? 'Mostrar' : 'Ocultar'} montos">${icon(hide ? 'eye-off' : 'eye')}</button>
      </header>
      <main class="content">
        ${banners.join('')}
        <section class="balance">
          <div class="bal-label">Balance del mes</div>
          <div class="bal-amount">${money(t.balance, t.balance < 0 ? '-' : '')}</div>
          <div class="bal-row"><span>DISPONIBLE</span><span>${t.ingresos ? pctText(avail) : '—'}</span></div>
          <div class="bal-bar"><i style="width:${(avail * 100).toFixed(1)}%"></i></div>
          <div class="bal-tiles">
            <div class="bal-tile"><small>${icon('arrow-up')} INGRESOS</small><b>${money(t.ingresos, '+')}</b></div>
            <div class="bal-tile"><small>${icon('arrow-down')} GASTOS</small><b>${money(t.gastos, '-')}</b></div>
          </div>
        </section>
        ${
          safe
            ? `<section class="card pad safe">
                <div class="safe-head">${icon('card')}<span>Seguro para gastar</span></div>
                <div class="safe-amount">${money(safe.amount)}</div>
                <small>${money(safe.perDay)} / día · ${safe.left} ${safe.left === 1 ? 'día restante' : 'días restantes'} · ${safe.basis}</small>
              </section>`
            : ''
        }
        ${budgetSection}
        <div class="row-links">
          <button class="link" data-action="to" data-to="/movimientos">Ver historial completo ${icon('chev-right')}</button>
          <button class="pill" data-action="to" data-to="/lote">${icon('sparkles')} Carga en lote</button>
        </div>
        ${
          list.length
            ? movementList(list.slice(0, 20))
            : `<div class="empty">${icon('inbox')}<p>${isCurrent ? 'Todavía no anotaste nada este mes.' : 'Sin movimientos este mes.'}</p><small>Tocá <b>Anotar</b> para empezar.</small></div>`
        }
      </main>
      ${fab(true)}
      ${tabbar('/')}
    </div>`,
    {
      'backup-now': () => exportBackup(),
      'backup-later': () => {
        store.setSetting('backupSnoozeUntil', addDays(todayStr(), 7));
        route(true);
      },
    },
  );
}

// ---------- Anotar: pasos (monto → descripción → categoría) y formulario ----------

function newDraft(o = {}) {
  return {
    step: 1, type: 'gasto', amount: 0, desc: '', categoryId: null, catManual: false, origCategoryId: null,
    date: todayStr(), tags: [], source: 'app', editId: null, recurringId: null, recurring: null,
    addAnother: false, query: '', fromSteps: false, ...o,
  };
}

function openNew(params, source) {
  if (!keepDraft || !draft) draft = newDraft({ type: params.get('tipo') === 'ingreso' ? 'ingreso' : 'gasto', source });
  keepDraft = false;
  renderDraft();
}

/** Monto que llega por URL desde el atajo: "4500", "4.500" o "4500.5" (punto decimal). */
function urlAmount(raw) {
  const s = String(raw || '').trim();
  return /^\d+\.\d{1,2}$/.test(s) ? Math.round(Number(s)) : parseAmount(s);
}

function openRapido(params) {
  const amount = urlAmount(params.get('monto'));
  if (amount > 0) {
    const type = params.get('tipo') === 'ingreso' ? 'ingreso' : 'gasto';
    const desc = (params.get('desc') || '').trim().slice(0, 80);
    // Se saca el monto de la URL para que al recargar no aparezca de nuevo.
    history.replaceState(null, '', '#/');
    currentHash = location.hash;
    renderHome();
    showQuickCard(newDraft({ type, amount, desc, source: 'rapido', categoryId: suggestCategory(desc, type, state) }));
    return;
  }
  openNew(params, 'rapido');
}

function openEdit(id) {
  const m = store.getMovement(id);
  if (!m) return navigate('/movimientos', { replace: true });
  draft = newDraft({
    step: 4, editId: m.id, type: m.type, amount: m.amount, desc: m.desc, categoryId: m.categoryId,
    origCategoryId: m.categoryId, catManual: true, date: m.date, tags: [...(m.tags || [])], source: m.source,
    recurringId: m.recurringId || null,
  });
  renderDraft();
}

function renderDraft() {
  if (draft.step === 1) return stepAmount();
  if (draft.step === 2) return stepDesc();
  if (draft.step === 3) return stepCategory();
  return draftForm();
}

const noun = () => (draft.type === 'ingreso' ? 'ingreso' : 'gasto');

function stepHeader() {
  const dots = [1, 2, 3].map((i) => `<i class="${i === draft.step ? 'on' : ''}"></i>`).join('');
  return `<header class="step-top">
    <button type="button" class="icon-btn" data-action="step-back" aria-label="Atrás" ${draft.step === 1 ? 'style="visibility:hidden"' : ''}>${icon('chev-left')}</button>
    <div class="dots">${dots}</div>
    <button type="button" class="icon-btn" data-action="close-draft" aria-label="Cerrar">${icon('x')}</button>
  </header>`;
}

const stepActions = {
  'step-back': () => {
    draft.step--;
    renderDraft();
  },
  'close-draft': () => {
    draft = null;
    goBack('/');
  },
};

function stepAmount() {
  const seg = (t, label) =>
    `<button type="button" class="seg-btn${draft.type === t ? ' on' : ''}" data-action="set-type" data-type="${t}">${label}</button>`;
  mount(
    `<form class="step">
      ${stepHeader()}
      <div class="seg center">${seg('gasto', 'Gasto')}${seg('ingreso', 'Ingreso')}</div>
      <h1 class="step-title">¿Cuánto?</h1>
      <p class="step-sub">Escribí el monto del ${noun()}</p>
      <label class="amount-box"><span>${esc(cur())}</span>
        <input id="amount" inputmode="numeric" autocomplete="off" enterkeyhint="next" placeholder="0" value="${draft.amount ? fmtNumber(draft.amount) : ''}"></label>
      <div class="step-actions"><button class="btn primary" type="submit" id="next" ${draft.amount > 0 ? '' : 'disabled'}>Continuar</button></div>
    </form>`,
    {
      ...stepActions,
      'set-type': (el) => {
        if (draft.type === el.dataset.type) return;
        draft.type = el.dataset.type;
        draft.categoryId = null;
        draft.catManual = false;
        stepAmount();
      },
    },
    {
      input: (e) => {
        if (e.target.id !== 'amount') return;
        draft.amount = formatAmountInput(e.target);
        root.querySelector('#next').disabled = !(draft.amount > 0);
      },
      submit: (e) => {
        e.preventDefault();
        if (!(draft.amount > 0)) return;
        draft.step = 2;
        renderDraft();
      },
    },
  );
  focusEnd('#amount');
}

function suggestionLine() {
  const id = suggestCategory(draft.desc, draft.type, state);
  if (!id) return draft.desc.trim() ? '<span class="muted-sm">Sin categoría sugerida: la elegís en el paso siguiente.</span>' : '';
  return `<span class="muted-sm">Categoría sugerida</span> ${catChip(catOf(id), id)}`;
}

function stepDesc() {
  const next = () => {
    if (!draft.catManual) draft.categoryId = suggestCategory(draft.desc, draft.type, state);
    draft.step = 3;
    draft.query = '';
    renderDraft();
  };
  mount(
    `<form class="step">
      ${stepHeader()}
      <h1 class="step-title">Describí el ${noun()}</h1>
      <p class="step-sub">${money(draft.amount, draft.type === 'ingreso' ? '+' : '-')}</p>
      <input class="big-input" id="desc" autocomplete="off" autocapitalize="sentences" enterkeyhint="next"
        placeholder="Ej: Café, Uber, Netflix" maxlength="80" value="${esc(draft.desc)}">
      <div class="suggest-line" id="sline">${suggestionLine()}</div>
      <div class="step-actions">
        <button class="btn primary" type="submit">Continuar</button>
        <button type="button" class="btn link" data-action="skip-desc">Omitir descripción</button>
      </div>
    </form>`,
    {
      ...stepActions,
      'skip-desc': () => {
        draft.desc = '';
        next();
      },
      'pick-cat': () => next(),
    },
    {
      input: (e) => {
        if (e.target.id !== 'desc') return;
        draft.desc = e.target.value;
        root.querySelector('#sline').innerHTML = suggestionLine();
      },
      submit: (e) => {
        e.preventDefault();
        next();
      },
    },
  );
  focusEnd('#desc');
}

function stepCategory() {
  const suggested = suggestCategory(draft.desc, draft.type, state);
  const toForm = () => {
    draft.step = 4;
    draft.fromSteps = true;
    renderDraft();
  };
  mount(
    `<div class="step">
      ${stepHeader()}
      <h1 class="step-title">¿En qué categoría?</h1>
      <label class="search">${icon('search')}<input id="catq" placeholder="Buscar categoría" autocomplete="off" value="${esc(draft.query)}"></label>
      <div id="catlist" class="picker">${categoryPicker(draft.type, draft.categoryId, draft.query, suggested)}</div>
      <div class="step-actions sticky"><button class="btn primary" data-action="cat-continue">${draft.categoryId ? 'Continuar' : 'Continuar sin categoría'}</button></div>
    </div>`,
    {
      ...stepActions,
      'pick-cat': (el) => {
        draft.categoryId = el.dataset.id;
        draft.catManual = el.dataset.id !== suggested;
        toForm();
      },
      'cat-new': async () => {
        const c = await createCategoryQuick(draft.type, draft.query);
        if (!c) return;
        draft.categoryId = c.id;
        draft.catManual = true;
        toForm();
      },
      'cat-continue': toForm,
    },
    {
      input: (e) => {
        if (e.target.id !== 'catq') return;
        draft.query = e.target.value;
        root.querySelector('#catlist').innerHTML = categoryPicker(draft.type, draft.categoryId, draft.query, suggested);
      },
    },
  );
}

function recFromDraft() {
  const dt = parseDate(draft.date);
  const every = draft.recurring.every;
  return { every, day: every === 'semanal' ? dt.getDay() : dt.getDate(), month: dt.getMonth() + 1 };
}

function recurringPanel() {
  if (!draft.recurring) return '';
  const r = draft.recurring;
  const seg = (e, label) =>
    `<button type="button" class="seg-btn${r.every === e ? ' on' : ''}" data-action="rec-every" data-every="${e}">${label}</button>`;
  return `<div class="rec-panel">
    <div class="seg">${seg('semanal', 'Semanal')}${seg('mensual', 'Mensual')}${seg('anual', 'Anual')}</div>
    <p class="muted-sm">${esc(fmtEvery(recFromDraft()))}. Cada vez se te pide confirmarlo.</p>
    <label class="check-row"><input type="checkbox" id="f-variable" ${r.variable ? 'checked' : ''}> El monto varía (se pide al confirmar)</label>
  </div>`;
}

function catRowHTML() {
  const c = catOf(draft.categoryId);
  return `<span class="field-label">Categoría</span>
    <span class="field-val">${catIcon(c, 'sm')}<b class="${draft.categoryId ? '' : 'warn-text'}">${esc(c.name)}</b></span>${icon('chev-right')}`;
}

function draftBudgetHTML() {
  if (draft.type !== 'gasto') return '';
  return budgetBox(draft.categoryId, monthOf(draft.date), draft.amount, draft.editId);
}

function tagsHTML() {
  return draft.tags
    .map((t, i) => `<button type="button" class="tag-chip" data-action="rm-tag" data-i="${i}">#${esc(t)} ${icon('x')}</button>`)
    .join('');
}

function draftForm() {
  const d = draft;
  const isEdit = !!d.editId;
  const title = isEdit ? 'Editar movimiento' : d.type === 'ingreso' ? 'Nuevo ingreso' : 'Nuevo gasto';
  const fijo = d.recurringId && store.getRecurring(d.recurringId);
  const seg = (t, label) =>
    `<button type="button" class="seg-btn${d.type === t ? ' on' : ''}" data-action="f-type" data-type="${t}">${label}</button>`;

  const updateBits = () => {
    root.querySelector('#f-catrow').innerHTML = catRowHTML();
    root.querySelector('#f-budget').innerHTML = draftBudgetHTML();
  };
  const addTag = (input) => {
    const t = input.value.replace(/[#,]/g, '').trim().slice(0, 24);
    input.value = '';
    if (!t || d.tags.includes(t)) return;
    d.tags.push(t);
    root.querySelector('#f-tags-list').innerHTML = tagsHTML();
  };

  mount(
    `<div class="screen form-screen">
      <header class="topbar">
        <button class="icon-btn" data-action="form-back" aria-label="Atrás">${icon('chev-left')}</button>
        <h1 class="topbar-title">${title}</h1>
        <div class="topbar-right">${isEdit ? `<button class="icon-btn danger" data-action="delete-mov" aria-label="Borrar">${icon('trash')}</button>` : ''}</div>
      </header>
      <div class="content">
        <div class="seg center">${seg('gasto', 'Gasto')}${seg('ingreso', 'Ingreso')}</div>
        <label class="hero-amount ${d.type}"><span>${esc(cur())}</span>
          <input id="f-amount" inputmode="numeric" autocomplete="off" value="${d.amount ? fmtNumber(d.amount) : ''}" placeholder="0"></label>
        <label class="date-chip">${icon('calendar')}<span id="f-date-label">${fmtDateLong(d.date)}</span>${icon('chev-down')}
          <input type="date" id="f-date" value="${d.date}" aria-label="Fecha"></label>
        <div class="field">
          <label for="f-desc" class="field-label">Descripción <em>(opcional)</em></label>
          <input id="f-desc" autocomplete="off" autocapitalize="sentences" maxlength="80" value="${esc(d.desc)}" placeholder="Ej: Café">
        </div>
        <button class="field-row" id="f-catrow" data-action="form-cat">${catRowHTML()}</button>
        <div id="f-budget">${draftBudgetHTML()}</div>
        <div class="field">
          <span class="field-label">Etiquetas <em>(opcional)</em></span>
          <div class="tags-edit"><span id="f-tags-list">${tagsHTML()}</span>
            <input id="f-tag" placeholder="+ etiqueta" list="taglist" autocomplete="off" enterkeyhint="done" maxlength="24"></div>
          <datalist id="taglist">${store.allTags().map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        </div>
        ${
          fijo
            ? `<p class="note">${icon('repeat')} Viene del fijo “${esc(fijo.name)}”</p>`
            : isEdit
              ? ''
              : `<button class="pill-btn${d.recurring ? ' on' : ''}" data-action="toggle-rec">${icon('repeat')} Hacer recurrente</button>
                 <div id="f-rec">${recurringPanel()}</div>`
        }
      </div>
      <div class="form-foot">
        ${
          isEdit
            ? ''
            : `<label class="switch-row"><span>Guardar y agregar otro</span>
                <input type="checkbox" id="f-another" ${d.addAnother ? 'checked' : ''}><i class="switch" aria-hidden="true"></i></label>`
        }
        <button class="btn primary" data-action="save-draft">Guardar</button>
      </div>
    </div>`,
    {
      'form-back': () => {
        if (d.editId) return goBack('/movimientos');
        if (d.fromSteps) {
          d.step = 3;
          return renderDraft();
        }
        draft = null;
        goBack('/');
      },
      'f-type': (el) => {
        if (d.type === el.dataset.type) return;
        d.type = el.dataset.type;
        d.categoryId = suggestCategory(d.desc, d.type, state);
        d.catManual = false;
        draftForm();
      },
      'form-cat': async () => {
        const id = await pickCategory(d.type, d.categoryId, suggestCategory(d.desc, d.type, state));
        if (id === undefined) return;
        d.categoryId = id;
        d.catManual = true;
        updateBits();
      },
      'rm-tag': (el) => {
        d.tags.splice(Number(el.dataset.i), 1);
        root.querySelector('#f-tags-list').innerHTML = tagsHTML();
      },
      'toggle-rec': (el) => {
        d.recurring = d.recurring ? null : { every: 'mensual', variable: false };
        el.classList.toggle('on', !!d.recurring);
        root.querySelector('#f-rec').innerHTML = recurringPanel();
      },
      'rec-every': (el) => {
        d.recurring.every = el.dataset.every;
        root.querySelector('#f-rec').innerHTML = recurringPanel();
      },
      'delete-mov': async () => {
        if (!(await ask('¿Borrar este movimiento?', { ok: 'Borrar', danger: true }))) return;
        store.deleteMovement(d.editId);
        checkSave();
        draft = null;
        toast('Movimiento borrado');
        goBack('/movimientos');
      },
      'save-draft': saveDraft,
    },
    {
      input: (e) => {
        const id = e.target.id;
        if (id === 'f-amount') {
          d.amount = formatAmountInput(e.target);
          root.querySelector('#f-budget').innerHTML = draftBudgetHTML();
        } else if (id === 'f-desc') {
          d.desc = e.target.value;
          if (!d.catManual) {
            d.categoryId = suggestCategory(d.desc, d.type, state);
            updateBits();
          }
        } else if (id === 'f-tag' && /,$/.test(e.target.value)) addTag(e.target);
      },
      change: (e) => {
        const id = e.target.id;
        if (id === 'f-date' && e.target.value) {
          d.date = e.target.value;
          root.querySelector('#f-date-label').textContent = fmtDateLong(d.date);
          root.querySelector('#f-budget').innerHTML = draftBudgetHTML();
          if (d.recurring) root.querySelector('#f-rec').innerHTML = recurringPanel();
        } else if (id === 'f-another') d.addAnother = e.target.checked;
        else if (id === 'f-variable') d.recurring.variable = e.target.checked;
        else if (id === 'f-tag') addTag(e.target);
      },
      keydown: (e) => {
        if (e.target.id === 'f-tag' && e.key === 'Enter') {
          e.preventDefault();
          addTag(e.target);
        } else if (e.key === 'Enter' && (e.target.id === 'f-amount' || e.target.id === 'f-desc')) {
          e.preventDefault();
          e.target.blur();
        }
      },
    },
  );
  if (!d.amount) focusEnd('#f-amount');
}

function saveDraft() {
  const d = draft;
  const tagInput = root.querySelector('#f-tag');
  if (tagInput && tagInput.value.trim()) {
    const t = tagInput.value.replace(/[#,]/g, '').trim();
    if (t && !d.tags.includes(t)) d.tags.push(t);
  }
  if (!(d.amount > 0)) {
    toast('Falta el monto');
    return focusEnd('#f-amount');
  }
  const desc = d.desc.trim();
  const changed = d.editId ? d.categoryId !== d.origCategoryId : d.catManual;
  if (changed && desc && d.categoryId && d.categoryId !== suggestCategory(desc, d.type, state)) store.learnRule(desc, d.categoryId);

  const data = { type: d.type, amount: d.amount, date: d.date, desc, categoryId: d.categoryId, tags: d.tags };
  let m;
  if (d.editId) {
    store.updateMovement(d.editId, data);
    m = store.getMovement(d.editId);
  } else {
    if (d.recurring) {
      const f = store.addRecurring(
        {
          name: desc || catOf(d.categoryId).name, type: d.type, amount: d.amount, variable: d.recurring.variable,
          categoryId: d.categoryId, ...recFromDraft(),
        },
        addDays(d.date, 1),
      );
      data.recurringId = f.id;
    }
    m = store.addMovement({ ...data, source: d.source });
  }
  checkSave();
  const alert = budgetAlert(m);
  celebrate(d.editId ? 'Guardado' : d.type === 'ingreso' ? '¡Ingreso anotado!' : '¡Gasto anotado!', alert);

  if (d.editId) {
    draft = null;
    return goBack('/movimientos');
  }
  if (d.addAnother) {
    draft = newDraft({ type: d.type, source: d.source, addAnother: true });
    return renderDraft();
  }
  draft = null;
  if (d.source === 'rapido') return renderRapidoDone(m);
  goBack('/');
}

/** Después de anotar desde el atajo: confirmación y listo para volver a lo que se estaba haciendo. */
function renderRapidoDone(m) {
  const c = catOf(m.categoryId);
  mount(
    `<div class="step done-screen">
      <div class="done-ico">${icon('check')}</div>
      <h1 class="step-title">Listo, anotado</h1>
      <p class="done-amt ${m.type}">${signed(m)}</p>
      <p class="muted">${esc(m.desc || c.name)} · ${esc(c.name)}</p>
      ${m.type === 'gasto' ? budgetBox(m.categoryId, monthOf(m.date)) : ''}
      <p class="muted-sm center">Ya podés volver a lo que estabas haciendo.</p>
      <div class="step-actions">
        <button class="btn primary" data-action="again">Anotar otro</button>
        <button class="btn secondary" data-action="tab" data-to="/">Ir al inicio</button>
      </div>
    </div>`,
    {
      again: () => {
        draft = newDraft({ source: 'rapido' });
        renderDraft();
      },
    },
  );
}

/** Tarjeta de "Gasto rápido" cuando el atajo abre la app con monto y descripción. */
function showQuickCard(d) {
  const c = catOf(d.categoryId);
  sheet.className = 'sheet center';
  sheet.innerHTML = `<div class="qcard" tabindex="-1" autofocus>
    <div class="q-head"><span>${icon('bolt')} ${d.type === 'ingreso' ? 'INGRESO' : 'GASTO'} RÁPIDO</span>
      <button class="icon-btn sm" data-q="close" aria-label="Cerrar">${icon('x')}</button></div>
    <button class="q-cat" data-q="cat">${catIcon(c)}
      <span><b>${esc(d.desc || c.name)}</b><small class="${d.categoryId ? '' : 'warn-text'}">${esc(c.name)} ›</small></span>${icon('edit')}</button>
    <div class="q-amount ${d.type}">${d.type === 'ingreso' ? '+' : '-'}${esc(cur())} ${fmtNumber(d.amount)}</div>
    ${d.type === 'gasto' ? budgetBox(d.categoryId, monthOf(d.date), d.amount) : ''}
    <button class="btn primary" data-q="save">Agregar ${d.type}</button>
    <button class="btn link" data-q="edit">Editar</button>
  </div>`;
  sheet.onclick = async (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    const q = b.dataset.q;
    if (q === 'close') closeSheet();
    else if (q === 'cat') {
      const id = await pickCategory(d.type, d.categoryId, suggestCategory(d.desc, d.type, state));
      if (id !== undefined) {
        d.categoryId = id;
        d.catManual = true;
      }
      showQuickCard(d);
    } else if (q === 'save') {
      closeSheet();
      if (d.catManual && d.desc && d.categoryId) store.learnRule(d.desc, d.categoryId);
      const m = store.addMovement({ type: d.type, amount: d.amount, date: d.date, desc: d.desc, categoryId: d.categoryId, source: 'rapido' });
      checkSave();
      celebrate(d.type === 'ingreso' ? '¡Ingreso anotado!' : '¡Gasto anotado!', budgetAlert(m));
      renderHome();
    } else if (q === 'edit') {
      closeSheet();
      draft = { ...d, step: 4 };
      keepDraft = true;
      navigate('/rapido');
    }
  };
  if (!sheet.open) sheet.showModal();
}

// ---------- Movimientos (historial) ----------

function historyList() {
  const q = normalizeText(histFilter.q);
  const list = store.movementsOf(viewMonth).filter(
    (m) =>
      (!histFilter.cat || (histFilter.cat === '__none' ? !m.categoryId : m.categoryId === histFilter.cat)) &&
      (!histFilter.tag || (m.tags || []).includes(histFilter.tag)) &&
      (!q || normalizeText(`${m.desc} ${catOf(m.categoryId).name} ${(m.tags || []).join(' ')}`).includes(q)),
  );
  if (!list.length) return `<div class="empty">${icon('search')}<p>No hay movimientos${histFilter.q || histFilter.cat || histFilter.tag ? ' con ese filtro' : ' este mes'}.</p></div>`;
  let g = 0;
  let i = 0;
  for (const m of list) m.type === 'ingreso' ? (i += m.amount) : (g += m.amount);
  return `<p class="summary-line">${list.length} ${list.length === 1 ? 'movimiento' : 'movimientos'} · <span class="neg">${money(g, '-')}</span> · <span class="pos">${money(i, '+')}</span></p>
    ${movementList(list)}`;
}

function renderHistory() {
  const opt = (v, label, sel) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(label)}</option>`;
  const catOptions = ['gasto', 'ingreso']
    .map((t) => `<optgroup label="${t === 'gasto' ? 'Gastos' : 'Ingresos'}">${store.categoriesOf(t).map((c) => opt(c.id, c.name, histFilter.cat)).join('')}</optgroup>`)
    .join('');
  mount(
    `<div class="screen">
      <header class="topbar main"><h1 class="brand-title">Movimientos</h1>${monthNav()}</header>
      <main class="content">
        <label class="search">${icon('search')}<input id="hq" placeholder="Buscar" autocomplete="off" value="${esc(histFilter.q)}"></label>
        <div class="filters">
          <select id="hcat" aria-label="Categoría">${opt('', 'Todas las categorías', histFilter.cat)}${opt('__none', 'Sin clasificar', histFilter.cat)}${catOptions}</select>
          <select id="htag" aria-label="Etiqueta">${opt('', 'Todas las etiquetas', histFilter.tag)}${store.allTags().map((t) => opt(t, '#' + t, histFilter.tag)).join('')}</select>
        </div>
        <div id="hlist">${historyList()}</div>
      </main>
      ${fab()}
      ${tabbar('/movimientos')}
    </div>`,
    {},
    {
      input: (e) => {
        if (e.target.id !== 'hq') return;
        histFilter.q = e.target.value;
        root.querySelector('#hlist').innerHTML = historyList();
      },
      change: (e) => {
        if (e.target.id === 'hcat') histFilter.cat = e.target.value;
        else if (e.target.id === 'htag') histFilter.tag = e.target.value;
        else return;
        root.querySelector('#hlist').innerHTML = historyList();
      },
    },
  );
}

// ---------- Análisis: presupuestos e insights ----------

function renderInsights() {
  const ym = viewMonth;
  const nowYm = store.currentMonth();
  const isCurrent = ym === nowYm;
  const prev = addMonths(ym, -1);
  const dim = daysInMonth(ym);
  const elapsed = isCurrent ? Number(todayStr().slice(8)) : ym < nowYm ? dim : 0;
  const t = store.totalsOf(ym);
  const spent = store.spentByCategory(ym);
  const spentPrev = store.spentByCategory(prev);
  const proj = (x) => (elapsed ? Math.round((x / elapsed) * dim) : 0);

  // Comparación con el mes anterior (en el mes actual, hasta el mismo día).
  let prevGastos = 0;
  for (const m of state.movements) {
    if (m.type !== 'gasto' || !m.date.startsWith(prev)) continue;
    if (!isCurrent || Number(m.date.slice(8)) <= elapsed) prevGastos += m.amount;
  }
  const prevName = MONTHS[Number(prev.slice(5)) - 1];
  let compare = '';
  if (prevGastos > 0 && t.gastos > 0) {
    const diff = t.gastos / prevGastos - 1;
    const more = diff > 0;
    compare = `<p class="compare ${more ? 'neg' : 'pos'}">${icon(more ? 'arrow-up' : 'arrow-down')}
      ${Math.abs(Math.round(diff * 100))} % ${more ? 'más' : 'menos'} que ${isCurrent ? `a esta altura de ${prevName}` : `en ${prevName}`}</p>`;
  }

  const totalLimit = state.budgets.reduce((s, b) => s + b.limit, 0);
  const projTotal = proj(t.gastos);
  const projCard =
    isCurrent && t.gastos > 0
      ? `<section class="card pad">
          <div class="sec-head"><h2>Proyección de fin de mes</h2></div>
          <div class="proj">
            <div><small>Si seguís a este ritmo</small><b class="${totalLimit && projTotal > totalLimit ? 'neg' : ''}">${money(projTotal)}</b></div>
            ${totalLimit ? `<div><small>Límite total</small><b>${money(totalLimit)}</b></div>` : ''}
          </div>
          ${totalLimit ? bar(projTotal / totalLimit) : ''}
          <p class="muted-sm">${money(t.gastos)} en ${elapsed} ${elapsed === 1 ? 'día' : 'días'} ÷ ${elapsed} × ${dim} días del mes</p>
        </section>`
      : '';

  const cats = store.categoriesOf('gasto');
  const withLimit = cats
    .filter((c) => store.getBudget(c.id))
    .map((c) => ({ c, s: spent.get(c.id) || 0, l: store.getBudget(c.id) }))
    .sort((a, b) => b.s / b.l - a.s / a.l);
  const noLimit = cats.filter((c) => !store.getBudget(c.id));

  const budgetHTML = `<section class="card pad">
    <div class="sec-head"><h2>Presupuestos</h2><small class="muted-sm">Tocá una categoría para cambiar su límite</small></div>
    ${withLimit
      .map(({ c, s, l }) => {
        const p = s / l;
        const pc = proj(s);
        return `<button class="bud-row" data-action="set-budget" data-id="${c.id}">
          <div class="bud-top">${catIcon(c, 'sm')}<b>${esc(c.name)}</b><span>${money(s)} <small>/ ${money(l)}</small></span></div>
          ${bar(p)}
          <div class="bud-foot"><span class="t-${tone(p)}">${pctText(p)}</span>${
            isCurrent && s ? `<span class="${pc > l ? 'neg' : ''}">Proyección ${money(pc)}</span>` : ''
          }</div>
        </button>`;
      })
      .join('')}
    ${
      noLimit.length
        ? `<p class="label">Sin límite</p><div class="chip-grid">${noLimit
            .map((c) => `<button class="chip-cat" data-action="set-budget" data-id="${c.id}">${catIcon(c, 'sm')}<span>${esc(c.name)}</span>${icon('plus')}</button>`)
            .join('')}</div>`
        : ''
    }
  </section>`;

  const ranked = [...spent.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const top = ranked[0]?.[1] || 1;
  const rankHTML = ranked.length
    ? `<section class="card pad">
        <div class="sec-head"><h2>En qué se fue la plata</h2></div>
        ${ranked
          .map(([id, v]) => {
            const c = catOf(id);
            const pv = spentPrev.get(id) || 0;
            const delta = pv ? v / pv - 1 : null;
            return `<div class="rank-row">
              ${catIcon(c, 'sm')}
              <div class="rank-main">
                <div class="rank-top"><span>${esc(c.name)}</span><b>${money(v)}</b></div>
                <div class="rank-bar"><i style="width:${((v / top) * 100).toFixed(1)}%;background:${c.color}"></i></div>
                <small>${pctText(v / (t.gastos || 1))} del gasto${
                  delta === null ? '' : ` · <span class="${delta > 0 ? 'neg' : 'pos'}">${delta > 0 ? '+' : ''}${Math.round(delta * 100)} % vs ${prevName}</span>`
                }</small>
              </div>
            </div>`;
          })
          .join('')}
      </section>`
    : '';

  mount(
    `<div class="screen">
      <header class="topbar main"><h1 class="brand-title">Análisis</h1>${monthNav()}</header>
      <main class="content">
        <div class="tiles3">
          <div class="tile3"><small>Gastado</small><b>${money(t.gastos)}</b></div>
          <div class="tile3"><small>Ingresado</small><b>${money(t.ingresos)}</b></div>
          <div class="tile3"><small>Balance</small><b class="${t.balance < 0 ? 'neg' : 'pos'}">${money(t.balance, t.balance < 0 ? '-' : '')}</b></div>
        </div>
        ${compare}
        ${projCard}
        ${budgetHTML}
        ${rankHTML}
      </main>
      ${fab()}
      ${tabbar('/analisis')}
    </div>`,
    {
      'set-budget': async (el) => {
        const c = catOf(el.dataset.id);
        const current = store.getBudget(c.id);
        const v = await promptSheet(`Límite mensual de ${c.name}`, {
          value: current || '', amount: true, placeholder: '0', hint: 'Dejalo vacío para quitar el límite.',
        });
        if (v === null) return;
        store.setBudget(c.id, v);
        checkSave();
        toast(v > 0 ? `Límite de ${c.name}: ${cur()} ${fmtNumber(v)}` : `${c.name} sin límite`);
        route(true);
      },
    },
  );
}

// ---------- Carga en lote ----------

function batchItemHTML(it, i) {
  const c = catOf(it.categoryId);
  return `<div class="batch-item${it.categoryId ? '' : ' unclassified'}" data-i="${i}">
    <button class="bi-ico" data-action="b-cat" data-i="${i}" id="bico-${i}">${catIcon(c)}</button>
    <div class="bi-main">
      <input class="bi-desc" data-i="${i}" value="${esc(it.desc)}" placeholder="Descripción" autocomplete="off">
      <button class="bi-cat" data-action="b-cat" data-i="${i}" id="bcat-${i}" style="--c:${c.color}">${esc(c.name)} ${icon('chev-down')}</button>
      <label class="bi-date">${icon('calendar')}<span>${fmtDateShort(it.date)}</span><input type="date" data-i="${i}" class="bi-date-in" value="${it.date}"></label>
    </div>
    <div class="bi-side">
      <div class="bi-amt ${it.type}">
        <button class="bi-sign" data-action="b-type" data-i="${i}" aria-label="Cambiar gasto/ingreso">${it.type === 'ingreso' ? '+' : '-'}</button>
        <input class="bi-amount" data-i="${i}" inputmode="numeric" value="${fmtNumber(it.amount)}">
      </div>
      <button class="icon-btn sm" data-action="b-del" data-i="${i}" aria-label="Quitar">${icon('trash')}</button>
    </div>
  </div>`;
}

function batchTotalHTML() {
  const net = batch.items.reduce((s, it) => s + (it.type === 'ingreso' ? it.amount : -it.amount), 0);
  const unc = batch.items.filter((it) => !it.categoryId).length;
  return `<small>TOTAL DEL LOTE · ${batch.items.length} ${batch.items.length === 1 ? 'movimiento' : 'movimientos'}</small>
    <b>${money(net, net < 0 ? '-' : '+')}</b>
    ${unc ? `<span class="warn-text">${unc} sin clasificar</span>` : ''}`;
}

function renderBatch() {
  if (!batch) batch = { text: '', source: 'lote' };
  if (!batch.items) return batchInput();
  return batchPreview();
}

function batchInput() {
  mount(
    `<div class="screen">
      ${topbar(`${icon('sparkles')} Carga en lote`, { back: '/' })}
      <main class="content">
        <p class="muted">Un movimiento por línea: <b>descripción y monto</b>. Con <b>+</b> delante del monto es un ingreso. La fecha al principio es opcional (<b>12/03</b>).</p>
        <textarea id="btext" class="batch-text" rows="9" autocapitalize="sentences"
          placeholder="Almuerzo 50.000&#10;Taxi 20.000&#10;Café 8.500&#10;Sueldo +1.500.000&#10;12/09 Farmacia 12.300">${esc(batch.text)}</textarea>
        <div id="bproc"></div>
        <button class="btn primary" data-action="process">${icon('sparkles')} Procesar</button>
      </main>
    </div>`,
    {
      process: () => {
        const text = root.querySelector('#btext').value;
        batch.text = text;
        const { items, errors } = parseBatch(text);
        if (!items.length) {
          toast(errors.length ? 'No encontré montos en esas líneas' : 'Escribí al menos un movimiento');
          return;
        }
        batch.items = items.map((it) => {
          const s = suggestCategory(it.desc, it.type, state);
          return { ...it, categoryId: s, suggested: s, catManual: false };
        });
        batch.errors = errors;
        processingAnimation(() => route(true));
      },
    },
    { input: (e) => e.target.id === 'btext' && (batch.text = e.target.value) },
  );
}

function processingAnimation(then) {
  const box = root.querySelector('#bproc');
  box.innerHTML = `<div class="processing"><span class="spinner"></span><p>Procesando…</p><div class="proc-bar"><i></i></div></div>`;
  root.querySelector('[data-action="process"]').disabled = true;
  setTimeout(then, 700);
}

function batchPreview() {
  const refreshItem = (i) => {
    const el = root.querySelector(`.batch-item[data-i="${i}"]`);
    const it = batch.items[i];
    const c = catOf(it.categoryId);
    el.classList.toggle('unclassified', !it.categoryId);
    root.querySelector(`#bico-${i}`).innerHTML = catIcon(c);
    const chip = root.querySelector(`#bcat-${i}`);
    chip.style.setProperty('--c', c.color);
    chip.innerHTML = `${esc(c.name)} ${icon('chev-down')}`;
    root.querySelector('#btotal').innerHTML = batchTotalHTML();
  };
  mount(
    `<div class="screen form-screen">
      ${topbar(`${icon('sparkles')} Carga en lote`, { back: '/' })}
      <main class="content">
        <div class="card pad batch-total" id="btotal">${batchTotalHTML()}</div>
        <p class="info-line">${icon('info')} Confirmá las categorías antes de guardar.</p>
        ${
          batch.errors?.length
            ? `<div class="card pad warn-card"><b>No entendí ${batch.errors.length === 1 ? 'esta línea' : 'estas líneas'}</b>${batch.errors
                .map((l) => `<code>${esc(l)}</code>`)
                .join('')}</div>`
            : ''
        }
        <div id="bitems">${batch.items.map(batchItemHTML).join('')}</div>
      </main>
      <div class="form-foot">
        <button class="btn primary" data-action="b-save" ${batch.items.length ? '' : 'disabled'}>Guardar ${batch.items.length || ''}</button>
        <button class="btn link" data-action="b-cancel">Cancelar</button>
      </div>
    </div>`,
    {
      'b-cat': async (el) => {
        const i = Number(el.dataset.i);
        const it = batch.items[i];
        const id = await pickCategory(it.type, it.categoryId, it.suggested);
        if (id === undefined) return;
        it.categoryId = id;
        it.catManual = true;
        refreshItem(i);
      },
      'b-type': (el) => {
        const it = batch.items[Number(el.dataset.i)];
        it.type = it.type === 'ingreso' ? 'gasto' : 'ingreso';
        it.suggested = suggestCategory(it.desc, it.type, state);
        it.categoryId = it.suggested;
        it.catManual = false;
        route(true);
      },
      'b-del': (el) => {
        batch.items.splice(Number(el.dataset.i), 1);
        if (!batch.items.length) {
          batch.items = null;
          return route(true);
        }
        route(true);
      },
      'b-cancel': () => {
        batch.items = null;
        if (batch.importMark) batch = null;
        route(true);
      },
      'b-save': () => {
        batch.items = batch.items.filter((it) => it.amount > 0);
        if (!batch.items.length) return toast('No hay montos para guardar');
        for (const it of batch.items) {
          if (it.catManual && it.desc && it.categoryId && it.categoryId !== suggestCategory(it.desc, it.type, state)) {
            store.learnRule(it.desc, it.categoryId);
          }
        }
        const saved = store.addMovements(
          batch.items.map((it) => ({
            type: it.type, amount: it.amount, date: it.date, desc: it.desc, categoryId: it.categoryId, tags: [], source: batch.source,
          })),
        );
        if (batch.importMark) store.setSetting('lastImport', batch.importMark);
        checkSave();
        const alert = saved.map(budgetAlert).find(Boolean);
        celebrate(`${saved.length} ${saved.length === 1 ? 'movimiento anotado' : 'movimientos anotados'}`, alert);
        batch = null;
        depth = 0;
        navigate('/', { replace: true });
      },
    },
    {
      input: (e) => {
        const i = Number(e.target.dataset.i);
        const it = batch.items[i];
        if (!it) return;
        if (e.target.classList.contains('bi-desc')) {
          it.desc = e.target.value;
          it.suggested = suggestCategory(it.desc, it.type, state);
          if (!it.catManual) {
            it.categoryId = it.suggested;
            refreshItem(i);
          }
        } else if (e.target.classList.contains('bi-amount')) {
          it.amount = formatAmountInput(e.target);
          root.querySelector('#btotal').innerHTML = batchTotalHTML();
        }
      },
      change: (e) => {
        if (!e.target.classList.contains('bi-date-in') || !e.target.value) return;
        const it = batch.items[Number(e.target.dataset.i)];
        it.date = e.target.value;
        e.target.previousElementSibling.textContent = fmtDateShort(it.date);
      },
    },
  );
}

// ---------- Movimientos fijos ----------

function occurrencesIn(f, ym) {
  const out = [];
  let d = occurrenceOnOrAfter(f, `${ym}-01`);
  while (d.startsWith(ym) && out.length < 6) {
    out.push(d);
    d = occurrenceOnOrAfter(f, addDays(d, 1));
  }
  return out;
}

function renderRecurring() {
  const list = [...state.recurring].sort((a, b) => b.active - a.active || a.nextDate.localeCompare(b.nextDate));
  const due = store.duePending().length;
  const nextYm = addMonths(store.currentMonth(), 1);
  const upcoming = state.recurring
    .filter((f) => f.active)
    .flatMap((f) => occurrencesIn(f, nextYm).map((date) => ({ f, date })))
    .sort((a, b) => a.date.localeCompare(b.date));
  let upG = 0;
  let upI = 0;
  for (const u of upcoming) if (!u.f.variable) u.f.type === 'ingreso' ? (upI += u.f.amount) : (upG += u.f.amount);

  mount(
    `<div class="screen">
      ${topbar('Movimientos fijos', { back: '/ajustes', right: `<button class="icon-btn" data-action="to" data-to="/fijo/nuevo" aria-label="Nuevo fijo">${icon('plus')}</button>` })}
      <main class="content">
        ${due ? `<button class="banner accent" data-action="to" data-to="/pendientes">${icon('inbox')}<span><b>Para confirmar (${due})</b><small>Revisalos y confirmalos</small></span>${icon('chev-right')}</button>` : ''}
        <p class="muted">Nunca se anotan solos: cuando vencen aparecen en <b>Para confirmar</b>.</p>
        ${
          list.length
            ? `<div class="card list">${list
                .map((f) => {
                  const c = catOf(f.categoryId);
                  return `<div class="fx-row${f.active ? '' : ' paused'}">
                    <button class="fx-main" data-action="to" data-to="/fijo/${f.id}">${catIcon(c)}
                      <span class="mov-main"><b>${esc(f.name)}</b><small>${esc(fmtEvery(f))} · ${f.active ? `Próximo: ${esc(fmtDay(f.nextDate))}` : 'En pausa'}</small></span>
                      <span class="mov-amt ${f.type}">${f.variable ? 'Varía' : money(f.amount, f.type === 'ingreso' ? '+' : '-')}</span>
                    </button>
                    <button class="icon-btn sm" data-action="fx-toggle" data-id="${f.id}" aria-label="${f.active ? 'Pausar' : 'Reanudar'}">${icon(f.active ? 'pause' : 'play')}</button>
                  </div>`;
                })
                .join('')}</div>`
            : `<div class="empty">${icon('repeat')}<p>No tenés movimientos fijos.</p><small>Sumá el alquiler, el sueldo o Netflix para no cargarlos a mano.</small>
                <button class="btn primary" data-action="to" data-to="/fijo/nuevo">Nuevo fijo</button></div>`
        }
        ${
          upcoming.length
            ? `<section class="card pad">
                <div class="sec-head"><h2>${esc(fmtMonth(nextYm))}</h2><small class="muted-sm">${money(upG, '-')} · ${money(upI, '+')}</small></div>
                ${upcoming
                  .map(
                    ({ f, date }) => `<div class="up-row"><span class="up-date">${parseDate(date).getDate()}</span>
                    <span>${esc(f.name)}</span><span class="mov-amt ${f.type}">${f.variable ? 'Varía' : money(f.amount, f.type === 'ingreso' ? '+' : '-')}</span></div>`,
                  )
                  .join('')}
              </section>`
            : ''
        }
      </main>
    </div>`,
    {
      'fx-toggle': (el) => {
        const f = store.getRecurring(el.dataset.id);
        store.updateRecurring(f.id, { active: !f.active });
        checkSave();
        toast(f.active ? `${f.name} reanudado` : `${f.name} en pausa`);
        route(true);
      },
    },
  );
}

function renderRecurringForm(id) {
  const existing = id && id !== 'nuevo' ? store.getRecurring(id) : null;
  if (id !== 'nuevo' && !existing) return navigate('/fijos', { replace: true });
  if (!fdraft || fdraft.id !== (existing?.id || null)) {
    const today = parseDate(todayStr());
    fdraft = existing
      ? { ...existing }
      : { id: null, name: '', type: 'gasto', amount: 0, variable: false, categoryId: null, every: 'mensual', day: today.getDate(), month: today.getMonth() + 1, active: true };
  }
  const f = fdraft;
  const c = catOf(f.categoryId);
  const seg = (key, val, label) =>
    `<button type="button" class="seg-btn${f[key] === val ? ' on' : ''}" data-action="fx-set" data-key="${key}" data-val="${val}">${label}</button>`;
  const opts = (n, from, sel, label = (x) => x) =>
    Array.from({ length: n }, (_, i) => i + from)
      .map((x) => `<option value="${x}"${x === Number(sel) ? ' selected' : ''}>${label(x)}</option>`)
      .join('');
  let dayField;
  if (f.every === 'semanal') dayField = `<select id="fx-day">${[1, 2, 3, 4, 5, 6, 0].map((x) => `<option value="${x}"${x === Number(f.day) ? ' selected' : ''}>${WEEKDAYS[x]}</option>`).join('')}</select>`;
  else if (f.every === 'anual')
    dayField = `<div class="two"><select id="fx-day">${opts(31, 1, f.day)}</select><select id="fx-month">${opts(12, 1, f.month, (x) => MONTHS[x - 1])}</select></div>`;
  else dayField = `<select id="fx-day">${opts(31, 1, Math.min(f.day, 31), (x) => `Día ${x}`)}</select>`;

  mount(
    `<div class="screen form-screen">
      ${topbar(existing ? 'Editar fijo' : 'Nuevo fijo', { back: '/fijos' })}
      <main class="content">
        <div class="field"><label class="field-label" for="fx-name">Nombre</label>
          <input id="fx-name" value="${esc(f.name)}" placeholder="Ej: Alquiler, Netflix, Sueldo" autocapitalize="sentences" maxlength="60"></div>
        <div class="seg">${seg('type', 'gasto', 'Gasto')}${seg('type', 'ingreso', 'Ingreso')}</div>
        <div class="field"><label class="field-label" for="fx-amount">Monto</label>
          <div class="amount-inline"><span>${esc(cur())}</span><input id="fx-amount" inputmode="numeric" value="${f.amount ? fmtNumber(f.amount) : ''}" placeholder="${f.variable ? 'Se pide al confirmar' : '0'}" ${f.variable ? 'disabled' : ''}></div>
          <label class="check-row"><input type="checkbox" id="fx-variable" ${f.variable ? 'checked' : ''}> El monto varía (luz, agua…): se pide al confirmar</label></div>
        <button class="field-row" data-action="fx-cat"><span class="field-label">Categoría</span><span class="field-val">${catIcon(c, 'sm')}<b>${esc(c.name)}</b></span>${icon('chev-right')}</button>
        <div class="field"><span class="field-label">Se repite</span>
          <div class="seg">${seg('every', 'semanal', 'Semanal')}${seg('every', 'mensual', 'Mensual')}${seg('every', 'anual', 'Anual')}</div></div>
        <div class="field"><span class="field-label">${f.every === 'semanal' ? 'Día de la semana' : 'Día'}</span>${dayField}</div>
        <p class="muted-sm">${esc(fmtEvery(f))} · Próxima vez: ${esc(fmtDay(occurrenceOnOrAfter(f, existing?.active ? existing.nextDate : todayStr())))}</p>
        ${existing ? `<label class="switch-row"><span>Activo</span><input type="checkbox" id="fx-active" ${f.active ? 'checked' : ''}><i class="switch"></i></label>` : ''}
      </main>
      <div class="form-foot">
        <button class="btn primary" data-action="fx-save">Guardar</button>
        ${existing ? `<button class="btn link danger" data-action="fx-del">Borrar fijo</button>` : ''}
      </div>
    </div>`,
    {
      'fx-set': (el) => {
        f[el.dataset.key] = el.dataset.val;
        if (el.dataset.key === 'every') f.day = el.dataset.val === 'semanal' ? parseDate(todayStr()).getDay() : Math.max(1, Number(f.day) || 1);
        if (el.dataset.key === 'type') f.categoryId = null;
        route(true);
      },
      'fx-cat': async () => {
        const id2 = await pickCategory(f.type, f.categoryId, suggestCategory(f.name, f.type, state));
        if (id2 === undefined) return;
        f.categoryId = id2;
        route(true);
      },
      'fx-save': () => {
        if (!f.name.trim()) return toast('Poné un nombre');
        if (!f.variable && !(f.amount > 0)) return toast('Poné el monto, o marcá que varía');
        const data = {
          name: f.name.trim(), type: f.type, amount: f.variable ? 0 : f.amount, variable: f.variable,
          categoryId: f.categoryId ?? suggestCategory(f.name, f.type, state), every: f.every, day: Number(f.day), month: Number(f.month),
        };
        if (existing) store.updateRecurring(existing.id, { ...data, active: f.active });
        else store.addRecurring(data);
        store.processRecurring();
        checkSave();
        fdraft = null;
        toast(existing ? 'Fijo actualizado' : 'Fijo creado');
        goBack('/fijos');
      },
      'fx-del': async () => {
        if (!(await ask(`¿Borrar el fijo “${f.name}”? Los movimientos ya anotados quedan.`, { ok: 'Borrar', danger: true }))) return;
        store.deleteRecurring(existing.id);
        checkSave();
        fdraft = null;
        goBack('/fijos');
      },
    },
    {
      input: (e) => {
        if (e.target.id === 'fx-name') f.name = e.target.value;
        else if (e.target.id === 'fx-amount') f.amount = formatAmountInput(e.target);
      },
      change: (e) => {
        const idt = e.target.id;
        if (idt === 'fx-variable') {
          f.variable = e.target.checked;
          route(true);
        } else if (idt === 'fx-day') {
          f.day = Number(e.target.value);
          route(true);
        } else if (idt === 'fx-month') {
          f.month = Number(e.target.value);
          route(true);
        } else if (idt === 'fx-active') f.active = e.target.checked;
      },
    },
  );
}

// ---------- Para confirmar ----------

function renderPending() {
  const today = todayStr();
  const due = store.duePending(today);
  const snoozed = state.pending.filter((p) => p.snoozeUntil && p.snoozeUntil > today);
  const card = (p) => {
    const f = store.getRecurring(p.recurringId);
    if (!f) return '';
    const c = catOf(f.categoryId);
    const late = p.dueDate < today;
    return `<div class="card pad pend" data-id="${p.id}">
      <div class="pend-top">${catIcon(c)}<span class="mov-main"><b>${esc(f.name)}</b>
        <small class="${late ? 'warn-text' : ''}">${late ? 'Vencía' : 'Vence'} ${esc(fmtDay(p.dueDate))} · ${esc(c.name)}</small></span></div>
      <div class="pend-amount ${f.type}"><span>${f.type === 'ingreso' ? '+' : '-'}${esc(cur())}</span>
        <input inputmode="numeric" class="pend-in" data-id="${p.id}" value="${p.amount ? fmtNumber(p.amount) : ''}" placeholder="${f.variable ? 'Monto de este mes' : '0'}"></div>
      <div class="pend-actions">
        <button class="btn primary sm" data-action="p-ok" data-id="${p.id}">${icon('check')} Confirmar</button>
        <button class="btn secondary sm" data-action="p-skip" data-id="${p.id}">Saltar</button>
        <button class="btn secondary sm" data-action="p-snooze" data-id="${p.id}">Mañana</button>
      </div>
    </div>`;
  };
  mount(
    `<div class="screen">
      ${topbar('Para confirmar', { back: '/' })}
      <main class="content">
        <p class="muted">Los fijos nunca se anotan solos. Confirmá, cambiá el monto, saltá este ciclo o posponelo.</p>
        ${due.length ? due.map(card).join('') : `<div class="empty">${icon('check')}<p>Todo al día.</p><small>No hay fijos vencidos.</small></div>`}
        ${snoozed.length ? `<p class="label">Pospuestos para mañana</p>${snoozed.map(card).join('')}` : ''}
        <button class="btn link" data-action="to" data-to="/fijos">Ver movimientos fijos</button>
      </main>
    </div>`,
    {
      'p-ok': (el) => {
        const input = root.querySelector(`.pend-in[data-id="${el.dataset.id}"]`);
        const amount = parseAmount(input.value);
        if (!(amount > 0)) {
          toast('Poné el monto');
          return input.focus();
        }
        const m = store.confirmPending(el.dataset.id, amount);
        checkSave();
        celebrate('Confirmado', budgetAlert(m));
        route(true);
      },
      'p-skip': async (el) => {
        if (!(await ask('¿Saltar este ciclo? No se anota nada.', { ok: 'Saltar' }))) return;
        store.skipPending(el.dataset.id);
        route(true);
      },
      'p-snooze': (el) => {
        store.snoozePending(el.dataset.id);
        toast('Te lo recuerdo mañana');
        route(true);
      },
    },
    { input: (e) => e.target.classList.contains('pend-in') && formatAmountInput(e.target) },
  );
}

// ---------- Categorías ----------

function renderCategories() {
  const list = store.categoriesOf(catTab);
  const count = new Map();
  for (const m of state.movements) count.set(m.categoryId, (count.get(m.categoryId) || 0) + 1);
  const seg = (t, label) => `<button type="button" class="seg-btn${catTab === t ? ' on' : ''}" data-action="cat-tab" data-t="${t}">${label}</button>`;
  mount(
    `<div class="screen">
      ${topbar('Categorías', { back: '/ajustes', right: `<button class="icon-btn" data-action="cat-add" aria-label="Nueva categoría">${icon('plus')}</button>` })}
      <main class="content">
        <div class="seg">${seg('gasto', 'Gastos')}${seg('ingreso', 'Ingresos')}</div>
        <div class="card list">${list
          .map(
            (c) => `<button class="row" data-action="cat-edit" data-id="${c.id}">${catIcon(c)}
              <span class="mov-main"><b>${esc(c.name)}</b><small>${count.get(c.id) || 0} movimientos${store.getBudget(c.id) ? ` · límite ${money(store.getBudget(c.id))}` : ''}</small></span>${icon('chev-right')}</button>`,
          )
          .join('')}</div>
        <button class="btn secondary" data-action="cat-add">${icon('plus')} Nueva categoría</button>
      </main>
    </div>`,
    {
      'cat-tab': (el) => {
        catTab = el.dataset.t;
        route(true);
      },
      'cat-add': () => editCategory(null, catTab),
      'cat-edit': (el) => editCategory(store.getCategory(el.dataset.id), catTab),
    },
  );
}

function editCategory(c, type) {
  const st = { name: c?.name || '', color: c?.color || nextColor(), icon: c?.icon || 'tag' };
  const draw = () => {
    sheet.className = 'sheet';
    sheet.innerHTML = `<form class="sheet-body tall" id="cform">
      <p class="sheet-title">${c ? 'Editar categoría' : 'Nueva categoría'}</p>
      <div class="cat-preview">${catIcon(st)}<input class="sheet-input" id="cname" value="${esc(st.name)}" placeholder="Nombre" maxlength="30" autocomplete="off"></div>
      <p class="label">Color</p>
      <div class="swatches">${COLORS.map((col) => `<button type="button" class="swatch${col === st.color ? ' on' : ''}" style="--c:${col}" data-color="${col}" aria-label="Color"></button>`).join('')}</div>
      <p class="label">Ícono</p>
      <div class="icon-grid">${CATEGORY_ICONS.map((ic) => `<button type="button" class="icon-opt${ic === st.icon ? ' on' : ''}" data-icon="${ic}" style="--c:${st.color}">${icon(ic)}</button>`).join('')}</div>
      <button class="sheet-btn primary" type="submit">Guardar</button>
      ${c ? '<button class="sheet-btn danger" type="button" data-del>Borrar categoría</button>' : ''}
      <button class="sheet-btn cancel" type="button" data-cancel>Cancelar</button>
    </form>`;
  };
  draw();
  sheet.oninput = (e) => e.target.id === 'cname' && (st.name = e.target.value);
  sheet.onclick = async (e) => {
    if (e.target === sheet || e.target.closest('[data-cancel]')) return closeSheet();
    const col = e.target.closest('[data-color]');
    const ic = e.target.closest('[data-icon]');
    if (col) st.color = col.dataset.color;
    if (ic) st.icon = ic.dataset.icon;
    if (col || ic) return draw();
    if (e.target.closest('[data-del]')) {
      const ok = await ask(`¿Borrar “${c.name}”? Sus movimientos pasan a Sin clasificar.`, { ok: 'Borrar', danger: true });
      if (!ok) return;
      store.deleteCategory(c.id);
      checkSave();
      toast('Categoría borrada');
      route(true);
    }
  };
  sheet.onsubmit = (e) => {
    e.preventDefault();
    const name = st.name.trim().slice(0, 30);
    if (!name) return toast('Poné un nombre');
    if (c) store.updateCategory(c.id, { name, color: st.color, icon: st.icon });
    else store.addCategory({ name, color: st.color, icon: st.icon, type });
    checkSave();
    closeSheet();
    route(true);
  };
  openDialog();
}

// ---------- Sin clasificar ----------

function renderUnclassified() {
  const list = state.movements.filter((m) => !m.categoryId).sort((a, b) => b.date.localeCompare(a.date));
  mount(
    `<div class="screen">
      ${topbar('Sin clasificar', { back: '/' })}
      <main class="content">
        <p class="muted">Tocá una categoría para asignarla. La app lo recuerda para la próxima vez.</p>
        ${
          list.length
            ? list
                .map((m) => {
                  const chips = store.frequentCategories(m.type, 5);
                  const extra = store.categoriesOf(m.type).filter((c) => !chips.includes(c)).slice(0, Math.max(0, 4 - chips.length));
                  return `<div class="card pad unc" data-id="${m.id}">
                    <div class="unc-top"><span class="mov-main"><b>${esc(m.desc || 'Sin descripción')}</b><small>${esc(fmtDay(m.date))}</small></span>
                      <span class="mov-amt ${m.type}">${signed(m)}</span></div>
                    <div class="chip-row">${[...chips, ...extra]
                      .map((c) => `<button class="chip-cat sm" data-action="u-set" data-id="${m.id}" data-cat="${c.id}">${catIcon(c, 'xs')}<span>${esc(c.name)}</span></button>`)
                      .join('')}<button class="chip-cat sm" data-action="u-more" data-id="${m.id}"><span>Otra…</span></button></div>
                  </div>`;
                })
                .join('')
            : `<div class="empty">${icon('check')}<p>Todo clasificado.</p></div>`
        }
      </main>
    </div>`,
    {
      'u-set': (el) => assignCategory(el.dataset.id, el.dataset.cat),
      'u-more': async (el) => {
        const m = store.getMovement(el.dataset.id);
        const id = await pickCategory(m.type, null);
        if (id) assignCategory(m.id, id);
      },
    },
  );
}

function assignCategory(movId, catId) {
  const m = store.getMovement(movId);
  if (!m) return;
  store.updateMovement(movId, { categoryId: catId });
  if (m.desc) store.learnRule(m.desc, catId);
  checkSave();
  toast(`${m.desc || 'Movimiento'} → ${catOf(catId).name}`);
  const card = root.querySelector(`.unc[data-id="${movId}"]`);
  if (card) {
    card.classList.add('leaving');
    setTimeout(() => route(true), 250);
  } else route(true);
}

function renderRules() {
  const list = [...state.rules].sort((a, b) => a.pattern.localeCompare(b.pattern));
  mount(
    `<div class="screen">
      ${topbar('Reglas aprendidas', { back: '/ajustes' })}
      <main class="content">
        <p class="muted">Cuando corregís la categoría de un movimiento, la app guarda la regla y la usa primero la próxima vez.</p>
        ${
          list.length
            ? `<div class="card list">${list
                .map((r) => {
                  const c = catOf(r.categoryId);
                  return `<div class="row">${catIcon(c, 'sm')}<span class="mov-main"><b>“${esc(r.pattern)}”</b><small>→ ${esc(c.name)}</small></span>
                    <button class="icon-btn sm" data-action="r-del" data-id="${r.id}" aria-label="Borrar regla">${icon('trash')}</button></div>`;
                })
                .join('')}</div>`
            : `<div class="empty">${icon('sparkles')}<p>Todavía no hay reglas aprendidas.</p></div>`
        }
      </main>
    </div>`,
    {
      'r-del': (el) => {
        store.deleteRule(el.dataset.id);
        route(true);
      },
    },
  );
}

// ---------- Ajustes, atajo y backup ----------

function settingsRow(ic, title, sub, attrs) {
  return `<button class="row" ${attrs}><span class="row-ico">${icon(ic)}</span>
    <span class="mov-main"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>${icon('chev-right')}</button>`;
}

function renderSettings() {
  const s = state.settings;
  const unc = state.movements.filter((m) => !m.categoryId).length;
  const active = state.recurring.filter((f) => f.active).length;
  mount(
    `<div class="screen">
      <header class="topbar main"><h1 class="brand-title">Ajustes</h1></header>
      <main class="content">
        <p class="label">Registrar</p>
        <div class="card list">
          ${settingsRow('layers', 'Carga en lote', 'Pegá varios movimientos, uno por línea', 'data-action="to" data-to="/lote"')}
          ${settingsRow('repeat', 'Movimientos fijos', `${active} ${active === 1 ? 'activo' : 'activos'}`, 'data-action="to" data-to="/fijos"')}
          ${settingsRow('inbox', 'Para confirmar', `${store.duePending().length} pendientes`, 'data-action="to" data-to="/pendientes"')}
          ${settingsRow('help', 'Sin clasificar', `${unc}`, 'data-action="to" data-to="/sin-clasificar"')}
        </div>
        <p class="label">Organizar</p>
        <div class="card list">
          ${settingsRow('grid', 'Categorías', `${state.categories.length} categorías`, 'data-action="to" data-to="/categorias"')}
          ${settingsRow('pie', 'Presupuestos', `${state.budgets.length} con límite`, 'data-action="tab" data-to="/analisis"')}
          ${settingsRow('sparkles', 'Reglas aprendidas', `${state.rules.length}`, 'data-action="to" data-to="/reglas"')}
        </div>
        <p class="label">Atajo del iPhone</p>
        <div class="card list">
          ${settingsRow('bolt', 'Configurar “Gasto rápido”', 'Centro de Control, botón de acción o tocar atrás', 'data-action="to" data-to="/atajo"')}
          ${settingsRow('file', 'Importar del atajo (archivo)', s.lastImport ? `Último importado: ${esc(s.lastImport)}` : 'Plan B: lee movimientos.txt', 'data-action="import-txt"')}
        </div>
        <p class="label">Datos</p>
        <div class="card list">
          ${settingsRow('dollar', 'Moneda', esc(cur()), 'data-action="currency"')}
          ${settingsRow('download', 'Exportar backup', s.lastBackup ? `Último: ${esc(fmtDay(s.lastBackup.slice(0, 10)))}` : 'Nunca', 'data-action="export"')}
          ${settingsRow('upload', 'Importar backup', 'Reemplaza los datos de este celular', 'data-action="import"')}
        </div>
        <p class="foot">Todo se guarda solo en este dispositivo · ${state.movements.length} movimientos</p>
        <input type="file" id="file-json" accept="application/json,.json" hidden>
        <input type="file" id="file-txt" accept=".txt,text/plain" hidden>
      </main>
      ${tabbar('/ajustes')}
    </div>`,
    {
      currency: async () => {
        const v = await promptSheet('Símbolo de moneda', { value: cur(), placeholder: '$' });
        if (v === null) return;
        store.setSetting('currency', v.slice(0, 4) || '$');
        route(true);
      },
      export: () => exportBackup(),
      import: () => root.querySelector('#file-json').click(),
      'import-txt': () => root.querySelector('#file-txt').click(),
    },
    {
      change: async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const text = await file.text();
        e.target.value = '';
        if (e.target.id === 'file-json') importBackup(text);
        else if (e.target.id === 'file-txt') importShortcutFile(text);
      },
    },
  );
}

async function exportBackup() {
  const json = store.exportData();
  const name = `appfinanzas-${todayStr()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  try {
    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Backup AppFinanzas' });
    else download();
  } catch (err) {
    if (err?.name === 'AbortError') return;
    download();
  }
  store.setSetting('lastBackup', new Date().toISOString());
  store.setSetting('backupSnoozeUntil', null);
  toast('Backup exportado');
  route(true);
}

async function importBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return toast('Ese archivo no es un backup válido');
  }
  if (!data || !Array.isArray(data.movements)) return toast('Ese archivo no es un backup de AppFinanzas');
  const ok = await ask(`Esto reemplaza todos los datos de este celular por los del backup (${data.movements.length} movimientos). ¿Seguir?`, {
    ok: 'Importar', danger: true,
  });
  if (!ok) return;
  store.importData(data);
  checkSave();
  toast('Backup importado');
  route(true);
}

/** Plan B: el atajo agrega líneas "30/09/2026 09:05 Café 4500" a movimientos.txt. Se importa solo lo nuevo. */
function importShortcutFile(text) {
  const { items, errors } = parseBatch(text);
  const last = state.settings.lastImport || '';
  const stamp = (it) => `${it.date} ${it.time || '00:00'}`;
  const fresh = items.filter((it) => stamp(it) > last);
  if (!fresh.length) return toast(items.length ? 'No hay movimientos nuevos para importar' : 'No encontré movimientos en el archivo');
  batch = {
    text: '',
    source: 'rapido',
    importMark: fresh.map(stamp).sort().pop(),
    errors,
    items: fresh.map((it) => {
      const s = suggestCategory(it.desc, it.type, state);
      return { ...it, categoryId: s, suggested: s, catManual: false };
    }),
  };
  navigate('/lote');
}

function renderShortcutHelp() {
  const base = `${location.origin}${location.pathname}`;
  const url = `${base}#/rapido?monto=`;
  mount(
    `<div class="screen">
      ${topbar(`${icon('bolt')} Gasto rápido`, { back: '/ajustes' })}
      <main class="content prose">
        <p class="muted">Un atajo de iOS te pregunta el monto y qué compraste, y abre la app con la tarjeta lista para guardar.</p>
        <section class="card pad">
          <div class="sec-head"><h2>Plan A · Abrir la app</h2></div>
          <ol class="steps">
            <li>Abrí <b>Atajos</b> → <b>+</b> → nombre: <b>Gasto rápido</b>.</li>
            <li>Acción <b>Pedir entrada</b> · tipo <b>Número</b> · pregunta “¿Cuánto?”.</li>
            <li>Acción <b>Pedir entrada</b> · tipo <b>Texto</b> · pregunta “¿Qué compraste?”.</li>
            <li>Acción <b>Codificar URL</b> sobre el texto (para espacios y tildes).</li>
            <li>Acción <b>Abrir URL</b> con: <code class="block">${esc(url)}<i>[Cantidad]</i>&amp;desc=<i>[URL codificada]</i></code></li>
            <li>Centro de Control → editar → <b>Agregar un control</b> → Atajos → <b>Gasto rápido</b>. También sirve el botón de acción o “tocar atrás”.</li>
          </ol>
          <p class="muted-sm">Para un ingreso, sumá <code>&amp;tipo=ingreso</code> al final.</p>
          <div class="two">
            <button class="btn secondary sm" data-action="copy">${icon('copy')} Copiar URL</button>
            <button class="btn secondary sm" data-action="try">${icon('bolt')} Probar</button>
          </div>
        </section>
        <section class="card pad">
          <div class="sec-head"><h2>Prueba 0</h2></div>
          <p class="muted-sm">En el iPhone, Abrir URL puede abrir <b>Safari</b> en vez de la app instalada, y Safari guarda los datos por separado. Anotá un gasto con el atajo y fijate si aparece en la app instalada. Si no aparece, usá el Plan B.</p>
        </section>
        <section class="card pad">
          <div class="sec-head"><h2>Plan B · Archivo</h2></div>
          <ol class="steps">
            <li>En el atajo, después de pedir monto y descripción, usá <b>Agregar a archivo de texto</b> → <code>movimientos.txt</code> en Archivos.</li>
            <li>Texto de cada línea: <code class="block"><i>[Fecha actual: dd/MM/yyyy HH:mm]</i> <i>[Texto]</i> <i>[Cantidad]</i></code></li>
            <li>En la app: Ajustes → <b>Importar del atajo (archivo)</b>. Solo se importa lo nuevo, con vista previa.</li>
          </ol>
        </section>
      </main>
    </div>`,
    {
      copy: async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast('URL copiada');
        } catch {
          toast('No se pudo copiar');
        }
      },
      try: () => {
        depth = 0;
        navigate('/rapido?monto=4500&desc=Parqueadero', { replace: true });
      },
    },
  );
}

// ---------- Arranque ----------

function syncViewport() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--vvh', `${h}px`);
}
window.visualViewport?.addEventListener('resize', syncViewport);
syncViewport();

// Al volver a la app, revisar fijos vencidos (puede haber cambiado el día).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || sheet.open) return;
  if (!location.hash || location.hash === '#/') route(true);
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

route();
