// Логика дат, повторов и прав — без интерфейса.

export const DAY = 86400000;

export const VIS = {
  personal: { title: 'Только я', icon: '🔒', hint: 'Видите только вы.' },
  visible: { title: 'Моё, но видно семье', icon: '👁', hint: 'Семья видит, изменить может только автор или исполнитель.' },
  family: { title: 'Семейное', icon: '👨‍👩‍👧', hint: 'Общее: видят и могут менять все.' },
};

export const REPEAT = {
  none: 'Не повторять',
  daily: 'Каждый день',
  weekdays: 'По будням',
  weekly: 'Каждую неделю',
  monthly: 'Каждый месяц',
  yearly: 'Каждый год',
};

export const PALETTE = ['#FF6B6B', '#4D96FF', '#3DBE6A', '#FFA53D', '#A970FF', '#FF7EB3', '#22B8AE', '#8D6E63'];

export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
export const startOfWeek = (d) => {
  const x = startOfDay(d);
  const wd = (x.getDay() + 6) % 7; // Пн = 0
  return addDays(x, -wd);
};

export const fmtTime = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
export const fmtDay = (d) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
export const fmtDayShort = (d) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
export const fmtWeekday = (d) => new Date(d).toLocaleDateString('ru-RU', { weekday: 'long' });
export const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function nextDate(ms, repeat) {
  const d = new Date(ms);
  switch (repeat) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekdays':
      do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
      break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
    default: return null;
  }
  return d.getTime();
}

// Есть ли событие в этот день (с учётом повторов и многодневности)
export function eventOccurs(ev, day) {
  if (!ev.start) return false;
  const s = startOfDay(ev.start);
  const t = startOfDay(day);
  if (t < s) return false;
  const sd = new Date(ev.start);
  const td = new Date(day);
  switch (ev.repeat || 'none') {
    case 'none': return t <= startOfDay(Math.max(ev.end || ev.start, ev.start));
    case 'daily': return true;
    case 'weekdays': return td.getDay() !== 0 && td.getDay() !== 6;
    case 'weekly': return sd.getDay() === td.getDay();
    case 'monthly': return sd.getDate() === td.getDate();
    case 'yearly': return sd.getDate() === td.getDate() && sd.getMonth() === td.getMonth();
  }
  return false;
}

// Начало события в конкретный день
export function eventStartOn(ev, day) {
  const s = new Date(ev.start);
  const d = new Date(day);
  d.setHours(s.getHours(), s.getMinutes(), 0, 0);
  return d.getTime();
}
export function eventEndOn(ev, day) {
  const dur = Math.max((ev.end || ev.start) - ev.start, 0);
  return eventStartOn(ev, day) + dur;
}

export function taskOnDay(t, day) {
  return t.due && sameDay(t.due, day);
}

export function isOverdue(t, now = Date.now()) {
  if (t.done || !t.due) return false;
  if (t.hasTime) return t.due < now;
  return startOfDay(t.due) < startOfDay(now);
}

// Задача «на мне»: назначена мне, либо без исполнителя и создана мной
export function isMine(item, me) {
  if (item.assigneeId) return item.assigneeId === me;
  return item.ownerId === me;
}

export function involves(ev, me) {
  return ev.ownerId === me || (ev.participants || []).includes(me);
}

export function canEdit(item, me) {
  if (item.visibility === 'family') return true;
  return item.ownerId === me || item.assigneeId === me;
}

export function goalProgress(goal, items) {
  if (goal.target > 0) return Math.max(0, Math.min(1, (goal.current || 0) / goal.target));
  const steps = items.filter((i) => i.type === 'task' && i.goalId === goal.id);
  if (!steps.length) return 0;
  return steps.filter((s) => s.done).length / steps.length;
}

export function dueText(t) {
  if (!t.due) return '';
  const today = startOfDay(Date.now());
  const d = startOfDay(t.due);
  const diff = Math.round((d - today) / DAY);
  let s = diff === 0 ? 'Сегодня' : diff === 1 ? 'Завтра' : diff === -1 ? 'Вчера' : fmtDayShort(t.due);
  if (t.hasTime) s += ', ' + fmtTime(t.due);
  return s;
}

export const NAG_OPTIONS = [
  [0, 'Обычное напоминание'],
  [5, 'Каждые 5 минут, пока не сделаю'],
  [10, 'Каждые 10 минут, пока не сделаю'],
  [15, 'Каждые 15 минут, пока не сделаю'],
  [30, 'Каждые 30 минут, пока не сделаю'],
];

// Момент срабатывания напоминания: время задачи или 9:00 дня срока
export function alarmAtOf(t) {
  if (!t.due) return null;
  return t.hasTime ? t.due : startOfDay(t.due).getTime() + 9 * 3600000;
}

// Должен ли сейчас звенеть будильник по задаче
export function alarmDue(t, me, now = Date.now()) {
  if (t.type !== 'task' || t.done || !t.due || !t.important) return false;
  if (!isMine(t, me)) return false;
  const at = alarmAtOf(t);
  if (at > now) return false;
  if (t.snoozedUntil && t.snoozedUntil > now) return false;
  return true;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
