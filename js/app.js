import { createStore } from './store.js';
import { vapidPublicKey } from './config.js';
import * as M from './model.js';
import { Alarm } from './alarm.js';
import * as X from './extras.js';

const { esc } = M;
const root = document.getElementById('root');

const S = {
  store: null,
  me: null,
  family: null,
  items: [],
  ready: false,
  tab: readLS('fp-tab') || 'today',
  scope: 'mine',
  weekStart: M.startOfWeek(new Date()),
  planMode: 'week',
  monthCursor: new Date(),
  selDay: M.startOfDay(new Date()),
  weekScope: 'family',
  sheet: null,
  joinCode: new URLSearchParams(location.search).get('join') || '',
  onboarding: 'start',
};

function readLS(k) { try { return localStorage.getItem(k); } catch { return null; } }
function writeLS(k, v) { try { localStorage.setItem(k, v); } catch {} }

// ------------------------------------------------------------------ helpers

const members = () => {
  const m = S.family?.members || {};
  return Object.entries(m)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
};
const member = (id) => (id && S.family?.members?.[id] ? { id, ...S.family.members[id] } : null);
const meMember = () => member(S.me);

function avatar(m, cls = '') {
  if (!m) return `<span class="avatar ${cls}" style="background:#aaa">?</span>`;
  const label = m.emoji || (m.name || '?').slice(0, 1).toUpperCase();
  return `<span class="avatar ${cls}" style="background:${esc(m.color || '#888')}" title="${esc(m.name)}">${esc(label)}</span>`;
}

const visIcon = (v) => `<span title="${esc(M.VIS[v]?.title)}">${M.VIS[v]?.icon || ''}</span>`;
const byType = (t) => S.items.filter((i) => i.type === t);
const tasks = () => byType('task');
const events = () => byType('event');
const goals = () => byType('goal');

function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ------------------------------------------------------------------ actions

export async function toggleTask(t) {
  if (!M.canEdit(t, S.me)) return toast('Изменить может только автор или исполнитель');
  if (!t.done && t.repeat && t.repeat !== 'none' && t.due) {
    const due = M.nextDate(t.due, t.repeat);
    await S.store.updateItem(t.id, { due, alarmAt: M.alarmAtOf({ ...t, due }), doneAt: Date.now(), snoozedUntil: null, lastNagAt: null, notifiedAt: null });
    toast('Готово! Следующий раз: ' + M.dueText({ ...t, due: M.nextDate(t.due, t.repeat) }));
  } else {
    await S.store.updateItem(t.id, { done: !t.done, doneAt: !t.done ? Date.now() : null, snoozedUntil: null });
  }
  if (!t.done) celebrate();
}

// Конфетти за выполненную задачу и салют, если сделано всё на сегодня
function celebrate() {
  const { total, done } = todayProgress('mine');
  if (total > 0 && done >= total) { X.confetti(true); toast('Все дела на сегодня сделаны! 🎉'); }
  else X.confetti(false);
}

// Прогресс дня: задачи со сроком сегодня (+ просроченные) и выполненные сегодня
function todayProgress(scope = S.scope) {
  const today = new Date();
  const list = tasks().filter((t) => (scope === 'mine' ? M.isMine(t, S.me) : t.visibility !== 'personal'));
  const open = list.filter((t) => !t.done && t.due && (M.sameDay(t.due, today) || M.isOverdue(t))).length;
  const done = list.filter((t) => t.doneAt && M.sameDay(t.doneAt, today)).length;
  return { total: open + done, done };
}

async function snoozeTask(t, minutes) {
  await S.store.updateItem(t.id, { snoozedUntil: Date.now() + minutes * 60000 });
}

// ------------------------------------------------------------------ rows

function taskRow(t, { showGoal = true } = {}) {
  const assignee = member(t.assigneeId);
  const goal = t.goalId ? S.items.find((g) => g.id === t.goalId) : null;
  const can = M.canEdit(t, S.me);
  return `<div class="row ${t.done ? 'done' : ''}">
    <button class="check ${t.done ? 'on' : ''}" data-act="toggle" data-id="${t.id}" ${can ? '' : 'disabled'} aria-label="Отметить">${t.done ? '✓' : ''}</button>
    <div class="body tap" data-act="edit" data-id="${t.id}">
      <div class="title">${esc(t.title)}</div>
      <div class="meta">
        ${t.due ? `<span class="${M.isOverdue(t) ? 'red' : ''}">🕑 ${esc(M.dueText(t))}</span>` : ''}
        ${t.repeat && t.repeat !== 'none' ? '<span>🔁</span>' : ''}
        ${t.photo ? '<span>📷</span>' : ''}
        ${t.important ? `<span class="badge alarm">⏰ ${t.nagEvery ? 'каждые ' + t.nagEvery + ' мин' : 'будильник'}</span>` : ''}
        ${showGoal && goal ? `<span>🎯 ${esc(goal.title)}</span>` : ''}
        ${visIcon(t.visibility)}
      </div>
    </div>
    ${assignee ? avatar(assignee, 'sm') : ''}
  </div>`;
}

