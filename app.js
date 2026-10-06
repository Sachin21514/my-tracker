/* Sachin's Tracker — vanilla JS, data in localStorage. */
(function () {
'use strict';
const STORE_KEY = 'sachin-tracker-v1';
const APP_VERSION = '1.2.0';
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
const fmtDLong = k => fmtDShort(k) + ' ' + k.slice(0, 4);
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
  return { version: 2, checklists: [], avoid: { items: [], log: {} }, grocery: { master: [], months: {}, prices: [], lastStore: '' }, stores: defaultStores(), goals: [], meta: { created: now().toISOString() } };
}
function normalize(d) {
  const b = blank();
  if (!d || typeof d !== 'object') return b;
  const o = {
    version: 2,
    checklists: Array.isArray(d.checklists) ? d.checklists : [],
    avoid: { items: (d.avoid && Array.isArray(d.avoid.items)) ? d.avoid.items : [], log: (d.avoid && d.avoid.log && typeof d.avoid.log === 'object') ? d.avoid.log : {} },
    grocery: { master: (d.grocery && Array.isArray(d.grocery.master)) ? d.grocery.master : [], months: (d.grocery && d.grocery.months && typeof d.grocery.months === 'object') ? d.grocery.months : {} },
    goals: Array.isArray(d.goals) ? d.goals : [],
    stores: Array.isArray(d.stores) ? d.stores.filter(x => x && x.id && x.name) : defaultStores(),
    meta: d.meta || b.meta
  };
  o.grocery.prices = (d.grocery && Array.isArray(d.grocery.prices)) ? d.grocery.prices.filter(p => p && p.mid && p.date) : [];
  o.grocery.lastStore = (d.grocery && typeof d.grocery.lastStore === 'string') ? d.grocery.lastStore : '';
  o.checklists.forEach(c => { c.items = Array.isArray(c.items) ? c.items : []; });
  o.goals.forEach(g => { g.dates = Array.isArray(g.dates) ? g.dates : []; g.prior = +g.prior || 0; g.target = Math.max(1, +g.target || 1); });
  Object.values(o.grocery.months).forEach(m => { m.items = Array.isArray(m.items) ? m.items : []; });
  // v1 → v2: quantity becomes pack size + unit × count (old qty → count, old unit → pack size/unit)
  o.grocery.master.forEach(m => migratePack(m, true));
  Object.values(o.grocery.months).forEach(m => m.items.forEach(it => migratePack(it, false)));
  o.grocery.prices.forEach(p => { if (!UNIT_BASE[p.sizeUnit]) { const m = o.grocery.master.find(x => x.id === p.mid); const pk = packOf(m || {}); p.size = pk.size; p.sizeUnit = pk.unit; } });
  o.version = 2;
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
      return { row: x.row, html: '<label class="lbl" for="' + id + '">' + esc(x.label) + '</label>' + inp + (x.hint ? '<div class="tiny muted" style="margin:4px 2px">' + esc(x.hint) + '</div>' : '') };
    }).reduce((acc, x, i, arr) => {   // consecutive fields with the same "row" sit side by side
      if (!x.row) return acc + x.html;
      const startsRow = i === 0 || arr[i - 1].row !== x.row, endsRow = i === arr.length - 1 || arr[i + 1].row !== x.row;
      return acc + (startsRow ? '<div class="f-row">' : '') + '<div class="f-col">' + x.html + '</div>' + (endsRow ? '</div>' : '');
    }, '');
    $('#sheetRoot').innerHTML = '<div class="sheet-bg"><form class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(opts.title) + '"><div class="grab"></div><h3>' + esc(opts.title) + '</h3>' +
      (opts.message ? '<p class="muted" style="margin:4px 0">' + opts.message + '</p>' : '') + f +
      (opts.preview ? '<div class="preview" data-testid="form-preview"></div>' : '') +
      '<div class="actions"><button type="button" class="btn" data-x="cancel">Cancel</button><button type="submit" class="btn ' + (opts.danger ? 'danger' : 'primary') + '" data-x="ok">' + esc(opts.ok || 'Save') + '</button></div></form></div>';
    const bg = $('#sheetRoot .sheet-bg'), form = bg.querySelector('form');
    const done = v => { closeSheet(); resolve(v); };
    bg.addEventListener('click', e => { if (e.target === bg) done(null); });
    form.querySelector('[data-x=cancel]').onclick = () => done(null);
    form.onsubmit = e => { e.preventDefault(); const v = {}; new FormData(form).forEach((val, k) => { v[k] = typeof val === 'string' ? val.trim() : val; }); done(v); };
    if (opts.preview) {
      const upd = () => { const v = {}; new FormData(form).forEach((val, k) => { v[k] = val; }); form.querySelector('.preview').innerHTML = opts.preview(v); };
      form.addEventListener('input', upd); form.addEventListener('change', upd); upd();
    }
    const first = form.querySelector('input,select');
    if (first && opts.focus !== false) setTimeout(() => { if (form.contains(document.activeElement)) return; first.focus(); if (first.select) first.select(); }, 60);
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
/* ---- packs: size + unit per pack, and a count of packs ---- */
const PACK_UNITS = ['g', 'kg', 'ml', 'L', 'pcs', 'dozen', 'pack'];
const UNIT_BASE = { g: ['kg', 0.001], kg: ['kg', 1], ml: ['L', 0.001], L: ['L', 1], pcs: ['pc', 1], dozen: ['pc', 12], pack: ['pack', 1] };
const UNIT_ALIAS = { g: 'g', gm: 'g', gms: 'g', gr: 'g', gram: 'g', grams: 'g', kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', ml: 'ml', l: 'L', lt: 'L', ltr: 'L', ltrs: 'L', litre: 'L', litres: 'L', liter: 'L', liters: 'L',
  pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs', nos: 'pcs', no: 'pcs', dozen: 'dozen', doz: 'dozen', dz: 'dozen', pack: 'pack', packs: 'pack', packet: 'pack', packets: 'pack', pkt: 'pack', pkts: 'pack' };
const toPackUnit = u => UNIT_ALIAS[String(u || '').toLowerCase()] || (UNIT_BASE[u] ? u : null);
/* Old free-text units ("kg", "5 kg", "400 g", "litre", "dozen", "bunch", "") → { size, unit }. */
function parsePack(str) {
  const s = String(str || '').trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]+)\.?$/);
  if (m) { const u = toPackUnit(m[2]); return { size: +m[1] > 0 ? +m[1] : 1, unit: u || 'pack' }; }
  return { size: 1, unit: toPackUnit(s) || 'pack' };
}
const packOf = x => ({ size: num(x && x.size) > 0 ? num(x.size) : 1, unit: x && UNIT_BASE[x.sizeUnit] ? x.sizeUnit : 'pack' });
const fmtN = n => String(+(+n).toFixed(3));
function packText(x) {
  const p = packOf(x);
  if (p.unit === 'pack') return p.size === 1 ? '1 pack' : fmtN(p.size) + ' packs';
  if (p.unit === 'pcs') return fmtN(p.size) + (p.size === 1 ? ' pc' : ' pcs');
  return fmtN(p.size) + ' ' + p.unit;
}
const qtyText = x => packText(x) + ' × ' + fmtN(num(x.count));
const baseUnit = x => UNIT_BASE[packOf(x).unit][0];
const packBase = x => { const p = packOf(x); return p.size * UNIT_BASE[p.unit][1]; };   // one pack in kg / L / pc / pack
const lineBase = x => packBase(x) * num(x.count);
const normPrice = (price, x) => num(price) / packBase(x);                           // ₹ per kg / L / pc / pack
function fmtBase(amount, bu) {
  const a = +amount || 0;
  if (bu === 'kg') return a < 1 ? fmtN(Math.round(a * 1000)) + ' g' : fmtN(+a.toFixed(3)) + ' kg';
  if (bu === 'L') return a < 1 ? fmtN(Math.round(a * 1000)) + ' ml' : fmtN(+a.toFixed(3)) + ' L';
  if (bu === 'pc') return fmtN(a) + (a === 1 ? ' pc' : ' pcs');
  return fmtN(a) + (a === 1 ? ' pack' : ' packs');
}
const normText = (price, x) => money(normPrice(price, x)) + '/' + baseUnit(x);
const samePack = (a, b) => { const x = packOf(a), y = packOf(b); return x.unit === y.unit && Math.abs(x.size - y.size) < 1e-9; };
/* Migrate a v1 line/master ({qty, unit}) to packs ({size, sizeUnit, count}). Price stays "per pack" (= per old unit). */
function migratePack(x, isMaster) {
  if (!x || typeof x !== 'object') return x;
  if (!(UNIT_BASE[x.sizeUnit] && num(x.size) > 0)) { const p = parsePack(x.unit); x.size = p.size; x.sizeUnit = p.unit; }
  if (x.count == null || x.count === '') x.count = x.qty != null && x.qty !== '' ? num(x.qty) : 1;
  x.count = num(x.count); if (isMaster && !(x.count > 0)) x.count = 1;
  delete x.qty; delete x.unit;
  return x;
}
const lineTotal = it => num(it.count) * num(it.price);
function lastLine(mid, beforeMk) {
  const keys = Object.keys(G().months).filter(k => k < beforeMk).sort().reverse();
  for (const k of keys) {
    const it = G().months[k].items.find(i => i.mid === mid && i.bought && num(i.price) > 0);
    if (it) return it;
  }
  return null;
}
/* New month row: the usual pack + count; price = last price paid for that pack (scaled by ₹/kg if the pack changed). */
function monthItem(m, mk) {
  const p = packOf(m), l = lastLine(m.id, mk);
  let price = num(m.price);
  if (l && samePack(l, m)) price = num(l.price);
  else if (l && baseUnit(l) === baseUnit(m) && !price) price = Math.round(normPrice(l.price, l) * packBase(m) * 100) / 100;
  return { mid: m.id, name: m.name, cat: m.cat || '', want: false, bought: false, size: p.size, sizeUnit: p.unit, count: num(m.count) > 0 ? num(m.count) : 1, price };
}
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
const lineMeta = it => qtyText(it) + ' = ' + fmtBase(lineBase(it), baseUnit(it)) + (num(it.price) ? ' · ' + money(it.price) + '/pack' + (packOf(it).unit !== 'pack' ? ' · ' + normText(it.price, it) : '') : '');
const storesBtn = () => '<button class="btn sm" data-act="stores" data-testid="g-stores-btn">🏪 Stores (' + S.stores.length + ')</button>';
function viewGMonth() {
  const cur = curMonthKey();
  if (!ui.gMonth || !G().months[ui.gMonth]) ui.gMonth = cur;
  const mk = ui.gMonth, mo = G().months[mk], keys = Object.keys(G().months).sort();
  const ki = keys.indexOf(mk);
  let h = '<div class="datebar"><button class="icon-btn ghost" data-act="gMonthNav" data-dir="-1" aria-label="Previous month" ' + (ki <= 0 ? 'disabled' : '') + '>‹</button>' +
    '<div class="lab" data-testid="g-month">' + monthName(mk) + (mk === cur ? '' : ' <span class="badge">past</span>') + '</div>' +
    '<button class="icon-btn ghost" data-act="gMonthNav" data-dir="1" aria-label="Next month" ' + (ki >= keys.length - 1 ? 'disabled' : '') + '>›</button></div>';
  if (!G().master.length) {
    return h + '<div class="empty"><div class="big">🛒</div><div class="bold">Set up your grocery items</div><div class="small">Add the things you usually buy (name, pack size like 200 g or 1 L, usual count and price). Every month gets a fresh list from these automatically.</div></div>' +
      '<div class="fab-row"><button class="btn primary grow" data-act="gAddMaster">＋ Add grocery item</button><button class="btn grow" data-act="photo" data-testid="add-photo">📷 From photo</button></div>' +
      '<div class="center">' + storesBtn() + '</div>';
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
      const it = mo.items[i], nm = esc(it.name);
      if ((it.cat || '') !== lastCat) { lastCat = it.cat || ''; if (anyCat) h += '<div class="g-cat">' + esc(lastCat || 'Other') + '</div>'; }
      const active = it.want || it.bought;
      h += '<div class="g-row ' + (it.want ? 'want ' : '') + (it.bought ? 'bought' : '') + '" data-testid="g-row" data-name="' + nm + '">' +
        '<button class="g-want" data-act="gWant" data-i="' + i + '" aria-label="Want to buy ' + nm + '" aria-pressed="' + !!it.want + '">🛒</button>' +
        '<div class="g-main"><div class="g-name"><span class="g-open" data-act="gItem" data-i="' + i + '">' + nm + '</span>' +
          '<button class="mini" data-act="gCompare" data-i="' + i + '" aria-label="Compare ' + nm + ' online" data-testid="g-compare">Compare</button></div>';
      if (active) {
        h += '<div class="g-edit"><button class="pack-chip" data-act="gPack" data-i="' + i + '" data-testid="g-pack" aria-label="Pack size of ' + nm + ': ' + esc(packText(it)) + ' (tap to change)">' + esc(packText(it)) + ' <span aria-hidden="true">✎</span></button>' +
          '<span class="muted" aria-hidden="true">×</span><span class="stepper"><button data-act="gCnt" data-d="-1" data-i="' + i + '" aria-label="One less ' + nm + '">−</button>' +
          '<input data-chg="gCount" data-i="' + i + '" data-testid="g-count" type="number" inputmode="decimal" step="any" min="0" value="' + esc(fmtN(num(it.count))) + '" aria-label="Number of packs of ' + nm + '">' +
          '<button data-act="gCnt" data-d="1" data-i="' + i + '" aria-label="One more ' + nm + '">+</button></span>' +
          '<b class="g-line" id="gl' + i + '">' + money(lineTotal(it)) + '</b></div>' +
          '<div class="g-store-row"><label class="g-price"><span class="muted small">₹</span><input class="price" data-chg="gPrice" data-i="' + i + '" type="number" inputmode="decimal" step="any" min="0" value="' + esc(it.price) + '" aria-label="Price per pack of ' + nm + '"></label>' +
          '<select class="g-store" data-chg="gStore" data-i="' + i + '" aria-label="Store for ' + nm + '">' + storeOptions(it.store) + '</select></div>' +
          '<div class="tiny muted g-meta" id="gm' + i + '" data-testid="g-meta">' + esc(lineMeta(it)) + '</div>' + cheapestHint(it);
      } else {
        const ins = storeInsight(it.mid || it.name);
        h += '<div class="small muted" data-testid="g-sub">' + esc(qtyText(it)) + ' · ' + (num(it.price) ? money(it.price) + '/pack' : 'no price yet') +
          (ins && ins.cheapest ? ' · cheapest ' + esc(storeName(ins.cheapest.store)) + ' ' + esc(money(ins.cheapest.norm) + '/' + ins.bu) : '') + '</div>';
      }
      h += '</div><button class="g-check" data-act="gBought" data-i="' + i + '" aria-label="Bought ' + nm + '" aria-pressed="' + !!it.bought + '">✓</button></div>';
    });
    h += '</div>';
  }
  const prev = keys[ki - 1];
  if (prev && filter !== 'bought' && !tt.nw && !tt.nb) h += '<div class="center" style="margin-top:8px"><button class="btn sm" data-act="gCopyPlan">⧉ Copy plan from ' + monthName(prev, true) + '</button></div>';
  h += '<div class="fab-row"><button class="btn grow" data-act="gAddMaster">＋ New item</button><button class="btn primary grow" data-act="photo" data-testid="add-photo">📷 Add from photo</button></div>';
  h += '<div class="row between" style="gap:8px"><span class="tiny muted">Price is per pack · total = price × packs. Tap the size to change it.</span>' + storesBtn() + '</div>';
  return h;
}
function updateGTotals(i) {
  const mo = G().months[ui.gMonth], tt = monthTotals(mo);
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  if (i != null) { set('gl' + i, money(lineTotal(mo.items[i]))); set('gm' + i, lineMeta(mo.items[i])); }
  set('gSpent', money(tt.spent)); set('gPlan', money(tt.planned));
  set('gSpentN', plural(tt.nb, 'item') + ' bought'); set('gPlanN', plural(tt.nw, 'item') + ' · est.');
}
const PRICE_MODES = [['pack', 'per pack'], ['total', 'for all the packs (line total)'], ['norm', 'per kg / L / piece']];
function packPreview(v, name) {
  const x = { size: num(v.size), sizeUnit: v.unit, count: num(v.count) };
  if (!(x.size > 0) || !(x.count > 0)) return '<span class="muted">Enter a pack size and count</span>';
  const pp = v.pmode === 'total' ? num(v.price) / x.count : v.pmode === 'norm' ? num(v.price) * packBase(x) : num(v.price);
  return '<b>' + esc(name ? name + ' — ' : '') + esc(qtyText(x)) + '</b> = ' + esc(fmtBase(lineBase(x), baseUnit(x))) +
    (pp ? ' · ' + money(pp * x.count) + ' <span class="muted">(' + money(pp) + '/pack' + (packOf(x).unit !== 'pack' ? ' · ' + normText(pp, x) : '') + ')</span>' : '');
}
const pricePerPack = r => r.pmode === 'total' ? num(r.price) / (num(r.count) || 1) : r.pmode === 'norm' ? num(r.price) * packBase({ size: num(r.size), sizeUnit: r.unit }) : num(r.price);
const packFields = (x, opts) => [
  { name: 'size', label: 'Pack size', row: 'pk', value: fmtN(packOf(x).size), type: 'number', step: 'any', min: 0, inputmode: 'decimal', required: true },
  { name: 'unit', label: 'Unit', row: 'pk', type: 'select', value: packOf(x).unit, options: PACK_UNITS.map(u => [u, u === 'pcs' ? 'pcs (pieces)' : u === 'pack' ? 'pack (no size)' : u]) },
  { name: 'count', row: 'cp', label: opts && opts.master ? 'Usual count (packs)' : 'How many packs', value: fmtN(num(x.count) || 1), type: 'number', step: 'any', min: 0, inputmode: 'decimal' },
  { name: 'price', row: 'cp', label: opts && opts.master ? 'Usual price (₹)' : 'Price (₹)', value: num(x.price) || '', type: 'number', step: 'any', min: 0, inputmode: 'decimal', placeholder: '0' },
  { name: 'pmode', label: 'That price is', type: 'select', value: 'pack', options: PRICE_MODES }
];
/* Edit pack size / unit / count / price of one month row (the "200 g ✎" chip). */
async function gPackSheet(i) {
  const mo = G().months[ui.gMonth], it = mo && mo.items[i]; if (!it) return;
  const m = it.mid && G().master.find(x => x.id === it.mid);
  const fields = packFields(it);
  if (m) fields.push({ name: 'scope', label: 'Save for', type: 'select', value: 'month', options: [['month', 'This month only'], ['usual', 'This month + my usual pack for ' + m.name]] });
  const r = await formSheet({ title: it.name + ' — pack & price', fields, ok: 'Save', focus: false, preview: v => packPreview(v, '') });
  if (!r) return;
  const size = num(r.size); if (!(size > 0)) return;
  it.size = size; it.sizeUnit = UNIT_BASE[r.unit] ? r.unit : 'pack';
  if (num(r.count) > 0) it.count = num(r.count);
  it.price = Math.round(pricePerPack(r) * 100) / 100;
  if (m && r.scope === 'usual') Object.assign(m, { size: it.size, sizeUnit: it.sizeUnit, count: it.count, price: it.price });
  save(); render();
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
      const a = items[key] = items[key] || { key, name: it.name, times: 0, spend: 0, hist: [] };
      a.times++; a.spend += lt; a.hist.push({ mk, price: num(it.price), norm: normPrice(it.price, it), bu: baseUnit(it), base: lineBase(it), pack: packText(it), count: num(it.count) });
    });
    months.push({ mk, total });
  }
  Object.values(items).forEach(a => {
    const l = a.hist[a.hist.length - 1]; a.bu = l.bu;
    a.base = a.hist.filter(h => h.bu === l.bu).reduce((s, h) => s + h.base, 0);
    const f = a.hist.find(h => h.bu === l.bu);
    a.change = f && f.norm ? (l.norm - f.norm) / f.norm * 100 : 0;   // compared per kg / L / pc, so pack-size changes don't fake a price change
    a.now = l;
  });
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
    h += '<h2>What I bought in ' + y + '</h2><div class="card" style="padding:4px 10px"><table class="t"><tr><th>Item</th><th class="r">Bought</th><th class="r">Spent</th><th class="r">Price Δ</th></tr>' +
      yd.items.map(a => {
        const ch = a.change, n = a.now;
        return '<tr data-act="gItemKey" data-key="' + esc(a.key) + '" data-testid="g-year-item" style="cursor:pointer"><td><div class="bold">' + esc(a.name) + '</div><div class="tiny muted">' + plural(a.times, 'month') + ' · now ' + money(n.price) + '/' + esc(n.pack) +
          (n.bu !== 'pack' ? ' · ' + money(n.norm) + '/' + n.bu : '') + '</div></td>' +
          '<td class="r">' + esc(fmtBase(a.base, a.bu)) + '</td><td class="r bold">' + money(a.spend) + '</td>' +
          '<td class="r ' + (ch > 0.05 ? 'up' : ch < -0.05 ? 'down' : 'muted') + '">' + (a.hist.length > 1 && Math.abs(ch) > 0.05 ? (ch > 0 ? '▲' : '▼') + Math.abs(ch).toFixed(0) + '%' : '—') + '</td></tr>';
      }).join('') + '</table></div><div class="tiny muted center">Price Δ compares ₹/kg, ₹/L or ₹/piece, so different pack sizes are fair. Tap an item for prices by store and history.</div>';
  }
  h += viewStoreSummary(y);
  return h;
}
function priceHistory(key) {
  const out = [];
  Object.keys(G().months).sort().forEach(mk => {
    G().months[mk].items.forEach(it => { if (it.bought && (it.mid || it.name) === key) out.push({ mk, price: num(it.price), norm: normPrice(it.price, it), bu: baseUnit(it), qty: qtyText(it), pack: packText(it), name: it.name, store: it.store || '' }); });
  });
  return out;
}
function showHistory(key) {
  const hs = priceHistory(key); if (!hs.length) return;
  const nm = hs[hs.length - 1].name, bu = hs[hs.length - 1].bu;
  let rows = '', prev = null;
  hs.forEach(x => {
    const d = prev && prev.bu === x.bu ? (x.norm - prev.norm) / prev.norm * 100 : null;
    rows += '<tr data-testid="hist-row"><td>' + monthName(x.mk) + '<div class="tiny muted">' + esc(storeName(x.store)) + '</div></td><td class="r small">' + esc(x.qty) + '</td><td class="r"><b>' + money(x.price) + '</b>' +
      (x.bu !== 'pack' ? '<div class="tiny muted">' + money(x.norm) + '/' + x.bu + '</div>' : '') + '</td><td class="r ' + (d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'muted') + '">' + (d == null || Math.abs(d) <= 0.05 ? '—' : (d > 0 ? '▲' : '▼') + Math.abs(d).toFixed(1) + '%') + '</td></tr>';
    prev = x;
  });
  const norms = hs.filter(x => x.bu === bu).map(x => x.norm);
  $('#sheetRoot').innerHTML = '<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Price history"><div class="grab"></div><h3>' + esc(nm) + ' — price history</h3>' +
    '<div class="small muted">Per ' + esc(bu) + ' · low ' + money(Math.min.apply(null, norms)) + ' · high ' + money(Math.max.apply(null, norms)) + ' · change is per ' + esc(bu) + '</div>' +
    '<table class="t" style="margin-top:8px"><tr><th>Month</th><th class="r">Bought</th><th class="r">Price/pack</th><th class="r">Change</th></tr>' + rows + '</table>' +
    '<div class="actions"><button class="btn block" type="button" data-close>Close</button></div></div></div>';
  const bg = $('#sheetRoot .sheet-bg');
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) closeSheet(); });
}
function viewGItems() {
  const M = G().master;
  let h = '<div class="note">These are your usual grocery items. Each new month starts with all of them (unticked), with your usual pack and count, prefilled with the last price you paid.</div>';
  if (!M.length) h += '<div class="empty small">No items yet.</div>';
  else {
    h += '<div class="card" style="padding:2px 12px">';
    M.slice().sort((a, b) => (a.cat || '~').localeCompare(b.cat || '~') || a.name.localeCompare(b.name)).forEach(m => {
      h += '<div class="item" data-testid="g-master"><div class="txt" data-act="gItemKey" data-key="' + m.id + '" style="cursor:pointer;padding-left:4px"><div class="bold">' + esc(m.name) + '</div><div class="small muted">' +
        (m.cat ? esc(m.cat) + ' · ' : '') + esc(qtyText(m)) + ' · ' + (num(m.price) ? money(m.price) + '/pack' : '—') + '</div></div>' +
        '<button class="icon-btn ghost sm" data-act="gEditMaster" data-id="' + m.id + '" aria-label="Edit ' + esc(m.name) + '">✏️</button>' +
        '<button class="icon-btn ghost sm" data-act="gDelMaster" data-id="' + m.id + '" aria-label="Delete ' + esc(m.name) + '">✕</button></div>';
    });
    h += '</div>';
  }
  h += '<div class="fab-row"><button class="btn primary grow" data-act="gAddMaster">＋ Add grocery item</button><button class="btn grow" data-act="photo">📷 From photo</button></div>';
  h += '<div class="fab-row"><button class="btn block" data-act="stores" data-testid="manage-stores">🏪 Manage stores (' + S.stores.length + ')</button></div>';
  return h;
}
function masterFields(m) {
  const cats = Array.from(new Set(G().master.map(x => x.cat).filter(Boolean)));
  return [{ name: 'name', label: 'Item name', value: m ? m.name : '', placeholder: 'e.g. Toor dal', required: true }]
    .concat(packFields(m || { size: 1, sizeUnit: 'kg', count: 1, price: '' }, { master: true }))
    .concat([{ name: 'cat', label: 'Category (optional)', value: m ? m.cat || '' : '', placeholder: cats.length ? cats.slice(0, 3).join(', ') : 'Staples, Vegetables, Dairy…' }]);
}
const masterFromForm = r => ({ name: r.name, size: num(r.size) > 0 ? num(r.size) : 1, sizeUnit: UNIT_BASE[r.unit] ? r.unit : 'pack', count: num(r.count) > 0 ? num(r.count) : 1, price: Math.round(pricePerPack(r) * 100) / 100, cat: r.cat });
async function gAddMaster() {
  const r = await formSheet({ title: 'New grocery item', fields: masterFields(null), ok: 'Add', preview: v => packPreview(v, v.name) });
  if (!r || !r.name) return;
  const m = Object.assign({ id: uid() }, masterFromForm(r));
  G().master.push(m);
  const cmk = curMonthKey(), cm = G().months[cmk];
  if (cm) cm.items.push(monthItem(m, cmk));
  if (ui.gMonth && ui.gMonth !== cmk && G().months[ui.gMonth]) G().months[ui.gMonth].items.push(monthItem(m, ui.gMonth));
  save(); render(); toast('Added ' + m.name);
}
async function gEditMaster(id) {
  const m = G().master.find(x => x.id === id); if (!m) return;
  const r = await formSheet({ title: 'Edit item', fields: masterFields(m), preview: v => packPreview(v, v.name) });
  if (!r || !r.name) return;
  const old = { size: m.size, sizeUnit: m.sizeUnit, count: num(m.count), price: num(m.price) };
  Object.assign(m, masterFromForm(r));
  const cm = G().months[curMonthKey()];
  if (cm) cm.items.forEach(it => {
    if (it.mid !== id) return;
    it.name = m.name; it.cat = m.cat;
    if (it.bought) return;
    const packWasUsual = samePack(it, old);
    if (packWasUsual) { it.size = m.size; it.sizeUnit = m.sizeUnit; }
    if (num(it.count) === old.count) it.count = m.count;
    if (packWasUsual && (num(it.price) === old.price || !num(it.price))) it.price = m.price;
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
const goalStart = g => g.start || todayKey();
const firstOnOrAfter = (k, wd) => addDays(k, (wd - parseKey(k).getDay() + 7) % 7);
function goalDone(g) { return g.dates.length + (g.prior || 0); }
/* First day that can count: the start date, or for weekly goals the first matching weekday on/after it. */
const goalFirstDay = g => isWeekly(g) ? firstOnOrAfter(goalStart(g), +g.weekday) : goalStart(g);
const goalNotStarted = g => goalStart(g) > todayKey();
function nextOccurrence(g) {
  if (!isWeekly(g)) return null;
  const t = todayKey(), diff = (g.weekday - parseKey(t).getDay() + 7) % 7;
  let k = addDays(t, diff);
  if (diff === 0 && g.dates.includes(t)) k = addDays(t, 7);
  const first = goalFirstDay(g);
  return first > k ? first : k;
}
function lastOccurrence(g) { const t = todayKey(); return addDays(t, -((parseKey(t).getDay() - g.weekday + 7) % 7)); }
function goalStats(g) {
  const t = todayKey(), start = goalStart(g), notStarted = start > t;
  const done = goalDone(g), target = g.target, remaining = Math.max(0, target - done);
  const pct = Math.min(100, done / target * 100);
  const weekly = isWeekly(g);
  let est = null, estEarliest = false, missed = 0;
  if (remaining > 0) {
    if (weekly) est = addDays(nextOccurrence(g), (remaining - 1) * 7);
    else if (notStarted) { est = addDays(start, remaining - 1); estEarliest = true; }
    else if (g.dates.length >= 2) {
      const ds = g.dates.slice().sort(), span = Math.max(1, daysBetween(ds[0], ds[ds.length - 1]));
      est = addDays(t, Math.ceil(remaining * span / (ds.length - 1)));
    }
  }
  if (weekly && !notStarted) {
    const sorted = g.dates.slice().sort();
    let s = start;
    if (sorted[0] && sorted[0] < s) s = sorted[0];
    let d = firstOnOrAfter(s, +g.weekday);
    while (d < t) { if (!g.dates.includes(d)) missed++; d = addDays(d, 7); }
  }
  return { done, target, remaining, pct, est, estEarliest, missed, weekly, notStarted, start, firstDay: goalFirstDay(g), daysToStart: notStarted ? daysBetween(t, start) : 0 };
}
const startsInText = st => 'Starts ' + (st.daysToStart === 1 ? 'tomorrow' : 'in ' + st.daysToStart + ' days') + ' · ' + fmtDLong(st.start);
function goalPrimary(g) {
  const t = todayKey(), st = goalStats(g);
  if (st.notStarted) {
    return '<button class="btn block" disabled data-testid="goal-primary">⏳ First ' + (st.weekly ? WD[g.weekday] : 'day') + ': ' + fmtDShort(st.firstDay) + '</button>';
  }
  if (!isWeekly(g) || parseKey(t).getDay() === +g.weekday) {
    const on = g.dates.includes(t);
    return '<button class="btn ' + (on ? '' : 'primary') + ' block" data-act="goalToggle" data-id="' + g.id + '" data-day="' + t + '" data-testid="goal-primary">' + (on ? '✓ Done today · tap to undo' : '＋ Mark today done') + '</button>';
  }
  const last = lastOccurrence(g);
  if (!g.dates.includes(last) && last >= goalStart(g)) {
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
      (st.weekly ? '<span class="badge">Every ' + WD[x.weekday] + '</span>' : '<span class="badge">Any day</span>') +
      (st.notStarted ? ' <span class="badge soon" data-testid="goal-soon">Upcoming</span>' : '') + '</div>' +
      (ui.reorder ? reorderBtns('goal', x.id, i, S.goals.length) : '<button class="icon-btn ghost" data-act="goalMenu" data-id="' + x.id + '" aria-label="Goal options">⋯</button>') + '</div>';
    if (!ui.reorder) {
      h += '<div class="goal-nums"><b data-testid="goal-count">' + st.done + '</b><span class="muted">/ ' + st.target + '</span><span class="grow"></span><span class="bold" data-testid="goal-pct">' + Math.floor(st.pct) + '%</span></div>' +
        '<div class="progress"><i style="width:' + st.pct + '%"></i></div>' +
        (st.notStarted ? '<div class="small soon-text" style="margin-top:6px" data-testid="goal-starts">⏳ ' + startsInText(st) + '</div>' : '') +
        '<div class="small muted" style="margin-top:' + (st.notStarted ? 2 : 6) + 'px" data-testid="goal-summary">' + (st.remaining ? st.remaining + ' to go' + (st.est ? ' · ' + (st.estEarliest ? 'earliest finish ' : 'est. finish ') + fmtD(st.est) : '') : '🎉 Target reached!') + '</div>' +
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
  h += '<div class="card"><h3 class="center">' + esc(g.name) + '</h3><div class="center" style="margin:4px 0">' + (st.weekly ? '<span class="badge">Every ' + WD[g.weekday] + '</span>' : '<span class="badge">Any day</span>') +
    (st.notStarted ? ' <span class="badge soon">Upcoming</span>' : '') + '</div>' +
    '<div class="ring" style="--p:' + st.pct + '"><div data-testid="goal-ring">' + Math.floor(st.pct) + '%</div></div>' +
    (st.notStarted ? '<div class="note center" data-testid="goal-starts-detail">⏳ ' + startsInText(st) + '</div>' : '') +
    '<div class="progress"><i style="width:' + st.pct + '%"></i></div>' +
    '<div class="kv" style="margin-top:12px"><span>Done</span><span data-testid="goal-done">' + st.done + ' / ' + st.target + '</span><span>Remaining</span><span data-testid="goal-remaining">' + st.remaining + '</span>' +
    (g.prior ? '<span>Counted before app</span><span>' + g.prior + '</span>' : '') +
    '<span>' + (st.notStarted ? 'Starts' : 'Started') + '</span><span data-testid="goal-start">' + fmtD(st.start) + '</span>' +
    (st.notStarted && st.weekly && st.firstDay !== st.start ? '<span>First ' + WD[g.weekday] + '</span><span>' + fmtD(st.firstDay) + '</span>' : '') +
    (st.weekly && !st.notStarted ? '<span>Missed ' + WD[g.weekday] + 's</span><span data-testid="goal-missed">' + st.missed + '</span>' : '') +
    '<span>' + (st.estEarliest ? 'Earliest finish' : 'Estimated finish') + '</span><span data-testid="goal-est">' + (st.remaining ? (st.est ? fmtD(st.est) : '—') : 'Done 🎉') + '</span></div>' +
    '<div class="goal-mark">' + goalPrimary(g) + '</div>' +
    (st.notStarted ? '<div class="tiny muted center" style="margin-top:8px">You can start marking from ' + fmtD(st.firstDay) + '.</div>' :
      '<form class="add-form" data-form="goalDate" style="margin-top:10px"><input class="field" type="date" name="day" max="' + t + '" value="' + t + '" aria-label="Pick a date"><button class="btn" type="submit">Mark date</button></form>') + '</div>';
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
    { name: 'start', label: 'Start date', type: 'date', value: g ? goalStart(g) : todayKey(), hint: 'Can be in the future — the goal waits until then.' },
    { name: 'prior', label: 'Already done before using the app', type: 'number', min: 0, step: 1, inputmode: 'numeric', value: g ? g.prior || 0 : 0, hint: 'Counts toward the target without dates.' }
  ];
}
const validDay = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
async function newGoal() {
  const r = await formSheet({ title: 'New goal', fields: goalFields(null), ok: 'Create' });
  if (!r || !r.name) return;
  const g = { id: uid(), name: r.name, target: Math.max(1, parseInt(r.target, 10) || 1), weekday: r.weekday === '' ? null : +r.weekday, start: validDay(r.start) ? r.start : todayKey(), prior: Math.max(0, parseInt(r.prior, 10) || 0), dates: [], created: now().toISOString() };
  S.goals.push(g);
  save(); render();
  toast(goalNotStarted(g) ? 'Goal created · starts ' + fmtD(g.start, { day: 'numeric', month: 'short' }) : 'Goal created');
}
async function goalMenu(id) {
  const g = S.goals.find(x => x.id === id); if (!g) return;
  const v = await menuSheet(g.name, [{ label: 'Edit / rename', value: 'edit', icon: '✏️' }, { label: 'Reorder goals', value: 'reorder', icon: '↕️' }, { label: 'Delete goal', value: 'del', icon: '🗑️', danger: true }]);
  if (v === 'edit') {
    const r = await formSheet({ title: 'Edit goal', fields: goalFields(g) });
    if (!r || !r.name) return;
    const newStart = validDay(r.start) ? r.start : goalStart(g);
    const before = g.dates.filter(d => d < newStart);
    if (before.length && !await confirmSheet('Remove ' + plural(before.length, 'earlier date') + '?', 'The new start date is ' + fmtD(newStart) + '. Dates marked before it will be removed.', 'Remove & save')) return;
    Object.assign(g, { name: r.name, target: Math.max(1, parseInt(r.target, 10) || 1), weekday: r.weekday === '' ? null : +r.weekday, start: newStart, prior: Math.max(0, parseInt(r.prior, 10) || 0) });
    g.dates = g.dates.filter(d => d >= newStart);
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
  if (!validDay(day)) return;
  if (day > t) { toast('Can’t mark a future date'); return; }
  if (g.dates.includes(day)) { toast(fmtD(day) + ' is already marked'); return; }
  const start = goalStart(g);
  if (day < start) {
    if (start > t) { toast('This goal starts on ' + fmtD(start)); return; }
    if (!await confirmSheet('Before the start date', 'This goal starts on ' + fmtD(start) + '. Move the start to ' + fmtD(day) + ' and count it?', 'Move start & count', false)) return;
    g.start = day;
  }
  if (isWeekly(g) && parseKey(day).getDay() !== +g.weekday) {
    if (!await confirmSheet('Not a ' + WD[g.weekday], fmtDShort(day) + ' is a ' + WD[parseKey(day).getDay()] + '. Count it anyway?', 'Count it', false)) return;
  }
  const before = goalDone(g);
  g.dates.push(day); g.dates.sort(); save(); render();
  if (before < g.target && goalDone(g) >= g.target) toast('🎉 Target reached: ' + g.name);
  else toast('Marked ' + fmtD(day, { day: 'numeric', month: 'short' }) + ' · ' + goalDone(g) + '/' + g.target, 'Undo', () => { g.dates = g.dates.filter(d => d !== day); save(); render(); });
}

/* =====================================================================
   STORES · COMPARE · PRICE INSIGHTS
   ===================================================================== */
const DEFAULT_STORES = ['Mall', 'BigBasket', 'Blinkit', 'Zepto', 'JioMart', 'Amazon Fresh', 'Local kirana'];
const defaultStores = () => DEFAULT_STORES.map((n, i) => ({ id: 's' + (i + 1), name: n }));
// Search URL formats verified Oct 2026 (Blinkit/Zepto/Amazon loaded live; BigBasket/JioMart from published examples).
const COMPARE_SITES = [
  ['BigBasket', q => 'https://www.bigbasket.com/ps/?q=' + q + '&nc=as', '#84c225'],
  ['Blinkit', q => 'https://blinkit.com/s/?q=' + q, '#f8cb46'],
  ['Zepto', q => 'https://www.zepto.com/search?query=' + q, '#7b2ff7'],
  ['JioMart', q => 'https://www.jiomart.com/search/' + q, '#0078ad'],
  ['Amazon Fresh', q => 'https://www.amazon.in/s?k=' + q + '&i=nowstore', '#ff9900']
];
const searchTerm = name => encodeURIComponent(String(name || '').replace(new RegExp(SIZE_RE.source, 'gi'), ' ').replace(/\s{2,}/g, ' ').trim() || String(name || '').trim());
function compareLinks(name, cls) {
  const q = searchTerm(name);
  return '<div class="cmp-grid ' + (cls || '') + '">' + COMPARE_SITES.map(([n, f, c]) =>
    '<a class="cmp" href="' + esc(f(q)) + '" target="_blank" rel="noopener noreferrer" data-testid="cmp-link" style="--c:' + c + '"><i></i>' + esc(n) + ' <span aria-hidden="true">↗</span></a>').join('') + '</div>';
}
const storeById = id => S.stores.find(s => s.id === id);
const storeName = id => (id && storeById(id)) ? storeById(id).name : 'Unknown store';
const NEW_STORE = '__new__';
function storeOptions(sel) {
  const known = sel && storeById(sel);
  return '<option value=""' + (!known ? ' selected' : '') + '>Unknown store</option>' + S.stores.map(s => '<option value="' + esc(s.id) + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') +
    '<option value="' + NEW_STORE + '">＋ New store…</option>';
}
/* Add a store by name; returns the existing one on a case-insensitive match (no duplicates). */
function ensureStore(name) {
  const v = String(name || '').replace(/\s+/g, ' ').trim(); if (!v) return null;
  const hit = S.stores.find(x => x.name.toLowerCase() === v.toLowerCase());
  if (hit) return { store: hit, created: false };
  const st = { id: uid(), name: v }; S.stores.push(st); save();
  return { store: st, created: true };
}
/* Ask for a new store name in a small layer ON TOP of whatever sheet is open (that sheet stays put). */
function promptNewStore() {
  return new Promise(resolve => {
    let layer = document.getElementById('promptRoot');
    if (!layer) { layer = document.createElement('div'); layer.id = 'promptRoot'; document.body.appendChild(layer); }
    layer.innerHTML = '<div class="sheet-bg layer2"><form class="sheet" role="dialog" aria-modal="true" aria-label="New store" data-testid="new-store-sheet"><div class="grab"></div><h3>New store</h3>' +
      '<label class="lbl" for="newStoreName">Store name</label><input class="field" id="newStoreName" name="name" placeholder="e.g. DMart, Star Bazaar, Ratnadeep" autocomplete="off" required>' +
      '<div class="tiny muted" style="margin:4px 2px">It’s added to your store list and picked here.</div>' +
      '<div class="actions"><button type="button" class="btn" data-x="cancel">Cancel</button><button type="submit" class="btn primary" data-x="ok">Add store</button></div></form></div>';
    const bg = layer.firstChild, form = bg.querySelector('form');
    const done = v => { layer.innerHTML = ''; resolve(v); };
    bg.addEventListener('click', e => { e.stopPropagation(); if (e.target === bg || e.target.closest('[data-x=cancel]')) done(null); });
    form.addEventListener('submit', e => {
      e.preventDefault(); e.stopPropagation();
      const r = ensureStore(form.name.value); if (!r) return;
      toast(r.created ? 'Added store “' + r.store.name + '”' : '“' + r.store.name + '” is already in your list — picked it');
      done(r.store.id);
    });
    setTimeout(() => form.name.focus(), 50);
  });
}
/* Wire a store <select>: picking "＋ New store…" prompts for a name, then selects it. */
async function pickStoreFrom(sel, prev, onPick) {
  if (sel.value !== NEW_STORE) { onPick(sel.value); return; }
  const id = await promptNewStore();
  const val = id || prev || '';
  document.querySelectorAll('select.g-store, select[data-store-sel]').forEach(x => { const v = x === sel ? val : x.value; x.innerHTML = storeOptions(v); x.value = v; });
  onPick(val);
}
const boughtDate = mk => mk === curMonthKey() ? todayKey() : (mk + '-28' < todayKey() ? mk + '-28' : todayKey());
/* All price observations for an item: bought lines (per month) + prices recorded manually. Compared per kg / L / piece. */
function itemObservations(key) {
  const out = [];
  Object.keys(G().months).sort().forEach(mk => G().months[mk].items.forEach(it => {
    if (it.bought && num(it.price) > 0 && (it.mid || it.name) === key)
      out.push({ date: it.boughtOn || mk + '-28', mk, store: it.store || '', price: num(it.price), size: packOf(it).size, sizeUnit: packOf(it).unit, count: num(it.count), base: lineBase(it), norm: normPrice(it.price, it), bu: baseUnit(it), pack: packText(it), src: 'bought' });
  }));
  (G().prices || []).forEach(p => { if (p.mid === key && num(p.price) > 0) out.push({ date: p.date, mk: p.date.slice(0, 7), store: p.store || '', price: num(p.price), size: packOf(p).size, sizeUnit: packOf(p).unit, norm: normPrice(p.price, p), bu: baseUnit(p), pack: packText(p), src: 'seen', id: p.id }); });
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.src === 'bought' ? -1 : 1));
}
/* Latest price per store (per kg/L/pc), cheapest store, and saving vs. where it was last bought. */
function storeInsight(key) {
  const all = itemObservations(key); if (!all.length) return null;
  const bu = all[all.length - 1].bu, obs = all.filter(o => o.bu === bu);     // only compare like with like (kg with kg…)
  const latest = {};
  obs.forEach(o => { const s = o.store && storeById(o.store) ? o.store : ''; latest[s] = o; });
  let cheapest = null;
  Object.keys(latest).filter(Boolean).forEach(s => { const o = latest[s]; if (!cheapest || o.norm < cheapest.norm) cheapest = { store: s, norm: o.norm, price: o.price, pack: o.pack, date: o.date }; });
  const lastBuy = obs.slice().reverse().find(o => o.src === 'bought') || null;
  const lastStore = lastBuy && lastBuy.store && storeById(lastBuy.store) ? lastBuy.store : '';
  const saving = cheapest && lastBuy && lastStore !== cheapest.store && lastBuy.norm > cheapest.norm + 1e-9 ? lastBuy.norm - cheapest.norm : 0;  // per kg / L / pc
  return { bu, latest, cheapest, lastBuy, lastStore, saving, savingTotal: saving && lastBuy ? saving * lastBuy.base : 0, nStores: Object.keys(latest).filter(Boolean).length };
}
const perBu = (n, bu) => money(n) + '/' + bu;
function cheapestHint(it) {
  const ins = storeInsight(it.mid || it.name);
  if (!ins || !ins.cheapest || ins.bu !== baseUnit(it)) return '';
  const cur = normPrice(it.price, it), cs = ins.cheapest;
  if ((it.store || '') === cs.store || !(cur > cs.norm + 0.004)) return ins.nStores > 1 && (it.store || '') === cs.store ? '<div class="hint good">⭐ Cheapest store</div>' : '';
  return '<div class="hint" data-testid="cheap-hint">💡 ' + esc(storeName(cs.store)) + ' ' + perBu(cs.norm, ins.bu) + ' · save ' + perBu(cur - cs.norm, ins.bu) + '</div>';
}
function compareSheet(name) {
  $('#sheetRoot').innerHTML = '<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Compare prices" data-testid="compare-sheet"><div class="grab"></div><h3>Compare “' + esc(name) + '”</h3>' +
    '<div class="small muted">Opens each store’s search in a new tab. Note the price you find with “Record a price” to track the cheapest store.</div>' +
    compareLinks(name) + '<div class="actions"><button class="btn block" type="button" data-close>Close</button></div></div></div>';
  const bg = $('#sheetRoot .sheet-bg');
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) closeSheet(); });
}
/* Item detail: compare links, latest price per store (normalised), cheapest + saving, record a price. */
function itemSheet(key) {
  const m = G().master.find(x => x.id === key);
  const obs = itemObservations(key);
  const lastRow = (() => { for (const mk of Object.keys(G().months).sort().reverse()) { const r = G().months[mk].items.find(it => (it.mid || it.name) === key); if (r) return r; } return null; })();
  const ref = m || lastRow || {};
  const name = m ? m.name : (lastRow ? lastRow.name : key);
  const ins = storeInsight(key);
  let rows = '';
  if (ins) {
    Object.keys(ins.latest).sort((a, b) => (!a - !b) || ins.latest[a].norm - ins.latest[b].norm).forEach(s => {
      const o = ins.latest[s], best = ins.cheapest && ins.cheapest.store === s;
      rows += '<tr data-testid="store-row"' + (best ? ' class="best"' : '') + '><td>' + (best ? '⭐ ' : '') + esc(storeName(s)) + '<div class="tiny muted">' + money(o.price) + ' / ' + esc(o.pack) + '</div></td>' +
        '<td class="r bold">' + (ins.bu === 'pack' ? money(o.norm) : perBu(o.norm, ins.bu)) + '</td><td class="r tiny muted">' + fmtD(o.date, { day: 'numeric', month: 'short', year: '2-digit' }) + (o.src === 'seen' ? ' · seen' : '') + '</td></tr>';
    });
  }
  let saving = '';
  if (ins && ins.lastBuy) {
    const lb = ins.lastBuy;
    saving = '<div class="note small" data-testid="saving-note">Last bought at <b>' + esc(storeName(ins.lastStore)) + '</b>: ' + money(lb.price) + ' for ' + esc(lb.pack) + (ins.bu !== 'pack' ? ' (' + perBu(lb.norm, ins.bu) + ')' : '') + '.' +
      (ins.saving ? ' Cheapest seen: <b>' + esc(storeName(ins.cheapest.store)) + '</b> ' + perBu(ins.cheapest.norm, ins.bu) + ' → save <b>' + perBu(ins.saving, ins.bu) + '</b>' +
        ' (' + money(ins.savingTotal) + ' on ' + esc(fmtBase(lb.base, ins.bu)) + ').'
        : (ins.cheapest && ins.nStores > 1 && ins.cheapest.store === ins.lastStore ? (ins.cheapest.norm < lb.norm - 0.004 ? ' It’s now ' + perBu(ins.cheapest.norm, ins.bu) + ' there — still' : ' That’s') + ' the cheapest store you’ve seen. 👍' : '')) + '</div>';
  }
  const rp = packOf(ref);
  $('#sheetRoot').innerHTML = '<div class="sheet-bg"><div class="sheet tall" role="dialog" aria-label="Item details" data-testid="item-sheet"><div class="grab"></div>' +
    '<h3>' + esc(name) + (m ? ' <span class="muted small">· usual ' + esc(qtyText(m)) + '</span>' : '') + '</h3>' +
    '<div class="small bold" style="margin-top:8px">Compare online</div>' + compareLinks(name) +
    '<div class="small bold" style="margin-top:14px">Latest price per store <span class="muted tiny">(compared per ' + esc(ins ? ins.bu : baseUnit(ref)) + ')</span></div>' +
    (rows ? '<table class="t" style="margin-top:4px">' + rows + '</table>' : '<div class="small muted" style="margin:6px 0">No prices yet. Mark it bought with a store, or record a price below.</div>') + saving +
    '<form class="rec-form" data-x="rec"><div class="rec-line"><select class="field" name="store" aria-label="Store" data-store-sel>' + storeOptions(G().lastStore) + '</select>' +
    '<input class="field" name="price" type="number" inputmode="decimal" step="any" min="0" placeholder="₹ price" aria-label="Price seen" required></div>' +
    '<div class="rec-line"><span class="small muted">for</span><input class="field rec-size" name="size" type="number" inputmode="decimal" step="any" min="0" value="' + esc(fmtN(rp.size)) + '" aria-label="Pack size">' +
    '<select class="field rec-unit" name="unit" aria-label="Unit">' + PACK_UNITS.map(u => '<option' + (u === rp.unit ? ' selected' : '') + '>' + u + '</option>').join('') + '</select>' +
    '<button class="btn" type="submit">Record</button></div></form>' +
    '<div class="tiny muted">Record a price you saw (in a shop or online) without buying. Different pack sizes are compared per kg / L / piece.</div>' +
    '<div class="actions">' + (m ? '<button class="btn" type="button" data-x="edit">✏️ Edit item</button>' : '') + (obs.some(o => o.src === 'bought') ? '<button class="btn" type="button" data-x="hist">History</button>' : '') +
    '<button class="btn primary" type="button" data-close>Close</button></div>' +
    '<div class="center"><button class="linkish small" type="button" data-x="stores">🏪 Manage stores</button></div></div></div>';
  const bg = $('#sheetRoot .sheet-bg');
  bg.addEventListener('click', e => {
    if (e.target === bg || e.target.closest('[data-close]')) closeSheet();
    else if (e.target.closest('[data-x=edit]')) { closeSheet(); gEditMaster(key); }
    else if (e.target.closest('[data-x=hist]')) showHistory(key);
    else if (e.target.closest('[data-x=stores]')) storesSheet();
  });
  const sel = bg.querySelector('select[name=store]');
  let prevStore = sel.value;
  sel.addEventListener('change', () => pickStoreFrom(sel, prevStore, v => { prevStore = v; }));
  bg.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target, price = num(f.price.value), store = f.store.value === NEW_STORE ? '' : f.store.value;
    if (!(price > 0)) return;
    G().prices.push({ id: uid(), mid: key, store, price, size: num(f.size.value) > 0 ? num(f.size.value) : 1, sizeUnit: UNIT_BASE[f.unit.value] ? f.unit.value : 'pack', date: todayKey() });
    if (store) G().lastStore = store;
    save(); itemSheet(key); render(); toast('Recorded ' + money(price) + ' at ' + storeName(store));
  });
}
function storesSheet() {
  const rows = S.stores.map(s => '<div class="item" data-testid="store-item"><div class="txt" style="padding-left:6px">' + esc(s.name) + '</div>' +
    '<button type="button" class="icon-btn ghost sm" data-sx="ren" data-id="' + s.id + '" aria-label="Rename ' + esc(s.name) + '">✏️</button>' +
    '<button type="button" class="icon-btn ghost sm" data-sx="del" data-id="' + s.id + '" aria-label="Delete ' + esc(s.name) + '">✕</button></div>').join('');
  $('#sheetRoot').innerHTML = '<div class="sheet-bg"><div class="sheet tall" role="dialog" aria-label="Stores" data-testid="stores-sheet"><div class="grab"></div><h3>🏪 My stores</h3>' +
    '<div class="small muted">Pick these when you enter a price. Deleting a store keeps old prices (shown as “Unknown store”).</div>' +
    '<div class="card" style="padding:2px 10px;margin-top:10px">' + (rows || '<div class="empty small">No stores.</div>') + '</div>' +
    '<form class="add-form" data-x="add"><input class="field" name="name" placeholder="Add a store (e.g. DMart)" autocomplete="off" aria-label="New store"><button class="btn primary" type="submit">Add</button></form>' +
    '<div class="actions"><button class="btn block" type="button" data-close>Done</button></div></div></div>';
  const bg = $('#sheetRoot .sheet-bg');
  bg.addEventListener('click', async e => {
    if (e.target === bg || e.target.closest('[data-close]')) { closeSheet(); render(); return; }
    const b = e.target.closest('[data-sx]'); if (!b) return;
    const st = storeById(b.dataset.id); if (!st) return;
    if (b.dataset.sx === 'ren') {
      const r = await formSheet({ title: 'Rename store', fields: [{ name: 'name', label: 'Store name', value: st.name, required: true }] });
      if (r && r.name) {
        if (S.stores.some(x => x !== st && x.name.toLowerCase() === r.name.trim().toLowerCase())) toast('“' + r.name + '” already exists');
        else { st.name = r.name.trim(); save(); }
      }
      storesSheet();
    } else {
      const ok = await confirmSheet('Delete “' + st.name + '”?', 'Prices recorded at this store will show as “Unknown store”.', 'Delete');
      if (ok) { S.stores = S.stores.filter(x => x.id !== st.id); if (G().lastStore === st.id) G().lastStore = ''; save(); }
      storesSheet();
    }
  });
  bg.querySelector('form').addEventListener('submit', e => {
    e.preventDefault(); const v = e.target.name.value.trim(); if (!v) return;
    const r = ensureStore(v); if (!r) return;
    if (!r.created) { toast('“' + r.store.name + '” already exists'); return; }
    storesSheet();
    const inp = document.querySelector('[data-testid=stores-sheet] input[name=name]'); if (inp) inp.focus();
  });
}
/* Year insights: spend by store, cheapest store tally, potential savings. */
function storeYearSummary(y) {
  const spend = {}, cache = {};
  for (let m = 1; m <= 12; m++) {
    const mo = G().months[y + '-' + pad(m)]; if (!mo) continue;
    mo.items.forEach(it => {
      if (!it.bought) return;
      const s = it.store && storeById(it.store) ? it.store : '';
      spend[s] = (spend[s] || 0) + lineTotal(it);
      const key = it.mid || it.name;
      if (cache[key] === undefined) cache[key] = { name: it.name, ins: storeInsight(key) };
    });
  }
  // Potential saving = for each item, (last price paid − cheapest store's latest price) × last quantity,
  // i.e. what switching would save on your next usual purchase. Not a backward-looking guess.
  const items = Object.values(cache).filter(c => c.ins);
  const top = items.filter(c => c.ins.saving > 0).map(c => ({ name: c.name, bu: c.ins.bu, cheapest: c.ins.cheapest, lastStore: c.ins.lastStore, lastNorm: c.ins.lastBuy.norm,
    saving: r2(c.ins.savingTotal) })).sort((a, b) => b.saving - a.saving);
  const tally = {};
  items.forEach(c => { if (c.ins.cheapest && c.ins.nStores > 1) tally[c.ins.cheapest.store] = (tally[c.ins.cheapest.store] || 0) + 1; });
  const compared = items.filter(c => c.ins.nStores > 1).length;
  const best = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
  return { spend, potential: r2(top.reduce((t, x) => t + x.saving, 0)), nSave: top.length, tally, best, compared, top: top.slice(0, 5) };
}
function viewStoreSummary(y) {
  const ss = storeYearSummary(y);
  const total = Object.values(ss.spend).reduce((a, b) => a + b, 0);
  if (!total && !ss.compared) return '';
  let h = '<h2>Best store</h2><div class="card" data-testid="best-store">';
  if (ss.best) h += '<div class="row"><div style="font-size:2rem">🏆</div><div class="grow"><div class="bold" style="font-size:1.1rem" data-testid="best-store-name">' + esc(storeName(ss.best)) + '</div><div class="small muted">cheapest for ' + ss.tally[ss.best] + ' of ' + plural(ss.compared, 'item') + ' you’ve priced at 2+ stores</div></div></div>';
  else h += '<div class="small muted">Enter prices with a store (or “Record a price” on an item) at 2+ stores to see where things are cheapest.</div>';
  if (ss.potential > 0.5) h += '<div class="note" data-testid="potential-saving">Buying ' + (ss.nSave === 1 ? 'this item' : 'these ' + ss.nSave + ' items') + ' at the cheapest store you’ve seen would save about <b>' + money(Math.round(ss.potential)) + '</b> on your next usual shop.</div>';
  if (ss.top.length) h += '<table class="t" style="margin-top:6px"><tr><th>Item</th><th>Buy at</th><th class="r">Save</th></tr>' + ss.top.map(t =>
    '<tr><td><div class="bold">' + esc(t.name) + '</div><div class="tiny muted">' + esc(storeName(t.lastStore)) + ' ' + perBu(t.lastNorm, t.bu) + ' → ' + perBu(t.cheapest.norm, t.bu) + '</div></td><td>' + esc(storeName(t.cheapest.store)) + '</td><td class="r bold">' + money(t.saving) + '</td></tr>').join('') + '</table>';
  if (total) {
    const max = Math.max.apply(null, Object.values(ss.spend));
    h += '<div class="small bold" style="margin-top:12px">Spend by store</div>' + Object.keys(ss.spend).sort((a, b) => ss.spend[b] - ss.spend[a]).map(s =>
      '<div class="sbar"><span>' + esc(storeName(s)) + '</span><i style="width:' + (ss.spend[s] / max * 100) + '%"></i><b>' + money(ss.spend[s]) + '</b></div>').join('');
  }
  h += '<div class="center" style="margin-top:10px">' + storesBtn() + '</div>';
  return h + '</div>';
}

