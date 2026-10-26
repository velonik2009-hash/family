// Формы (выезжающие листы): задача, событие, цель, семья и т.д.
import * as M from './model.js';

const { esc } = M;

const pad = (n) => String(n).padStart(2, '0');
const toDateStr = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const toTimeStr = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromParts = (date, time) => {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
};

const sw = (k, on) => `<label class="switch"><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''}><span></span></label>`;
const sel = (k, options, value) =>
  `<select data-k="${k}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

function visGroup(d, disabled = false) {
  return `<div class="group opts">${Object.entries(M.VIS).map(([k, v]) =>
    `<button type="button" class="opt" data-act="vis" data-v="${k}" ${disabled ? 'disabled' : ''}>${v.icon} ${v.title}${d.visibility === k ? '<span class="tick">✓</span>' : ''}</button>`).join('')}</div>
    <div class="hint">${M.VIS[d.visibility].hint}</div>`;
}

function bindInput(d) {
  return (el) => {
    const k = el.dataset.k;
    if (!k) return;
    d[k] = el.type === 'checkbox' ? el.checked : el.value;
  };
}

const REMIND = [
  ['none', 'Нет'],
  ['notify', '🔔 Уведомление в срок'],
  ['alarm5', '⏰ Каждые 5 мин'],
  ['alarm10', '⏰ Каждые 10 мин'],
  ['alarm15', '⏰ Каждые 15 мин'],
  ['alarm30', '⏰ Каждые 30 мин'],
];

// ------------------------------------------------------------ меню «+»

function addMenu(c) {
  const opt = (v, ic, t, s) => `<button class="opt" data-act="pick" data-v="${v}"><span style="font-size:22px">${ic}</span><div><b>${t}</b><div style="font-size:13px;color:var(--muted)">${s}</div></div></button>`;
  return {
    title: 'Добавить',
    html: () => `<div class="group opts">
      ${opt('task', '✅', 'Задача', 'Дело со сроком, исполнителем и будильником')}
      ${opt('event', '📅', 'Событие', 'Встреча, кружок, врач — в календарь')}
      ${opt('goal', '🎯', 'Цель', 'Личная или семейная, с прогрессом')}
      ${opt('shop', '🛒', 'Покупка', 'В общий список покупок')}
    </div>`,
    onAct(act, el) {
      if (act !== 'pick') return;
      const v = el.dataset.v;
      if (v === 'shop') { c.S.tab = 'shop'; c.closeSheet(); c.render(); setTimeout(() => document.querySelector('form[data-form=shop] input')?.focus(), 50); return; }
      c.openSheet(v === 'goal' ? goal(c, null) : v === 'event' ? event(c, null) : task(c, null));
    },
  };
}

// ------------------------------------------------------------ задача

function task(c, t, preset = {}) {
  const S = c.S;
  const readOnly = t && !M.canEdit(t, c.me);
  const d = t ? {
    title: t.title || '', notes: t.notes || '',
    hasDue: !!t.due, date: toDateStr(t.due || Date.now()), hasTime: !!t.hasTime, time: t.hasTime ? toTimeStr(t.due) : '09:00',
    repeat: t.repeat || 'none', visibility: t.visibility || 'personal',
    assigneeId: t.assigneeId || '', goalId: t.goalId || '',
    remind: t.important ? 'alarm' + (t.nagEvery || 10) : t.notify ? 'notify' : 'none',
  } : {
    title: '', notes: '',
    hasDue: !!preset.due, date: toDateStr(preset.due || Date.now()), hasTime: false, time: '09:00',
    repeat: 'none', visibility: preset.visibility || (S.scope === 'family' ? 'family' : 'personal'),
    assigneeId: preset.assigneeId || (S.scope === 'family' ? c.me : ''), goalId: preset.goalId || '',
    remind: 'none',
  };
  if (preset.goalId) {
    const g = S.items.find((i) => i.id === preset.goalId);
    if (g) d.visibility = g.visibility;
  }

  const goals = () => S.items.filter((g) => g.type === 'goal' && M.goalProgress(g, S.items) < 1 && (d.visibility === 'personal' ? g.ownerId === c.me : true) || g.id === d.goalId);

  return {
    title: t ? 'Задача' : 'Новая задача',
    readOnly,
    focus: t ? null : 'input[data-k=title]',
    canSave: () => d.title.trim().length > 0,
    html: () => `<div class="form">
      <div class="group">
        <div class="field"><input data-k="title" placeholder="Что нужно сделать" value="${esc(d.title)}" ${readOnly ? 'disabled' : ''}></div>
      </div>
      <div class="group">
        <div class="field"><label>Срок</label>${sw('hasDue', d.hasDue)}</div>
        ${d.hasDue ? `
          <div class="field"><label>Дата</label><input type="date" data-k="date" value="${d.date}"></div>
          <div class="field"><label>Время</label>${sw('hasTime', d.hasTime)}</div>
          ${d.hasTime ? `<div class="field"><label>Во сколько</label><input type="time" data-k="time" value="${d.time}"></div>` : ''}
          <div class="field"><label>Повтор</label>${sel('repeat', Object.entries(M.REPEAT), d.repeat)}</div>` : ''}
      </div>
      <div class="group">
        <div class="field"><label>Напоминание</label>${sel('remind', REMIND, d.remind)}</div>
      </div>
      ${d.remind.startsWith('alarm') ? `<div class="hint">Будильник зазвенит ${d.hasTime ? 'в ' + d.time : 'в 09:00 (или укажите время)'} и будет повторяться, пока вы не нажмёте «Сделано». ${d.hasDue ? '' : '<b class="red">Укажите срок.</b>'}</div>` : ''}
      ${visGroup(d, readOnly)}
      ${d.visibility !== 'personal' ? `<div class="group"><div class="field"><label>Кто делает</label>${sel('assigneeId', [['', 'Не назначено'], ...c.members().map((m) => [m.id, m.name])], d.assigneeId)}</div></div>` : ''}
      ${goals().length ? `<div class="group"><div class="field"><label>Шаг к цели</label>${sel('goalId', [['', 'Без цели'], ...goals().map((g) => [g.id, (g.emoji || '🎯') + ' ' + g.title])], d.goalId)}</div></div>` : ''}
      <div class="group"><div class="field"><textarea data-k="notes" placeholder="Заметки">${esc(d.notes)}</textarea></div></div>
      ${t && d.hasDue ? `<button type="button" class="btn ghost" data-act="ics">📅 Добавить будильник в Календарь iPhone</button>
        <div class="hint">Резервный вариант: Календарь iPhone прозвенит сам, даже без интернета (в срок и ещё 4 раза).</div>` : ''}
      ${t && !readOnly ? `<button type="button" class="btn ghost" data-act="toggle-done">${t.done ? 'Вернуть в работу' : '✓ Отметить выполненной'}</button>
        <button type="button" class="btn danger" data-act="delete">Удалить задачу</button>` : ''}
      ${readOnly ? '<div class="hint">🔒 Эту задачу может изменить только автор или исполнитель.</div>' : ''}
      ${t ? `<div class="hint">Автор: ${esc(c.member(t.ownerId)?.name || '—')}</div>` : ''}
    </div>`,
    onInput: bindInput(d),
    onChange(el) {
      bindInput(d)(el);
      if (el.dataset.k === 'remind' && d.remind !== 'none') d.hasDue = true;
    },
    async onAct(act, el) {
      if (act === 'vis' && !readOnly) {
        d.visibility = el.dataset.v;
        if (d.visibility !== 'personal' && !d.assigneeId) d.assigneeId = c.me;
      }
      if (act === 'remind' && !readOnly) {
        d.remind = el.dataset.v;
        if (d.remind !== 'none' && !d.hasDue) d.hasDue = true;
      }
      if (act === 'delete') {
        if (confirm('Удалить задачу?')) { await c.store.removeItem(t.id); c.closeSheet(); }
      }
      if (act === 'toggle-done') { await c.toggleTask(t); c.closeSheet(); }
      if (act === 'ics') downloadICS(t);
    },
    async onSave() {
      const due = d.hasDue ? fromParts(d.date, d.hasTime ? d.time : '00:00') : null;
      const alarm = d.remind.startsWith('alarm');
      const data = {
        type: 'task',
        title: d.title.trim(), notes: d.notes.trim(),
        due, hasTime: d.hasDue && d.hasTime,
        repeat: d.hasDue ? d.repeat : 'none',
        visibility: d.visibility,
        assigneeId: d.visibility === 'personal' ? null : (d.assigneeId || null),
        goalId: d.goalId || null,
        important: alarm,
        nagEvery: alarm ? Number(d.remind.replace('alarm', '')) : null,
        notify: d.remind === 'notify',
      };
      data.alarmAt = M.alarmAtOf(data);
      if (t) {
        const changedTime = t.due !== data.due;
        if (changedTime) { data.snoozedUntil = null; data.lastNagAt = null; data.notifiedAt = null; }
        await c.store.updateItem(t.id, data);
      } else {
        await c.store.addItem({ ...data, done: false, ownerId: c.me });
      }
      if (alarm && c.S.store.mode === 'cloud' && 'Notification' in window && Notification.permission === 'default' && c.isStandalone()) {
        c.toast('Разрешите уведомления, чтобы будильник звонил и при закрытом приложении');
        setTimeout(() => c.enablePush(), 400);
      }
    },
  };
}

// ------------------------------------------------------------ событие

function event(c, ev) {
  const S = c.S;
  const readOnly = ev && !M.canEdit(ev, c.me);
  const nextHour = (() => { const x = new Date(); x.setMinutes(0, 0, 0); x.setHours(x.getHours() + 1); return x.getTime(); })();
  const baseDay = S.tab === 'week' && S.planMode === 'month' ? S.selDay.getTime() : Date.now();
  const startDefault = (() => { const d = new Date(baseDay); const h = new Date(nextHour); d.setHours(h.getHours(), 0, 0, 0); return d.getTime(); })();
  const d = ev ? {
    title: ev.title, notes: ev.notes || '', allDay: !!ev.allDay,
    sDate: toDateStr(ev.start), sTime: toTimeStr(ev.start), eDate: toDateStr(ev.end || ev.start), eTime: toTimeStr(ev.end || ev.start),
    repeat: ev.repeat || 'none', reminder: ev.reminder ?? 15, visibility: ev.visibility || 'family',
    participants: new Set(ev.participants || []),
  } : {
    title: '', notes: '', allDay: false,
    sDate: toDateStr(startDefault), sTime: toTimeStr(startDefault), eDate: toDateStr(startDefault + 3600000), eTime: toTimeStr(startDefault + 3600000),
    repeat: 'none', reminder: 15, visibility: S.scope === 'mine' ? 'visible' : 'family',
    participants: new Set([c.me]),
  };
  return {
    title: ev ? 'Событие' : 'Новое событие',
    readOnly,
    focus: ev ? null : 'input[data-k=title]',
    canSave: () => d.title.trim().length > 0,
    html: () => `<div class="form">
      <div class="group"><div class="field"><input data-k="title" placeholder="Название" value="${esc(d.title)}" ${readOnly ? 'disabled' : ''}></div></div>
      <div class="group">
        <div class="field"><label>Весь день</label>${sw('allDay', d.allDay)}</div>
        <div class="field"><label>Начало</label><input type="date" data-k="sDate" value="${d.sDate}">${d.allDay ? '' : `<input type="time" data-k="sTime" value="${d.sTime}">`}</div>
        <div class="field"><label>Конец</label><input type="date" data-k="eDate" value="${d.eDate}">${d.allDay ? '' : `<input type="time" data-k="eTime" value="${d.eTime}">`}</div>
        <div class="field"><label>Повтор</label>${sel('repeat', Object.entries(M.REPEAT), d.repeat)}</div>
        <div class="field"><label>Напомнить</label>${sel('reminder', [[-1, 'Не напоминать'], [0, 'В начале'], [5, 'За 5 мин'], [15, 'За 15 мин'], [30, 'За 30 мин'], [60, 'За час'], [120, 'За 2 часа'], [1440, 'За день']], d.reminder)}</div>
      </div>
      ${visGroup(d, readOnly)}
      ${d.visibility !== 'personal' ? `<div class="section"><h2>Кто участвует</h2></div><div class="group opts">${c.members().map((m) =>
        `<button type="button" class="opt" data-act="part" data-v="${m.id}">${c.avatar(m, 'sm')} ${esc(m.name)}${d.participants.has(m.id) ? '<span class="tick">✓</span>' : ''}</button>`).join('')}</div>` : ''}
      <div class="group"><div class="field"><textarea data-k="notes" placeholder="Адрес, что взять с собой…">${esc(d.notes)}</textarea></div></div>
      ${ev && !readOnly ? '<button type="button" class="btn danger" data-act="delete">Удалить событие</button>' : ''}
      ${readOnly ? '<div class="hint">🔒 Это событие может изменить только автор.</div>' : ''}
    </div>`,
    onInput(el) {
      bindInput(d)(el);
      if (el.dataset.k === 'sDate' && d.eDate < d.sDate) d.eDate = d.sDate;
    },
    onChange(el) {
      bindInput(d)(el);
      if (el.dataset.k === 'sDate' && d.eDate < d.sDate) d.eDate = d.sDate;
      if (el.dataset.k === 'sTime' && d.eDate === d.sDate && d.eTime <= d.sTime) {
        const t = fromParts(d.sDate, d.sTime) + 3600000;
        d.eDate = toDateStr(t); d.eTime = toTimeStr(t);
      }
    },
    async onAct(act, el) {
      if (readOnly) return;
      if (act === 'vis') d.visibility = el.dataset.v;
      if (act === 'part') { const id = el.dataset.v; d.participants.has(id) ? d.participants.delete(id) : d.participants.add(id); }
      if (act === 'delete' && confirm('Удалить событие?')) { await c.store.removeItem(ev.id); c.closeSheet(); }
    },
    async onSave() {
      const start = fromParts(d.sDate, d.allDay ? '00:00' : d.sTime);
      let end = fromParts(d.eDate, d.allDay ? '00:00' : d.eTime);
      if (end < start) end = start;
      const data = {
        type: 'event', title: d.title.trim(), notes: d.notes.trim(), allDay: d.allDay, start, end,
        repeat: d.repeat, reminder: Number(d.reminder), visibility: d.visibility,
        participants: d.visibility === 'personal' ? [c.me] : [...d.participants],
      };
      if (ev) await c.store.updateItem(ev.id, data);
      else await c.store.addItem({ ...data, ownerId: c.me });
    },
  };
}

// ------------------------------------------------------------ цель

function goal(c, g) {
  const d = g ? {
    title: g.title, emoji: g.emoji || '', notes: g.notes || '',
    hasDeadline: !!g.deadline, deadline: toDateStr(g.deadline || Date.now()),
    measurable: g.target > 0, target: g.target || '', current: g.current || '', unit: g.unit || '',
    visibility: g.visibility,
  } : {
    title: '', emoji: '', notes: '', hasDeadline: false, deadline: toDateStr(Date.now() + 90 * M.DAY),
    measurable: false, target: '', current: '', unit: '', visibility: c.S.scope === 'family' ? 'family' : 'personal',
  };
  const num = (s) => Number(String(s).replace(',', '.').replace(/\s/g, '')) || 0;
  return {
    title: g ? 'Изменить цель' : 'Новая цель',
    focus: g ? null : 'input[data-k=title]',
    canSave: () => d.title.trim().length > 0,
    html: () => `<div class="form">
      <div class="group">
        <div class="field"><input data-k="title" placeholder="Например: отпуск на море" value="${esc(d.title)}"></div>
        <div class="field"><input data-k="emoji" placeholder="Эмодзи (необязательно) 🏖" value="${esc(d.emoji)}"></div>
      </div>
      <div class="group">
        <div class="field"><label>Срок</label>${sw('hasDeadline', d.hasDeadline)}</div>
        ${d.hasDeadline ? `<div class="field"><label>До</label><input type="date" data-k="deadline" value="${d.deadline}"></div>` : ''}
      </div>
      <div class="group">
        <div class="field"><label>Измерять в цифрах</label>${sw('measurable', d.measurable)}</div>
        ${d.measurable ? `
          <div class="field"><label>Цель</label><input inputmode="decimal" data-k="target" value="${esc(d.target)}" placeholder="150000" style="text-align:right"></div>
          <div class="field"><label>Уже есть</label><input inputmode="decimal" data-k="current" value="${esc(d.current)}" placeholder="0" style="text-align:right"></div>
          <div class="field"><label>Единица</label><input data-k="unit" value="${esc(d.unit)}" placeholder="₽, книг, км…" style="text-align:right"></div>` : ''}
      </div>
      <div class="hint">${d.measurable ? 'Прогресс по числу: например, накоплено 40 000 из 150 000 ₽.' : 'Прогресс по выполненным шагам (задачам), привязанным к цели.'}</div>
      ${visGroup(d)}
      <div class="group"><div class="field"><textarea data-k="notes" placeholder="Зачем это нам, идеи…">${esc(d.notes)}</textarea></div></div>
      ${g ? '<button type="button" class="btn danger" data-act="delete">Удалить цель</button>' : ''}
    </div>`,
    onInput: bindInput(d),
    onChange(el) { bindInput(d)(el); },
    async onAct(act, el) {
      if (act === 'vis') d.visibility = el.dataset.v;
      if (act === 'delete' && confirm('Удалить цель? Шаги останутся в задачах.')) { await c.store.removeItem(g.id); c.closeSheet(); }
    },
    async onSave() {
      const data = {
        type: 'goal', title: d.title.trim(), emoji: [...d.emoji.trim()].slice(0, 2).join(''), notes: d.notes.trim(),
        deadline: d.hasDeadline ? fromParts(d.deadline) : null,
        target: d.measurable ? num(d.target) : 0, current: d.measurable ? num(d.current) : 0, unit: d.measurable ? d.unit.trim() : '',
        visibility: d.visibility,
      };
      if (g) await c.store.updateItem(g.id, data);
      else await c.store.addItem({ ...data, ownerId: c.me });
    },
  };
}

function goalDetail(c, g0) {
  const st = { amount: '' };
  const get = () => c.S.items.find((i) => i.id === g0.id) || g0;
  return {
    title: 'Цель',
    html: () => {
      const g = get();
      const p = M.goalProgress(g, c.S.items);
      const steps = c.S.items.filter((i) => i.type === 'task' && i.goalId === g.id)
        .sort((a, b) => (a.done - b.done) || ((a.due || 9e15) - (b.due || 9e15)));
      const can = M.canEdit(g, c.me);
      const stepRow = (t) => `<div class="row ${t.done ? 'done' : ''}">
        <button class="check ${t.done ? 'on' : ''}" data-act="step-toggle" data-id="${t.id}" ${M.canEdit(t, c.me) ? '' : 'disabled'}>${t.done ? '✓' : ''}</button>
        <div class="body"><div class="title">${esc(t.title)}</div><div class="meta">${t.due ? esc(M.dueText(t)) : ''}</div></div></div>`;
      return `<div class="form">
        <div class="card" style="padding:18px;text-align:center">
          <div style="font-size:48px">${esc(g.emoji || '🎯')}</div>
          <h2 style="margin:6px 0 4px">${esc(g.title)}</h2>
          <div style="color:var(--muted);font-size:14px">${M.VIS[g.visibility].icon} ${M.VIS[g.visibility].title}${g.deadline ? ' · до ' + esc(M.fmtDay(g.deadline)) : ''}</div>
          <div class="progress" style="height:12px;margin-top:14px"><div style="width:${p * 100}%"></div></div>
          <div style="margin-top:8px;font-weight:600">${Math.round(p * 100)}%${g.target > 0 ? ` · ${fmtNum(g.current)} из ${fmtNum(g.target)} ${esc(g.unit || '')}` : ''}</div>
        </div>
        ${g.target > 0 && can ? `<form class="shop-add" data-form="amount"><input name="a" inputmode="decimal" placeholder="Сколько добавить" value="${esc(st.amount)}"><button type="submit">+</button></form>` : ''}
        <div class="section"><h2>Шаги</h2>${can ? '<button class="link" data-act="add-step">+ Шаг</button>' : ''}</div>
        <div class="card">${steps.length ? steps.map(stepRow).join('') : '<div class="empty">Разбейте цель на шаги — они появятся в задачах и в «Сегодня».</div>'}</div>
        ${g.notes ? `<div class="section"><h2>Заметки</h2></div><div class="card"><div class="empty" style="color:var(--text);white-space:pre-wrap">${esc(g.notes)}</div></div>` : ''}
        ${can ? '<button type="button" class="btn ghost" data-act="edit-goal">Изменить цель</button>' : ''}
      </div>`;
    },
    async onAct(act, el) {
      const g = get();
      if (act === 'step-toggle') { const t = c.S.items.find((i) => i.id === el.dataset.id); if (t) await c.toggleTask(t); }
      if (act === 'add-step') c.openSheet(task(c, null, { goalId: g.id }));
      if (act === 'edit-goal') c.openSheet(goal(c, g));
    },
    async onSubmit(f) {
      const g = get();
      const v = Number(f.querySelector('input').value.replace(',', '.').replace(/\s/g, ''));
      if (!v) return;
      await c.store.updateItem(g.id, { current: (g.current || 0) + v });
      c.toast('Добавлено: ' + fmtNum(v));
    },
  };
}

const fmtNum = (n) => Number(n || 0).toLocaleString('ru-RU');

// ------------------------------------------------------------ семья

function family(c) {
  const st = { editing: null, newName: '', newColor: M.PALETTE[1] };
  return {
    title: 'Семья',
    html: () => {
      const fam = c.S.family;
      const cloud = c.store.mode === 'cloud';
      const link = `${location.origin}${location.pathname}?join=${fam.code}`;
      return `<div class="form">
        <div class="section"><h2>${esc(fam.name)}</h2></div>
        <div class="group opts">${c.members().map((m) =>
          `<button class="opt" data-act="edit-member" data-v="${m.id}">${c.avatar(m)} <span style="flex:1">${esc(m.name)}${m.id === c.me ? ' <span style="color:var(--muted);font-size:13px">(это вы)</span>' : ''}${!m.uid ? ' <span style="color:var(--muted);font-size:13px">· без телефона</span>' : ''}</span>›</button>`).join('')}
        </div>
        ${st.editing ? memberEditor(c, st) : `<button class="btn ghost" data-act="add-member">+ Добавить участника без телефона</button>
        <div class="hint">Например, маленького ребёнка — ему можно назначать дела и события.</div>`}

        <div class="section"><h2>Пригласить на другой iPhone</h2></div>
        ${cloud ? `<div class="card"><div class="code">${esc(fam.code)}</div></div>
          <button class="btn" data-act="share" data-v="${esc(link)}">Отправить приглашение</button>
          <div class="hint">Член семьи откроет ссылку в Safari, добавит приложение на экран «Домой» и введёт имя.</div>`
        : `<div class="banner">💡<div>Сейчас демо-режим: всё хранится только на этом устройстве. Приглашения заработают после подключения облака.</div></div>`}

        <div class="section"><h2>Будильник и уведомления</h2></div>
        <div class="group opts">
          <button class="opt" data-act="test-alarm">🔊 Проверить звук будильника</button>
          ${cloud ? `<button class="opt" data-act="enable-push">🔔 Включить уведомления на этом телефоне ${'Notification' in window && Notification.permission === 'granted' ? '<span class="tick">✓</span>' : ''}</button>` : ''}
        </div>
        <div class="hint">Важно: на iPhone звук и уведомления работают, когда приложение добавлено на экран «Домой». Если телефон на беззвучном, уведомление придёт без звука — для самых важных дел используйте «Добавить будильник в Календарь iPhone» в задаче.</div>

        <div class="section"><h2>Другое</h2></div>
        <button class="btn danger" data-act="leave">Выйти из семьи на этом устройстве</button>
        <div class="hint" style="margin-top:0">Версия ${esc('1.0')} · ${cloud ? 'облако подключено' : 'демо-режим'}</div>
      </div>`;
    },
    onInput(el) { if (el.dataset.k === 'mname') st.newName = el.value; if (el.dataset.k === 'memoji') st.newEmoji = el.value; },
    async onAct(act, el) {
      if (act === 'add-member') { st.editing = 'new'; st.newName = ''; st.newEmoji = ''; st.newColor = M.PALETTE[c.members().length % M.PALETTE.length]; }
      if (act === 'edit-member') { const m = c.member(el.dataset.v); st.editing = m.id; st.newName = m.name; st.newEmoji = m.emoji || ''; st.newColor = m.color; }
      if (act === 'mcolor') st.newColor = el.dataset.v;
      if (act === 'mcancel') st.editing = null;
      if (act === 'msave') {
        if (!st.newName.trim()) return c.toast('Введите имя');
        const data = { name: st.newName.trim(), color: st.newColor, emoji: [...(st.newEmoji || '').trim()].slice(0, 2).join('') };
        if (st.editing === 'new') await c.store.addMember(data);
        else await c.store.updateMember(st.editing, data);
        st.editing = null;
      }
      if (act === 'share') {
        const url = el.dataset.v;
        const text = `Присоединяйся к нашему семейному ежедневнику «${c.S.family.name}». Открой ссылку в Safari: ${url}  (код: ${c.S.family.code})`;
        if (navigator.share) { try { await navigator.share({ title: 'Семейный ежедневник', text }); } catch {} }
        else { try { await navigator.clipboard.writeText(text); c.toast('Ссылка скопирована'); } catch { prompt('Скопируйте ссылку', url); } }
      }
      if (act === 'test-alarm') {
        const { Alarm } = await import('./alarm.js');
        Alarm.unlock(); Alarm.test();
      }
      if (act === 'enable-push') await c.enablePush();
      if (act === 'leave') {
        if (confirm(c.store.mode === 'local' ? 'Удалить все данные демо-режима с этого устройства?' : 'Выйти из семьи на этом устройстве? Данные семьи останутся у остальных.')) {
          await c.store.leave(); c.closeSheet();
        }
      }
    },
  };
}

function memberEditor(c, st) {
  return `<div class="group">
    <div class="field"><input data-k="mname" placeholder="Имя" value="${esc(st.newName)}"></div>
    <div class="field"><input data-k="memoji" placeholder="Эмодзи (необязательно)" value="${esc(st.newEmoji || '')}"></div>
    <div class="colors">${M.PALETTE.map((col) => `<button type="button" data-act="mcolor" data-v="${col}" class="${st.newColor === col ? 'on' : ''}" style="background:${col}"></button>`).join('')}</div>
  </div>
  <div style="display:flex;gap:10px"><button class="btn ghost" data-act="mcancel">Отмена</button><button class="btn" data-act="msave">Сохранить</button></div>`;
}

// ------------------------------------------------------------ .ics для Календаря iPhone

function icsDate(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}
function icsEsc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }

export function downloadICS(t) {
  const start = t.hasTime ? t.due : M.startOfDay(t.due).getTime() + 9 * 3600000;
  const every = t.nagEvery || 10;
  const alarms = [0, every, every * 2, every * 3, every * 4].map((m) =>
    `BEGIN:VALARM\r\nACTION:AUDIO\r\nTRIGGER;VALUE=DATE-TIME:${icsDate(start + m * 60000)}\r\nEND:VALARM\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:${icsEsc('⏰ ' + t.title)}\r\nTRIGGER;VALUE=DATE-TIME:${icsDate(start + m * 60000)}\r\nEND:VALARM`).join('\r\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FamilyPlanner//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${t.id}@family-planner`,
    `DTSTAMP:${icsDate(Date.now())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(start + 15 * 60000)}`,
    `SUMMARY:${icsEsc('⏰ ' + t.title)}`,
    `DESCRIPTION:${icsEsc((t.notes || '') + '\nИз семейного ежедневника')}`,
    alarms,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const url = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'budilnik.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const Sheets = { addMenu, task, event, goal, goalDetail, family };
