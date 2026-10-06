/* Sachin's Tracker — vanilla JS, data in localStorage. */
(function () {
'use strict';
const STORE_KEY = 'sachin-tracker-v1';
const APP_VERSION = '1.0.0';
const $ = s => document.querySelector(s);

/* ---------- date helpers (device local time) ---------- */
const pad = n => String(n).padStart(2, '0');
const dkey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseKey = k => { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2] || 1); };
const now = () => new Date();
const todayKey = () => dkey(now());
const curMonthKey = () => todayKey().slice(0, 7);
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dkey(d); };
const addMonths = (mk, n) => { const d = parseKey(mk + '-01'); d.setMonth(d.getMonth() + n); return dkey(d).slice(0, 7); };
const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5);
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmtD = (k, o) => parseKey(k).toLocaleDateString('en-IN', o || { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDShort = k => fmtD(k, { weekday: 'short', day: 'numeric', month: 'short' });
const monthName = (mk, short) => parseKey(mk + '-01').toLocaleDateString('en-IN', short ? { month: 'short' } : { month: 'long', year: 'numeric' });
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = n => inr.format(Math.round((+n || 0) * 100) / 100);
const num = v => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

/* ---------- state ---------- */
let S;
function blank() {
  return { version: 1, checklists: [], avoid: { items: [], log: {} }, grocery: { master: [], months: {} }, goals: [], meta: { created: now().toISOString() } };
}
function normalize(d) {
  const b = blank();
  if (!d || typeof d !== 'object') return b;
  const o = {
    version: 1,
    checklists: Array.isArray(d.checklists) ? d.checklists : [],
    avoid: { items: (d.avoid && Array.isArray(d.avoid.items)) ? d.avoid.items : [], log: (d.avoid && d.avoid.log && typeof d.avoid.log === 'object') ? d.avoid.log : {} },
    grocery: { master: (d.grocery && Array.isArray(d.grocery.master)) ? d.grocery.master : [], months: (d.grocery && d.grocery.months && typeof d.grocery.months === 'object') ? d.grocery.months : {} },
    goals: Array.isArray(d.goals) ? d.goals : [],
    meta: d.meta || b.meta
  };
  o.checklists.forEach(c => { c.items = Array.isArray(c.items) ? c.items : []; });
  o.goals.forEach(g => { g.dates = Array.isArray(g.dates) ? g.dates : []; g.prior = +g.prior || 0; g.target = Math.max(1, +g.target || 1); });
  Object.values(o.grocery.months).forEach(m => { m.items = Array.isArray(m.items) ? m.items : []; });
  return o;
}
function load() {
  try { S = normalize(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); } catch (e) { S = blank(); }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch (e) { toast('Could not save: storage full?'); }
}

/* ---------- UI state ---------- */
const ui = {
  tab: 'checklists', listId: null, reorder: false,
  avoidDate: null, avoidId: null, avoidMonth: null,
  gMode: 'month', gMonth: null, gFilter: null, gYear: null,
  goalId: null, seenMonth: null, seenDay: null
};
const titles = { checklists: 'Checklists', avoid: 'Avoid', grocery: 'Grocery', goals: 'Goals', settings: 'Settings' };

/* ---------- generic helpers ---------- */
function move(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return false;
  const t = arr[i]; arr[i] = arr[j]; arr[j] = t; return true;
}
function reorderBtns(kind, id, i, len) {
  return '<div class="reorder"><button class="icon-btn sm" data-act="move" data-kind="' + kind + '" data-id="' + id + '" data-dir="-1" aria-label="Move up" ' + (i === 0 ? 'disabled' : '') + '>↑</button>' +
    '<button class="icon-btn sm" data-act="move" data-kind="' + kind + '" data-id="' + id + '" data-dir="1" aria-label="Move down" ' + (i === len - 1 ? 'disabled' : '') + '>↓</button></div>';
}
let toastTimer;
function toast(msg, actLabel, actFn) {
  const t = $('#toast');
  t.innerHTML = '<span>' + esc(msg) + '</span>' + (actLabel ? '<button type="button">' + esc(actLabel) + '</button>' : '');
  if (actLabel) t.querySelector('button').onclick = () => { t.classList.remove('show'); actFn(); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), actLabel ? 5000 : 2400);
}

/* Bottom sheet with a form. fields: [{name,label,type,value,placeholder,options,min,step,required}] */
function closeSheet() { $('#sheetRoot').innerHTML = ''; }
function formSheet(opts) {
  return new Promise(resolve => {
    const f = (opts.fields || []).map(x => {
      const id = 'f_' + x.name;
      let inp;
      if (x.type === 'select') {
        inp = '<select class="field" id="' + id + '" name="' + x.name + '">' + x.options.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(x.value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
      } else {
        inp = '<input class="field" id="' + id + '" name="' + x.name + '" type="' + (x.type || 'text') + '" value="' + esc(x.value == null ? '' : x.value) + '"' +
          (x.placeholder ? ' placeholder="' + esc(x.placeholder) + '"' : '') + (x.min != null ? ' min="' + x.min + '"' : '') + (x.max != null ? ' max="' + x.max + '"' : '') +
          (x.step ? ' step="' + x.step + '"' : '') + (x.inputmode ? ' inputmode="' + x.inputmode + '"' : '') + (x.required ? ' required' : '') + ' autocomplete="off">';
      }
      return '<label class="lbl" for="' + id + '">' + esc(x.label) + '</label>' + inp + (x.hint ? '<div class="tiny muted" style="margin:4px 2px">' + esc(x.hint) + '</div>' : '');
    }).join('');
    $('#sheetRoot').innerHTML = '<div class="sheet-bg"><form class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(opts.title) + '"><div class="grab"></div><h3>' + esc(opts.title) + '</h3>' +
      (opts.message ? '<p class="muted" style="margin:4px 0">' + opts.message + '</p>' : '') + f +
      '<div class="actions"><button type="button" class="btn" data-x="cancel">Cancel</button><button type="submit" class="btn ' + (opts.danger ? 'danger' : 'primary') + '" data-x="ok">' + esc(opts.ok || 'Save') + '</button></div></form></div>';
    const bg = $('#sheetRoot .sheet-bg'), form = bg.querySelector('form');
    const done = v => { closeSheet(); resolve(v); };
    bg.addEventListener('click', e => { if (e.target === bg) done(null); });
    form.querySelector('[data-x=cancel]').onclick = () => done(null);
    form.onsubmit = e => { e.preventDefault(); const v = {}; new FormData(form).forEach((val, k) => { v[k] = typeof val === 'string' ? val.trim() : val; }); done(v); };
    const first = form.querySelector('input,select');
    if (first && opts.focus !== false) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 60);
  });
}
const confirmSheet = (title, message, ok, danger) => formSheet({ title, message: esc(message), ok: ok || 'OK', danger: danger !== false, fields: [] }).then(v => !!v);
function menuSheet(title, items) {
  return new Promise(resolve => {
    $('#sheetRoot').innerHTML = '<div class="sheet-bg"><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="grab"></div><h3>' + esc(title) + '</h3><div class="menu-list">' +
      items.map((it, i) => '<button type="button" data-i="' + i + '" class="' + (it.danger ? 'danger' : '') + '"><span>' + (it.icon || '') + '</span>' + esc(it.label) + '</button>').join('') +
      '<button type="button" data-i="-1" class="muted">Cancel</button></div></div></div>';
    const bg = $('#sheetRoot .sheet-bg');
    bg.addEventListener('click', e => {
      if (e.target === bg) { closeSheet(); return resolve(null); }
      const b = e.target.closest('button[data-i]'); if (!b) return;
      closeSheet(); const i = +b.dataset.i; resolve(i >= 0 ? items[i].value : null);
    });
  });
}

/* =====================================================================
   CHECKLISTS
   ===================================================================== */
function viewChecklists() {
  const L = S.checklists.find(c => c.id === ui.listId);
  if (L) return viewChecklist(L);
  ui.listId = null;
  let h = '';
  if (!S.checklists.length) {
    h += '<div class="empty"><div class="big">📝</div><div class="bold">No checklists yet</div><div class="small">Make reusable lists — packing, “things I don’t eat”, weekly chores…</div></div>';
  }
  S.checklists.forEach((c, i) => {
    const n = c.items.length, d = c.items.filter(x => x.done).length;
    h += '<div class="card ' + (ui.reorder ? '' : 'tap') + '" ' + (ui.reorder ? '' : 'data-act="openList" data-id="' + c.id + '"') + ' data-testid="list-card">' +
      '<div class="row"><div class="grow"><h3 class="ellipsis">' + esc(c.name) + '</h3><div class="small muted">' + (n ? d + ' of ' + plural(n, 'item') + ' checked' : 'Empty list') + '</div></div>' +
      (ui.reorder ? reorderBtns('list', c.id, i, S.checklists.length) : '<button class="icon-btn ghost" data-act="listMenu" data-id="' + c.id + '" aria-label="List options">⋯</button>') + '</div>' +
      (n && !ui.reorder ? '<div class="progress" style="margin-top:10px"><i style="width:' + (d / n * 100) + '%"></i></div>' : '') + '</div>';
  });
  h += '<div class="fab-row"><button class="btn primary block" data-act="newList">＋ New checklist</button></div>';
  return h;
}
function viewChecklist(L) {
  const n = L.items.length, d = L.items.filter(x => x.done).length;
  let h = '<div class="row between" style="margin:2px 0 6px"><button class="btn sm" data-act="closeList">‹ All lists</button>' +
    '<div class="small muted">' + d + '/' + n + ' checked</div></div>';
  h += '<form class="add-form" data-form="addItem"><input class="field" name="text" placeholder="Add an item…" autocomplete="off" aria-label="New item"><button class="btn primary" type="submit" aria-label="Add item">Add</button></form>';
  if (!n) h += '<div class="empty"><div class="big">🧺</div>No items yet. Add some above.</div>';
  else {
    const order = ui.reorder ? L.items : L.items.filter(x => !x.done).concat(L.items.filter(x => x.done));
    h += '<div class="card" style="padding:4px 10px">' + order.map(it => {
      const i = L.items.indexOf(it);
      return '<div class="item ' + (it.done ? 'done' : '') + '" data-testid="list-item">' +
        (ui.reorder ? '' : '<button class="check ' + (it.done ? 'on' : '') + '" data-act="toggleItem" data-id="' + it.id + '" aria-label="Toggle ' + esc(it.text) + '" aria-pressed="' + !!it.done + '"><i>✓</i></button>') +
        '<div class="txt" ' + (ui.reorder ? 'style="padding-left:10px"' : 'data-act="editItem" data-id="' + it.id + '"') + '>' + esc(it.text) + '</div>' +
        (ui.reorder ? reorderBtns('item', it.id, i, n) : '<button class="icon-btn ghost sm" data-act="delItem" data-id="' + it.id + '" aria-label="Delete ' + esc(it.text) + '">✕</button>') + '</div>';
    }).join('') + '</div>';
    h += '<div class="fab-row"><button class="btn block" data-act="resetList" ' + (d ? '' : 'disabled') + '>↺ Uncheck all</button></div>';
  }
  return h;
}
function curList() { return S.checklists.find(c => c.id === ui.listId); }
async function listMenu(id) {
  const c = S.checklists.find(x => x.id === id); if (!c) return;
  const v = await menuSheet(c.name, [
    { label: 'Rename', value: 'rename', icon: '✏️' }, { label: 'Uncheck all', value: 'reset', icon: '↺' },
    { label: 'Duplicate', value: 'dup', icon: '⧉' }, { label: 'Reorder lists', value: 'reorder', icon: '↕️' },
    { label: 'Delete list', value: 'del', icon: '🗑️', danger: true }]);
  if (v === 'rename') {
    const r = await formSheet({ title: 'Rename checklist', fields: [{ name: 'name', label: 'Name', value: c.name, required: true }] });
    if (r && r.name) { c.name = r.name; save(); render(); }
  } else if (v === 'reset') { c.items.forEach(x => x.done = false); save(); render(); toast('All items unchecked'); }
  else if (v === 'dup') {
    const copy = { id: uid(), name: c.name + ' (copy)', created: now().toISOString(), items: c.items.map(x => ({ id: uid(), text: x.text, done: false })) };
    S.checklists.splice(S.checklists.indexOf(c) + 1, 0, copy); save(); render(); toast('Duplicated');
  } else if (v === 'reorder') { ui.listId = null; ui.reorder = true; render(); }
  else if (v === 'del') {
    if (await confirmSheet('Delete “' + c.name + '”?', 'This removes the list and its ' + plural(c.items.length, 'item') + '.', 'Delete')) {
      const idx = S.checklists.indexOf(c); S.checklists.splice(idx, 1);
      if (ui.listId === id) ui.listId = null; save(); render();
      toast('List deleted', 'Undo', () => { S.checklists.splice(idx, 0, c); save(); render(); });
    }
  }
}

/* =====================================================================
   AVOID (daily yes/no)
   ===================================================================== */
const avLog = id => (S.avoid.log[id] = S.avoid.log[id] || {});
function setAvoid(id, day, val) {
  const log = avLog(id);
  if (val) log[day] = val; else delete log[day];
  save();
}
function avoidStats(it) {
  const log = S.avoid.log[it.id] || {}, t = todayKey();
  let cur = 0, d = log[t] === 'kept' ? t : (log[t] === 'broken' ? null : addDays(t, -1));
  while (d && log[d] === 'kept') { cur++; d = addDays(d, -1); }
  const kept = Object.keys(log).filter(k => log[k] === 'kept').sort();
  let best = 0, run = 0, prev = null;
  kept.forEach(k => { run = (prev && addDays(prev, 1) === k) ? run + 1 : 1; best = Math.max(best, run); prev = k; });
  const broken = Object.keys(log).filter(k => log[k] === 'broken').length;
  return { cur, best, kept: kept.length, broken };
}
function viewAvoid() {
  const it = S.avoid.items.find(x => x.id === ui.avoidId);
  if (it) return viewAvoidDetail(it);
  ui.avoidId = null;
  const t = todayKey();
  if (!ui.avoidDate || ui.avoidDate > t) ui.avoidDate = t;
  const day = ui.avoidDate;
  let h = '';
  if (!S.avoid.items.length) {
    return '<div class="empty"><div class="big">🚫</div><div class="bold">Nothing to avoid yet</div><div class="small">Add habits you want to stay away from — sweets, cold drinks, late-night phone…<br>Each day, mark whether you kept away or slipped.</div></div>' +
      '<div class="fab-row"><button class="btn primary block" data-act="newAvoid">＋ Add a habit to avoid</button></div>';
  }
  if (!ui.reorder) {
    h += '<div class="datebar"><button class="icon-btn ghost" data-act="avDay" data-dir="-1" aria-label="Previous day">‹</button><div class="lab" data-testid="avoid-date">' +
      (day === t ? 'Today · ' : day === addDays(t, -1) ? 'Yesterday · ' : '') + fmtDShort(day) + '</div>' +
      '<button class="icon-btn ghost" data-act="avDay" data-dir="1" aria-label="Next day" ' + (day >= t ? 'disabled' : '') + '>›</button></div>';
    const pending = S.avoid.items.filter(x => !avLog(x.id)[day]).length;
    if (pending > 1) h += '<button class="btn sm block" data-act="avAllKept" style="margin:4px 0">✓ Mark remaining ' + pending + ' as avoided</button>';
  }
  S.avoid.items.forEach((x, i) => {
    const v = (S.avoid.log[x.id] || {})[day], st = avoidStats(x);
    h += '<div class="card" data-testid="avoid-card"><div class="row"><div class="grow ' + (ui.reorder ? '' : 'tap') + '" ' + (ui.reorder ? '' : 'data-act="openAvoid" data-id="' + x.id + '"') + '>' +
      '<h3 class="ellipsis">' + esc(x.name) + '</h3><div class="small muted">🔥 ' + st.cur + '-day streak · best ' + st.best + '</div></div>' +
      (ui.reorder ? reorderBtns('avoid', x.id, i, S.avoid.items.length) : '<button class="icon-btn ghost" data-act="avoidMenu" data-id="' + x.id + '" aria-label="Habit options">⋯</button>') + '</div>';
    if (!ui.reorder) {
      h += '<div class="small" style="margin-top:8px">Did I avoid ' + esc(x.name.toLowerCase()) + (day === t ? ' today' : ' on ' + fmtD(day, { day: 'numeric', month: 'short' })) + '?</div>' +
        '<div class="avoid-btns"><button class="kept ' + (v === 'kept' ? 'on' : '') + '" data-act="avSet" data-id="' + x.id + '" data-v="kept" aria-pressed="' + (v === 'kept') + '">✓ Yes, avoided</button>' +
        '<button class="broken ' + (v === 'broken' ? 'on' : '') + '" data-act="avSet" data-id="' + x.id + '" data-v="broken" aria-pressed="' + (v === 'broken') + '">✗ No, slipped</button></div>';
      h += '<div class="strip">';
      for (let k = 6; k >= 0; k--) {
        const dk = addDays(day, -k), s = (S.avoid.log[x.id] || {})[dk];
        h += '<span><b class="' + (s === 'kept' ? 'k' : s === 'broken' ? 'x' : '') + '"></b>' + parseKey(dk).toLocaleDateString('en-IN', { weekday: 'narrow' }) + '</span>';
      }
      h += '</div>';
    }
    h += '</div>';
  });
  h += '<div class="fab-row"><button class="btn primary block" data-act="newAvoid">＋ Add a habit to avoid</button></div>';
  return h;
}
function calendarHTML(mk, cellFn) {
  const first = parseKey(mk + '-01'), days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  let h = '<div class="cal">' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => '<div class="hd">' + x + '</div>').join('');
  for (let i = 0; i < first.getDay(); i++) h += '<div></div>';
  for (let d = 1; d <= days; d++) h += cellFn(mk + '-' + pad(d), d);
  return h + '</div>';
}
function viewAvoidDetail(it) {
  const t = todayKey();
  ui.avoidMonth = ui.avoidMonth || t.slice(0, 7);
  const mk = ui.avoidMonth, log = avLog(it.id), st = avoidStats(it);
  const mKept = Object.keys(log).filter(k => k.startsWith(mk) && log[k] === 'kept').length;
  const mBroken = Object.keys(log).filter(k => k.startsWith(mk) && log[k] === 'broken').length;
  let h = '<div class="row between" style="margin:2px 0 6px"><button class="btn sm" data-act="closeAvoid">‹ All habits</button><button class="icon-btn ghost" data-act="avoidMenu" data-id="' + it.id + '" aria-label="Habit options">⋯</button></div>';
  h += '<div class="card"><h3>' + esc(it.name) + '</h3><div class="stats">' +
    '<div class="stat"><b data-testid="av-cur">🔥 ' + st.cur + '</b><span>current streak</span></div><div class="stat"><b data-testid="av-best">' + st.best + '</b><span>best streak</span></div>' +
    '<div class="stat"><b>' + (st.kept + st.broken ? Math.round(st.kept / (st.kept + st.broken) * 100) : 0) + '%</b><span>days kept</span></div></div></div>';
  h += '<div class="card"><div class="datebar" style="margin:0;border:0;padding:0"><button class="icon-btn ghost" data-act="avMonth" data-dir="-1" aria-label="Previous month">‹</button><div class="lab">' + monthName(mk) + '</div>' +
    '<button class="icon-btn ghost" data-act="avMonth" data-dir="1" aria-label="Next month" ' + (mk >= t.slice(0, 7) ? 'disabled' : '') + '>›</button></div>';
  h += calendarHTML(mk, (dk, d) => {
    const s = log[dk];
    return '<button class="' + (s === 'kept' ? 'k' : s === 'broken' ? 'x' : '') + (dk === t ? ' today' : '') + '" data-act="avCycle" data-id="' + it.id + '" data-day="' + dk + '" ' + (dk > t ? 'disabled' : '') +
      ' aria-label="' + fmtD(dk) + ': ' + (s || 'not logged') + '">' + d + '</button>';
  });
  h += '<div class="legend"><span><i class="k"></i>Kept ' + mKept + '</span><span><i class="x"></i>Slipped ' + mBroken + '</span><span><i></i>Not logged</span></div>' +
    '<div class="tiny muted" style="margin-top:8px">Tap a day to cycle: kept → slipped → clear.</div></div>';
  return h;
}
async function avoidMenu(id) {
  const it = S.avoid.items.find(x => x.id === id); if (!it) return;
  const v = await menuSheet(it.name, [{ label: 'Rename', value: 'rename', icon: '✏️' }, { label: 'Reorder habits', value: 'reorder', icon: '↕️' }, { label: 'Delete habit', value: 'del', icon: '🗑️', danger: true }]);
  if (v === 'rename') {
    const r = await formSheet({ title: 'Rename habit', fields: [{ name: 'name', label: 'What to avoid', value: it.name, required: true }] });
    if (r && r.name) { it.name = r.name; save(); render(); }
  } else if (v === 'reorder') { ui.avoidId = null; ui.reorder = true; render(); }
  else if (v === 'del') {
    if (await confirmSheet('Delete “' + it.name + '”?', 'Its whole history will be removed.', 'Delete')) {
      const idx = S.avoid.items.indexOf(it), log = S.avoid.log[id];
      S.avoid.items.splice(idx, 1); delete S.avoid.log[id]; ui.avoidId = null; save(); render();
      toast('Habit deleted', 'Undo', () => { S.avoid.items.splice(idx, 0, it); if (log) S.avoid.log[id] = log; save(); render(); });
    }
  }
}