function eventRow(ev, day) {
  const owner = member(ev.ownerId);
  const parts = (ev.participants || []).map(member).filter(Boolean);
  let time = 'Весь день';
  if (!ev.allDay) {
    const s = M.eventStartOn(ev, day), e = M.eventEndOn(ev, day);
    time = M.fmtTime(s) + (e > s ? ' – ' + M.fmtTime(e) : '');
  }
  return `<div class="row tap" data-act="edit" data-id="${ev.id}">
    <span class="bar" style="background:${esc(owner?.color || 'var(--accent)')}"></span>
    <div class="body">
      <div class="title">${esc(ev.title)}</div>
      <div class="meta"><span>${time}</span>${ev.repeat && ev.repeat !== 'none' ? '<span>🔁</span>' : ''}${visIcon(ev.visibility)}</div>
    </div>
    <div class="avs">${parts.slice(0, 4).map((m) => avatar(m, 'sm')).join('')}</div>
  </div>`;
}

function goalRow(g) {
  const p = M.goalProgress(g, S.items);
  return `<div class="row tap" data-act="goal" data-id="${g.id}" style="display:block">
    <div style="display:flex;gap:8px;align-items:center">
      <span style="font-size:20px">${esc(g.emoji || '🎯')}</span>
      <b style="flex:1">${esc(g.title)}</b>
      ${visIcon(g.visibility)}
      <span style="color:var(--muted);font-variant-numeric:tabular-nums">${Math.round(p * 100)}%</span>
    </div>
    <div class="progress"><div style="width:${p * 100}%"></div></div>
    ${g.deadline ? `<div class="meta" style="margin-top:6px">до ${esc(M.fmtDay(g.deadline))}</div>` : ''}
  </div>`;
}

const card = (rows, empty) => `<div class="card">${rows.length ? rows.join('') : `<div class="empty">${empty}</div>`}</div>`;
const section = (title, extra = '') => `<div class="section"><h2>${title}</h2>${extra}</div>`;
const seg = (key, options, value) =>
  `<div class="seg">${options.map(([v, l]) => `<button data-act="seg" data-k="${key}" data-v="${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</div>`;

// ------------------------------------------------------------------ screens

function scopeTasks(list) {
  return list.filter((t) => (S.scope === 'mine' ? M.isMine(t, S.me) : t.visibility !== 'personal'));
}
function scopeEvents(list) {
  return list.filter((e) => (S.scope === 'mine' ? M.involves(e, S.me) : e.visibility !== 'personal'));
}

function topbar(title, sub = '') {
  return `<div class="topbar">
    <button class="iconbtn" data-act="family" aria-label="Семья">${meMember() ? avatar(meMember()) : '👤'}</button>
    <div style="flex:1;min-width:0"><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    <button class="iconbtn primary" data-act="add" aria-label="Добавить">+</button>
  </div>`;
}

function banners() {
  let out = '';
  if (S.store.mode === 'local') {
    out += `<div class="banner">💡<div style="flex:1">Демо-режим: данные хранятся только на этом устройстве. После подключения облака семья будет видеть общие планы.</div></div>`;
  }
  if (isIOS() && !isStandalone()) {
    out += `<div class="banner">📲<div style="flex:1">Добавьте приложение на экран «Домой»: кнопка <b>Поделиться</b> внизу Safari → <b>На экран «Домой»</b>. Так работают уведомления и будильник.</div></div>`;
  } else if (S.store.mode === 'cloud' && vapidPublicKey && 'Notification' in window && Notification.permission === 'default') {
    out += `<div class="banner">🔔<div style="flex:1">Включите уведомления, чтобы будильник по важным задачам срабатывал, даже когда приложение закрыто.</div><button data-act="push">Включить</button></div>`;
  }
  if (!Alarm.unlocked) {
    out += `<div class="banner" id="sound-banner">🔊<div style="flex:1">Нажмите куда-нибудь, чтобы разрешить звук будильника.</div></div>`;
  }
  return out;
}