/* =====================================================================
   PHOTO → GROCERY ITEMS (in-browser OCR with vendored Tesseract.js)
   ===================================================================== */
const OCR_BASE = 'vendor/tesseract/';
const UNIT_WORDS = { kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', g: 'g', gm: 'g', gms: 'g', gr: 'g', gram: 'g', grams: 'g', l: 'litre', lt: 'litre', ltr: 'litre', ltrs: 'litre', litre: 'litre', litres: 'litre', liter: 'litre', liters: 'litre', ml: 'ml',
  pc: 'pc', pcs: 'pc', piece: 'pc', pieces: 'pc', pkt: 'packet', pkts: 'packet', packet: 'packet', packets: 'packet', pack: 'packet', packs: 'packet', dozen: 'dozen', doz: 'dozen', dz: 'dozen', nos: 'pc', no: 'pc', bunch: 'bunch', bunches: 'bunch', box: 'box', bottle: 'bottle', bottles: 'bottle', can: 'can', tin: 'tin', bag: 'bag', jar: 'jar' };
const UNIT_RE_SRC = Object.keys(UNIT_WORDS).sort((a, b) => b.length - a.length).join('|');
const SIZE_RE = new RegExp('(\\d+(?:\\.\\d+)?)\\s*(' + UNIT_RE_SRC + ')\\b\\.?', 'i');
const SKIP_RE = /\b(sub\s*-?\s*total|total|grand|net\s*(amt|amount|payable|value)|amount\s*(due|paid|payable|in\s*words)|gst|cgst|sgst|igst|utgst|vat|tax|taxable|cess|round(ed)?\s*-?\s*off|discount|disc|saving|savings|saved|change|cash|card|upi|paytm|gpay|phonepe|tender(ed)?|paid|balance|bill|invoice|inv|receipt|token|table|cashier|counter|date|time|phone|ph|mob(ile)?|tel|contact|gstin|fssai|cin|thank|thanks|visit|again|welcome|www|http|email|address|road|street|nagar|layout|cross|main\s*rd|pin\s*code|hsn|sac|description|particulars|sl|s\.?\s*no|qty|rate|mrp\s*total|items?\s*count|no\s*of\s*items|customer|terms|conditions|exchange|refund|e\s*&\s*o\.?\s*e)\b/i;
const LIST_HEADER_RE = /^(my\s+)?(shopping|grocery|groceries|kirana|to\s*buy|buy|list|items?|things\s+to\s+buy)(\s+list)?\s*[:\-]?\s*$/i;
const SYNONYMS = { tur: 'toor', arhar: 'toor', toovar: 'toor', dahi: 'curd', yogurt: 'curd', yoghurt: 'curd', chili: 'chilli', chilly: 'chilli', dhania: 'coriander', jeera: 'cumin', bhindi: 'okra', baingan: 'brinjal', eggplant: 'brinjal', aloo: 'potato', alu: 'potato', pyaz: 'onion', pyaaz: 'onion', tamatar: 'tomato', chawal: 'rice', doodh: 'milk', cheeni: 'sugar', namak: 'salt', haldi: 'turmeric', maida: 'flour', capsicum: 'capsicum', curd: 'curd' };
const STOP = new Set(['fresh', 'organic', 'premium', 'loose', 'the', 'of', 'and', 'pack', 'packet', 'pkt', 'new', 'special', 'pure', 'best', 'quality', 'super', 'regular', 'local']);