/* =====================================================================
   GROCERY
   ===================================================================== */
const G = () => S.grocery;
const lineTotal = it => num(it.qty) * num(it.price);
function lastPrice(mid, beforeMk) {
  const keys = Object.keys(G().months).filter(k => k < beforeMk).sort().reverse();
  for (const k of keys) {
    const it = G().months[k].items.find(i => i.mid === mid && i.bought && num(i.price) > 0);
    if (it) return num(it.price);
  }
  const m = G().master.find(x => x.id === mid);
  return m ? num(m.price) : 0;
}
const monthItem = (m, mk) => ({ mid: m.id, name: m.name, unit: m.unit || '', cat: m.cat || '', want: false, bought: false, qty: 1, price: lastPrice(m.id, mk) });
/* Create the current month's list from the master list if it doesn't exist (automatic rollover). */
function ensureMonth(mk) {
  mk = mk || curMonthKey();
  if (G().months[mk]) return false;
  G().months[mk] = { created: now().toISOString(), items: G().master.map(m => monthItem(m, mk)) };
  save();
  return true;
}
function monthTotals(mo) {
  let spent = 0, planned = 0, nb = 0, nw = 0;
  (mo ? mo.items : []).forEach(it => {
    if (it.bought) { spent += lineTotal(it); nb++; }
    else if (it.want) { planned += lineTotal(it); nw++; }
  });
  return { spent, planned, nb, nw };
}
function sortedIdx(items) {
  return items.map((it, i) => i).sort((a, b) => {
    const A = items[a], B = items[b];
    return (A.cat || '~').localeCompare(B.cat || '~') || A.name.localeCompare(B.name);
  });
}
function viewGrocery() {
  ensureMonth();
  let h = '<div class="seg" role="tablist">' + [['month', 'Month'], ['year', 'Year'], ['items', 'Items']].map(x =>
    '<button class="' + (ui.gMode === x[0] ? 'on' : '') + '" data-act="gMode" data-m="' + x[0] + '" role="tab" aria-selected="' + (ui.gMode === x[0]) + '">' + x[1] + '</button>').join('') + '</div>';
  if (ui.gMode === 'year') return h + viewGYear();
  if (ui.gMode === 'items') return h + viewGItems();
  return h + viewGMonth();
}
function viewGMonth() {
  const cur = curMonthKey();
  if (!ui.gMonth || !G().months[ui.gMonth]) ui.gMonth = cur;
  const mk = ui.gMonth, mo = G().months[mk], keys = Object.keys(G().months).sort();
  const ki = keys.indexOf(mk);
  let h = '<div class="datebar"><button class="icon-btn ghost" data-act="gMonthNav" data-dir="-1" aria-label="Previous month" ' + (ki <= 0 ? 'disabled' : '') + '>‹</button>' +
    '<div class="lab" data-testid="g-month">' + monthName(mk) + (mk === cur ? '' : ' <span class="badge">past</span>') + '</div>' +
    '<button class="icon-btn ghost" data-act="gMonthNav" data-dir="1" aria-label="Next month" ' + (ki >= keys.length - 1 ? 'disabled' : '') + '>›</button></div>';
  if (!G().master.length) {
    return h + '<div class="empty"><div class="big">🛒</div><div class="bold">Set up your grocery items</div><div class="small">Add the things you usually buy (name, unit, usual price). Every month gets a fresh list from these automatically.</div></div>' +
      '<div class="fab-row"><button class="btn primary block" data-act="gAddMaster">＋ Add grocery item</button></div>';
  }
  const tt = monthTotals(mo);
  h += '<div class="card summary"><div><div class="small muted">Spent</div><div class="big" id="gSpent" data-testid="g-spent">' + money(tt.spent) + '</div><div class="tiny muted" id="gSpentN">' + plural(tt.nb, 'item') + ' bought</div></div>' +
    '<div><div class="small muted">Still to buy</div><div class="big" id="gPlan">' + money(tt.planned) + '</div><div class="tiny muted" id="gPlanN">' + plural(tt.nw, 'item') + ' · est.</div></div></div>';
  const filter = ui.gFilter || (tt.nw + tt.nb ? 'list' : 'all');
  h += '<div class="chips">' + [['list', 'Shopping list'], ['tobuy', 'To buy'], ['bought', 'Bought'], ['all', 'All items']].map(x =>
    '<button class="chip ' + (filter === x[0] ? 'on' : '') + '" data-act="gFilter" data-f="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
  const show = it => filter === 'all' || (filter === 'list' && (it.want || it.bought)) || (filter === 'tobuy' && it.want && !it.bought) || (filter === 'bought' && it.bought);
  const idx = sortedIdx(mo.items).filter(i => show(mo.items[i]));
  if (!idx.length) {
    h += '<div class="empty small">' + (filter === 'bought' ? 'Nothing bought yet this month.' : filter === 'all' ? 'No items.' : 'Nothing planned. Open <b>All items</b> and tap 🛒 on what you want to buy.') + '</div>';
  } else {
    h += '<div class="card" style="padding:2px 12px">';
    let lastCat = null;
    const anyCat = idx.some(j => mo.items[j].cat);
    idx.forEach(i => {
      const it = mo.items[i];
      if ((it.cat || '') !== lastCat) { lastCat = it.cat || ''; if (anyCat) h += '<div class="g-cat">' + esc(lastCat || 'Other') + '</div>'; }
      const active = it.want || it.bought;
      h += '<div class="g-row ' + (it.want ? 'want ' : '') + (it.bought ? 'bought' : '') + '" data-testid="g-row" data-name="' + esc(it.name) + '">' +
        '<button class="g-want" data-act="gWant" data-i="' + i + '" aria-label="Want to buy ' + esc(it.name) + '" aria-pressed="' + !!it.want + '">🛒</button>' +
        '<div class="g-main"><div class="g-name">' + esc(it.name) + (it.unit ? ' <span class="muted small">· ' + esc(it.unit) + '</span>' : '') + '</div>' +
        (active ? '<div class="g-edit"><input data-chg="gQty" data-i="' + i + '" type="number" inputmode="decimal" step="any" min="0" value="' + esc(it.qty) + '" aria-label="Quantity of ' + esc(it.name) + '">' +
          '<span class="muted small">× ₹</span><input class="price" data-chg="gPrice" data-i="' + i + '" type="number" inputmode="decimal" step="any" min="0" value="' + esc(it.price) + '" aria-label="Price per unit of ' + esc(it.name) + '">' +
          '<span class="g-line" id="gl' + i + '">' + money(lineTotal(it)) + '</span></div>'
          : '<div class="small muted">' + (num(it.price) ? money(it.price) + (it.unit ? ' / ' + esc(it.unit) : '') : 'No price yet') + '</div>') +
        '</div><button class="g-check" data-act="gBought" data-i="' + i + '" aria-label="Bought ' + esc(it.name) + '" aria-pressed="' + !!it.bought + '">✓</button></div>';
    });
    h += '</div>';
  }
  const prev = keys[ki - 1];
  if (prev && filter !== 'bought' && !tt.nw && !tt.nb) h += '<div class="center" style="margin-top:8px"><button class="btn sm" data-act="gCopyPlan">⧉ Copy plan from ' + monthName(prev, true) + '</button></div>';
  h += '<div class="fab-row"><button class="btn block" data-act="gAddMaster">＋ New grocery item</button></div>';
  h += '<div class="tiny muted center">Price is per unit; line total = qty × price. A new month list is created automatically on the 1st.</div>';
  return h;
}
function updateGTotals(i) {
  const mo = G().months[ui.gMonth], tt = monthTotals(mo);
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  if (i != null) set('gl' + i, money(lineTotal(mo.items[i])));
  set('gSpent', money(tt.spent)); set('gPlan', money(tt.planned));
  set('gSpentN', plural(tt.nb, 'item') + ' bought'); set('gPlanN', plural(tt.nw, 'item') + ' · est.');
}
function yearData(y) {
  const months = [], items = {};
  for (let m = 1; m <= 12; m++) {
    const mk = y + '-' + pad(m), mo = G().months[mk];
    let total = 0;
    if (mo) mo.items.forEach(it => {
      if (!it.bought) return;
      const lt = lineTotal(it); total += lt;
      const key = it.mid || it.name;
      const a = items[key] = items[key] || { key, name: it.name, unit: it.unit, times: 0, qty: 0, spend: 0, hist: [] };
      a.times++; a.qty += num(it.qty); a.spend += lt; a.hist.push({ mk, price: num(it.price), qty: num(it.qty) });
    });
    months.push({ mk, total });
  }
  return { months, total: months.reduce((s, m) => s + m.total, 0), items: Object.values(items).sort((a, b) => b.spend - a.spend) };
}
function viewGYear() {
  const t = todayKey(), cy = +t.slice(0, 4);
  ui.gYear = ui.gYear || cy;
  const years = Object.keys(G().months).map(k => +k.slice(0, 4));
  const minY = Math.min.apply(null, years.concat([cy]));
  const y = ui.gYear, yd = yearData(y), max = Math.max.apply(null, yd.months.map(m => m.total).concat([1]));
  const active = yd.months.filter(m => m.total > 0);
  let h = '<div class="datebar"><button class="icon-btn ghost" data-act="gYearNav" data-dir="-1" aria-label="Previous year" ' + (y <= minY ? 'disabled' : '') + '>‹</button><div class="lab">' + y + '</div>' +
    '<button class="icon-btn ghost" data-act="gYearNav" data-dir="1" aria-label="Next year" ' + (y >= cy ? 'disabled' : '') + '>›</button></div>';
  h += '<div class="card"><div class="row between"><div><div class="small muted">Spent in ' + y + '</div><div style="font-size:1.7rem;font-weight:800" data-testid="g-year-total">' + money(yd.total) + '</div></div>' +
    '<div class="center"><div class="small muted">Avg / month</div><div class="bold">' + money(active.length ? Math.round(yd.total / active.length) : 0) + '</div></div></div>' +
    '<div class="bars">' + yd.months.map(m => '<div class="bar ' + (m.mk === t.slice(0, 7) ? 'cur' : '') + '" title="' + monthName(m.mk) + ': ' + money(m.total) + '"><i style="height:' + (m.total / max * 100) + '%"></i><span>' + monthName(m.mk, true).slice(0, 3) + '</span></div>').join('') + '</div></div>';
  h += '<h2>Month totals</h2><div class="card" style="padding:4px 12px"><table class="t" data-testid="g-month-totals">' +
    (active.length ? active.map(m => '<tr><td><button class="btn sm" data-act="gGoMonth" data-mk="' + m.mk + '">' + monthName(m.mk) + '</button></td><td class="r bold">' + money(m.total) + '</td></tr>').join('') : '<tr><td class="muted">No purchases recorded in ' + y + '.</td></tr>') +
    '</table></div>';
  if (yd.items.length) {
    h += '<h2>What I bought in ' + y + '</h2><div class="card" style="padding:4px 10px"><table class="t"><tr><th>Item</th><th class="r">Qty</th><th class="r">Spent</th><th class="r">Price Δ</th></tr>' +
      yd.items.map(a => {
        const f = a.hist[0].price, l = a.hist[a.hist.length - 1].price, ch = f ? (l - f) / f * 100 : 0;
        return '<tr data-act="gHist" data-key="' + esc(a.key) + '" data-testid="g-year-item" style="cursor:pointer"><td><div class="bold">' + esc(a.name) + '</div><div class="tiny muted">' + plural(a.times, 'month') + ' · now ' + money(l) + (a.unit ? '/' + esc(a.unit) : '') + '</div></td>' +
          '<td class="r">' + (+a.qty.toFixed(2)) + (a.unit ? ' ' + esc(a.unit) : '') + '</td><td class="r bold">' + money(a.spend) + '</td>' +
          '<td class="r ' + (ch > 0.05 ? 'up' : ch < -0.05 ? 'down' : 'muted') + '">' + (a.hist.length > 1 && Math.abs(ch) > 0.05 ? (ch > 0 ? '▲' : '▼') + Math.abs(ch).toFixed(0) + '%' : '—') + '</td></tr>';
      }).join('') + '</table></div><div class="tiny muted center">Tap an item for its full price history.</div>';
  }
  return h;
}
function priceHistory(key) {
  const out = [];
  Object.keys(G().months).sort().forEach(mk => {
    G().months[mk].items.forEach(it => { if (it.bought && (it.mid || it.name) === key) out.push({ mk, price: num(it.price), qty: num(it.qty), name: it.name, unit: it.unit }); });
  });
  return out;
}
function showHistory(key) {
  const hs = priceHistory(key); if (!hs.length) return;
  const nm = hs[hs.length - 1].name, unit = hs[hs.length - 1].unit;
  let rows = '', prev = null;
  hs.forEach(x => {
    const d = prev ? (x.price - prev) / prev * 100 : null;
    rows += '<tr data-testid="hist-row"><td>' + monthName(x.mk) + '</td><td class="r">' + x.qty + '</td><td class="r bold">' + money(x.price) + '</td><td class="r ' + (d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'muted') + '">' + (d == null || Math.abs(d) <= 0.05 ? '—' : (d > 0 ? '▲' : '▼') + Math.abs(d).toFixed(1) + '%') + '</td></tr>';
    prev = x.price;
  });
  const prices = hs.map(x => x.price);
  $('#sheetRoot').innerHTML = '<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Price history"><div class="grab"></div><h3>' + esc(nm) + ' — price history</h3>' +
    '<div class="small muted">Per ' + esc(unit || 'unit') + ' · low ' + money(Math.min.apply(null, prices)) + ' · high ' + money(Math.max.apply(null, prices)) + '</div>' +
    '<table class="t" style="margin-top:8px"><tr><th>Month</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Change</th></tr>' + rows + '</table>' +
    '<div class="actions"><button class="btn block" type="button" data-close>Close</button></div></div></div>';
  const bg = $('#sheetRoot .sheet-bg');
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) closeSheet(); });
}
function viewGItems() {
  const M = G().master;
  let h = '<div class="note">These are your usual grocery items. Each new month starts with all of them (unticked), prefilled with the last price you paid.</div>';
  if (!M.length) h += '<div class="empty small">No items yet.</div>';
  else {
    h += '<div class="card" style="padding:2px 12px">';
    M.slice().sort((a, b) => (a.cat || '~').localeCompare(b.cat || '~') || a.name.localeCompare(b.name)).forEach(m => {
      h += '<div class="item" data-testid="g-master"><div class="txt" data-act="gEditMaster" data-id="' + m.id + '" style="cursor:pointer;padding-left:4px"><div class="bold">' + esc(m.name) + '</div><div class="small muted">' +
        (m.cat ? esc(m.cat) + ' · ' : '') + (num(m.price) ? money(m.price) : '—') + (m.unit ? ' / ' + esc(m.unit) : '') + '</div></div>' +
        '<button class="icon-btn ghost sm" data-act="gEditMaster" data-id="' + m.id + '" aria-label="Edit ' + esc(m.name) + '">✏️</button>' +
        '<button class="icon-btn ghost sm" data-act="gDelMaster" data-id="' + m.id + '" aria-label="Delete ' + esc(m.name) + '">✕</button></div>';
    });
    h += '</div>';
  }
  h += '<div class="fab-row"><button class="btn primary block" data-act="gAddMaster">＋ Add grocery item</button></div>';
  return h;
}
function masterFields(m) {
  const cats = Array.from(new Set(G().master.map(x => x.cat).filter(Boolean)));
  return [
    { name: 'name', label: 'Item name', value: m ? m.name : '', placeholder: 'e.g. Toor dal', required: true },
    { name: 'unit', label: 'Unit', value: m ? m.unit : '', placeholder: 'kg, litre, packet, dozen…' },
    { name: 'price', label: 'Usual price per unit (₹)', value: m ? m.price : '', type: 'number', step: 'any', min: 0, inputmode: 'decimal', placeholder: '0' },
    { name: 'cat', label: 'Category (optional)', value: m ? m.cat || '' : '', placeholder: cats.length ? cats.slice(0, 3).join(', ') : 'Staples, Vegetables, Dairy…' }
  ];
}
async function gAddMaster() {
  const r = await formSheet({ title: 'New grocery item', fields: masterFields(null), ok: 'Add' });
  if (!r || !r.name) return;
  const m = { id: uid(), name: r.name, unit: r.unit, price: num(r.price), cat: r.cat };
  G().master.push(m);
  const cmk = curMonthKey(), cm = G().months[cmk];
  if (cm) cm.items.push(monthItem(m, cmk));
  if (ui.gMonth && ui.gMonth !== cmk && G().months[ui.gMonth]) G().months[ui.gMonth].items.push(monthItem(m, ui.gMonth));
  save(); render(); toast('Added ' + m.name);
}
async function gEditMaster(id) {
  const m = G().master.find(x => x.id === id); if (!m) return;
  const r = await formSheet({ title: 'Edit item', fields: masterFields(m) });
  if (!r || !r.name) return;
  const oldPrice = num(m.price);
  Object.assign(m, { name: r.name, unit: r.unit, price: num(r.price), cat: r.cat });
  const cm = G().months[curMonthKey()];
  if (cm) cm.items.forEach(it => {
    if (it.mid !== id) return;
    it.name = m.name; it.unit = m.unit; it.cat = m.cat;
    if (!it.bought && (num(it.price) === oldPrice || !num(it.price))) it.price = m.price;
  });
  save(); render();
}
async function gDelMaster(id) {
  const m = G().master.find(x => x.id === id); if (!m) return;
  if (!await confirmSheet('Remove “' + m.name + '”?', 'It won’t appear in future months. Past months keep their records.', 'Remove')) return;
  G().master = G().master.filter(x => x.id !== id);
  const cm = G().months[curMonthKey()];
  if (cm) cm.items = cm.items.filter(it => it.mid !== id || it.bought);
  save(); render();
}

