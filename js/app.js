// Pantallas y router por hash. Cada render reemplaza root.innerHTML y define sus acciones (data-action).
import * as store from './store.js';
import { state } from './store.js';
import { icon } from './icons.js';
import { COLORS, UNCLASSIFIED } from './data.js';
import { suggestCategory, parseBatch } from './rules.js';
import { loadJsQR, decodeImage, parseFiscalQR, fmtCuit } from './qr.js';
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
let histFilter = { q: '', cat: '' };
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
  // Las fechas de la lista quedan pegadas justo debajo de la barra de título (si la pantalla tiene una).
  const bar = root.querySelector('.topbar');
  root.style.setProperty('--sticky-top', `${bar ? bar.offsetHeight : 0}px`);
  syncFab();
}

/** El botón "Anotar" se achica a solo "+" al bajar, para no tapar la lista. */
function syncFab() {
  root.querySelector('.fab.wide')?.classList.toggle('small', window.scrollY > 24);
}
window.addEventListener('scroll', syncFab, { passive: true });

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
    case 'meses':
      return renderMonths();
    case 'pendientes':
      return renderPending();
    case 'sin-clasificar':
      return renderUnclassified();
    default:
      return navigate('/', { replace: true });
  }
}

// ---------- Piezas comunes ----------

function tabbar(active) {
  const tabs = [
    ['/', 'home', 'Inicio'],
    ['/movimientos', 'list', 'Historial'],
    ['/analisis', 'chart', 'Análisis'],
    ['/ajustes', 'sliders', 'Ajustes'],
  ];
  return `<nav class="tabbar">${tabs
    .map(
      ([to, ic, label]) =>
        `<button class="tab${active === to ? ' on' : ''}" data-action="tab" data-to="${to}">${icon(ic)}<span>${label}</span></button>`,
    )
    .join('')}</nav>`;
}

function fab(label = false) {
  return `<button class="fab${label ? ' wide' : ''}" data-action="to" data-to="/nuevo" aria-label="Anotar">${icon('plus')}${label ? '<span>Anotar</span>' : ''}</button>`;
}

/** Pastilla con el mes completo ("Octubre"); el año solo aparece si no es el actual ("Diciembre 2025"). */
function monthNav() {
  const [name, year] = fmtMonth(viewMonth).split(' ');
  const label = name[0].toUpperCase() + name.slice(1) + (year === todayStr().slice(0, 4) ? '' : ` ${year}`);
  return `<div class="month-pill">
    <button data-action="month-prev" aria-label="Mes anterior">${icon('chev-left')}</button>
    <span>${label}</span>
    <button data-action="month-next" aria-label="Mes siguiente">${icon('chev-right')}</button>
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

// "Deshacer" unos segundos después de guardar: vuelve los datos a como estaban justo antes.
// Si se guarda cualquier otra cosa mientras tanto, el botón desaparece (deshacer pisaría ese cambio).
let undo = null; // { el, timer }
let restoring = false;

function hideUndo() {
  if (!undo) return;
  const { el, timer } = undo;
  undo = null;
  clearTimeout(timer);
  el.classList.remove('show');
  setTimeout(() => el.remove(), 300);
}

function offerUndo(snap, label) {
  hideUndo();
  const el = document.createElement('div');
  el.className = 'undo-bar';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(label)}</span><button type="button">Deshacer</button>`;
  document.body.appendChild(el);
  void el.offsetWidth; // aplicar el estado inicial antes de animar la entrada
  el.classList.add('show');
  el.querySelector('button').onclick = () => {
    hideUndo();
    restoring = true;
    store.restore(snap);
    restoring = false;
    route(true);
    toast('Listo, se deshizo');
  };
  undo = { el, timer: setTimeout(hideUndo, 5000) };
}

store.setOnSave(() => {
  if (!restoring) hideUndo();
});

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
  sheet.onchange = null;
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

/** Calendario propio en una hoja. Resuelve con 'YYYY-MM-DD', o null si se canceló. */
function pickDate(value) {
  return new Promise((resolve) => {
    const today = todayStr();
    let ym = monthOf(value || today);
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      closeSheet();
      resolve(v);
    };
    const draw = () => {
      const [y, m] = ym.split('-').map(Number);
      const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // la semana empieza el lunes
      const days = Array.from({ length: daysInMonth(ym) }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
      const [name, year] = fmtMonth(ym).split(' ');
      sheet.className = 'sheet';
      sheet.innerHTML = `<div class="sheet-body cal">
        <div class="cal-quick">
          <button class="${value === today ? 'on' : ''}" data-d="${today}">Hoy</button>
          <button class="${value === addDays(today, -1) ? 'on' : ''}" data-d="${addDays(today, -1)}">Ayer</button>
        </div>
        <div class="cal-head">
          <button data-nav="-1" aria-label="Mes anterior">${icon('chev-left')}</button>
          <b>${name[0].toUpperCase() + name.slice(1)} ${year}</b>
          <button data-nav="1" aria-label="Mes siguiente">${icon('chev-right')}</button>
        </div>
        <div class="cal-grid">
          ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((w) => `<span class="cal-wd">${w}</span>`).join('')}
          ${'<span></span>'.repeat(offset)}
          ${days
            .map((d) => {
              const cls = [d === value && 'sel', d === today && 'today', d > today && 'future'].filter(Boolean).join(' ');
              return `<button class="cal-day ${cls}" data-d="${d}">${Number(d.slice(8))}</button>`;
            })
            .join('')}
        </div>
        <button class="sheet-btn cancel" data-cancel>Cancelar</button>
      </div>`;
    };
    draw();
    sheet.onclick = (e) => {
      if (e.target === sheet) return done(null);
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.nav) {
        ym = addMonths(ym, Number(b.dataset.nav));
        draw();
      } else if (b.dataset.d) done(b.dataset.d);
      else if (b.hasAttribute('data-cancel')) done(null);
    };
    if (sheet.open) sheet.close();
    sheet.showModal();
    sheet.onclose = () => !sheet.open && done(null);
  });
}

// ---------- Escáner de QR ----------

/**
 * Hoja con la cámara para leer un QR: escanea sola mientras se apunta. Se puede hacer zoom con dos dedos
 * o con 1x/2x/3x (zoom real de la cámara si el teléfono lo deja; si no, se amplía el centro de la imagen).
 * "Sacar foto" aparece solo si la cámara no abre. Devuelve el texto del QR o null si se canceló.
 */