function fixNumToken(tok) {
  // OCR confusions inside numbers: O/o→0, l/I/|→1, S→5, B→8; strip currency marks; "1,234.00" → "1234.00"
  let t = tok.replace(/^(₹|rs\.?|inr|%|=|~)/i, '').replace(/[/-]$/, '');
  if (!/\d/.test(t)) return null;
  if (!/^[\dOolI|SB.,]+$/.test(t)) return null;
  t = t.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
  t = t.replace(/,(?=\d{3}(\D|$))/g, '').replace(/,(?=\d{1,2}$)/, '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return t;
}
function titleCase(s) { return s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()); }
function cleanName(s) {
  s = s.replace(/^[\s\-–—*•·>○◦□☐✓✔☑︎_~=+.,:;|'"`()\[\]]+/, '').replace(/[\s\-–—*•·_~=+.,:;|'"`(\[]+$/, '');
  s = s.replace(/^\(?\d{1,2}[.)]\s*/, '');           // "1. Milk", "2) Eggs"
  s = s.replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/^([^A-Za-z]{1,2}\s)+/, '').replace(/(\s[^A-Za-z0-9]{1,2})+$/, '').trim(); // stray OCR specks
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  if (letters >= 3 && s === s.toUpperCase()) s = titleCase(s);
  return s;
}
function extractSize(name) {
  const m = name.match(SIZE_RE);
  if (!m) return { name, size: null };
  const n = parseFloat(m[1]), u = toPackUnit(m[2]) || 'pack';
  const rest = (name.slice(0, m.index) + ' ' + name.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').replace(/[\s\-–,(]+$/, '').replace(/^[\s\-–,)]+/, '').trim();
  return { name: rest, size: { n, u } };
}
const approx = (a, b) => Math.abs(a - b) <= Math.max(1, 0.02 * Math.abs(b));
const r2 = n => Math.round(n * 100) / 100;
/* Decide qty / unit price / amount from the numbers at the end of a receipt line. */
function interpretNums(nums) {
  const v = nums.map(Number);
  if (v.length >= 3) {
    const last = v.slice(-4);
    const amt = last[last.length - 1];
    for (let i = 0; i < last.length - 1; i++) for (let j = 0; j < last.length - 1; j++) {
      if (i === j) continue;
      if (approx(last[i] * last[j], amt) && last[i] <= last[j]) return { qty: last[i], price: last[j], amount: amt };
    }
    return { qty: 1, price: amt, amount: amt };
  }
  if (v.length === 2) {
    const [a, b] = v;
    if (approx(a, b)) return { qty: 1, price: b, amount: b };
    const ratio = b / a;
    if (a > 0 && ratio >= 1.5 && ratio <= 50 && Math.abs(ratio - Math.round(ratio)) < 0.02 && a >= 5) return { qty: Math.round(ratio), price: a, amount: b };
    if (a > 0 && a <= 20 && b > a) return { qty: a, price: r2(b / a), amount: b };
    return { qty: 1, price: b, amount: b };
  }
  return { qty: 1, price: v[0], amount: v[0] };
}
function splitLine(line) {
  // returns { name, nums[] } where nums are the trailing numeric tokens (x / @ / * separators ignored)
  const toks = line.replace(/(\d)\s*[xX×*@]\s*(\d)/g, '$1 $2').split(/\s+/).filter(Boolean);
  const nums = [];
  while (toks.length) {
    const tk = toks[toks.length - 1];
    if (/^([xX×*@=:]|rs\.?|₹|inr|%)$/i.test(tk)) { toks.pop(); continue; }
    const n = fixNumToken(tk);
    if (n == null) { if (tk.length === 1 && nums.length) { toks.pop(); continue; } break; }
    nums.unshift(n); toks.pop();
  }
  return { name: toks.join(' '), nums };
}
function isJunkLine(l) {
  const digits = (l.match(/\d/g) || []).length, letters = (l.match(/[A-Za-z]/g) || []).length;
  if (letters < 2) return true;
  if (/(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/.test(l) || /\b\d{3,5}[\s-]\d{6,8}\b/.test(l)) return true;       // phone numbers
  if (/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/.test(l) || /\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\b/i.test(l)) return true; // dates / times
  if (/\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]{2}\b/i.test(l)) return true;    // GSTIN
  if (/@|\.com\b|\.in\b/i.test(l)) return true;
  const hasPrice = /\d[.,]\d{2}\b/.test(l);
  if (digits >= 8 && letters < digits && !hasPrice) return true;
  if (/\b[1-9]\d{5}\b/.test(l) && !hasPrice) return true;                 // PIN code
  return false;
}
/* Parse OCR text into candidate grocery lines. Exported for tests. */
function parseOcrText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/[“”"]/g, '').replace(/\t/g, '  ').trim()).filter(l => l.length > 1);
  const priced = lines.filter(l => !SKIP_RE.test(l) && /\d+[.,]\d{2}\s*$/.test(l)).length;
  const mode = (priced >= 2 || (priced >= 1 && priced >= lines.length * 0.3)) ? 'receipt' : 'list';
  const items = [];
  let started = false, pendingName = null;
  for (const raw of lines) {
    let l = raw;
    if (mode === 'receipt') {
      if (/\b(sub\s*-?\s*total|grand\s*total|net\s*(amt|amount|payable)|total\s*(amount|amt|qty|items)?\s*[:₹]|^total\b)/i.test(l) && started) break; // footer starts
      if (SKIP_RE.test(l) || isJunkLine(l.replace(/^[\d.\s]+$/, ''))) {
        // a numbers-only line can complete a pending two-line item
        if (pendingName && /^[\d.,\s₹xX@*rsRS]+$/.test(l)) {
          const sp = splitLine(l);
          if (sp.nums.length) { items.push(mkItem(pendingName, interpretNums(sp.nums), mode)); started = true; }
        }
        pendingName = null; continue;
      }
      const sp = splitLine(l);
      if (!sp.nums.length) { pendingName = sp.name; continue; }
      if ((sp.name.match(/[A-Za-z]/g) || []).length < 2) {
        if (pendingName) { items.push(mkItem(pendingName, interpretNums(sp.nums), mode)); started = true; pendingName = null; }
        continue;
      }
      if (!started && !sp.nums.some(n => /\.\d{2}$/.test(n))) { pendingName = null; continue; }
      // drop a leading serial number "1 Toor Dal ..."
      sp.name = sp.name.replace(/^\d{1,3}[.)]?\s+(?=[A-Za-z])/, '');
      items.push(mkItem(sp.name, interpretNums(sp.nums), mode)); started = true; pendingName = null;
    } else {
      if (LIST_HEADER_RE.test(l) || isJunkLine(l)) continue;
      if (SKIP_RE.test(l) && !/^[-*•·\d.)\s]*[A-Za-z]/.test(l.replace(SKIP_RE, ''))) continue;
      l = l.replace(/^\s*[-–—*•·>○◦□☐✓✔]+\s*/, '').replace(/^\(?\d{1,2}[.)]\s+/, '');
      l = l.replace(new RegExp('(^|\\s)([SsOoIl|])\\s*(?=(' + UNIT_RE_SRC + ')\\b)', 'g'), (m0, a, c) => a + ({ S: '5', s: '5', O: '0', o: '0', I: '1', l: '1', '|': '1' })[c] + ' ');
      // a number with a weight/volume/piece unit is the PACK SIZE ("Toor dal 1 kg", "Butter 100g");
      // a bare number or "x 3" / "3 packets" is the COUNT ("Milk x 4", "3 Onions").
      let count = 1, size = null, unit = '';
      const take = (n, u) => { const pu = u ? (toPackUnit(u) || 'pack') : null; if (pu && pu !== 'pack') { size = n; unit = pu; } else count = n; };
      let m = l.match(new RegExp('^(\\d+(?:\\.\\d+)?)\\s*(?:[xX×]\\s*)?(' + UNIT_RE_SRC + ')?\\b\\.?\\s*(?:[xX×]\\s+)?(?=[A-Za-z])', 'i'));  // "2 kg onions", "3 eggs", "2 x butter"
      if (m && !(m[2] === undefined && /^\d+[A-Za-z]/.test(l))) { take(parseFloat(m[1]), m[2]); l = l.slice(m[0].length); }
      m = l.match(new RegExp('[\\s\\-–:,(]+[xX×]\\s*(\\d+(?:\\.\\d+)?)\\s*(' + UNIT_RE_SRC + ')?\\.?\\)?\\s*$', 'i'));        // "... x 2"
      if (m) { take(parseFloat(m[1]), m[2]); l = l.slice(0, m.index); }
      m = l.match(new RegExp('[\\s\\-–:,(]+(\\d+(?:\\.\\d+)?)\\s*(' + UNIT_RE_SRC + ')?\\.?\\)?\\s*$', 'i'));               // "Milk - 3 L", "Eggs 2"
      if (m) { take(parseFloat(m[1]), m[2]); l = l.slice(0, m.index); }
      if (size == null) { const sz = extractSize(l); if (sz.size) { size = sz.size.n; unit = sz.size.u; if (unit === 'pack') { count = size; size = null; unit = ''; } l = sz.name; } }  // size inside the name
      const name = cleanName(l);
      if ((name.match(/[A-Za-z]/g) || []).length < 2 || name.length > 40) continue;
      items.push({ name, size: size > 0 && size < 100000 ? size : null, unit: size > 0 ? unit : '', count: count > 0 && count < 1000 ? count : 1, price: 0, amount: 0 });
    }
  }
  // tidy + de-duplicate by normalized name
  const out = [];
  items.forEach(it => {
    if (!it || !it.name || (it.name.match(/[A-Za-z]/g) || []).length < 2) return;
    const k = normName(it.name);
    if (!k) return;
    const prev = out.find(o => normName(o.name) === k && (o.unit || '') === (it.unit || '') && (o.size || 0) === (it.size || 0));
    if (prev) { const tot = prev.count * prev.price + it.count * it.price; prev.count = r2(prev.count + it.count); prev.price = prev.count ? r2(tot / prev.count) : prev.price; prev.amount = r2(prev.amount + it.amount); }
    else out.push(it);
  });
  return { mode, items: out, lines: lines.length };
}
function mkItem(rawName, nums, mode) {
  let name = cleanName(rawName.replace(/\s+\d+(\.\d+)?\s*$/, ''));
  const sz = extractSize(name);
  name = cleanName(sz.name) || name;
  let size = sz.size ? sz.size.n : null, unit = sz.size ? sz.size.u : '';
  if (unit === 'pack') { size = null; unit = ''; }
  return { name, size, unit, count: nums.qty, price: r2(nums.price), amount: r2(nums.amount) };
}