/* =====================================================================
   GOALS (counted)
   ===================================================================== */
const isWeekly = g => g.weekday != null && g.weekday !== '';
function goalDone(g) { return g.dates.length + (g.prior || 0); }
function nextOccurrence(g) {
  if (!isWeekly(g)) return null;
  const t = todayKey(), diff = (g.weekday - parseKey(t).getDay() + 7) % 7;
  let k = addDays(t, diff);
  if (diff === 0 && g.dates.includes(t)) k = addDays(t, 7);
  return k;
}
function lastOccurrence(g) { const t = todayKey(); return addDays(t, -((parseKey(t).getDay() - g.weekday + 7) % 7)); }
function goalStats(g) {
  const done = goalDone(g), target = g.target, remaining = Math.max(0, target - done);
  const pct = Math.min(100, done / target * 100);
  const weekly = isWeekly(g);
  let est = null, missed = 0;
  if (remaining > 0) {
    if (weekly) est = addDays(nextOccurrence(g), (remaining - 1) * 7);
    else if (g.dates.length >= 2) {
      const ds = g.dates.slice().sort(), span = Math.max(1, daysBetween(ds[0], ds[ds.length - 1]));
      est = addDays(todayKey(), Math.ceil(remaining * span / (ds.length - 1)));
    }
  }
  if (weekly) {
    const sorted = g.dates.slice().sort();
    let start = g.start || todayKey();
    if (sorted[0] && sorted[0] < start) start = sorted[0];
    let d = addDays(start, (g.weekday - parseKey(start).getDay() + 7) % 7);
    const t = todayKey();
    while (d < t) { if (!g.dates.includes(d)) missed++; d = addDays(d, 7); }
  }
  return { done, target, remaining, pct, est, missed, weekly };
}
function goalPrimary(g) {
  const t = todayKey();
  if (!isWeekly(g) || parseKey(t).getDay() === +g.weekday) {
    const on = g.dates.includes(t);
    return '<button class="btn ' + (on ? '' : 'primary') + ' block" data-act="goalToggle" data-id="' + g.id + '" data-day="' + t + '" data-testid="goal-primary">' + (on ? '✓ Done today · tap to undo' : '＋ Mark today done') + '</button>';
  }
  const last = lastOccurrence(g);
  if (!g.dates.includes(last) && last >= (g.start || '0000')) {
    return '<button class="btn primary block" data-act="goalToggle" data-id="' + g.id + '" data-day="' + last + '" data-testid="goal-primary">＋ Mark last ' + WD[g.weekday] + ' (' + fmtD(last, { day: 'numeric', month: 'short' }) + ')</button>';
  }
  return '<button class="btn block" disabled data-testid="goal-primary">Next: ' + fmtDShort(nextOccurrence(g)) + '</button>';
}
function viewGoals() {
  const g = S.goals.find(x => x.id === ui.goalId);
  if (g) return viewGoalDetail(g);
  ui.goalId = null;
  let h = '';
  if (!S.goals.length) {
    h += '<div class="empty"><div class="big">🎯</div><div class="bold">No goals yet</div><div class="small">Count things toward a target — e.g. “Fast for 96 Fridays”, “50 gym sessions”, “Read 30 books”.</div></div>';
  }
  S.goals.forEach((x, i) => {
    const st = goalStats(x);
    h += '<div class="card" data-testid="goal-card"><div class="goal-head"><div class="grow ' + (ui.reorder ? '' : 'tap') + '" ' + (ui.reorder ? '' : 'data-act="openGoal" data-id="' + x.id + '"') + '><h3>' + esc(x.name) + '</h3>' +
      (st.weekly ? '<span class="badge">Every ' + WD[x.weekday] + '</span>' : '<span class="badge">Any day</span>') + '</div>' +
      (ui.reorder ? reorderBtns('goal', x.id, i, S.goals.length) : '<button class="icon-btn ghost" data-act="goalMenu" data-id="' + x.id + '" aria-label="Goal options">⋯</button>') + '</div>';
    if (!ui.reorder) {
      h += '<div class="goal-nums"><b data-testid="goal-count">' + st.done + '</b><span class="muted">/ ' + st.target + '</span><span class="grow"></span><span class="bold" data-testid="goal-pct">' + Math.floor(st.pct) + '%</span></div>' +
        '<div class="progress"><i style="width:' + st.pct + '%"></i></div>' +
        '<div class="small muted" style="margin-top:6px">' + (st.remaining ? st.remaining + ' to go' + (st.est ? ' · est. finish ' + fmtD(st.est) : '') : '🎉 Target reached!') + '</div>' +
        '<div class="goal-mark">' + goalPrimary(x) + '</div>';
    }
    h += '</div>';
  });
  h += '<div class="fab-row"><button class="btn primary block" data-act="newGoal">＋ New goal</button></div>';
  return h;
}
function viewGoalDetail(g) {
  const st = goalStats(g), t = todayKey();
  let h = '<div class="row between" style="margin:2px 0 6px"><button class="btn sm" data-act="closeGoal">‹ All goals</button><button class="icon-btn ghost" data-act="goalMenu" data-id="' + g.id + '" aria-label="Goal options">⋯</button></div>';
  h += '<div class="card"><h3 class="center">' + esc(g.name) + '</h3><div class="center" style="margin:4px 0">' + (st.weekly ? '<span class="badge">Every ' + WD[g.weekday] + '</span>' : '<span class="badge">Any day</span>') + '</div>' +
    '<div class="ring" style="--p:' + st.pct + '"><div data-testid="goal-ring">' + Math.floor(st.pct) + '%</div></div>' +
    '<div class="progress"><i style="width:' + st.pct + '%"></i></div>' +
    '<div class="kv" style="margin-top:12px"><span>Done</span><span data-testid="goal-done">' + st.done + ' / ' + st.target + '</span><span>Remaining</span><span data-testid="goal-remaining">' + st.remaining + '</span>' +
    (g.prior ? '<span>Counted before app</span><span>' + g.prior + '</span>' : '') +
    '<span>Started</span><span>' + fmtD(g.start || t) + '</span>' +
    (st.weekly ? '<span>Missed ' + WD[g.weekday] + 's</span><span data-testid="goal-missed">' + st.missed + '</span>' : '') +
    '<span>Estimated finish</span><span data-testid="goal-est">' + (st.remaining ? (st.est ? fmtD(st.est) : '—') : 'Done 🎉') + '</span></div>' +
    '<div class="goal-mark">' + goalPrimary(g) + '</div>' +
    '<form class="add-form" data-form="goalDate" style="margin-top:10px"><input class="field" type="date" name="day" max="' + t + '" value="' + t + '" aria-label="Pick a date"><button class="btn" type="submit">Mark date</button></form></div>';
  const done = st.done, cells = Math.min(g.target, 400);
  h += '<div class="card"><div class="row between"><h3>Progress grid</h3><span class="small muted">' + done + ' of ' + g.target + '</span></div><div class="grid">';
  for (let i = 1; i <= cells; i++) h += '<i class="' + (i <= done ? 'on' : '') + '">' + i + '</i>';
  h += '</div></div>';
  const ds = g.dates.slice().sort().reverse();
  h += '<div class="card"><h3>Completed dates (' + ds.length + ')</h3>' + (ds.length ? '<div class="dates">' + ds.map(d =>
    '<span data-testid="goal-date">' + fmtD(d, { day: 'numeric', month: 'short', year: '2-digit' }) + '<button data-act="goalUnmark" data-id="' + g.id + '" data-day="' + d + '" aria-label="Unmark ' + fmtD(d) + '">✕</button></span>').join('') + '</div>' : '<div class="small muted" style="margin-top:6px">None yet.</div>') + '</div>';
  return h;
}
function goalFields(g) {
  return [
    { name: 'name', label: 'Goal', value: g ? g.name : '', placeholder: 'e.g. Fast on Fridays', required: true },
    { name: 'target', label: 'Target count', value: g ? g.target : 96, type: 'number', min: 1, step: 1, inputmode: 'numeric', required: true },
    { name: 'weekday', label: 'Repeat on', type: 'select', value: g && isWeekly(g) ? g.weekday : '', options: [['', 'Any day (no fixed weekday)']].concat(WD.map((w, i) => [String(i), 'Every ' + w])) },
    { name: 'start', label: 'Start date', type: 'date', value: g ? (g.start || todayKey()) : todayKey(), max: todayKey() },
    { name: 'prior', label: 'Already done before using the app', type: 'number', min: 0, step: 1, inputmode: 'numeric', value: g ? g.prior || 0 : 0, hint: 'Counts toward the target without dates.' }
  ];
}
async function newGoal() {
  const r = await formSheet({ title: 'New goal', fields: goalFields(null), ok: 'Create' });
  if (!r || !r.name) return;
  S.goals.push({ id: uid(), name: r.name, target: Math.max(1, parseInt(r.target, 10) || 1), weekday: r.weekday === '' ? null : +r.weekday, start: r.start || todayKey(), prior: Math.max(0, parseInt(r.prior, 10) || 0), dates: [], created: now().toISOString() });
  save(); render(); toast('Goal created');
}
async function goalMenu(id) {
  const g = S.goals.find(x => x.id === id); if (!g) return;
  const v = await menuSheet(g.name, [{ label: 'Edit / rename', value: 'edit', icon: '✏️' }, { label: 'Reorder goals', value: 'reorder', icon: '↕️' }, { label: 'Delete goal', value: 'del', icon: '🗑️', danger: true }]);
  if (v === 'edit') {
    const r = await formSheet({ title: 'Edit goal', fields: goalFields(g) });
    if (!r || !r.name) return;
    Object.assign(g, { name: r.name, target: Math.max(1, parseInt(r.target, 10) || 1), weekday: r.weekday === '' ? null : +r.weekday, start: r.start || g.start, prior: Math.max(0, parseInt(r.prior, 10) || 0) });
    save(); render();
  } else if (v === 'reorder') { ui.goalId = null; ui.reorder = true; render(); }
  else if (v === 'del') {
    if (await confirmSheet('Delete “' + g.name + '”?', 'All ' + plural(g.dates.length, 'completed date') + ' will be removed.', 'Delete')) {
      const idx = S.goals.indexOf(g); S.goals.splice(idx, 1); ui.goalId = null; save(); render();
      toast('Goal deleted', 'Undo', () => { S.goals.splice(idx, 0, g); save(); render(); });
    }
  }
}
async function goalMark(g, day) {
  const t = todayKey();
  if (!day) return;
  if (day > t) { toast('Can’t mark a future date'); return; }
  if (g.dates.includes(day)) { toast(fmtD(day) + ' is already marked'); return; }
  if (isWeekly(g) && parseKey(day).getDay() !== +g.weekday) {
    if (!await confirmSheet('Not a ' + WD[g.weekday], fmtDShort(day) + ' is a ' + WD[parseKey(day).getDay()] + '. Count it anyway?', 'Count it', false)) return;
  }
  const before = goalDone(g);
  g.dates.push(day); g.dates.sort(); save(); render();
  if (before < g.target && goalDone(g) >= g.target) toast('🎉 Target reached: ' + g.name);
  else toast('Marked ' + fmtD(day, { day: 'numeric', month: 'short' }) + ' · ' + goalDone(g) + '/' + g.target, 'Undo', () => { g.dates = g.dates.filter(d => d !== day); save(); render(); });
}