function scanQR() {
  return new Promise((resolve) => {
    let settled = false;
    let stream = null;
    let timer = null;
    let zoom = 1;
    let native = null; // { min, max } si la cámara tiene zoom propio
    let frame = 0;
    const canvas = document.createElement('canvas');
    const stop = () => {
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };
    const done = (v) => {
      if (settled) return;
      settled = true;
      stop();
      closeSheet();
      resolve(v);
    };

    sheet.className = 'sheet';
    sheet.innerHTML = `<div class="sheet-body scan">
      <p class="sheet-title">Escanear QR del ticket</p>
      <div class="scan-view">
        <video playsinline muted autoplay></video>
        <span class="scan-frame"></span>
        <div class="scan-zoom" hidden>${[1, 2, 3].map((z) => `<button data-zoom="${z}">${z}x</button>`).join('')}</div>
        <p class="scan-msg">Abriendo la cámara…</p>
      </div>
      <p class="muted-sm">Apuntá al QR de ARCA que está al pie del ticket: se lee solo. Si está lejos, hacé zoom con dos dedos.</p>
      <label class="sheet-btn" hidden>${icon('camera')} Sacar foto
        <input type="file" accept="image/*" capture="environment" hidden></label>
      <button class="sheet-btn cancel" data-cancel>Cancelar</button>
    </div>`;
    const view = sheet.querySelector('.scan-view');
    const video = sheet.querySelector('video');
    const msg = sheet.querySelector('.scan-msg');
    const zoomBar = sheet.querySelector('.scan-zoom');
    const photoBtn = sheet.querySelector('label.sheet-btn');
    const setMsg = (t) => {
      msg.textContent = t;
      msg.hidden = !t;
    };

    const maxZoom = () => (native ? Math.min(native.max, 6) : 4);
    let applying = false;
    const setZoom = (z) => {
      zoom = Math.min(maxZoom(), Math.max(1, z));
      zoomBar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Math.abs(Number(b.dataset.zoom) - zoom) < 0.5));
      const track = stream?.getVideoTracks()[0];
      if (native && track) {
        if (applying) return;
        applying = true;
        requestAnimationFrame(() => {
          track.applyConstraints({ advanced: [{ zoom: Math.max(native.min, zoom) }] }).catch(() => {}).finally(() => (applying = false));
        });
      } else video.style.transform = zoom > 1 ? `scale(${zoom})` : '';
    };

    // Zoom con dos dedos sobre la imagen.
    let pinch = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    view.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) pinch = { d: dist(e.touches), z: zoom };
    }, { passive: true });
    view.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      setZoom(pinch.z * (dist(e.touches) / pinch.d));
    }, { passive: false });
    view.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) pinch = null;
    });

    sheet.onclick = (e) => {
      if (e.target === sheet || e.target.closest('[data-cancel]')) return done(null);
      const zb = e.target.closest('[data-zoom]');
      if (zb) setZoom(Number(zb.dataset.zoom));
    };
    sheet.onchange = async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      setMsg('Buscando el QR…');
      try {
        const jsQR = await loadJsQR();
        const bmp = await createImageBitmap(file);
        const text =
          decodeImage(jsQR, bmp, bmp.width, bmp.height, canvas, { thorough: true }) ||
          decodeImage(jsQR, bmp, bmp.width, bmp.height, canvas, { thorough: true, crop: 2 });
        bmp.close?.();
        // Los avisos van dentro de la hoja: un toast quedaría tapado por el diálogo abierto.
        setMsg(text ? '' : 'No encontré un QR en la foto. Probá más de cerca y con luz.');
        if (text) done(text);
      } catch {
        setMsg('No se pudo leer la foto.');
      }
    };
    if (sheet.open) sheet.close();
    sheet.showModal();
    sheet.onclose = () => !sheet.open && done(null);

    // Escaneo continuo. Se alterna entre lo que se ve y el centro ampliado al doble y al triple: así un QR
    // chico o lejano se lee aunque no se haga zoom.
    const tick = (jsQR) => {
      if (settled || !stream) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const base = native ? 1 : zoom;
        const crop = Math.min(base * ((frame++ % 3) + 1), 6);
        const text = decodeImage(jsQR, video, video.videoWidth, video.videoHeight, canvas, { crop });
        if (text) {
          if (navigator.vibrate) navigator.vibrate(30);
          return done(text);
        }
      }
      timer = setTimeout(() => tick(jsQR), 100);
    };
    (async () => {
      try {
        const [jsQR, s] = await Promise.all([
          loadJsQR(),
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          }),
        ]);
        if (settled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const caps = s.getVideoTracks()[0]?.getCapabilities?.() || {};
        if (caps.zoom && caps.zoom.max > 1) native = { min: caps.zoom.min || 1, max: caps.zoom.max };
        video.srcObject = s;
        await video.play().catch(() => {});
        setMsg('');
        zoomBar.hidden = false;
        setZoom(1);
        tick(jsQR);
      } catch {
        if (settled) return;
        setMsg('No se pudo abrir la cámara. Usá “Sacar foto”.');
        photoBtn.hidden = false;
      }
    })();
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

/**
 * El total grande cuenta rápido hasta el valor nuevo (al cambiar de mes) en vez de aparecer de golpe.
 * `key` separa Inicio de Análisis; la primera vez que se muestra no se anima.
 */