/* ---- fuzzy name matching against the usual-items list ---- */
function normName(s) {
  return String(s || '').toLowerCase().replace(new RegExp(SIZE_RE.source, 'gi'), ' ').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => SYNONYMS[w] || w).map(w => w.length > 4 && /(oes|ies)$/.test(w) ? w.replace(/(oes)$/, 'o').replace(/ies$/, 'y') : (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w))
    .map(w => SYNONYMS[w] || w).filter(w => !STOP.has(w)).join(' ').trim();
}
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function nameSimilarity(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const tx = x.split(' '), ty = y.split(' ');
  const [sh, lo] = tx.length <= ty.length ? [tx, ty] : [ty, tx];
  // the head noun is usually the last word: "Tata Salt" ≈ "Salt", but "Rice flour" ≠ "Rice"
  const headSame = (f => f(sh[sh.length - 1], lo[lo.length - 1]));
  if (sh.every(w => lo.includes(w)) && sh.join('').length >= 3) return headSame((a, b) => a === b) ? 0.9 : 0.6;   // "toor dal" ⊂ "tata toor dal"
  const tokOk = (w, v) => w === v || (Math.min(w.length, v.length) >= 2 && Math.max(w.length, v.length) >= 3 && (v.startsWith(w) || w.startsWith(v))) || (Math.min(w.length, v.length) >= 4 && lev(w, v) <= 1);
  if (sh.length && sh.every(w => lo.some(v => tokOk(w, v))) && headSame(tokOk) && sh.join('').length >= 4) return 0.85; // truncated receipt names, small typos
  const ratio = 1 - lev(x, y) / Math.max(x.length, y.length);
  if (Math.min(x.length, y.length) <= 3) return ratio === 1 ? 1 : 0;
  return ratio;
}
function matchMaster(name) {
  let best = null, score = 0;
  G().master.forEach(m => { const s = nameSimilarity(name, m.name); if (s > score) { score = s; best = m; } });
  return score >= 0.75 ? best : null;
}