/* =====================================================================
   SETTINGS
   ===================================================================== */
let deferredInstall = null;
function viewSettings() {
  const size = new Blob([localStorage.getItem(STORE_KEY) || '']).size;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let h = '<h2>Backup</h2><div class="card"><div class="small muted">Your data lives only on this device (' + (size / 1024).toFixed(1) + ' KB). Export a backup now and then — and before changing phones or clearing the browser.</div>' +
    '<div class="fab-row" style="flex-wrap:wrap"><button class="btn primary grow" data-act="export">⬇ Export JSON</button><button class="btn grow" data-act="importPick">⬆ Import JSON</button></div>' +
    (navigator.canShare ? '<button class="btn block" data-act="shareBackup">📤 Share backup file…</button>' : '') +
    '<input type="file" id="importFile" accept="application/json,.json" hidden></div>';
  h += '<h2>Install on your phone</h2><div class="card small">' + (standalone ? '✅ Running as an installed app.' :
    (deferredInstall ? '<button class="btn primary block" data-act="install">📲 Install app</button>' : '') +
    '<div style="margin-top:6px"><b>iPhone (Safari):</b> tap Share → <i>Add to Home Screen</i>.</div><div style="margin-top:6px"><b>Android (Chrome):</b> menu ⋮ → <i>Add to Home screen</i> / <i>Install app</i>.</div>') +
    '<div class="muted" style="margin-top:8px">Works offline once opened.</div></div>';
  h += '<h2>Summary</h2><div class="card"><div class="kv"><span>Checklists</span><span>' + S.checklists.length + '</span><span>Avoid habits</span><span>' + S.avoid.items.length + '</span>' +
    '<span>Grocery items</span><span>' + G().master.length + '</span><span>Grocery months</span><span>' + Object.keys(G().months).length + '</span><span>Goals</span><span>' + S.goals.length + '</span>' +
    '<span>Today</span><span>' + fmtD(todayKey(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + '</span></div></div>';
  h += '<h2>Danger zone</h2><div class="card"><button class="btn danger block" data-act="wipe">Erase all data on this device</button></div>';
  h += '<div class="tiny muted center" style="margin:16px 0">Tracker v' + APP_VERSION + ' · ₹ INR · en-IN</div>';
  return h;
}
function backupBlob() {
  const payload = { app: 'sachin-tracker', version: APP_VERSION, exportedAt: now().toISOString(), data: S };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}
const backupName = () => 'tracker-backup-' + todayKey() + '.json';
function doExport() {
  const url = URL.createObjectURL(backupBlob()), a = document.createElement('a');
  a.href = url; a.download = backupName(); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Backup downloaded');
}
async function shareBackup() {
  const file = new File([backupBlob()], backupName(), { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Tracker backup' }); } catch (e) { /* cancelled */ } }
  else doExport();
}
async function importText(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { toast('That file is not valid JSON'); return false; }
  const data = d && d.data ? d.data : d;
  if (!data || typeof data !== 'object' || !('checklists' in data || 'goals' in data || 'grocery' in data || 'avoid' in data)) { toast('Not a tracker backup file'); return false; }
  const n = normalize(data);
  const msg = 'Replace everything on this device with the backup? (' + n.checklists.length + ' checklists, ' + n.avoid.items.length + ' habits, ' + n.goals.length + ' goals, ' + Object.keys(n.grocery.months).length + ' grocery months)';
  if (!await confirmSheet('Import backup', msg, 'Replace data')) return false;
  S = n; ensureMonth(); save(); Object.assign(ui, { listId: null, avoidId: null, goalId: null, gMonth: null }); render(); toast('Backup imported');
  return true;
}

/* =====================================================================
   ACTIONS & EVENTS
   ===================================================================== */
const A = {
  tab: d => { ui.tab = d.tab; ui.reorder = false; closeSheet(); if (location.hash !== '#' + d.tab) history.replaceState(null, '', '#' + d.tab); render(); window.scrollTo(0, 0); },
  doneReorder: () => { ui.reorder = false; render(); },
  startReorder: () => { ui.reorder = true; render(); },
  move: d => {
    const dir = +d.dir;
    let arr = null;
    if (d.kind === 'list') arr = S.checklists; else if (d.kind === 'avoid') arr = S.avoid.items; else if (d.kind === 'goal') arr = S.goals;
    else if (d.kind === 'item') arr = (curList() || {}).items;
    if (!arr) return;
    const i = arr.findIndex(x => x.id === d.id);
    if (i >= 0 && move(arr, i, dir)) { save(); render(); }
  },
  newList: async () => {
    const r = await formSheet({ title: 'New checklist', fields: [{ name: 'name', label: 'Name', placeholder: 'e.g. Packing list', required: true }], ok: 'Create' });
    if (!r || !r.name) return;
    const c = { id: uid(), name: r.name, created: now().toISOString(), items: [] };
    S.checklists.push(c); ui.listId = c.id; save(); render();
  },
  openList: d => { ui.listId = d.id; ui.reorder = false; render(); window.scrollTo(0, 0); },
  closeList: () => { ui.listId = null; ui.reorder = false; render(); },
  listMenu: d => listMenu(d.id || ui.listId),
  toggleItem: d => { const L = curList(), it = L && L.items.find(x => x.id === d.id); if (it) { it.done = !it.done; save(); render(); } },
  delItem: d => {
    const L = curList(); if (!L) return;
    const i = L.items.findIndex(x => x.id === d.id); if (i < 0) return;
    const it = L.items.splice(i, 1)[0]; save(); render();
    toast('Removed “' + it.text + '”', 'Undo', () => { L.items.splice(i, 0, it); save(); render(); });
  },
  editItem: async d => {
    const L = curList(), it = L && L.items.find(x => x.id === d.id); if (!it) return;
    const r = await formSheet({ title: 'Edit item', fields: [{ name: 'text', label: 'Item', value: it.text, required: true }] });
    if (r && r.text) { it.text = r.text; save(); render(); }
  },
  resetList: () => { const L = curList(); if (L) { const prev = L.items.map(x => x.done); L.items.forEach(x => x.done = false); save(); render(); toast('All unchecked', 'Undo', () => { L.items.forEach((x, i) => x.done = prev[i]); save(); render(); }); } },
  newAvoid: async () => {
    const r = await formSheet({ title: 'New habit to avoid', fields: [{ name: 'name', label: 'What do you want to avoid?', placeholder: 'e.g. Sweets', required: true }], ok: 'Add' });
    if (!r || !r.name) return;
    S.avoid.items.push({ id: uid(), name: r.name, created: todayKey() }); save(); render();
  },
  avDay: d => { const t = todayKey(); const n = addDays(ui.avoidDate || t, +d.dir); ui.avoidDate = n > t ? t : n; render(); },
  avSet: d => { const cur = avLog(d.id)[ui.avoidDate]; setAvoid(d.id, ui.avoidDate, cur === d.v ? null : d.v); render(); },
  avAllKept: () => { S.avoid.items.forEach(x => { if (!avLog(x.id)[ui.avoidDate]) avLog(x.id)[ui.avoidDate] = 'kept'; }); save(); render(); toast('Nice — all avoided'); },
  openAvoid: d => { ui.avoidId = d.id; ui.avoidMonth = (ui.avoidDate || todayKey()).slice(0, 7); render(); window.scrollTo(0, 0); },
  closeAvoid: () => { ui.avoidId = null; render(); },
  avoidMenu: d => avoidMenu(d.id),
  avMonth: d => { const n = addMonths(ui.avoidMonth, +d.dir); if (n <= curMonthKey()) { ui.avoidMonth = n; render(); } },
  avCycle: d => { const cur = avLog(d.id)[d.day]; setAvoid(d.id, d.day, !cur ? 'kept' : cur === 'kept' ? 'broken' : null); render(); },
  gMode: d => { ui.gMode = d.m; render(); },
  gFilter: d => { ui.gFilter = d.f; render(); },
  gMonthNav: d => { const keys = Object.keys(G().months).sort(), i = keys.indexOf(ui.gMonth) + (+d.dir); if (keys[i]) { ui.gMonth = keys[i]; ui.gFilter = null; render(); } },
  gGoMonth: d => { ui.gMode = 'month'; ui.gMonth = d.mk; ui.gFilter = null; render(); window.scrollTo(0, 0); },
  gYearNav: d => { ui.gYear += +d.dir; render(); },
  gWant: d => { const it = G().months[ui.gMonth].items[+d.i]; it.want = !it.want; if (!it.want) it.bought = false; save(); render(); },
  gBought: d => { const it = G().months[ui.gMonth].items[+d.i]; it.bought = !it.bought; if (it.bought) it.want = true; save(); render(); },
  gCopyPlan: () => {
    const keys = Object.keys(G().months).sort(), prev = G().months[keys[keys.indexOf(ui.gMonth) - 1]]; if (!prev) return;
    const mo = G().months[ui.gMonth]; let n = 0;
    prev.items.forEach(p => { if (!(p.want || p.bought)) return; const it = mo.items.find(x => (x.mid && x.mid === p.mid) || x.name === p.name); if (it) { it.want = true; it.qty = p.qty; n++; } });
    ui.gFilter = 'list'; save(); render(); toast('Copied ' + plural(n, 'item'));
  },
  gAddMaster: () => gAddMaster(), gEditMaster: d => gEditMaster(d.id), gDelMaster: d => gDelMaster(d.id),
  gHist: d => showHistory(d.key),
  newGoal: () => newGoal(),
  openGoal: d => { ui.goalId = d.id; render(); window.scrollTo(0, 0); },
  closeGoal: () => { ui.goalId = null; render(); },
  goalMenu: d => goalMenu(d.id),
  goalToggle: d => {
    const g = S.goals.find(x => x.id === d.id); if (!g) return;
    if (g.dates.includes(d.day)) { g.dates = g.dates.filter(x => x !== d.day); save(); render(); toast('Unmarked ' + fmtD(d.day, { day: 'numeric', month: 'short' }), 'Undo', () => { g.dates.push(d.day); g.dates.sort(); save(); render(); }); }
    else goalMark(g, d.day);
  },
  goalUnmark: async d => {
    const g = S.goals.find(x => x.id === d.id); if (!g) return;
    if (!await confirmSheet('Unmark ' + fmtD(d.day) + '?', 'This removes it from the count.', 'Unmark')) return;
    g.dates = g.dates.filter(x => x !== d.day); save(); render();
  },
  export: () => doExport(), shareBackup: () => shareBackup(),
  importPick: () => $('#importFile').click(),
  install: async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); },
  wipe: async () => {
    if (!await confirmSheet('Erase everything?', 'All checklists, habits, grocery months and goals on this device will be deleted. Export a backup first if unsure.', 'Erase')) return;
    if (!await confirmSheet('Really erase?', 'This cannot be undone.', 'Yes, erase all')) return;
    S = blank(); ensureMonth(); save(); Object.assign(ui, { listId: null, avoidId: null, goalId: null, gMonth: null }); render(); toast('All data erased');
  }
};
const F = {
  addItem: f => {
    const L = curList(), v = f.elements.text.value.trim(); if (!L || !v) return;
    L.items.push({ id: uid(), text: v, done: false });
    save(); render();
    const n = document.querySelector('form[data-form=addItem] input'); if (n) n.focus();
  },
  goalDate: f => { const g = S.goals.find(x => x.id === ui.goalId); if (g) goalMark(g, f.elements.day.value); }
};
const C = {
  gQty: (d, el) => { const it = G().months[ui.gMonth].items[+d.i]; it.qty = num(el.value); save(); updateGTotals(+d.i); },
  gPrice: (d, el) => { const it = G().months[ui.gMonth].items[+d.i]; it.price = num(el.value); save(); updateGTotals(+d.i); }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || el.closest('.sheet-bg')) return;
  const fn = A[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el.dataset, el, e); }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault(); const fn = F[f.dataset.form]; if (fn) fn(f);
});
document.addEventListener('input', e => { const el = e.target.closest('[data-chg]'); if (el && C[el.dataset.chg]) C[el.dataset.chg](el.dataset, el); });
document.addEventListener('change', e => {
  if (e.target.id === 'importFile') {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => importText(String(r.result)); r.readAsText(file); e.target.value = '';
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#sheetRoot').innerHTML) { const c = $('#sheetRoot [data-x=cancel], #sheetRoot [data-close], #sheetRoot [data-i="-1"]'); if (c) c.click(); } });

/* ---------- render ---------- */
function topActions() {
  if (ui.reorder) return '<button class="btn sm primary" data-act="doneReorder">Done</button>';
  const reorderable = (ui.tab === 'checklists' && (ui.listId ? (curList() || { items: [] }).items.length > 1 : S.checklists.length > 1)) ||
    (ui.tab === 'avoid' && !ui.avoidId && S.avoid.items.length > 1) || (ui.tab === 'goals' && !ui.goalId && S.goals.length > 1);
  let h = '';
  if (reorderable) h += '<button class="icon-btn" data-act="startReorder" aria-label="Reorder">↕️</button>';
  if (ui.tab === 'checklists' && ui.listId) h += '<button class="icon-btn" data-act="listMenu" aria-label="List options">⋯</button>';
  return h;
}
function render() {
  const views = { checklists: viewChecklists, avoid: viewAvoid, grocery: viewGrocery, goals: viewGoals, settings: viewSettings };
  if (!views[ui.tab]) ui.tab = 'checklists';
  const main = $('#main');
  main.innerHTML = views[ui.tab]();
  let title = titles[ui.tab];
  if (ui.tab === 'checklists' && curList()) title = curList().name;
  if (ui.reorder) title = 'Reorder';
  $('#title').textContent = title;
  $('#topActions').innerHTML = topActions();
  document.querySelectorAll('.tabbar button').forEach(b => { const on = b.dataset.tab === ui.tab; b.classList.toggle('active', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
}
/* Detects day / month change while the app stays open or resumes from background. */
function checkRollover() {
  const mk = curMonthKey(), day = todayKey();
  let changed = false;
  if (ensureMonth(mk)) {
    if (ui.seenMonth && ui.seenMonth !== mk) toast('New month — ' + monthName(mk) + ' grocery list created');
    changed = true;
  }
  if (ui.seenMonth && ui.seenMonth !== mk && (!ui.gMonth || ui.gMonth === ui.seenMonth)) { ui.gMonth = mk; ui.gFilter = null; changed = true; }
  if (ui.seenDay && ui.seenDay !== day) { if (ui.avoidDate === ui.seenDay) ui.avoidDate = day; changed = true; }
  ui.seenMonth = mk; ui.seenDay = day;
  return changed;
}
function init() {
  load();
  const h = location.hash.replace('#', '');
  if (titles[h]) ui.tab = h;
  checkRollover();
  render();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && checkRollover()) render(); });
  setInterval(() => { if (checkRollover() && !$('#sheetRoot').innerHTML && !(document.activeElement && document.activeElement.matches('input'))) render(); }, 30000);
  window.addEventListener('hashchange', () => { const x = location.hash.replace('#', ''); if (titles[x] && x !== ui.tab) { ui.tab = x; ui.reorder = false; render(); } });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (ui.tab === 'settings') render(); });
  window.addEventListener('storage', e => { if (e.key === STORE_KEY) { load(); render(); } });
  if (!window.__SINGLE_FILE__ && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
window.Tracker = { get state() { return S; }, checkRollover, render, ensureMonth, goalStats, avoidStats, yearData, STORE_KEY, importText };
init();
})();
