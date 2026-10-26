// Запускается GitHub Actions каждые 5 минут.
// Шлёт push-уведомления:
//  - по важным задачам — повторно каждые N минут, пока задачу не отметят «Сделано»;
//  - по задачам с обычным напоминанием — один раз в срок;
//  - по событиям — за указанное время до начала.
//
// Нужны секреты: FIREBASE_SERVICE_ACCOUNT (JSON), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, APP_URL.

import admin from 'firebase-admin';
import webpush from 'web-push';
import * as M from '../js/model.js';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.project_id) { console.log('Нет FIREBASE_SERVICE_ACCOUNT — пропускаю'); process.exit(0); }

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
webpush.setVapidDetails('mailto:noreply@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
const APP_URL = (process.env.APP_URL || './').replace(/\/?$/, '/');

const now = Date.now();
const SLACK = 90 * 1000; // запас на неточность расписания GitHub
const subsCache = new Map();
let sent = 0;

async function subsFor(fid, uid) {
  const key = fid + '/' + uid;
  if (subsCache.has(key)) return subsCache.get(key);
  const d = await db.doc(`families/${fid}/push/${uid}`).get();
  const v = d.exists ? d.data().sub : null;
  subsCache.set(key, v);
  return v;
}

async function push(fid, uid, payload) {
  const sub = await subsFor(fid, uid);
  if (!sub) return false;
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 600, urgency: 'high' });
    sent++;
    return true;
  } catch (e) {
    console.warn('push error', e.statusCode, e.body);
    if (e.statusCode === 404 || e.statusCode === 410) await db.doc(`families/${fid}/push/${uid}`).delete();
    return false;
  }
}

const familyCache = new Map();
async function family(fid) {
  if (!familyCache.has(fid)) familyCache.set(fid, (await db.doc(`families/${fid}`).get()).data() || {});
  return familyCache.get(fid);
}

// У участника «без телефона» нет uid — ему пуш не отправить
async function uidOfMember(fid, memberId) {
  const f = await family(fid);
  return f.members?.[memberId]?.uid || null;
}

// ---- Задачи
const familyRefs = await db.collection('families').listDocuments();
const taskDocs = [];
const eventDocs = [];
for (const ref of familyRefs) {
  const items = ref.collection('items');
  taskDocs.push(...(await items.where('type', '==', 'task').where('done', '==', false).get()).docs);
  eventDocs.push(...(await items.where('type', '==', 'event').get()).docs);
}

for (const doc of taskDocs) {
  const t = { id: doc.id, ...doc.data() };
  const fid = doc.ref.parent.parent.id;
  const at = t.alarmAt || M.alarmAtOf(t);
  if (!at || at > now + SLACK) continue;
  const targetMember = t.assigneeId || t.ownerId;
  const uid = await uidOfMember(fid, targetMember) || (targetMember === t.ownerId ? t.ownerId : null);
  if (!uid) continue;
  const url = `${APP_URL}?task=${t.id}`;

  if (t.important) {
    if (t.snoozedUntil && t.snoozedUntil > now) continue;
    const every = (t.nagEvery || 10) * 60000;
    if (t.lastNagAt && now - t.lastNagAt < every - SLACK) continue;
    const lateMin = Math.max(0, Math.round((now - at) / 60000));
    const ok = await push(fid, uid, {
      title: `⏰ ${t.title}`,
      body: lateMin > 1 ? `Не сделано уже ${lateMin} мин. Откройте и отметьте «Сделано».` : 'Пора! Нажмите, чтобы отметить «Сделано».',
      tag: 'task-' + t.id,
      urgent: true,
      url,
    });
    if (ok) await doc.ref.update({ lastNagAt: now });
  } else if (t.notify && !t.notifiedAt && now - at < 6 * 3600000) {
    const ok = await push(fid, uid, { title: `🔔 ${t.title}`, body: 'Срок задачи — сейчас', tag: 'task-' + t.id, url });
    if (ok) await doc.ref.update({ notifiedAt: now });
  }
}

// ---- События
for (const doc of eventDocs) {
  const ev = { id: doc.id, ...doc.data() };
  if (!(ev.reminder >= 0)) continue;
  const fid = doc.ref.parent.parent.id;
  // Проверяем сегодня и завтра (для напоминаний «за день»)
  for (const offset of [0, 1]) {
    const day = M.addDays(M.startOfDay(now), offset);
    if (!M.eventOccurs(ev, day)) continue;
    const start = ev.allDay ? day.getTime() + 9 * 3600000 : M.eventStartOn(ev, day);
    const at = start - (ev.allDay ? 0 : ev.reminder * 60000);
    if (now < at - SLACK || now - at > 20 * 60000) continue;
    if (ev.lastRemindedFor === at) continue;
    const people = ev.participants?.length ? ev.participants : [ev.ownerId];
    const body = ev.allDay ? 'Сегодня' : `В ${new Date(start).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Europe/Moscow' })}`;
    for (const m of people) {
      const uid = await uidOfMember(fid, m);
      if (uid) await push(fid, uid, { title: `📅 ${ev.title}`, body, tag: 'ev-' + ev.id, url: APP_URL });
    }
    await doc.ref.update({ lastRemindedFor: at });
  }
}

console.log(`Готово. Отправлено уведомлений: ${sent}`);
process.exit(0);