function viewToday() {
  const today = new Date();
  const hour = today.getHours();
  const greet = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  const name = meMember()?.name || '';
  const evs = scopeEvents(events()).filter((e) => M.eventOccurs(e, today))
    .sort((a, b) => (a.allDay ? 0 : M.eventStartOn(a, today)) - (b.allDay ? 0 : M.eventStartOn(b, today)));
  const tk = scopeTasks(tasks()).filter((t) => !t.done && t.due && (M.sameDay(t.due, today) || M.isOverdue(t)))
    .sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0) || a.due - b.due);
  const gl = goals().filter((g) => (S.scope === 'mine' ? g.ownerId === S.me : g.visibility !== 'personal') && M.goalProgress(g, S.items) < 1);
  const shopLeft = byType('shop').filter((s) => !s.bought).length;
  const done = scopeTasks(tasks()).filter((t) => t.doneAt && M.sameDay(t.doneAt, today)).length;

  const prog = todayProgress();
  const pct = prog.total ? prog.done / prog.total : 0;
  const photo = S.family?.photo;
  const hero = `<div class="hero ${photo ? 'with-photo' : ''}" ${photo ? `style="background-image:linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.55)),url('${photo}')"` : ''}>
      <div class="hero-top">
        <button class="iconbtn glass" data-act="family" aria-label="Семья">${meMember() ? avatar(meMember()) : '👤'}</button>
        <span class="hero-family">${esc(S.family?.name || '')}</span>
        <button class="iconbtn glass" data-act="add" aria-label="Добавить">＋</button>
      </div>
      <div class="hero-main">
        <div style="flex:1;min-width:0">
          <div class="hero-date">${esc(M.fmtWeekday(today))}, ${esc(M.fmtDay(today))}</div>
          <h1 class="hero-title">${greet}${name ? ', ' + esc(name) : ''}</h1>
          <div class="hero-sub">${prog.total ? (prog.done >= prog.total ? 'Все дела на сегодня сделаны 🎉' : `Сделано ${prog.done} из ${prog.total} ${X.plural(prog.total, 'дела', 'дел', 'дел')}`) : 'На сегодня дел нет — отдыхайте ☀️'}</div>
        </div>
        ${X.ring(pct)}
      </div>
    </div>`;
  return hero
    + banners()
    + seg('scope', [['mine', 'Моё'], ['family', 'Семья']], S.scope)
    + section('События сегодня')
    + card(evs.map((e) => eventRow(e, today)), 'Ничего не запланировано')
    + section('Задачи', done ? `<span style="color:var(--muted);font-size:13px">сделано сегодня: ${done}</span>` : '')
    + card(tk.map((t) => taskRow(t)), 'Всё сделано 🎉')
    + (gl.length ? section('Цели') + card(gl.map(goalRow), '') : '')
    + (S.scope === 'family' ? section('Покупки') + `<div class="card"><div class="row tap" data-act="tab" data-v="shop">🛒<div class="body">${shopLeft ? 'Нужно купить: ' + shopLeft : 'Список покупок пуст'}</div>›</div></div>` : '');
}

// --- Неделя: таблица дни × люди
function columnFor(item) {
  if (item.type === 'task') return [item.assigneeId || item.ownerId];
  const p = item.participants && item.participants.length ? item.participants : [item.ownerId];
  return p;
}

function weekItem(item, day) {
  if (item.type === 'event') {
    const owner = member(item.ownerId);
    const t = item.allDay ? '' : `<span class="t">${M.fmtTime(M.eventStartOn(item, day))}</span>`;
    return `<div class="wi ev" style="--c:${esc(owner?.color || 'var(--accent)')}" data-act="edit" data-id="${item.id}">${t}<span>${esc(item.title)}</span></div>`;
  }
  const can = M.canEdit(item, S.me);
  const t = item.hasTime ? `<span class="t">${M.fmtTime(item.due)}</span>` : '';
  return `<div class="wi ${item.done ? 'done' : ''} ${item.important && !item.done ? 'alarm' : ''}" data-act="edit" data-id="${item.id}">
    <button class="ck" data-act="toggle" data-id="${item.id}" ${can ? '' : 'disabled'}>${item.done ? '✓' : ''}</button>${t}<span>${item.important && !item.done ? '⏰ ' : ''}${esc(item.title)}</span></div>`;
}