/* ---- OCR engine loading & image prep ---- */
let ocrWorker = null, ocrCancelled = false;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = () => { s.remove(); rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); });
}
function simdSupported() {
  try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; }
}
let ocrFromCdn = false;
async function getTesseract() {
  if (window.Tesseract) return window.Tesseract;
  try { await loadScript(OCR_BASE + 'tesseract.min.js'); }
  catch (e) { await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js'); ocrFromCdn = true; }
  if (!window.Tesseract) throw new Error('OCR engine unavailable');
  return window.Tesseract;
}
function prepImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const w0 = img.naturalWidth, h0 = img.naturalHeight, long = Math.max(w0, h0);
      const scale = long > 2400 ? 2400 / long : (long < 1200 ? Math.min(2.5, 1200 / long) : 1);
      const c = document.createElement('canvas');
      c.width = Math.round(w0 * scale); c.height = Math.round(h0 * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      // grayscale + gentle contrast stretch helps with phone photos
      const d = ctx.getImageData(0, 0, c.width, c.height), p = d.data;
      let lo = 255, hi = 0; const g = new Uint8ClampedArray(p.length / 4);
      for (let i = 0, j = 0; i < p.length; i += 4, j++) { const v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; g[j] = v; }
      const hist = new Uint32Array(256); g.forEach(v => hist[v]++);
      let acc = 0; const n = g.length;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.01) { lo = v; break; } }
      acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.01) { hi = v; break; } }
      const span = Math.max(40, hi - lo);
      for (let i = 0, j = 0; i < p.length; i += 4, j++) { const v = Math.max(0, Math.min(255, (g[j] - lo) * 255 / span)); p[i] = p[i + 1] = p[i + 2] = v; }
      ctx.putImageData(d, 0, 0);
      URL.revokeObjectURL(url); resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be opened as an image')); };
    img.src = url;
  });
}
const OCR_STATUS = { 'loading tesseract core': 'Loading the text reader…', 'initializing tesseract': 'Starting up…', 'initialized tesseract': 'Starting up…', 'loading language traineddata': 'Loading English model (first time only)…',
  'loading language traineddata (from cache)': 'Loading English model…', 'initializing api': 'Getting ready…', 'initialized api': 'Getting ready…', 'recognizing text': 'Reading your photo…' };
