// Оформление (темы, кольцо прогресса, конфетти, фото) и общение семьи (доска, голосования).
import * as M from './model.js';

const { esc } = M;

// ------------------------------------------------------------------ темы

export const ACCENTS = [
  { id: 'blue', name: 'Синяя', color: '#4d6cf0', dark: '#7b93ff', grad: ['#4d8def', '#7b61ff'] },
  { id: 'violet', name: 'Фиолетовая', color: '#8b5cf6', dark: '#a78bfa', grad: ['#8b5cf6', '#ec4899'] },
  { id: 'mint', name: 'Мятная', color: '#0f9f8f', dark: '#2dd4bf', grad: ['#14b8a6', '#3b82f6'] },
  { id: 'coral', name: 'Коралловая', color: '#f0624d', dark: '#fb8a76', grad: ['#f97362', '#f59e0b'] },
  { id: 'pink', name: 'Розовая', color: '#e2457f', dark: '#f472b6', grad: ['#ec4899', '#8b5cf6'] },
  { id: 'forest', name: 'Лесная', color: '#2f9e44', dark: '#51cf66', grad: ['#2f9e44', '#0ca678'] },
];

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

export const Theme = {
  get accent() { return ls.get('fp-accent') || 'blue'; },
  get mode() { return ls.get('fp-mode') || 'auto'; },
  set(accent, mode) {
    if (accent) ls.set('fp-accent', accent);
    if (mode) ls.set('fp-mode', mode);
    this.apply();
  },
  isDark() {
    const m = this.mode;
    if (m === 'dark') return true;
    if (m === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  },
  apply() {
    const a = ACCENTS.find((x) => x.id === this.accent) || ACCENTS[0];
    const dark = this.isDark();
    const r = document.documentElement;
    r.classList.toggle('dark', dark);
    r.style.setProperty('--accent', dark ? a.dark : a.color);
    r.style.setProperty('--accent-soft', dark ? hexA(a.dark, 0.18) : hexA(a.color, 0.12));
    r.style.setProperty('--g1', a.grad[0]);
    r.style.setProperty('--g2', a.grad[1]);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0e0e11' : a.color);
  },
};

function hexA(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => Theme.apply());

// ------------------------------------------------------------------ кольцо прогресса

export function ring(pct, size = 84, stroke = 9) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, pct)));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="ring">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#fff" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})" style="transition:stroke-dashoffset .6s ease"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="${size * 0.24}" font-weight="700">${Math.round(pct * 100)}%</text>
  </svg>`;
}

// ------------------------------------------------------------------ конфетти

export function confetti(big = false) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.createElement('canvas');
  cv.className = 'confetti';
  cv.width = innerWidth * devicePixelRatio;
  cv.height = innerHeight * devicePixelRatio;
  document.body.appendChild(cv);
  const g = cv.getContext('2d');
  g.scale(devicePixelRatio, devicePixelRatio);
  const colors = ['#FF6B6B', '#4D96FF', '#3DBE6A', '#FFA53D', '#A970FF', '#FF7EB3', '#22B8AE'];
  const n = big ? 160 : 50;
  const parts = [...Array(n)].map(() => ({
    x: big ? Math.random() * innerWidth : innerWidth / 2 + (Math.random() - 0.5) * 80,
    y: big ? -20 - Math.random() * innerHeight * 0.4 : innerHeight * 0.55,
    vx: (Math.random() - 0.5) * (big ? 4 : 9),
    vy: big ? 2 + Math.random() * 3 : -6 - Math.random() * 7,
    s: 5 + Math.random() * 6,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  const dur = big ? 2800 : 1600;
  (function frame(t) {
    g.clearRect(0, 0, innerWidth, innerHeight);
    const k = (t - t0) / dur;
    for (const p of parts) {
      p.vy += 0.18; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save();
      g.globalAlpha = Math.max(0, 1 - k * k);
      g.translate(p.x, p.y); g.rotate(p.r);
      g.fillStyle = p.c;
      g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      g.restore();
    }
    if (k < 1) requestAnimationFrame(frame); else cv.remove();
  })(t0);
}

// ------------------------------------------------------------------ фото

// Сжимаем фото, чтобы его можно было хранить прямо в базе (до ~120 КБ)
export function pickPhoto(maxSide = 900, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        const k = Math.min(1, maxSide / Math.max(w, h));
        w = Math.round(w * k); h = Math.round(h * k);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        let q = quality;
        let data = cv.toDataURL('image/jpeg', q);
        while (data.length > 160000 && q > 0.3) { q -= 0.1; data = cv.toDataURL('image/jpeg', q); }
        URL.revokeObjectURL(img.src);
        resolve(data);
      };
      img.onerror = () => reject(new Error('Не удалось открыть фото'));
      img.src = URL.createObjectURL(f);
    };
    inp.click();
  });
}

// ------------------------------------------------------------------ время «назад»

export function ago(ms) {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return 'только что';
  if (d < 3600) return Math.floor(d / 60) + ' мин назад';
  if (d < 86400) return Math.floor(d / 3600) + ' ч назад';
  if (d < 86400 * 2) return 'вчера';
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

// ------------------------------------------------------------------ доска

export const NOTE_COLORS = [
  ['yellow', '#FFF3B0', '#4a3d00'],
  ['green', '#D3F9D8', '#11421b'],
  ['blue', '#D0EBFF', '#0b3354'],
  ['pink', '#FFDEEB', '#5c1033'],
  ['violet', '#E5DBFF', '#2f1a66'],
  ['gray', '#F1F3F5', '#212529'],
];
export const noteColor = (id) => NOTE_COLORS.find((c) => c[0] === id) || NOTE_COLORS[0];

export function noteCard(n, ctx) {
  const [, bg, fg] = noteColor(n.color);
  const author = ctx.member(n.ownerId);
  return `<div class="note ${n.pinned ? 'pinned' : ''}" style="background:${bg};color:${fg}" data-act="edit" data-id="${n.id}">
    ${n.pinned ? '<span class="pin">📌</span>' : ''}
    ${n.title ? `<b class="note-title">${esc(n.title)}</b>` : ''}
    <div class="note-text">${esc(n.text || '')}</div>
    <div class="note-meta">${ctx.avatar(author, 'sm')}<span>${esc(author?.name || '')} · ${ago(n.updatedAt || n.createdAt || Date.now())}</span>${n.visibility === 'personal' ? ' 🔒' : ''}</div>
  </div>`;
}

export function pollCard(p, ctx) {
  const votes = p.votes || {};
  const total = Object.keys(votes).length;
  const mine = votes[ctx.me];
  const author = ctx.member(p.ownerId);
  const opts = (p.options || []).map((o, i) => {
    const voters = Object.entries(votes).filter(([, v]) => v === i).map(([m]) => ctx.member(m)).filter(Boolean);
    const pct = total ? voters.length / total : 0;
    return `<button class="poll-opt ${mine === i ? 'mine' : ''}" data-act="vote" data-id="${p.id}" data-v="${i}" ${p.closed ? 'disabled' : ''}>
      <span class="poll-bar" style="width:${(pct * 100).toFixed(0)}%"></span>
      <span class="poll-label">${mine === i ? '✓ ' : ''}${esc(o)}</span>
      <span class="avs">${voters.slice(0, 4).map((m) => ctx.avatar(m, 'sm')).join('')}</span>
      <span class="poll-pct">${total ? Math.round(pct * 100) + '%' : ''}</span>
    </button>`;
  }).join('');
  return `<div class="card poll">
    <div class="poll-head">
      <span style="font-size:20px">🗳</span>
      <b style="flex:1">${esc(p.title)}</b>
      ${p.ownerId === ctx.me || p.visibility === 'family' ? `<button class="link" data-act="edit" data-id="${p.id}">⋯</button>` : ''}
    </div>
    <div class="poll-opts">${opts}</div>
    <div class="note-meta" style="padding:0 14px 12px">${ctx.avatar(author, 'sm')}<span>${esc(author?.name || '')} · ${total} ${plural(total, 'голос', 'голоса', 'голосов')}${p.closed ? ' · завершено' : ''}</span></div>
  </div>`;
}

export function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

// ------------------------------------------------------------------ формы: заметка и голосование

export function noteSheet(c, n) {
  const can = !n || M.canEdit(n, c.me);
  const d = n ? { title: n.title || '', text: n.text || '', color: n.color || 'yellow', pinned: !!n.pinned, visibility: n.visibility || 'family' }
    : { title: '', text: '', color: 'yellow', pinned: false, visibility: 'family' };
  return {
    title: n ? 'Заметка' : 'Новая заметка',
    readOnly: !can,
    focus: n ? null : 'textarea[data-k=text]',
    canSave: () => (d.text.trim() || d.title.trim()).length > 0,
    html: () => {
      const [, bg, fg] = noteColor(d.color);
      return `<div class="form">
        <div class="group" style="background:${bg};color:${fg}">
          <div class="field" style="border-color:rgba(0,0,0,.08)"><input data-k="title" placeholder="Заголовок (необязательно)" value="${esc(d.title)}" style="font-weight:600;color:inherit" ${can ? '' : 'disabled'}></div>
          <div class="field"><textarea data-k="text" placeholder="Объявление, код от домофона, телефон врача…" style="min-height:130px;color:inherit" ${can ? '' : 'disabled'}>${esc(d.text)}</textarea></div>
        </div>
        <div class="colors">${NOTE_COLORS.map(([id, bgc]) => `<button type="button" data-act="ncolor" data-v="${id}" class="${d.color === id ? 'on' : ''}" style="background:${bgc};border:1px solid rgba(0,0,0,.1)"></button>`).join('')}</div>
        <div class="group"><div class="field"><label>📌 Закрепить наверху</label><label class="switch"><input type="checkbox" data-k="pinned" ${d.pinned ? 'checked' : ''}><span></span></label></div></div>
        <div class="group opts">
          <button type="button" class="opt" data-act="nvis" data-v="family">👨‍👩‍👧 Для всей семьи${d.visibility === 'family' ? '<span class="tick">✓</span>' : ''}</button>
          <button type="button" class="opt" data-act="nvis" data-v="personal">🔒 Только для меня${d.visibility === 'personal' ? '<span class="tick">✓</span>' : ''}</button>
        </div>
        ${n && can ? '<button type="button" class="btn danger" data-act="ndelete">Удалить заметку</button>' : ''}
      </div>`;
    },
    onInput(el) { if (el.dataset.k) d[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; },
    onChange(el) { if (el.dataset.k) d[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; },
    async onAct(act, el) {
      if (!can) return;
      if (act === 'ncolor') d.color = el.dataset.v;
      if (act === 'nvis') d.visibility = el.dataset.v;
      if (act === 'ndelete' && confirm('Удалить заметку?')) { await c.store.removeItem(n.id); c.closeSheet(); }
    },
    async onSave() {
      const data = { type: 'note', title: d.title.trim(), text: d.text.trim(), color: d.color, pinned: d.pinned, visibility: d.visibility };
      if (n) await c.store.updateItem(n.id, data);
      else await c.store.addItem({ ...data, ownerId: c.me });
    },
  };
}

export function pollSheet(c, p) {
  const d = p ? { title: p.title, options: [...(p.options || [])], closed: !!p.closed }
    : { title: '', options: ['', ''], closed: false };
  const can = !p || M.canEdit(p, c.me);
  return {
    title: p ? 'Голосование' : 'Новое голосование',
    readOnly: !can,
    focus: p ? null : 'input[data-k=title]',
    canSave: () => d.title.trim() && d.options.filter((o) => o.trim()).length >= 2,
    html: () => `<div class="form">
      <div class="group"><div class="field"><input data-k="title" placeholder="Вопрос, например «Куда поедем в субботу?»" value="${esc(d.title)}"></div></div>
      <div class="section"><h2>Варианты</h2></div>
      <div class="group">
        ${d.options.map((o, i) => `<div class="field"><span style="color:var(--muted)">${i + 1}.</span><input data-opt="${i}" placeholder="Вариант" value="${esc(o)}" ${p ? 'disabled' : ''}>${!p && d.options.length > 2 ? `<button type="button" class="link" data-act="pdel" data-v="${i}" style="border:0;background:none;color:var(--danger)">✕</button>` : ''}</div>`).join('')}
      </div>
      ${!p && d.options.length < 8 ? '<button type="button" class="btn ghost" data-act="padd">+ Вариант</button>' : ''}
      ${p ? `<div class="group"><div class="field"><label>Завершить голосование</label><label class="switch"><input type="checkbox" data-k="closed" ${d.closed ? 'checked' : ''}><span></span></label></div></div>
        <div class="hint">После создания варианты менять нельзя, чтобы не сбить голоса.</div>
        <button type="button" class="btn danger" data-act="pdelete">Удалить голосование</button>` : '<div class="hint">Каждый член семьи выбирает один вариант. Голос можно поменять.</div>'}
    </div>`,
    onInput(el) {
      if (el.dataset.opt !== undefined) d.options[Number(el.dataset.opt)] = el.value;
      else if (el.dataset.k) d[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value;
    },
    onChange(el) { this.onInput(el); },
    async onAct(act, el) {
      if (act === 'padd') d.options.push('');
      if (act === 'pdel') d.options.splice(Number(el.dataset.v), 1);
      if (act === 'pdelete' && confirm('Удалить голосование?')) { await c.store.removeItem(p.id); c.closeSheet(); }
    },
    async onSave() {
      if (p) await c.store.updateItem(p.id, { title: d.title.trim(), closed: d.closed });
      else await c.store.addItem({ type: 'poll', title: d.title.trim(), options: d.options.map((o) => o.trim()).filter(Boolean), votes: {}, closed: false, visibility: 'family', ownerId: c.me });
    },
  };
}

export function photoSheet(src, title = 'Фото') {
  return {
    title,
    html: () => `<img src="${src}" alt="" style="width:100%;border-radius:14px;display:block">`,
  };
}