function viewWeek() {
  const days = [...Array(7)].map((_, i) => M.addDays(S.weekStart, i));
  const end = days[6];
  const label = `${M.fmtDayShort(days[0])} – ${M.fmtDayShort(end)}`;
  let html = topbar('План') + seg('planMode', [['week', 'Неделя'], ['month', 'Месяц']], S.planMode);

  if (S.planMode === 'month') return html + viewMonth();

  html += `<div class="weeknav">
    <button data-act="week" data-v="-1">‹</button>
    <div class="label">${label}</div>
    <button data-act="week" data-v="0">Сегодня</button>
    <button data-act="week" data-v="1">›</button>
  </div>`;
  html += `<div class="chips">
    <button class="chip ${S.weekScope === 'family' ? 'on' : ''}" data-act="wscope" data-v="family">Вся семья</button>
    <button class="chip ${S.weekScope === 'mine' ? 'on' : ''}" data-act="wscope" data-v="mine">Только моё</button>
  </div>`;

  const cols = S.weekScope === 'mine' ? [meMember() || { id: S.me, name: 'Я' }] : members();
  const visibleItems = S.items.filter((i) => i.type === 'task' || i.type === 'event');

  html += `<div class="wtable-wrap"><table class="wtable ${cols.length > 3 ? 'many' : ''}"><thead><tr><th class="dcol"></th>`;
  for (const c of cols) html += `<th>${avatar(c, 'sm')} ${esc(c.name)}</th>`;
  html += `</tr></thead><tbody>`;
  for (const d of days) {
    const isToday = M.sameDay(d, new Date());
    html += `<tr class="${isToday ? 'today' : ''}"><td class="dcol">${M.WD_SHORT[(d.getDay() + 6) % 7]}<b>${d.getDate()}</b></td>`;
    for (const c of cols) {
      const evs = visibleItems.filter((i) => i.type === 'event' && M.eventOccurs(i, d) && columnFor(i).includes(c.id))
        .sort((a, b) => (a.allDay ? 0 : M.eventStartOn(a, d)) - (b.allDay ? 0 : M.eventStartOn(b, d)));
      const tks = visibleItems.filter((i) => i.type === 'task' && M.taskOnDay(i, d) && columnFor(i).includes(c.id))
        .sort((a, b) => (a.done - b.done) || (a.due - b.due));
      html += `<td class="cell" data-act="cell" data-day="${d.getTime()}" data-member="${c.id}">${evs.map((e) => weekItem(e, d)).join('')}${tks.map((t) => weekItem(t, d)).join('')}</td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;
  html += `<div class="legend"><span>Нажмите на пустое место в клетке, чтобы добавить задачу</span><span>⏰ — будильник</span></div>`;

  // Без срока — чтобы ничего не терялось
  const noDate = tasks().filter((t) => !t.done && !t.due && (S.weekScope === 'family' ? true : M.isMine(t, S.me)));
  if (noDate.length) html += section('Без срока') + card(noDate.map((t) => taskRow(t)), '');
  return html;
}

function viewMonth() {
  const cur = S.monthCursor;
  const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const daysIn = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
  let g = `<div class="card month"><div class="head"><button data-act="month" data-v="-1">‹</button><b>${first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</b><button data-act="month" data-v="1">›</button></div><div class="mgrid">`;
  g += M.WD_SHORT.map((w) => `<div class="wd">${w}</div>`).join('');
  for (let i = 0; i < lead; i++) g += '<div></div>';
  for (let n = 1; n <= daysIn; n++) {
    const d = new Date(cur.getFullYear(), cur.getMonth(), n);
    const dots = [
      ...events().filter((e) => M.eventOccurs(e, d)).map((e) => member(e.ownerId)?.color || '#4d6cf0'),
      ...tasks().filter((t) => !t.done && M.taskOnDay(t, d)).map((t) => member(t.assigneeId || t.ownerId)?.color || '#999'),
    ].slice(0, 4);
    g += `<button class="mday ${M.sameDay(d, new Date()) ? 'today' : ''} ${M.sameDay(d, S.selDay) ? 'sel' : ''}" data-act="selday" data-v="${d.getTime()}"><span class="n">${n}</span><span class="dots">${dots.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span></button>`;
  }
  g += '</div></div>';
  const d = S.selDay;
  const evs = events().filter((e) => M.eventOccurs(e, d));
  const tk = tasks().filter((t) => M.taskOnDay(t, d));
  g += section(esc(M.fmtWeekday(d)) + ', ' + esc(M.fmtDay(d)), `<button class="link" data-act="newtask-day" data-v="${d.getTime()}">+ Задача</button>`);
  g += card([...evs.map((e) => eventRow(e, d)), ...tk.map((t) => taskRow(t))], 'Ничего нет');
  return g;
}

function viewTasks() {
  const list = scopeTasks(tasks());
  const open = list.filter((t) => !t.done);
  const today = new Date();
  const overdue = open.filter((t) => M.isOverdue(t)).sort((a, b) => a.due - b.due);
  const todays = open.filter((t) => t.due && !M.isOverdue(t) && M.sameDay(t.due, today)).sort((a, b) => a.due - b.due);
  const soon = open.filter((t) => t.due && !M.isOverdue(t) && !M.sameDay(t.due, today)).sort((a, b) => a.due - b.due);
  const noDate = open.filter((t) => !t.due);
  const done = list.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 30);
  const part = (title, arr) => (arr.length ? section(title) + card(arr.map((t) => taskRow(t)), '') : '');
  return topbar('Задачи')
    + seg('scope', [['mine', 'Мои'], ['family', 'Семья']], S.scope)
    + (open.length ? '' : card([], S.scope === 'mine' ? 'Открытых задач нет' : 'У семьи нет открытых задач'))
    + part('Просрочено', overdue) + part('Сегодня', todays) + part('Скоро', soon) + part('Без срока', noDate)
    + (done.length ? `<details style="margin-top:18px"><summary style="color:var(--muted);cursor:pointer;padding:6px 0">Выполнено (${done.length})</summary>${card(done.map((t) => taskRow(t)), '')}</details>` : '');
}

function viewGoals() {
  const list = goals().filter((g) => (S.scope === 'mine' ? g.ownerId === S.me : g.visibility !== 'personal'));
  const active = list.filter((g) => M.goalProgress(g, S.items) < 1);
  const achieved = list.filter((g) => M.goalProgress(g, S.items) >= 1);
  return topbar('Цели')
    + seg('scope', [['mine', 'Мои'], ['family', 'Семейные']], S.scope)
    + (list.length ? '' : card([], S.scope === 'mine'
      ? 'Личных целей пока нет.<br>Например: прочитать 20 книг, бегать 3 раза в неделю.'
      : 'Семейных целей пока нет.<br>Например: накопить на отпуск, сделать ремонт.'))
    + (active.length ? section('В процессе') + card(active.map(goalRow), '') : '')
    + (achieved.length ? section('Достигнуто 🏆') + card(achieved.map(goalRow), '') : '')
    + `<div style="margin-top:16px"><button class="btn ghost" data-act="new" data-v="goal">+ Новая цель</button></div>`;
}

function viewBoard() {
  const xc = { me: S.me, member, avatar };
  const notes = byType('note').sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
  const polls = byType('poll').sort((a, b) => (a.closed ? 1 : 0) - (b.closed ? 1 : 0) || (b.createdAt || 0) - (a.createdAt || 0));
  return topbar('Доска', 'Объявления, заметки и голосования')
    + `<div style="display:flex;gap:10px;margin-bottom:6px"><button class="btn ghost" data-act="new" data-v="note">📝 Заметка</button><button class="btn ghost" data-act="new" data-v="poll">🗳 Голосование</button></div>`
    + (polls.length ? section('Голосования') + polls.map((p) => X.pollCard(p, xc)).join('<div style="height:10px"></div>') : '')
    + section('Заметки')
    + (notes.length ? `<div class="notes">${notes.map((n) => X.noteCard(n, xc)).join('')}</div>`
      : card([], 'Здесь можно оставлять объявления для семьи: «купил билеты», код от домофона, телефон врача…'));
}

function viewShop() {
  const list = byType('shop');
  const toBuy = list.filter((s) => !s.bought).sort((a, b) => a.createdAt - b.createdAt);
  const bought = list.filter((s) => s.bought).sort((a, b) => (b.boughtAt || 0) - (a.boughtAt || 0));
  const row = (s) => `<div class="row ${s.bought ? 'done' : ''}">
      <button class="check ${s.bought ? 'on' : ''}" data-act="buy" data-id="${s.id}">${s.bought ? '✓' : ''}</button>
      <div class="body tap" data-act="buy" data-id="${s.id}"><div class="title">${esc(s.title)}</div></div>
      ${avatar(member(s.ownerId), 'sm')}
      <button class="iconbtn" style="width:30px;height:30px;font-size:14px;box-shadow:none;background:none" data-act="del" data-id="${s.id}" aria-label="Удалить">✕</button>
    </div>`;
  return topbar('Покупки', 'Общий список для всей семьи')
    + `<form class="shop-add" data-form="shop"><input name="t" placeholder="Молоко, хлеб, яйца…" autocomplete="off" enterkeyhint="done"><button type="submit" aria-label="Добавить">+</button></form>`
    + `<div class="hint" style="margin:0 0 6px">Можно сразу несколько через запятую</div>`
    + section(`Купить (${toBuy.length})`) + card(toBuy.map(row), 'Всё куплено 👌')
    + (bought.length ? section('Куплено', '<button class="link" data-act="clearshop">Очистить</button>') + card(bought.map(row), '') : '');
}

// ------------------------------------------------------------------ onboarding

function viewOnboarding() {
  const cloud = S.store.mode === 'cloud';
  const d = S.ob || (S.ob = { family: '', name: '', color: M.PALETTE[0], code: S.joinCode });
  const colors = `<div class="colors">${M.PALETTE.map((c) => `<button type="button" data-act="obcolor" data-v="${c}" class="${d.color === c ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div>`;
  let body = '';
  if (S.onboarding === 'login') {
    body = `<div class="form">
      <div class="group">
        <div class="field"><input data-ob="email" type="email" autocomplete="username" placeholder="Почта" value="${esc(d.email || '')}"></div>
        <div class="field"><input data-ob="pass" type="password" autocomplete="current-password" placeholder="Пароль"></div>
      </div>
      <button class="btn" data-act="oblogin">Войти</button>
      <button class="btn ghost" data-act="obreset">Забыли пароль?</button>
      <button class="btn ghost" data-act="obmode" data-v="start">Назад</button>
    </div>`;
  } else if (S.joinCode || S.onboarding === 'join') {
    body = `<div class="form">
      <div class="group">
        <div class="field"><input data-ob="code" placeholder="Код семьи" value="${esc(d.code)}" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.1em"></div>
        <div class="field"><input data-ob="name" placeholder="Ваше имя" value="${esc(d.name)}"></div>
        ${colors}
      </div>
      <button class="btn" data-act="objoin">Присоединиться</button>
      <button class="btn ghost" data-act="obmode" data-v="start">Создать новую семью</button>
    </div>`;
  } else {
    body = `<div class="form">
      <div class="group">
        <div class="field"><input data-ob="family" placeholder="Название семьи, например «Ивановы»" value="${esc(d.family)}"></div>
        <div class="field"><input data-ob="name" placeholder="Ваше имя" value="${esc(d.name)}"></div>
        ${colors}
      </div>
      <button class="btn" data-act="obcreate">Создать семью</button>
      ${cloud ? `<button class="btn ghost" data-act="obmode" data-v="join">У меня есть код приглашения</button>
      <button class="btn ghost" data-act="obmode" data-v="login">Войти по почте</button>` : ''}
    </div>`;
  }
  return `<div class="welcome"><img class="logo" src="icons/icon-192.png" alt=""><h1>Семейный ежедневник</h1>
    <p>Общие планы, личные дела, цели и покупки — в одном месте для всей семьи.</p></div>${body}`;
}

// ------------------------------------------------------------------ render

const TABS = [
  ['today', '☀️', 'Сегодня'],
  ['week', '📅', 'План'],
  ['tasks', '✅', 'Задачи'],
  ['goals', '🎯', 'Цели'],
  ['shop', '🛒', 'Покупки'],
  ['board', '📌', 'Доска'],
];

function render() {
  if (!S.ready) return;
  const scrollY = window.scrollY;
  let html = '<div class="app">';
  if (!S.family) {
    html += viewOnboarding() + '</div>';
  } else {
    html += ({ today: viewToday, week: viewWeek, tasks: viewTasks, goals: viewGoals, shop: viewShop, board: viewBoard }[S.tab] || viewToday)();
    html += '</div>';
    html += `<nav class="tabs"><div class="inner">${TABS.map(([k, ic, l]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}"><span class="ic">${ic}</span>${l}</button>`).join('')}</div></nav>`;
  }
  // сохраняем фокус/ввод в поле покупок
  const active = document.activeElement;
  const keepShop = active && active.name === 't' ? active.value : null;
  root.innerHTML = html;
  if (keepShop !== null) {
    const inp = root.querySelector('form[data-form=shop] input');
    if (inp) { inp.value = keepShop; inp.focus(); }
  }
  window.scrollTo(0, scrollY);
  renderSheet();
}

// ------------------------------------------------------------------ sheets (формы)

import { Sheets, authError } from './sheets.js';

function sheetFor(item) {
  if (item.type === 'event') return Sheets.event(ctx(), item);
  if (item.type === 'note') return X.noteSheet(ctx(), item);
  if (item.type === 'poll') return X.pollSheet(ctx(), item);
  if (item.type === 'goal') return Sheets.goalDetail(ctx(), item);
  return Sheets.task(ctx(), item);
}

function renderSheet() {
  let host = document.getElementById('sheet-host');
  if (!S.sheet) { host?.remove(); return; }
  if (!host) {
    host = document.createElement('div');
    host.id = 'sheet-host';
    document.body.appendChild(host);
  }
  const sh = S.sheet;
  const sc = host.querySelector('.sheet')?.scrollTop || 0;
  const fresh = host._sheet !== sh;
  host._sheet = sh;
  host.innerHTML = `<div class="sheet-bg ${fresh ? 'anim' : ''}" data-act="sheet-bg"><div class="sheet" role="dialog">
    <div class="sheet-head"><button data-act="sheet-close">${sh.readOnly ? 'Закрыть' : 'Отмена'}</button><b>${esc(sh.title)}</b>
    ${sh.onSave && !sh.readOnly ? `<button class="save" data-act="sheet-save" ${sh.canSave && !sh.canSave() ? 'disabled' : ''}>${sh.saveLabel || 'Готово'}</button>` : '<span style="min-width:76px"></span>'}</div>
    ${sh.html()}
  </div></div>`;
  host.querySelector('.sheet').scrollTop = fresh ? 0 : sc;
  if (sh.focus && !sh._focused) {
    sh._focused = true;
    host.querySelector(sh.focus)?.focus();
  }
}

export function openSheet(sh) { S.sheet = sh; renderSheet(); }
export function closeSheet() { S.sheet = null; renderSheet(); }

// ------------------------------------------------------------------ events

document.addEventListener('click', async (e) => {
  Alarm.unlock();
  document.getElementById('sound-banner')?.remove();
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  const v = el.dataset.v;
  const item = id ? S.items.find((i) => i.id === id) : null;

  // Внутри формы — передаём обработку туда
  if (S.sheet && el.closest('#sheet-host')) {
    if (act === 'sheet-bg' && e.target !== el) return;
    if (act === 'sheet-bg' || act === 'sheet-close') { closeSheet(); return; }
    if (act === 'sheet-save') {
      const sh = S.sheet;
      try { await sh.onSave(); } catch (err) { console.error(err); toast('Ошибка: ' + err.message); return; }
      if (S.sheet === sh) closeSheet();
      return;
    }
    if (S.sheet.onAct) { e.preventDefault(); await S.sheet.onAct(act, el, e); renderSheet(); }
    return;
  }

  switch (act) {
    case 'tab': S.tab = v; writeLS('fp-tab', v); window.scrollTo(0, 0); render(); break;
    case 'seg': S[el.dataset.k] = v; render(); break;
    case 'toggle': e.stopPropagation(); if (item) await toggleTask(item); break;
    case 'edit': if (item) openSheet(sheetFor(item)); break;
    case 'vote': {
      if (!item || item.closed) break;
      const i = Number(v);
      const votes = { ...(item.votes || {}) };
      if (votes[S.me] === i) delete votes[S.me]; else votes[S.me] = i;
      await S.store.updateItem(item.id, { votes });
      break;
    }
    case 'photo': if (item?.photo) openSheet(X.photoSheet(item.photo, item.title)); break;
    case 'goal': if (item) openSheet(Sheets.goalDetail(ctx(), item)); break;
    case 'add': openSheet(Sheets.addMenu(ctx())); break;
    case 'new': openSheet(v === 'goal' ? Sheets.goal(ctx(), null) : v === 'event' ? Sheets.event(ctx(), null)
      : v === 'note' ? X.noteSheet(ctx(), null) : v === 'poll' ? X.pollSheet(ctx(), null) : Sheets.task(ctx(), null)); break;
    case 'family': openSheet(Sheets.family(ctx())); break;
    case 'week':
      S.weekStart = v === '0' ? M.startOfWeek(new Date()) : M.addDays(S.weekStart, 7 * Number(v));
      render(); break;
    case 'wscope': S.weekScope = v; render(); break;
    case 'month': S.monthCursor = new Date(S.monthCursor.getFullYear(), S.monthCursor.getMonth() + Number(v), 1); render(); break;
    case 'selday': S.selDay = new Date(Number(v)); render(); break;
    case 'newtask-day': openSheet(Sheets.task(ctx(), null, { due: Number(v) })); break;
    case 'cell':
      if (e.target !== el) return; // клик по задаче внутри клетки
      openSheet(Sheets.task(ctx(), null, { due: Number(el.dataset.day), assigneeId: el.dataset.member, visibility: el.dataset.member === S.me ? 'personal' : 'family' }));
      break;
    case 'buy':
      if (item) await S.store.updateItem(item.id, { bought: !item.bought, boughtAt: !item.bought ? Date.now() : null });
      break;
    case 'del': if (item) await S.store.removeItem(item.id); break;
    case 'clearshop':
      for (const s of byType('shop').filter((s) => s.bought)) await S.store.removeItem(s.id);
      break;
    case 'push': await enablePush(); break;
    case 'obcolor': S.ob.color = v; render(); break;
    case 'obmode': S.onboarding = v; S.joinCode = ''; render(); break;
    case 'obcreate': {
      if (!S.ob.name.trim()) return toast('Введите ваше имя');
      el.disabled = true;
      try {
        await S.store.createFamily(S.ob.family.trim() || 'Наша семья', { name: S.ob.name.trim(), color: S.ob.color, emoji: '' });
      } catch (err) { console.error(err); toast('Не получилось: ' + err.message); el.disabled = false; }
      break;
    }
    case 'oblogin': {
      if (!(S.ob.email || '').includes('@') || !S.ob.pass) return toast('Введите почту и пароль');
      el.disabled = true;
      try {
        const { uid } = await S.store.signInEmail(S.ob.email, S.ob.pass);
        S.me = uid;
        S.ob.pass = '';
        if (!S.store.familyId) { toast('Вход выполнен. Создайте семью или присоединитесь по коду.'); S.onboarding = 'start'; render(); }
      } catch (err) { console.error(err); toast(authError(err)); el.disabled = false; }
      break;
    }
    case 'obreset': {
      if (!(S.ob.email || '').includes('@')) return toast('Сначала введите почту');
      try { await S.store.resetPassword(S.ob.email); toast('Письмо для сброса пароля отправлено на ' + S.ob.email); }
      catch (err) { toast(authError(err)); }
      break;
    }
    case 'objoin': {
      if (!S.ob.code.trim() || !S.ob.name.trim()) return toast('Введите код и имя');
      el.disabled = true;
      try {
        await S.store.joinFamily(S.ob.code, { name: S.ob.name.trim(), color: S.ob.color, emoji: '' });
        history.replaceState(null, '', location.pathname);
      } catch (err) { console.error(err); toast(err.message); el.disabled = false; }
      break;
    }
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.ob) { S.ob[el.dataset.ob] = el.value; return; }
  if (S.sheet && el.closest('#sheet-host') && S.sheet.onInput) {
    S.sheet.onInput(el);
    const save = document.querySelector('#sheet-host [data-act=sheet-save]');
    if (save && S.sheet.canSave) save.disabled = !S.sheet.canSave();
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (S.sheet && el.closest('#sheet-host') && S.sheet.onChange) {
    S.sheet.onChange(el);
    // Текстовые поля не перерисовываем: иначе теряется нажатие на кнопку «Готово»
    const textual = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && ['text', 'search', ''].includes(el.type) && !el.dataset.k?.match(/^(date|time)/));
    if (!textual) renderSheet();
  }
});

document.addEventListener('submit', async (e) => {
  const f = e.target;
  e.preventDefault();
  if (f.dataset.form === 'shop') {
    const inp = f.querySelector('input');
    const titles = inp.value.split(',').map((s) => s.trim()).filter(Boolean);
    inp.value = '';
    for (const t of titles) {
      await S.store.addItem({ type: 'shop', title: t[0].toUpperCase() + t.slice(1), bought: false, visibility: 'family', ownerId: S.me });
    }
    inp.focus();
  }
  if (S.sheet && f.closest('#sheet-host') && S.sheet.onSubmit) { await S.sheet.onSubmit(f); renderSheet(); }
});

// ------------------------------------------------------------------ push

function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function enablePush() {
  if (S.store.mode !== 'cloud' || !vapidPublicKey) return toast('Уведомления заработают после подключения облака');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return toast(isIOS() ? 'Сначала добавьте приложение на экран «Домой» и откройте его оттуда' : 'Этот браузер не поддерживает уведомления');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return toast('Уведомления не разрешены');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(vapidPublicKey) });
  await S.store.savePushSubscription(sub);
  toast('Уведомления включены 🔔');
  render();
}

// ------------------------------------------------------------------ context for sheets

function ctx() {
  return { S, M, X, store: S.store, me: S.me, members, member, avatar, toast, toggleTask, snoozeTask, openSheet, closeSheet, enablePush, render, isIOS, isStandalone };
}

// ------------------------------------------------------------------ boot

async function boot() {
  X.Theme.apply();
  S.store = createStore();
  try {
    const { uid } = await S.store.init();
    S.me = uid;
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="app"><div class="welcome"><h1>Нет связи</h1><p>Не удалось подключиться к серверу. Проверьте интернет и обновите страницу.</p><p style="font-size:12px">${esc(err.message)}</p></div></div>`;
    return;
  }
  S.store.subscribe(({ family, items }) => {
    S.family = family;
    S.items = items;
    S.ready = true;
    // Если открыта форма — просто обновим фон
    render();
    Alarm.check();
  });
  Alarm.init({
    getItems: () => S.items,
    me: () => S.me,
    member,
    toggleTask,
    snoozeTask,
    openTask: (t) => openSheet(Sheets.task(ctx(), t)),
  });
  const openId = new URLSearchParams(location.search).get('task');
  if (openId) setTimeout(() => {
    const t = S.items.find((i) => i.id === openId);
    if (t) openSheet(Sheets.task(ctx(), t));
  }, 800);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
  // Обновлять «сегодня» при возвращении в приложение
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); Alarm.check(); } });
  setInterval(() => { if (!document.hidden && !S.sheet) render(); }, 60000);
}

boot();