const shownTotals = {};
function animateTotal(key, total) {
  const el = root.querySelector('.spent-amount');
  const from = shownTotals[key];
  shownTotals[key] = total;
  if (!el || from === undefined || from === total || state.settings.hideAmounts) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t0 = performance.now();
  const step = (t) => {
    if (!el.isConnected) return;
    const p = Math.min(1, (t - t0) / 450);
    el.innerHTML = money(from + (total - from) * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- Inicio ----------

function renderHome() {
  const ym = viewMonth;
  const isCurrent = ym === store.currentMonth();
  const gastos = store.movementsOf(ym).filter((m) => m.type === 'gasto');
  const total = gastos.reduce((s, m) => s + m.amount, 0);
  const pending = store.duePending();
  const backupDays = store.backupReminderDays();
  const over = budgetRows(ym).filter((b) => b.pct > 1);
  const unclassified = gastos.filter((m) => !m.categoryId).length;
  const hide = state.settings.hideAmounts;
  const monthName = fmtMonth(ym).split(' ')[0];

  // Avisos: solo aparecen cuando hay algo para hacer.
  const banners = [];
  if (pending.length)
    banners.push(`<button class="banner accent" data-action="to" data-to="/pendientes">${icon('inbox')}
      <span><b>Para confirmar (${pending.length})</b><small>Gastos fijos vencidos</small></span>${icon('chev-right')}</button>`);
  if (over.length)
    banners.push(`<button class="banner danger" data-action="to" data-to="/analisis">${icon('alert')}
      <span><b>Te pasaste en ${esc(over.map((b) => b.c.name).join(', '))}</b><small>${over
        .map((b) => `${esc(b.c.name)}: ${pctText(b.pct)}`)
        .join(' · ')}</small></span>${icon('chev-right')}</button>`);
  if (unclassified)
    banners.push(`<button class="banner" data-action="to" data-to="/sin-clasificar">${icon('help')}
      <span><b>${unclassified} sin categoría</b><small>Tocá para asignarles una</small></span>${icon('chev-right')}</button>`);
  if (backupDays)
    banners.push(`<div class="banner">${icon('download')}
      <span><b>Hace ${backupDays} días que no hacés backup</b><small>Los datos viven solo en este celular</small></span>
      <button class="btn sm" data-action="backup-now">Exportar</button>
      <button class="btn sm ghost" data-action="backup-later">Luego</button></div>`);

  mount(
    `<div class="screen">
      <header class="home-top">
        <div class="brand">
          <img class="logo" src="icons/icon.svg" alt="">
          <h1 class="brand-title">Gastos</h1>
        </div>
        ${monthNav()}
      </header>
      <main class="content">
        ${banners.join('')}
        <section class="spent">
          <div class="spent-head">
            <span class="spent-label">Gastaste en ${esc(monthName)}</span>
            <button class="icon-btn sm" data-action="toggle-hide" aria-label="${hide ? 'Mostrar' : 'Ocultar'} montos">${icon(hide ? 'eye-off' : 'eye')}</button>
          </div>
          <div class="spent-amount">${money(total)}</div>
          <small>${gastos.length} ${gastos.length === 1 ? 'gasto' : 'gastos'}</small>
        </section>
        <div class="row-links">
          <h2 class="sec-title">Últimos gastos</h2>
          <button class="link" data-action="to" data-to="/movimientos">Ver todos ${icon('chev-right')}</button>
        </div>
        ${
          gastos.length
            ? movementList(gastos.slice(0, 15))
            : `<div class="empty">${icon('inbox')}<p>${isCurrent ? 'Todavía no anotaste nada este mes.' : 'Sin gastos este mes.'}</p><small>Tocá <b>Anotar</b> para empezar.</small></div>`
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
  animateTotal('home', total);
}

// ---------- Anotar: una sola pantalla (monto → categoría → Guardar) ----------

function newDraft(o = {}) {
  return {
    type: 'gasto', amount: 0, desc: '', categoryId: null, catManual: false, origCategoryId: null,
    date: todayStr(), source: 'app', editId: null, recurringId: null, recurring: null, ...o,
  };
}

function openNew(params, source) {
  if (!keepDraft || !draft) draft = newDraft({ source });
  keepDraft = false;
  draftForm();
}

/** Monto que llega por URL: "4500", "4.500" o "4500.5" (punto decimal). */
function urlAmount(raw) {
  const s = String(raw || '').trim();
  return /^\d+\.\d{1,2}$/.test(s) ? Math.round(Number(s)) : parseAmount(s);
}

/** #/rapido?monto=4500&desc=Café muestra la tarjeta de gasto rápido; sin monto, la pantalla de anotar. */
function openRapido(params) {
  const amount = urlAmount(params.get('monto'));
  if (amount > 0) {
    const desc = (params.get('desc') || '').trim().slice(0, 80);
    // Se saca el monto de la URL para que al recargar no aparezca de nuevo.
    history.replaceState(null, '', '#/');
    currentHash = location.hash;
    renderHome();
    showQuickCard(newDraft({ amount, desc, source: 'rapido', categoryId: suggestCategory(desc, 'gasto', state) }));
    return;
  }
  openNew(params, 'rapido');
}

function openEdit(id) {
  const m = store.getMovement(id);
  if (!m) return navigate('/movimientos', { replace: true });
  draft = newDraft({
    editId: m.id, type: m.type, amount: m.amount, desc: m.desc, categoryId: m.categoryId,
    origCategoryId: m.categoryId, catManual: true, date: m.date, source: m.source, recurringId: m.recurringId || null,
  });
  draftForm();
}

function recFromDraft() {
  const dt = parseDate(draft.date);
  const every = draft.recurring.every;
  return {
    every, day: every === 'semanal' ? dt.getDay() : dt.getDate(), month: dt.getMonth() + 1,
    workdays: every === 'diario' && !!draft.recurring.workdays,
  };
}

function recurringPanel() {
  if (!draft.recurring) return '';
  const r = draft.recurring;
  const seg = (e, label) =>
    `<button type="button" class="seg-btn${r.every === e ? ' on' : ''}" data-action="rec-every" data-every="${e}">${label}</button>`;
  return `<div class="rec-panel">
    <div class="seg">${seg('diario', 'Diario')}${seg('semanal', 'Semanal')}${seg('mensual', 'Mensual')}${seg('anual', 'Anual')}</div>
    ${r.every === 'diario' ? `<label class="check-row"><input type="checkbox" id="f-workdays" ${r.workdays ? 'checked' : ''}> Solo de lunes a viernes</label>` : ''}
    <p class="muted-sm">${esc(fmtEvery(recFromDraft()))}. Cada vez se te pide confirmarlo.</p>
    <label class="check-row"><input type="checkbox" id="f-variable" ${r.variable ? 'checked' : ''}> El monto varía (se pide al confirmar)</label>
  </div>`;
}

/** Grilla de categorías como botones: un toque elige. */
function catGridHTML() {
  return `${store
    .categoriesOf(draft.type)
    .map(
      (c) => `<button type="button" class="cat-tile${c.id === draft.categoryId ? ' on' : ''}" data-action="f-cat" data-id="${c.id}">
        ${catIcon(c)}<span>${esc(c.name)}</span></button>`,
    )
    .join('')}
    <button type="button" class="cat-tile add" data-action="f-cat-new">${icon('plus')}<span>Nueva</span></button>`;
}

/** Una línea con lo que queda del límite de la categoría elegida. */
function budgetHint() {
  if (draft.type !== 'gasto' || !draft.categoryId) return '';
  const st = store.budgetStatus(draft.categoryId, monthOf(draft.date), draft.amount, draft.editId);
  if (!st) return '';
  const name = esc(catOf(draft.categoryId).name);
  return st.remaining >= 0
    ? `<span class="t-${tone(st.pct)}">${name}: te quedan ${money(st.remaining)} este mes</span>`
    : `<span class="t-over">${name}: te pasás por ${money(-st.remaining)}</span>`;
}

function draftForm() {
  const d = draft;
  const isEdit = !!d.editId;
  const fijo = d.recurringId && store.getRecurring(d.recurringId);
  const dateLabel = () => (d.date === todayStr() ? 'Hoy' : d.date === addDays(todayStr(), -1) ? 'Ayer' : fmtDateLong(d.date));
  const refresh = () => {
    root.querySelector('#f-cats').innerHTML = catGridHTML();
    root.querySelector('#f-hint').innerHTML = budgetHint();
  };

  mount(
    `<div class="screen form-screen quick-form">
      <header class="topbar">
        <button class="icon-btn" data-action="form-close" aria-label="Cerrar">${icon(isEdit ? 'chev-left' : 'x')}</button>
        <h1 class="topbar-title center">${isEdit ? 'Editar gasto' : 'Nuevo gasto'}</h1>
        <div class="topbar-right">${isEdit ? `<button class="icon-btn danger" data-action="delete-mov" aria-label="Borrar">${icon('trash')}</button>` : ''}</div>
      </header>
      <div class="content">
        ${
          isEdit
            ? ''
            : `<div class="entry-modes">
                <button class="pill-btn" data-action="scan-qr">${icon('qr')} Escanear ticket</button>
                <button class="pill-btn" data-action="to-batch">${icon('layers')} Varios en lote</button>
              </div>`
        }
        <label class="hero-amount ${d.type}"><span>${esc(cur())}</span>
          <input id="f-amount" inputmode="numeric" autocomplete="off" value="${d.amount ? fmtNumber(d.amount) : ''}" placeholder="0" aria-label="Monto"></label>
        <button class="date-chip" data-action="f-date">${icon('calendar')}<span id="f-date-label">${dateLabel()}</span>${icon('chev-down')}</button>
        <div class="cat-grid" id="f-cats">${catGridHTML()}</div>
        <input id="f-desc" class="desc-input" autocomplete="off" autocapitalize="sentences" maxlength="80"
          value="${esc(d.desc)}" placeholder="Descripción (opcional)" aria-label="Descripción">
        ${d.cuit ? `<p class="note">${icon('qr')} Del QR del ticket · CUIT ${fmtCuit(d.cuit)}</p>` : ''}
        ${
          fijo
            ? `<p class="note">${icon('repeat')} Viene del fijo “${esc(fijo.name)}”</p>`
            : isEdit
              ? ''
              : `<button class="pill-btn${d.recurring ? ' on' : ''}" data-action="toggle-rec">${icon('repeat')} Se repite</button>
                 <div id="f-rec">${recurringPanel()}</div>`
        }
      </div>
      <div class="form-foot">
        <p class="foot-hint" id="f-hint">${budgetHint()}</p>
        <button class="btn primary" data-action="save-draft">Guardar</button>
      </div>
    </div>`,
    {
      'form-close': () => {
        draft = null;
        goBack(isEdit ? '/movimientos' : '/');
      },
      // Reemplaza a "Nuevo gasto" en el historial: desde el lote, atrás vuelve a donde se tocó Anotar.
      'to-batch': () => {
        draft = null;
        navigate('/lote', { replace: true });
      },
      'scan-qr': async () => {
        const text = await scanQR();
        if (!text) return;
        const t = parseFiscalQR(text);
        if (!t) return toast('Ese QR no es el de un ticket o factura (ARCA)');
        const known = store.getMerchant(t.cuit);
        draft = newDraft({
          amount: t.amount, date: t.date || todayStr(), source: 'qr', cuit: t.cuit,
          desc: known?.desc || '', categoryId: known?.categoryId || null, catManual: !!known?.categoryId,
        });
        draftForm();
        toast(known?.categoryId ? 'Ticket leído' : 'Ticket leído: elegí la categoría');
      },
      'f-date': async () => {
        const v = await pickDate(d.date);
        if (!v) return;
        d.date = v;
        root.querySelector('#f-date-label').textContent = dateLabel();
        root.querySelector('#f-hint').innerHTML = budgetHint();
        if (d.recurring) root.querySelector('#f-rec').innerHTML = recurringPanel();
      },
      'f-cat': (el) => {
        d.categoryId = el.dataset.id;
        d.catManual = true;
        refresh();
      },
      'f-cat-new': async () => {
        const c = await createCategoryQuick(d.type);
        if (!c) return;
        d.categoryId = c.id;
        d.catManual = true;
        refresh();
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
        if (!(await ask('¿Borrar este gasto?', { ok: 'Borrar', danger: true }))) return;
        store.deleteMovement(d.editId);
        checkSave();
        draft = null;
        toast('Gasto borrado');
        goBack('/movimientos');
      },
      'save-draft': saveDraft,
    },
    {
      input: (e) => {
        const id = e.target.id;
        if (id === 'f-amount') {
          d.amount = formatAmountInput(e.target);
          root.querySelector('#f-hint').innerHTML = budgetHint();
        } else if (id === 'f-desc') {
          d.desc = e.target.value;
          // Mientras no se toque una categoría a mano, la elige la descripción.
          if (!d.catManual) {
            d.categoryId = suggestCategory(d.desc, d.type, state);
            refresh();
          }
        }
      },
      change: (e) => {
        const id = e.target.id;
        if (id === 'f-variable') d.recurring.variable = e.target.checked;
        else if (id === 'f-workdays') {
          d.recurring.workdays = e.target.checked;
          root.querySelector('#f-rec').innerHTML = recurringPanel();
        }
      },
      keydown: (e) => {
        if (e.key === 'Enter' && (e.target.id === 'f-amount' || e.target.id === 'f-desc')) {
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
  if (!(d.amount > 0)) {
    toast('Falta el monto');
    return focusEnd('#f-amount');
  }
  const snap = store.snapshot();
  const desc = d.desc.trim();
  const changed = d.editId ? d.categoryId !== d.origCategoryId : d.catManual;
  if (changed && desc && d.categoryId && d.categoryId !== suggestCategory(desc, d.type, state)) store.learnRule(desc, d.categoryId);

  if (d.cuit) store.rememberMerchant(d.cuit, desc, d.categoryId);

  const data = { type: d.type, amount: d.amount, date: d.date, desc, categoryId: d.categoryId };
  let m;
  if (d.editId) {
    store.updateMovement(d.editId, data);
    m = store.getMovement(d.editId);
  } else {
    if (d.recurring) {
      const f = store.addRecurring(
        {
          name: desc || catOf(d.categoryId).name, type: 'gasto', amount: d.amount, variable: d.recurring.variable,
          categoryId: d.categoryId, ...recFromDraft(),
        },
        addDays(d.date, 1),
      );
      data.recurringId = f.id;
    }
    m = store.addMovement({ ...data, source: d.source });
  }
  checkSave();
  celebrate(d.editId ? 'Guardado' : '¡Gasto anotado!', budgetAlert(m));
  offerUndo(snap, d.editId ? 'Cambios guardados' : 'Gasto anotado');
  draft = null;
  goBack(d.editId ? '/movimientos' : '/');
}

/** Tarjeta de "Gasto rápido" cuando se abre #/rapido?monto=...&desc=... */
function showQuickCard(d) {
  const c = catOf(d.categoryId);
  sheet.className = 'sheet center';
  sheet.innerHTML = `<div class="qcard" tabindex="-1" autofocus>
    <div class="q-head"><span>${icon('bolt')} GASTO RÁPIDO</span>
      <button class="icon-btn sm" data-q="close" aria-label="Cerrar">${icon('x')}</button></div>
    <button class="q-cat" data-q="cat">${catIcon(c)}
      <span><b>${esc(d.desc || c.name)}</b><small class="${d.categoryId ? '' : 'warn-text'}">${esc(c.name)} ›</small></span>${icon('edit')}</button>
    <div class="q-amount">-${esc(cur())} ${fmtNumber(d.amount)}</div>
    ${budgetBox(d.categoryId, monthOf(d.date), d.amount)}
    <button class="btn primary" data-q="save">Agregar gasto</button>
    <button class="btn link" data-q="edit">Editar</button>
  </div>`;
  sheet.onclick = async (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    const q = b.dataset.q;
    if (q === 'close') closeSheet();
    else if (q === 'cat') {
      const id = await pickCategory('gasto', d.categoryId, suggestCategory(d.desc, 'gasto', state));
      if (id !== undefined) {
        d.categoryId = id;
        d.catManual = true;
      }
      showQuickCard(d);
    } else if (q === 'save') {
      closeSheet();
      const snap = store.snapshot();
      if (d.catManual && d.desc && d.categoryId) store.learnRule(d.desc, d.categoryId);
      const m = store.addMovement({ type: 'gasto', amount: d.amount, date: d.date, desc: d.desc, categoryId: d.categoryId, source: 'rapido' });
      checkSave();
      celebrate('¡Gasto anotado!', budgetAlert(m));
      renderHome();
      offerUndo(snap, 'Gasto anotado');
    } else if (q === 'edit') {
      closeSheet();
      draft = d;
      keepDraft = true;
      navigate('/rapido');
    }
  };
  if (!sheet.open) sheet.showModal();
}

// ---------- Gastos (historial) ----------

function historyList() {
  const q = normalizeText(histFilter.q);
  const list = store.movementsOf(viewMonth).filter(
    (m) =>
      m.type === 'gasto' &&
      (!histFilter.cat || (histFilter.cat === '__none' ? !m.categoryId : m.categoryId === histFilter.cat)) &&
      (!q || normalizeText(`${m.desc} ${catOf(m.categoryId).name}`).includes(q)),
  );
  if (!list.length) return `<div class="empty">${icon('search')}<p>No hay gastos${histFilter.q || histFilter.cat ? ' con ese filtro' : ' este mes'}.</p></div>`;
  const total = list.reduce((s, m) => s + m.amount, 0);
  return `<p class="summary-line">${list.length} ${list.length === 1 ? 'gasto' : 'gastos'} · ${money(total)}</p>
    ${movementList(list)}`;
}

function renderHistory() {
  const opt = (v, label, sel) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(label)}</option>`;
  mount(
    `<div class="screen">
      <header class="topbar main"><h1 class="brand-title">Historial</h1>${monthNav()}</header>
      <main class="content">
        <div class="filters">
          <label class="search">${icon('search')}<input id="hq" placeholder="Buscar" autocomplete="off" value="${esc(histFilter.q)}"></label>
          <select id="hcat" aria-label="Categoría">${opt('', 'Todas', histFilter.cat)}${opt('__none', 'Sin categoría', histFilter.cat)}${store
            .categoriesOf('gasto')
            .map((c) => opt(c.id, c.name, histFilter.cat))
            .join('')}</select>
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
        if (e.target.id !== 'hcat') return;
        histFilter.cat = e.target.value;
        root.querySelector('#hlist').innerHTML = historyList();
      },
    },
  );
}

// ---------- Análisis: gráfico, proyección y presupuestos ----------

/**
 * "En qué se fue la plata": una barra de 100 % partida por categoría (con separación entre tramos)
 * y la lista debajo como leyenda, con nombre, monto y porcentaje. Así no depende solo del color.
 */
function spendingChart(ranked, total, spentPrev, prevName) {
  if (!ranked.length) return '';
  const segs = ranked
    .map(([id, v]) => {
      const c = catOf(id);
      const pct = v / total;
      return `<button class="stack-seg" style="flex-grow:${v};background:${c.color}" data-action="seg" data-id="${id ?? ''}"
        aria-label="${esc(c.name)}: ${money(v)}, ${pctText(pct)}"></button>`;
    })
    .join('');
  const rows = ranked
    .map(([id, v]) => {
      const c = catOf(id);
      const pv = spentPrev.get(id) || 0;
      const delta = pv ? v / pv - 1 : null;
      return `<div class="legend-row" data-id="${id ?? ''}">
        ${catIcon(c, 'sm')}
        <span class="legend-name">${esc(c.name)}${
          delta === null ? '' : `<small class="${delta > 0 ? 'neg' : 'pos'}">${delta > 0 ? '+' : ''}${Math.round(delta * 100)} % vs ${prevName}</small>`
        }</span>
        <span class="legend-val"><b>${money(v)}</b><small>${pctText(v / total)}</small></span>
      </div>`;
    })
    .join('');
  return `<section class="card pad chart-card">
    <div class="sec-head"><h2>En qué se fue la plata</h2></div>
    <div class="stack" role="img" aria-label="Gasto por categoría">${segs}</div>
    <div class="legend">${rows}</div>
  </section>`;
}

function renderInsights() {
  const ym = viewMonth;
  const nowYm = store.currentMonth();
  const isCurrent = ym === nowYm;
  const prev = addMonths(ym, -1);
  const dim = daysInMonth(ym);
  const elapsed = isCurrent ? Number(todayStr().slice(8)) : ym < nowYm ? dim : 0;
  const total = store.totalsOf(ym).gastos;
  const spent = store.spentByCategory(ym);
  const spentPrev = store.spentByCategory(prev);
  const proj = (x) => (elapsed ? Math.round((x / elapsed) * dim) : 0);
  const prevName = MONTHS[Number(prev.slice(5)) - 1];

  // Comparación con el mes anterior (en el mes actual, hasta el mismo día).
  let prevGastos = 0;
  for (const m of state.movements) {
    if (m.type !== 'gasto' || !m.date.startsWith(prev)) continue;
    if (!isCurrent || Number(m.date.slice(8)) <= elapsed) prevGastos += m.amount;
  }
  let compare = '';
  if (prevGastos > 0 && total > 0) {
    const diff = total / prevGastos - 1;
    const more = diff > 0;
    compare = `<p class="compare ${more ? 'neg' : 'pos'}">${icon(more ? 'arrow-up' : 'arrow-down')}
      ${Math.abs(Math.round(diff * 100))} % ${more ? 'más' : 'menos'} que ${isCurrent ? `a esta altura de ${prevName}` : `en ${prevName}`}</p>`;
  }

  const totalLimit = state.budgets.reduce((s, b) => s + b.limit, 0);
  const projTotal = proj(total);
  const projCard =
    isCurrent && total > 0
      ? `<section class="card pad">
          <div class="sec-head"><h2>Proyección de fin de mes</h2></div>
          <div class="proj">
            <div><small>Si seguís a este ritmo</small><b class="${totalLimit && projTotal > totalLimit ? 'neg' : ''}">${money(projTotal)}</b></div>
            ${totalLimit ? `<div><small>Límite total</small><b>${money(totalLimit)}</b></div>` : ''}
          </div>
          ${totalLimit ? bar(projTotal / totalLimit) : ''}
        </section>`
      : '';

  const cats = store.categoriesOf('gasto');
  const withLimit = cats
    .filter((c) => store.getBudget(c.id))
    .map((c) => ({ c, s: spent.get(c.id) || 0, l: store.getBudget(c.id) }))
    .sort((a, b) => b.s / b.l - a.s / a.l);
  const noLimit = cats.filter((c) => !store.getBudget(c.id));

  const budgetHTML = `<section class="card pad">
    <div class="sec-head"><h2>Límites</h2><small class="muted-sm">Tocá para cambiar</small></div>
    ${withLimit
      .map(({ c, s, l }) => {
        const p = s / l;
        return `<div class="bud-row">
          <button class="bud-edit" data-action="set-budget" data-id="${c.id}">
            <div class="bud-top">${catIcon(c, 'sm')}<b>${esc(c.name)}</b><span>${money(s)} <small>/ ${money(l)}</small></span></div>
            ${bar(p)}
          </button>
          <div class="bud-foot"><span class="t-${tone(p)}">${pctText(p)}</span>
            <button class="bud-del" data-action="del-budget" data-id="${c.id}" aria-label="Quitar el límite de ${esc(c.name)}">${icon('trash')}</button></div>
        </div>`;
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

  mount(
    `<div class="screen">
      <header class="topbar main"><h1 class="brand-title">Análisis</h1>${monthNav()}</header>
      <main class="content">
        <section class="spent small">
          <div class="spent-label">Gastado</div>
          <div class="spent-amount">${money(total)}</div>
          ${compare}
        </section>
        ${spendingChart(ranked, total, spentPrev, prevName)}
        ${projCard}
        ${budgetHTML}
      </main>
      ${fab()}
      ${tabbar('/analisis')}
    </div>`,
    {
      seg: (el) => {
        const row = root.querySelector(`.legend-row[data-id="${el.dataset.id}"]`);
        root.querySelectorAll('.legend-row.hl, .stack-seg.hl').forEach((x) => x.classList.remove('hl'));
        el.classList.add('hl');
        row?.classList.add('hl');
        toast(el.getAttribute('aria-label'));
      },
      'del-budget': (el) => {
        const c = catOf(el.dataset.id);
        store.setBudget(c.id, 0);
        checkSave();
        toast(`${c.name} sin límite`);
        route(true);
      },
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
  animateTotal('analisis', total);
}

// ---------- Carga en lote ----------

function batchItemHTML(it, i) {
  const c = catOf(it.categoryId);
  return `<div class="batch-item${it.categoryId ? '' : ' unclassified'}" data-i="${i}">
    <button class="bi-ico" data-action="b-cat" data-i="${i}" id="bico-${i}">${catIcon(c)}</button>
    <div class="bi-main">
      <input class="bi-desc" data-i="${i}" value="${esc(it.desc)}" placeholder="Descripción" autocomplete="off">
      <button class="bi-cat" data-action="b-cat" data-i="${i}" id="bcat-${i}" style="--c:${c.color}">${esc(c.name)} ${icon('chev-down')}</button>
      <button class="bi-date" data-action="b-date" data-i="${i}">${icon('calendar')}<span>${fmtDateShort(it.date)}</span></button>
    </div>
    <div class="bi-side">
      <div class="bi-amt">
        <span class="bi-sign">${esc(cur())}</span>
        <input class="bi-amount" data-i="${i}" inputmode="numeric" value="${fmtNumber(it.amount)}">
      </div>
      <button class="icon-btn sm" data-action="b-del" data-i="${i}" aria-label="Quitar">${icon('trash')}</button>
    </div>
  </div>`;
}

function batchTotalHTML() {
  const total = batch.items.reduce((s, it) => s + it.amount, 0);
  const unc = batch.items.filter((it) => !it.categoryId).length;
  return `<small>TOTAL DEL LOTE · ${batch.items.length} ${batch.items.length === 1 ? 'gasto' : 'gastos'}</small>
    <b>${money(total)}</b>
    ${unc ? `<span class="warn-text">${unc} sin categoría</span>` : ''}`;
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
        <p class="muted">Un gasto por línea: <b>descripción y monto</b>. La fecha al principio es opcional (<b>12/03</b>).</p>
        <p class="info-line">${icon('camera')} <span>¿Una lista o un ticket en papel? Tocá el cuadro, elegí <b>Escanear texto</b> y apuntá con la cámara: el texto se escribe solo.</span></p>
        <textarea id="btext" class="batch-text" rows="9" autocapitalize="sentences"
          placeholder="Almuerzo 50.000&#10;Taxi 20.000&#10;Café 8.500&#10;12/09 Farmacia 12.300">${esc(batch.text)}</textarea>
        <div id="bproc"></div>
        <button class="btn primary" data-action="process">${icon('sparkles')} Procesar</button>
      </main>
    </div>`,
    {
      process: () => {
        const text = root.querySelector('#btext').value;
        batch.text = text;
        const { items, errors, ticket, total } = parseBatch(text);
        if (!items.length) {
          toast(errors.length ? 'No encontré montos en esas líneas' : 'Escribí al menos un gasto');
          return;
        }
        batch.items = items.map((it) => {
          const s = suggestCategory(it.desc, 'gasto', state);
          return { ...it, type: 'gasto', categoryId: s, suggested: s, catManual: false };
        });
        batch.errors = errors;
        batch.ticket = ticket;
        batch.total = total;
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
        <p class="info-line">${icon('info')} ${batch.ticket ? 'Parece un ticket: salteé totales, impuestos, pagos y descuentos.' : 'Confirmá las categorías antes de guardar.'}</p>
        ${batch.items.length > 1 ? `<button class="btn secondary" data-action="b-join">${icon('layers')} Juntar en un solo gasto</button>` : ''}
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
      'b-date': async (el) => {
        const it = batch.items[Number(el.dataset.i)];
        const v = await pickDate(it.date);
        if (!v) return;
        it.date = v;
        el.querySelector('span').textContent = fmtDateShort(v);
      },
      'b-cat': async (el) => {
        const i = Number(el.dataset.i);
        const it = batch.items[i];
        const id = await pickCategory(it.type, it.categoryId, it.suggested);
        if (id === undefined) return;
        it.categoryId = id;
        it.catManual = true;
        refreshItem(i);
      },
      // Todo en un gasto por el total (útil con tickets del súper): toma la categoría que más se repite.
      // Si el ticket trae su TOTAL impreso, se usa ese (ya tiene los descuentos).
      'b-join': () => {
        const its = batch.items;
        const count = {};
        for (const it of its) if (it.categoryId) count[it.categoryId] = (count[it.categoryId] || 0) + 1;
        const cat = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || null;
        batch.items = [{
          desc: '', amount: batch.total || its.reduce((t, it) => t + (it.amount || 0), 0), date: its[0].date, time: null,
          type: 'gasto', categoryId: cat, suggested: cat, catManual: false,
        }];
        route(true);
        toast(`Se juntaron ${its.length} gastos en uno`);
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
        const snap = store.snapshot();
        for (const it of batch.items) {
          if (it.catManual && it.desc && it.categoryId && it.categoryId !== suggestCategory(it.desc, it.type, state)) {
            store.learnRule(it.desc, it.categoryId);
          }
        }
        const saved = store.addMovements(
          batch.items.map((it) => ({
            type: 'gasto', amount: it.amount, date: it.date, desc: it.desc, categoryId: it.categoryId, source: batch.source,
          })),
        );
        if (batch.importMark) store.setSetting('lastImport', batch.importMark);
        checkSave();
        const alert = saved.map(budgetAlert).find(Boolean);
        const label = `${saved.length} ${saved.length === 1 ? 'gasto anotado' : 'gastos anotados'}`;
        celebrate(label, alert);
        offerUndo(snap, label[0].toUpperCase() + label.slice(1));
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
  const upTotal = upcoming.reduce((s, u) => s + (u.f.variable ? 0 : u.f.amount), 0);

  mount(
    `<div class="screen">
      ${topbar('Gastos fijos', { back: '/ajustes', right: `<button class="icon-btn" data-action="to" data-to="/fijo/nuevo" aria-label="Nuevo fijo">${icon('plus')}</button>` })}
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
            : `<div class="empty">${icon('repeat')}<p>No tenés gastos fijos.</p><small>Sumá el alquiler, la luz o Netflix para no cargarlos a mano.</small>
                <button class="btn primary" data-action="to" data-to="/fijo/nuevo">Nuevo fijo</button></div>`
        }
        ${
          upcoming.length
            ? `<section class="card pad">
                <div class="sec-head"><h2>${esc(fmtMonth(nextYm))}</h2><small class="muted-sm">${money(upTotal)}</small></div>
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
  if (f.every === 'diario')
    dayField = `<label class="check-row"><input type="checkbox" id="fx-workdays" ${f.workdays ? 'checked' : ''}> Solo de lunes a viernes</label>`;
  else if (f.every === 'semanal') dayField = `<select id="fx-day">${[1, 2, 3, 4, 5, 6, 0].map((x) => `<option value="${x}"${x === Number(f.day) ? ' selected' : ''}>${WEEKDAYS[x]}</option>`).join('')}</select>`;
  else if (f.every === 'anual')
    dayField = `<div class="two"><select id="fx-day">${opts(31, 1, f.day)}</select><select id="fx-month">${opts(12, 1, f.month, (x) => MONTHS[x - 1])}</select></div>`;
  else dayField = `<select id="fx-day">${opts(31, 1, Math.min(f.day, 31), (x) => `Día ${x}`)}</select>`;

  mount(
    `<div class="screen form-screen">
      ${topbar(existing ? 'Editar fijo' : 'Nuevo fijo', { back: '/fijos' })}
      <main class="content">
        <div class="field"><label class="field-label" for="fx-name">Nombre</label>
          <input id="fx-name" value="${esc(f.name)}" placeholder="Ej: Alquiler, Netflix, Sueldo" autocapitalize="sentences" maxlength="60"></div>
        <div class="field"><label class="field-label" for="fx-amount">Monto</label>
          <div class="amount-inline"><span>${esc(cur())}</span><input id="fx-amount" inputmode="numeric" value="${f.amount ? fmtNumber(f.amount) : ''}" placeholder="${f.variable ? 'Se pide al confirmar' : '0'}" ${f.variable ? 'disabled' : ''}></div>
          <label class="check-row"><input type="checkbox" id="fx-variable" ${f.variable ? 'checked' : ''}> El monto varía (luz, agua…): se pide al confirmar</label></div>
        <button class="field-row" data-action="fx-cat"><span class="field-label">Categoría</span><span class="field-val">${catIcon(c, 'sm')}<b>${esc(c.name)}</b></span>${icon('chev-right')}</button>
        <div class="field"><span class="field-label">Se repite</span>
          <div class="seg">${seg('every', 'diario', 'Diario')}${seg('every', 'semanal', 'Semanal')}${seg('every', 'mensual', 'Mensual')}${seg('every', 'anual', 'Anual')}</div></div>
        <div class="field">${f.every === 'diario' ? '' : `<span class="field-label">${f.every === 'semanal' ? 'Día de la semana' : 'Día'}</span>`}${dayField}</div>
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
          workdays: f.every === 'diario' && !!f.workdays,
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
        } else if (idt === 'fx-workdays') {
          f.workdays = e.target.checked;
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
        <input inputmode="numeric" class="pend-in" data-id="${p.id}" value="${p.amount ? fmtNumber(p.amount) : ''}" placeholder="${f.variable ? (f.every === 'diario' ? 'Monto de ese día' : 'Monto de este mes') : '0'}"></div>
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
        ${due.length > 1 ? `<button class="btn secondary" data-action="p-all">${icon('check')} Confirmar todos (${due.length})</button>` : ''}
        ${due.length ? due.map(card).join('') : `<div class="empty">${icon('check')}<p>Todo al día.</p><small>No hay fijos vencidos.</small></div>`}
        ${snoozed.length ? `<p class="label">Pospuestos para mañana</p>${snoozed.map(card).join('')}` : ''}
        <button class="btn link" data-action="to" data-to="/fijos">Ver gastos fijos</button>
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
      // Confirma de una todos los que tienen monto (los de monto variable sin completar quedan).
      'p-all': () => {
        const ready = due
          .map((p) => ({ p, amount: parseAmount(root.querySelector(`.pend-in[data-id="${p.id}"]`)?.value || '') }))
          .filter((x) => x.amount > 0);
        if (!ready.length) return toast('Completá los montos primero');
        const snap = store.snapshot();
        const saved = ready.map((x) => store.confirmPending(x.p.id, x.amount)).filter(Boolean);
        checkSave();
        const label = `${saved.length} ${saved.length === 1 ? 'confirmado' : 'confirmados'}`;
        celebrate(label[0].toUpperCase() + label.slice(1), saved.map(budgetAlert).find(Boolean));
        offerUndo(snap, label[0].toUpperCase() + label.slice(1));
        if (ready.length < due.length) toast('Los que no tienen monto quedaron para completar');
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

// ---------- Sin clasificar ----------

function renderUnclassified() {
  const list = state.movements.filter((m) => !m.categoryId).sort((a, b) => b.date.localeCompare(a.date));
  mount(
    `<div class="screen">
      ${topbar('Sin categoría', { back: '/' })}
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

// ---------- Gastos por mes ----------

/** Últimos 12 meses (del más viejo al actual), empezando desde el primer mes con gastos. */
function monthlySeries() {
  const totals = new Map();
  for (const m of state.movements) {
    if (m.type !== 'gasto') continue;
    const ym = monthOf(m.date);
    totals.set(ym, (totals.get(ym) || 0) + m.amount);
  }
  const now = store.currentMonth();
  let months = Array.from({ length: 12 }, (_, i) => addMonths(now, i - 11));
  const first = months.findIndex((ym) => totals.get(ym));
  months = first === -1 ? [now] : months.slice(first);
  return months.map((ym) => ({ ym, total: totals.get(ym) || 0 }));
}

const monthTitle = (ym) => {
  const [name, year] = fmtMonth(ym).split(' ');
  return `${name[0].toUpperCase()}${name.slice(1)} ${year}`;
};

function renderMonths(selected = store.currentMonth(), still = false) {
  const series = monthlySeries();
  const max = Math.max(...series.map((s) => s.total), 1);
  // Promedio de los meses ya cerrados (el actual todavía no terminó).
  const closed = series.filter((s) => s.ym !== store.currentMonth());
  const avg = closed.length ? Math.round(closed.reduce((a, s) => a + s.total, 0) / closed.length) : 0;
  const sel = series.find((s) => s.ym === selected) || series[series.length - 1];

  const bars = series
    .map(
      (s) => `<button class="mbar${s.ym === sel.ym ? ' on' : ''}" data-action="m-pick" data-ym="${s.ym}"
        aria-label="${monthTitle(s.ym)}: ${money(s.total)}">
        <span class="mbar-track"><i style="height:${((s.total / max) * 100).toFixed(1)}%"></i></span>
        <span class="mbar-lbl">${MONTHS[Number(s.ym.slice(5)) - 1].slice(0, 3)}</span>
      </button>`,
    )
    .join('');

  const rows = [...series]
    .reverse()
    .map((s) => {
      const prev = series.find((x) => x.ym === addMonths(s.ym, -1));
      const delta = prev && prev.total ? s.total / prev.total - 1 : null;
      return `<button class="row month-row${s.ym === sel.ym ? ' on' : ''}" data-action="m-open" data-ym="${s.ym}">
        <span class="mov-main"><b>${monthTitle(s.ym)}</b>${
          s.ym === store.currentMonth()
            ? '<small>En curso</small>'
            : delta === null
            ? ''
            : `<small class="${delta > 0 ? 'neg' : 'pos'}">${icon(delta > 0 ? 'arrow-up' : 'arrow-down')}${Math.abs(Math.round(delta * 100))} % vs. el anterior</small>`
        }</span>
        <span class="mov-amt">${money(s.total)}</span>${icon('chev-right')}
      </button>`;
    })
    .join('');

  mount(
    `<div class="screen">
      ${topbar('Gastos por mes', { back: '/ajustes' })}
      <main class="content">
        <section class="spent small">
          <div class="spent-label">${monthTitle(sel.ym)}</div>
          <div class="spent-amount">${money(sel.total)}</div>
          ${avg ? `<small>Promedio mensual: ${money(avg)}</small>` : ''}
        </section>
        <section class="card pad">
          <div class="mchart${still ? ' still' : ''}" role="img" aria-label="Gasto por mes, últimos ${series.length} meses">${bars}</div>
        </section>
        <div class="card list">${rows}</div>
      </main>
    </div>`,
    {
      'm-pick': (el) => renderMonths(el.dataset.ym, true),
      'm-open': (el) => {
        viewMonth = el.dataset.ym;
        navigate('/analisis');
      },
    },
  );
}

// ---------- Ajustes y backup ----------

function settingsRow(ic, title, sub, attrs) {
  return `<button class="row" ${attrs}><span class="row-ico">${icon(ic)}</span>
    <span class="mov-main"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>${icon('chev-right')}</button>`;
}

function renderSettings() {
  const s = state.settings;
  const active = state.recurring.filter((f) => f.active).length;
  mount(
    `<div class="screen">
      <header class="topbar main"><h1 class="brand-title">Ajustes</h1></header>
      <main class="content">
        <div class="card list">
          ${settingsRow('chart', 'Gastos por mes', 'Resumen de los últimos meses', 'data-action="to" data-to="/meses"')}
        </div>
        <div class="card list">
          ${settingsRow('repeat', 'Gastos fijos', `${active} ${active === 1 ? 'activo' : 'activos'}`, 'data-action="to" data-to="/fijos"')}
          ${settingsRow('layers', 'Carga en lote', 'Pegá varios gastos, uno por línea', 'data-action="to" data-to="/lote"')}
        </div>
        <p class="label">Backup</p>
        <div class="card list">
          ${settingsRow('download', 'Exportar backup', s.lastBackup ? `Último: ${esc(fmtDay(s.lastBackup.slice(0, 10)))}` : 'Nunca', 'data-action="export"')}
          ${settingsRow('upload', 'Importar backup', 'Reemplaza los datos de este celular', 'data-action="import"')}
        </div>
        <p class="foot">Todo se guarda solo en este celular · ${state.movements.length} gastos</p>
        <input type="file" id="file-json" accept="application/json,.json" hidden>
      </main>
      ${tabbar('/ajustes')}
    </div>`,
    {
      export: () => exportBackup(),
      import: () => root.querySelector('#file-json').click(),
    },
    {
      change: async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const text = await file.text();
        e.target.value = '';
        if (e.target.id === 'file-json') importBackup(text);
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
  // Un backup real pesa unos pocos KB; uno enorme no es de esta app y podría trabar el celular.
  if (text.length > 5_000_000) return toast('Ese archivo es demasiado grande para ser un backup');
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

// ---------- Arranque ----------

function syncViewport() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--vvh', `${h}px`);
}
window.visualViewport?.addEventListener('resize', syncViewport);
syncViewport();

// Al volver a la app: revisar fijos vencidos (puede haber cambiado el día) y, si estuvo más de 10 minutos
// afuera, volver al mes actual. El iPhone deja la app dormida en vez de cerrarla, y sin esto seguiría en el
// mes que se estaba mirando (o en el mes anterior, si cambió el mes mientras tanto).
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    return;
  }
  if (hiddenAt && Date.now() - hiddenAt > 10 * 60 * 1000) viewMonth = store.currentMonth();
  if (sheet.open) return;
  if (['', '#/', '#/movimientos', '#/analisis'].includes(location.hash)) route(true);
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

route();

// Pantalla de carga (está en index.html y solo se ve en celular): queda ~2 s desde que abrió la app y se
// desvanece. El setTimeout de respaldo la saca aunque no llegue el fin de la transición.
const splash = document.getElementById('splash');
if (splash && getComputedStyle(splash).display !== 'none') {
  setTimeout(() => {
    splash.classList.add('out');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    setTimeout(() => splash.remove(), 600);
  }, Math.max(0, 2000 - performance.now()));
} else {
  splash?.remove();
}