function ocrProgressSheet() {
  $('#sheetRoot').innerHTML = '<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Reading photo" data-testid="ocr-progress"><div class="grab"></div><h3>📷 Reading your photo</h3>' +
    '<div class="small muted" id="ocrStatus">Preparing image…</div><div class="progress" style="margin:14px 0 6px"><i id="ocrBar" style="width:2%"></i></div><div class="tiny muted" id="ocrPct">0%</div>' +
    '<div class="tiny muted" style="margin-top:10px">Everything happens on your phone — the photo is not uploaded.</div>' +
    '<div class="actions"><button class="btn block" type="button" id="ocrCancel">Cancel</button></div></div></div>';
  $('#ocrCancel').onclick = () => { ocrCancelled = true; if (ocrWorker) { ocrWorker.terminate().catch(() => {}); ocrWorker = null; } closeSheet(); toast('Cancelled'); };
}
function ocrProgress(m) {
  const st = document.getElementById('ocrStatus'); if (!st) return;
  const label = OCR_STATUS[m.status] || (m.status ? m.status.charAt(0).toUpperCase() + m.status.slice(1) + '…' : '');
  st.textContent = label;
  // weight: setup steps 0–30%, recognition 30–100%
  const p = m.status === 'recognizing text' ? 30 + (m.progress || 0) * 70 : Math.min(30, 5 + (m.progress || 0) * 25);
  document.getElementById('ocrBar').style.width = p.toFixed(0) + '%';
  document.getElementById('ocrPct').textContent = p.toFixed(0) + '%';
}
async function ocrRecognize(canvas) {
  const T = await getTesseract();
  const abs = p => new URL(p, location.href).href;
  const opts = { logger: m => { if (!ocrCancelled) ocrProgress(m); }, errorHandler: () => {} };
  if (!ocrFromCdn) Object.assign(opts, { workerBlobURL: false, workerPath: abs(OCR_BASE + 'worker.min.js'), corePath: abs(OCR_BASE + 'core/' + (simdSupported() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js')), langPath: abs(OCR_BASE + 'lang'), gzip: true });
  ocrWorker = await T.createWorker('eng', 1, opts);
  try {
    await ocrWorker.setParameters({ tessedit_pageseg_mode: String(window.__OCR_PSM || '6'), preserve_interword_spaces: '1' });
    const res = await ocrWorker.recognize(canvas);
    if (!ocrFromCdn && window.caches) {   // keep the OCR engine available offline
      const core = OCR_BASE + 'core/' + (simdSupported() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js');
      caches.open('tracker-ocr-v1').then(c => Promise.all([OCR_BASE + 'tesseract.min.js', OCR_BASE + 'worker.min.js', core, OCR_BASE + 'lang/eng.traineddata.gz']
        .map(u => c.match(abs(u)).then(hit => hit || c.add(abs(u)))))).catch(() => {});
    }
    return res.data.text || '';
  } finally { if (ocrWorker) { ocrWorker.terminate().catch(() => {}); ocrWorker = null; } }
}
async function handlePhoto(file) {
  if (!file) return;
  if (!/^https?:$/.test(location.protocol) && !window.Tesseract) { /* file:// fallback: try anyway, CDN may work */ }
  ocrCancelled = false;
  ocrProgressSheet();
  let text = '';
  try {
    const canvas = await prepImage(file);
    if (ocrCancelled) return;
    text = await ocrRecognize(canvas);
  } catch (e) {
    if (ocrCancelled) return;
    closeSheet();
    formSheet({ title: 'Couldn’t read the photo', message: esc((e && e.message) || String(e)) + '<br><br>Photo import needs the app opened from its web address (it downloads a ~10 MB text reader once, then works offline).', ok: 'OK', fields: [] });
    return;
  }
  if (ocrCancelled) return;
  window.__lastOcrText = text;
  const parsed = parseOcrText(text);
  if (!parsed.items.length) return ocrNothingFound(text);
  openOcrReview(parsed, text);
}
function ocrNothingFound(text) {
  const has = text.replace(/\s/g, '').length > 0;
  $('#sheetRoot').innerHTML = '<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="No items found" data-testid="ocr-empty"><div class="grab"></div><h3>🤔 No items found</h3>' +
    '<p class="small">' + (has ? 'I could read some text, but nothing that looks like grocery items.' : 'I couldn’t read any text in that photo.') + '</p>' +
    '<div class="note">Tips: use good light, hold the phone straight above the paper, fill the frame with the list, and avoid shadows. Printed bills work best; neat block letters work for handwriting.</div>' +
    (has ? '<details><summary class="small muted">Show what was read</summary><pre class="ocr-raw">' + esc(text.trim()) + '</pre></details>' : '') +
    '<div class="actions"><button class="btn" type="button" data-x="close">Close</button><button class="btn primary" type="button" data-x="again">Try another photo</button></div></div></div>';
  const bg = $('#sheetRoot .sheet-bg');
  bg.addEventListener('click', e => {
    if (e.target === bg || e.target.closest('[data-x=close]')) closeSheet();
    else if (e.target.closest('[data-x=again]')) { closeSheet(); photoMenu(); }
  });
}

/* ---- review screen ---- */
let review = null;
function openOcrReview(parsed, text) {
  const mk = ui.gMonth && G().months[ui.gMonth] ? ui.gMonth : curMonthKey();
  review = { mk, mode: parsed.mode, asBought: parsed.mode === 'receipt', addMaster: true, text, store: G().lastStore && storeById(G().lastStore) ? G().lastStore : '',
    items: parsed.items.map(it => reviewItem(it, parsed.mode)) };
  renderReview();
}
/* Fill missing sizes from the matched usual item; on lists, "2 kg" of a usual 1 kg pack becomes 1 kg × 2. */
function reviewItem(it, mode) {
  const r = { on: true, name: it.name, size: it.size || 0, unit: it.unit || '', count: it.count || 1, price: it.price || 0 };
  const m = matchMaster(it.name);
  if (!r.size || !UNIT_BASE[r.unit]) { const p = m ? packOf(m) : { size: 1, unit: 'pack' }; r.size = p.size; r.unit = p.unit; }
  else if (m && mode === 'list' && !r.price && r.count === 1 && baseUnit({ sizeUnit: r.unit }) === baseUnit(m) && !samePack({ size: r.size, sizeUnit: r.unit }, m)) {
    const k = packBase({ size: r.size, sizeUnit: r.unit }) / packBase(m);
    if (k >= 1 && k <= 6 && Math.abs(k - Math.round(k)) < 1e-6) { r.count = Math.round(k); r.size = packOf(m).size; r.unit = packOf(m).unit; }
  }
  return r;
}
function reviewMatchLabel(it) {
  if (!it.name.trim()) return '';
  const m = matchMaster(it.name);
  return m ? '<span class="match">↔ ' + esc(m.name) + '</span>' : '<span class="newtag">new item</span>';
}
function reviewTotals() {
  const on = review.items.filter(i => i.on && i.name.trim());
  return { n: on.length, total: on.reduce((s, i) => s + num(i.count) * num(i.price), 0) };
}
function renderReview() {
  const R = review, tt = reviewTotals();
  const rows = R.items.map((it, i) =>
    '<div class="rv-row ' + (it.on ? '' : 'off') + '" data-testid="rv-row">' +
      '<button type="button" class="check ' + (it.on ? 'on' : '') + '" data-rv="toggle" data-i="' + i + '" aria-label="Include ' + esc(it.name) + '" aria-pressed="' + it.on + '"><i>✓</i></button>' +
      '<div class="grow"><input class="rv-name" data-rv-in="name" data-i="' + i + '" value="' + esc(it.name) + '" aria-label="Item name" placeholder="Item name">' +
        '<div class="rv-sub"><span class="rv-pack"><input class="rv-num size" data-rv-in="size" data-i="' + i + '" type="number" inputmode="decimal" step="any" min="0" value="' + esc(fmtN(it.size)) + '" aria-label="Pack size">' +
          '<select class="rv-unit" data-rv-in="unit" data-i="' + i + '" aria-label="Unit">' + PACK_UNITS.map(u => '<option' + (u === it.unit ? ' selected' : '') + '>' + u + '</option>').join('') + '</select></span>' +
          '<label>× <input class="rv-num cnt" data-rv-in="count" data-i="' + i + '" type="number" inputmode="decimal" step="any" min="0" value="' + esc(fmtN(it.count)) + '" aria-label="Number of packs"></label>' +
          '<label>₹ <input class="rv-num price" data-rv-in="price" data-i="' + i + '" type="number" inputmode="decimal" step="any" min="0" value="' + esc(it.price || '') + '" placeholder="/pack" aria-label="Price per pack"></label></div>' +
        '<div class="tiny" id="rvm' + i + '">' + reviewMatchLabel(it) + '</div></div>' +
      '<button type="button" class="icon-btn ghost sm" data-rv="del" data-i="' + i + '" aria-label="Delete line">✕</button></div>').join('');
  $('#sheetRoot').innerHTML = '<div class="sheet-bg"><div class="sheet tall" role="dialog" aria-label="Review items" data-testid="ocr-review"><div class="grab"></div>' +
    '<h3>Review items <span class="muted small">(' + R.items.length + ' found)</span></h3>' +
    '<div class="small muted">Looks like a ' + (R.mode === 'receipt' ? '<b>bill / receipt</b>' : '<b>shopping list</b>') + '. Fix anything that was misread, untick what you don’t want.</div>' +
    '<div class="rv-list">' + (rows || '<div class="empty small">No lines.</div>') + '</div>' +
    '<button type="button" class="btn sm" data-rv="addline" style="margin:6px 0">＋ Add a line</button>' +
    '<div class="card" style="margin:10px 0 0;padding:12px"><div class="small bold" style="margin-bottom:6px">Add to ' + monthName(R.mk) + ' as</div>' +
      '<div class="seg" style="margin:0"><button type="button" data-rv="want" class="' + (R.asBought ? '' : 'on') + '">🛒 To buy</button><button type="button" data-rv="bought" class="' + (R.asBought ? 'on' : '') + '">✓ Bought (with prices)</button></div>' +
      '<label class="rv-store small bold">Store <select class="field" data-rv-in="store" data-store-sel aria-label="Store">' + storeOptions(R.store) + '</select></label>' +
      '<label class="rv-opt"><input type="checkbox" data-rv-in="addMaster" ' + (R.addMaster ? 'checked' : '') + '> Also add new ones to my usual items</label>' +
      '<div class="tiny muted">Items that match your usual list (↔) are merged, never duplicated.</div></div>' +
    '<details style="margin-top:10px"><summary class="small muted">Show recognised text</summary><pre class="ocr-raw" data-testid="ocr-raw">' + esc(R.text.trim()) + '</pre></details>' +
    '<div class="actions"><button type="button" class="btn" data-rv="cancel">Cancel</button><button type="button" class="btn primary" data-rv="apply" data-testid="rv-apply" ' + (tt.n ? '' : 'disabled') + '>Add ' + plural(tt.n, 'item') +
      (R.asBought && tt.total ? ' · ' + money(tt.total) : '') + '</button></div></div></div>';
  const sheet = $('#sheetRoot .sheet');
  sheet.addEventListener('click', onReviewClick);
  sheet.addEventListener('input', onReviewInput);
  sheet.addEventListener('change', e => { const el = e.target; if (el.dataset.rvIn === 'name') { const m = document.getElementById('rvm' + el.dataset.i); if (m) m.innerHTML = reviewMatchLabel(review.items[+el.dataset.i]); } });
}
function updateApplyBtn() {
  const b = document.querySelector('[data-rv=apply]'); if (!b) return;
  const tt = reviewTotals(); b.disabled = !tt.n;
  b.textContent = 'Add ' + plural(tt.n, 'item') + (review.asBought && tt.total ? ' · ' + money(tt.total) : '');
}
function onReviewInput(e) {
  const el = e.target, k = el.dataset.rvIn; if (!k) return;
  if (k === 'addMaster') { review.addMaster = el.checked; return; }
  if (k === 'store') { if (e.type === 'input') pickStoreFrom(el, review.store, v => { review.store = v; }); return; }
  const it = review.items[+el.dataset.i];
  it[k] = (k === 'name' || k === 'unit') ? el.value : num(el.value);
  updateApplyBtn();
}
function onReviewClick(e) {
  const b = e.target.closest('[data-rv]'); if (!b) return;
  const a = b.dataset.rv, i = +b.dataset.i;
  if (a === 'toggle') { review.items[i].on = !review.items[i].on; renderReview(); }
  else if (a === 'del') { review.items.splice(i, 1); renderReview(); }
  else if (a === 'addline') { review.items.push({ on: true, name: '', size: 1, unit: 'pack', count: 1, price: 0 }); renderReview(); const ins = document.querySelectorAll('.rv-name'); if (ins.length) ins[ins.length - 1].focus(); }
  else if (a === 'want' || a === 'bought') { review.asBought = a === 'bought'; renderReview(); }
  else if (a === 'cancel') { review = null; closeSheet(); }
  else if (a === 'apply') applyReview();
}
function applyReview() {
  const R = review; if (!R) return;
  ensureMonth(R.mk);
  const mo = G().months[R.mk];
  let added = 0, merged = 0, newMaster = 0;
  R.items.filter(i => i.on && i.name.trim()).forEach(it => {
    const name = it.name.trim(), count = num(it.count) > 0 ? num(it.count) : 1, price = num(it.price);
    const pk = { size: num(it.size) > 0 ? num(it.size) : 1, sizeUnit: UNIT_BASE[it.unit] ? it.unit : 'pack' };
    let m = matchMaster(name);
    if (!m && R.addMaster) {
      m = { id: uid(), name, size: pk.size, sizeUnit: pk.sizeUnit, count, price, cat: '' };
      G().master.push(m); newMaster++;
      Object.keys(G().months).forEach(k => { if (k >= curMonthKey() && k !== R.mk) G().months[k].items.push(monthItem(m, k)); });
    } else if (m && !num(m.price) && price && samePack(m, pk)) m.price = price;
    let row = m ? mo.items.find(x => x.mid === m.id) : mo.items.find(x => !x.mid && nameSimilarity(x.name, name) >= 0.9);
    if (!row) {
      row = m ? monthItem(m, R.mk) : { mid: null, name, cat: '', want: false, bought: false, size: pk.size, sizeUnit: pk.sizeUnit, count: 1, price };
      row.count = 0; mo.items.push(row); added++;
    } else merged++;
    if (R.asBought) {
      const p = price || (samePack(row, pk) ? num(row.price) : r2(normPrice(row.price, row) * packBase(pk)));
      if (row.bought && num(row.count) > 0 && baseUnit(row) === baseUnit(pk)) {
        // bought again this month: keep the new pack size, add up weight/volume and money
        const base = lineBase(row) + packBase(pk) * count, spend = lineTotal(row) + p * count;
        row.size = pk.size; row.sizeUnit = pk.sizeUnit; row.count = r2(base / packBase(pk)); row.price = row.count ? r2(spend / row.count) : p;
      } else { row.size = pk.size; row.sizeUnit = pk.sizeUnit; row.count = count; row.price = p; }
      row.bought = true; row.want = true; row.boughtOn = boughtDate(R.mk);
      if (R.store) row.store = R.store;
    } else {
      const wasActive = (row.want || row.bought) && num(row.count) > 0;
      row.want = true;
      if (!wasActive) {
        if (!samePack(row, pk) && !price) row.price = num(row.price) ? r2(normPrice(row.price, row) * packBase(pk)) : 0;  // estimate for the new size
        row.size = pk.size; row.sizeUnit = pk.sizeUnit; row.count = count;
      }
      if (price && !row.bought && samePack(row, pk)) { row.price = price; if (R.store) row.store = R.store; }
      if (price && R.store) G().prices.push({ id: uid(), mid: m ? m.id : name, store: R.store, price, size: pk.size, sizeUnit: pk.sizeUnit, date: todayKey() });
    }
  });
  if (R.store) G().lastStore = R.store;
  save();
  review = null; closeSheet();
  ui.tab = 'grocery'; ui.gMode = 'month'; ui.gMonth = R.mk; ui.gFilter = R.asBought ? 'bought' : 'tobuy';
  render();
  toast('Added ' + plural(added + merged, 'item') + (newMaster ? ' · ' + newMaster + ' new in usual items' : ''));
}
async function photoMenu() {
  const v = await menuSheet('Add from photo', [{ label: 'Take a photo', value: 'cam', icon: '📷' }, { label: 'Choose from gallery', value: 'gal', icon: '🖼️' }]);
  if (v === 'cam') $('#photoCam').click(); else if (v === 'gal') $('#photoPick').click();
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
  h += '<h2>Stores</h2><div class="card"><div class="small muted">' + esc(S.stores.map(x => x.name).join(' · ') || 'No stores') + '</div><div class="fab-row" style="margin-bottom:0"><button class="btn block" data-act="stores" data-testid="settings-stores">🏪 Manage stores</button></div></div>';
  h += '<h2>Install on your phone</h2><div class="card small">' + (standalone ? '✅ Running as an installed app.' :
    (deferredInstall ? '<button class="btn primary block" data-act="install">📲 Install app</button>' : '') +
    '<div style="margin-top:6px"><b>iPhone (Safari):</b> tap Share → <i>Add to Home Screen</i>.</div><div style="margin-top:6px"><b>Android (Chrome):</b> menu ⋮ → <i>Add to Home screen</i> / <i>Install app</i>.</div>') +
    '<div class="muted" style="margin-top:8px">Works offline once opened.</div></div>';
  h += '<h2>Summary</h2><div class="card"><div class="kv"><span>Checklists</span><span>' + S.checklists.length + '</span><span>Avoid habits</span><span>' + S.avoid.items.length + '</span>' +
    '<span>Grocery items</span><span>' + G().master.length + '</span><span>Grocery months</span><span>' + Object.keys(G().months).length + '</span><span>Goals</span><span>' + S.goals.length + '</span>' +
    '<span>Today</span><span>' + fmtDLong(todayKey()) + '</span></div></div>';
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
  gBought: d => {
    const it = G().months[ui.gMonth].items[+d.i]; it.bought = !it.bought;
    if (it.bought) { it.want = true; it.boughtOn = boughtDate(ui.gMonth); if (!it.store && G().lastStore && storeById(G().lastStore)) it.store = G().lastStore; }
    save(); render();
  },
  gItem: d => { const it = G().months[ui.gMonth].items[+d.i]; if (it) itemSheet(it.mid || it.name); },
  gItemKey: d => itemSheet(d.key),
  gCompare: d => { const it = G().months[ui.gMonth].items[+d.i]; if (it) compareSheet(it.name); },
  gPack: d => gPackSheet(+d.i),
  gCnt: d => { const it = G().months[ui.gMonth].items[+d.i]; if (!it) return; const n = r2(num(it.count) + (+d.d)); if (n <= 0) return; it.count = n; save(); render(); },
  stores: () => storesSheet(),
  gCopyPlan: () => {
    const keys = Object.keys(G().months).sort(), prev = G().months[keys[keys.indexOf(ui.gMonth) - 1]]; if (!prev) return;
    const mo = G().months[ui.gMonth]; let n = 0;
    prev.items.forEach(p => { if (!(p.want || p.bought)) return; const it = mo.items.find(x => (x.mid && x.mid === p.mid) || x.name === p.name); if (it) { it.want = true; it.count = p.count; if (!it.bought && !samePack(it, p)) { it.size = p.size; it.sizeUnit = p.sizeUnit; it.price = num(p.price) || it.price; } n++; } });
    ui.gFilter = 'list'; save(); render(); toast('Copied ' + plural(n, 'item'));
  },
  gAddMaster: () => gAddMaster(), gEditMaster: d => gEditMaster(d.id), gDelMaster: d => gDelMaster(d.id),
  gHist: d => showHistory(d.key),
  photo: () => photoMenu(),
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
  gCount: (d, el) => { const it = G().months[ui.gMonth].items[+d.i]; it.count = num(el.value); save(); updateGTotals(+d.i); },
  gPrice: (d, el) => { const it = G().months[ui.gMonth].items[+d.i]; it.price = num(el.value); save(); updateGTotals(+d.i); },
  gStore: (d, el) => {
    const it = G().months[ui.gMonth].items[+d.i];
    pickStoreFrom(el, it.store, v => { it.store = v; if (v) G().lastStore = v; save(); });
  }
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
  if (e.target.id === 'photoCam' || e.target.id === 'photoPick') {
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    if (file) handlePhoto(file);
    return;
  }
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
window.Tracker = { get state() { return S; }, checkRollover, render, ensureMonth, goalStats, avoidStats, yearData, STORE_KEY, importText, parseOcrText, matchMaster, nameSimilarity, normName, handlePhoto };
init();
})();
