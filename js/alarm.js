// Будильник внутри приложения: полноэкранный сигнал со звуком,
// который не прекращается, пока задачу не отметят «Сделано» или не отложат.
// Плюс мягкие напоминания о событиях и обычных задачах.
import * as M from './model.js';

const { esc } = M;

let ctx = null;
let cfg = null;
let loopTimer = null;
let current = null;
let titleTimer = null;
const origTitle = document.title;

function shownKey(id, at) { return `fp-shown-${id}-${at}`; }
function wasShown(k) { try { return !!sessionStorage.getItem(k) || !!localStorage.getItem(k); } catch { return false; } }
function markShown(k) { try { localStorage.setItem(k, '1'); } catch {} }

function beepPattern() {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  // «Будильник»: три двойных сигнала
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const t = t0 + i * 0.5 + j * 0.16;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(j ? 1320 : 990, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.14);
    }
  }
}

function chime() {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  [784, 1047].forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const t = t0 + i * 0.18;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.55);
  });
}

function stopSound() {
  clearInterval(loopTimer); loopTimer = null;
  clearInterval(titleTimer); titleTimer = null;
  document.title = origTitle;
}

function startSound() {
  stopSound();
  beepPattern();
  if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
  loopTimer = setInterval(() => {
    beepPattern();
    if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
  }, 2200);
  let on = false;
  titleTimer = setInterval(() => { on = !on; document.title = on ? '⏰ ' + (current?.title || '') : origTitle; }, 1000);
}

function hideOverlay() {
  document.getElementById('alarm-host')?.remove();
  stopSound();
  current = null;
}

function showOverlay(t) {
  current = t;
  let host = document.getElementById('alarm-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'alarm-host';
    document.body.appendChild(host);
  }
  const late = Date.now() - (t.hasTime ? t.due : M.startOfDay(t.due).getTime() + 9 * 3600000);
  const lateMin = Math.floor(late / 60000);
  host.innerHTML = `<div class="alarm-bg" role="alertdialog">
    <div class="bell">⏰</div>
    <p>${lateMin > 1 ? `Просрочено на ${lateMin < 60 ? lateMin + ' мин' : Math.floor(lateMin / 60) + ' ч ' + (lateMin % 60) + ' мин'}` : 'Пора!'}</p>
    <h2>${esc(t.title)}</h2>
    ${t.notes ? `<p>${esc(t.notes)}</p>` : ''}
    <div class="actions">
      <button class="done-btn" data-alarm="done">✓ Сделано</button>
      <button class="snooze-btn" data-alarm="snooze" data-v="10">Отложить на 10 минут</button>
      <button class="snooze-btn" data-alarm="snooze" data-v="60">Отложить на час</button>
    </div>
    <p class="more">Будильник не замолчит, пока задача не будет выполнена</p>
  </div>`;
  if (!loopTimer) startSound();
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-alarm]');
  if (!b || !current) return;
  e.stopPropagation();
  const t = current;
  if (b.dataset.alarm === 'done') {
    hideOverlay();
    await cfg.toggleTask(t);
  } else if (b.dataset.alarm === 'snooze') {
    hideOverlay();
    await cfg.snoozeTask(t, Number(b.dataset.v));
  }
}, true);

function toastSoft(msg) {
  chime();
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

export const Alarm = {
  unlocked: false,

  init(c) {
    cfg = c;
    setInterval(() => this.check(), 10000);
    // Попытка разблокировать звук при первом касании
    ['pointerdown', 'touchend', 'keydown'].forEach((ev) =>
      document.addEventListener(ev, () => this.unlock(), { once: false, passive: true }));
  },

  unlock() {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      if (!this.unlocked) {
        // Тихий звук — разблокирует аудио на iOS
        const o = ctx.createOscillator(); const g = ctx.createGain();
        g.gain.value = 0.0001; o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.01);
        this.unlocked = true;
      }
    } catch {}
  },

  test() {
    this.unlock();
    beepPattern();
  },

  check() {
    if (!cfg) return;
    const me = cfg.me();
    const now = Date.now();
    const items = cfg.getItems();

    // 1) Настойчивый будильник по важным задачам
    const due = items.filter((t) => M.alarmDue(t, me, now)).sort((a, b) => a.due - b.due);
    if (current) {
      const still = due.find((t) => t.id === current.id);
      if (!still) hideOverlay();
      else if (still.title !== current.title) showOverlay(still);
    }
    if (!current && due.length) showOverlay(due[0]);

    // 2) Мягкие напоминания: события и задачи с уведомлением
    for (const ev of items) {
      if (ev.type === 'event' && ev.reminder >= 0 && M.involves(ev, me) && M.eventOccurs(ev, now)) {
        const start = ev.allDay ? M.startOfDay(now).getTime() + 9 * 3600000 : M.eventStartOn(ev, now);
        const at = start - (ev.allDay ? 0 : ev.reminder * 60000);
        if (now >= at && now - at < 30 * 60000) {
          const k = shownKey(ev.id, at);
          if (!wasShown(k)) { markShown(k); toastSoft(`📅 ${ev.title} — ${ev.allDay ? 'сегодня' : 'в ' + M.fmtTime(start)}`); }
        }
      }
      if (ev.type === 'task' && ev.notify && !ev.done && ev.due && M.isMine(ev, me)) {
        const at = ev.hasTime ? ev.due : M.startOfDay(ev.due).getTime() + 9 * 3600000;
        if (now >= at && now - at < 60 * 60000) {
          const k = shownKey(ev.id, at);
          if (!wasShown(k)) { markShown(k); toastSoft(`🔔 Пора: ${ev.title}`); }
        }
      }
    }
  },
};
