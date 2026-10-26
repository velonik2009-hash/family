// Слой данных. Два варианта с одинаковым интерфейсом:
//  - LocalStore: всё в localStorage (демо, один телефон)
//  - FirebaseStore: Firestore + анонимный вход, общая семья между телефонами
//
// Интерфейс:
//   init() -> Promise<{ uid }>
//   familyId (string|null)
//   createFamily(name, me:{name,color,emoji}) -> Promise
//   joinFamily(code, me) -> Promise
//   subscribe(cb)  cb({ family, items })
//   addItem(obj) / updateItem(id, patch) / removeItem(id)
//   updateFamily(patch) / addMember(member) / updateMember(id, patch)
//   savePushSubscription(sub)
//   leave()

import { firebaseConfig } from './config.js';

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2))
    .replace(/-/g, '').slice(0, 20);

export const makeCode = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const arr = new Uint32Array(6);
  crypto.getRandomValues(arr);
  for (const n of arr) s += abc[n % abc.length];
  return s;
};

const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const safeDel = (k) => { try { localStorage.removeItem(k); } catch {} };

// ---------------------------------------------------------------- Local

class LocalStore {
  constructor() {
    this.mode = 'local';
    this.listeners = new Set();
    this.state = null;
  }
  async init() {
    let raw = safeGet('fp-local');
    this.state = raw ? JSON.parse(raw) : { family: null, items: {} };
    this.uid = safeGet('fp-uid') || uid();
    safeSet('fp-uid', this.uid);
    return { uid: this.uid };
  }
  get familyId() { return this.state.family ? this.state.family.id : null; }
  persist() {
    safeSet('fp-local', JSON.stringify(this.state));
    this.emit();
  }
  emit() {
    const snap = { family: this.state.family, items: Object.values(this.state.items) };
    for (const cb of this.listeners) cb(snap);
  }
  subscribe(cb) {
    this.listeners.add(cb);
    cb({ family: this.state.family, items: Object.values(this.state.items) });
    return () => this.listeners.delete(cb);
  }
  async createFamily(name, me) {
    this.state.family = {
      id: uid(), name, code: makeCode(), createdAt: Date.now(),
      memberUids: [this.uid],
      members: { [this.uid]: { ...me, uid: this.uid, createdAt: Date.now() } },
    };
    this.persist();
  }
  async joinFamily() { throw new Error('В демо-режиме присоединиться к семье нельзя: сначала подключите облако.'); }
  async addItem(obj) {
    const id = uid();
    this.state.items[id] = { ...obj, id, createdAt: Date.now(), updatedAt: Date.now() };
    this.persist();
    return id;
  }
  async updateItem(id, patch) {
    if (!this.state.items[id]) return;
    this.state.items[id] = { ...this.state.items[id], ...patch, updatedAt: Date.now() };
    this.persist();
  }
  async removeItem(id) { delete this.state.items[id]; this.persist(); }
  async updateFamily(patch) { this.state.family = { ...this.state.family, ...patch }; this.persist(); }
  async addMember(m) {
    const id = uid();
    this.state.family.members[id] = { ...m, createdAt: Date.now() };
    this.persist();
    return id;
  }
  async updateMember(id, patch) {
    this.state.family.members[id] = { ...this.state.family.members[id], ...patch };
    this.persist();
  }
  async savePushSubscription() {}
  async leave() { safeDel('fp-local'); this.state = { family: null, items: {} }; this.emit(); }
}

// ---------------------------------------------------------------- Firebase

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

class FirebaseStore {
  constructor(config) {
    this.mode = 'cloud';
    this.config = config;
    this.listeners = new Set();
    this.family = null;
    this.shared = new Map();
    this.mine = new Map();
    this.unsubs = [];
    this._familyId = safeGet('fp-family');
  }
  get familyId() { return this._familyId; }

  async init() {
    const app = await import(FB + 'firebase-app.js');
    const auth = await import(FB + 'firebase-auth.js');
    this.fs = await import(FB + 'firebase-firestore.js');
    this.app = app.initializeApp(this.config);
    this.auth = auth.getAuth(this.app);
    try {
      this.db = this.fs.initializeFirestore(this.app, {
        localCache: this.fs.persistentLocalCache({ tabManager: this.fs.persistentSingleTabManager() }),
      });
    } catch {
      this.db = this.fs.getFirestore(this.app);
    }
    await auth.setPersistence(this.auth, auth.browserLocalPersistence);
    const user = await new Promise((resolve, reject) => {
      const off = auth.onAuthStateChanged(this.auth, (u) => {
        if (u) { off(); resolve(u); }
      });
      auth.signInAnonymously(this.auth).catch(reject);
    });
    this.uid = user.uid;
    if (this._familyId) this.listen();
    return { uid: this.uid };
  }

  emit() {
    const items = new Map([...this.shared, ...this.mine]);
    const snap = { family: this.family, items: [...items.values()] };
    for (const cb of this.listeners) cb(snap);
  }
  subscribe(cb) {
    this.listeners.add(cb);
    cb({ family: this.family, items: [...new Map([...this.shared, ...this.mine]).values()] });
    return () => this.listeners.delete(cb);
  }

  listen() {
    const { doc, collection, query, where, onSnapshot } = this.fs;
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    const fid = this._familyId;
    this.unsubs.push(onSnapshot(doc(this.db, 'families', fid), (d) => {
      this.family = d.exists() ? { id: d.id, ...d.data() } : null;
      if (!this.family) { safeDel('fp-family'); this._familyId = null; }
      this.emit();
    }, (e) => { console.warn(e); this.family = null; this.emit(); }));
    const items = collection(this.db, 'families', fid, 'items');
    this.unsubs.push(onSnapshot(query(items, where('visibility', 'in', ['family', 'visible'])), (s) => {
      this.shared = new Map(s.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
      this.emit();
    }, (e) => console.warn(e)));
    this.unsubs.push(onSnapshot(query(items, where('ownerId', '==', this.uid)), (s) => {
      this.mine = new Map(s.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
      this.emit();
    }, (e) => console.warn(e)));
  }

  async createFamily(name, me) {
    const { doc, setDoc, writeBatch } = this.fs;
    const fid = uid();
    const code = makeCode();
    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'families', fid), {
      name, code, createdAt: Date.now(),
      memberUids: [this.uid],
      members: { [this.uid]: { ...me, uid: this.uid, createdAt: Date.now() } },
    });
    batch.set(doc(this.db, 'codes', code), { familyId: fid });
    await batch.commit();
    this._familyId = fid;
    safeSet('fp-family', fid);
    this.listen();
  }

  async joinFamily(code, me) {
    const { doc, getDoc, updateDoc, arrayUnion } = this.fs;
    code = code.trim().toUpperCase();
    const c = await getDoc(doc(this.db, 'codes', code));
    if (!c.exists()) throw new Error('Семья с таким кодом не найдена');
    const fid = c.data().familyId;
    const patch = { memberUids: arrayUnion(this.uid) };
    if (me.claimId) {
      // Член семьи уже был добавлен вручную — «забираем» его профиль
      patch[`members.${me.claimId}.uid`] = this.uid;
    } else {
      patch[`members.${this.uid}`] = { name: me.name, color: me.color, emoji: me.emoji || '', uid: this.uid, createdAt: Date.now() };
    }
    await updateDoc(doc(this.db, 'families', fid), patch);
    this._familyId = fid;
    safeSet('fp-family', fid);
    this.listen();
  }

  // Предпросмотр семьи по коду (для выбора «кто я»)
  async peekFamily(code) {
    const { doc, getDoc } = this.fs;
    const c = await getDoc(doc(this.db, 'codes', code.trim().toUpperCase()));
    if (!c.exists()) throw new Error('Семья с таким кодом не найдена');
    return c.data().familyId;
  }

  async addItem(obj) {
    const { collection, addDoc } = this.fs;
    const ref = await addDoc(collection(this.db, 'families', this._familyId, 'items'),
      clean({ ...obj, createdAt: Date.now(), updatedAt: Date.now() }));
    return ref.id;
  }
  async updateItem(id, patch) {
    const { doc, updateDoc } = this.fs;
    await updateDoc(doc(this.db, 'families', this._familyId, 'items', id), clean({ ...patch, updatedAt: Date.now() }));
  }
  async removeItem(id) {
    const { doc, deleteDoc } = this.fs;
    await deleteDoc(doc(this.db, 'families', this._familyId, 'items', id));
  }
  async updateFamily(patch) {
    const { doc, updateDoc } = this.fs;
    await updateDoc(doc(this.db, 'families', this._familyId), clean(patch));
  }
  async addMember(m) {
    const id = uid();
    await this.updateFamily({ [`members.${id}`]: { ...m, createdAt: Date.now() } });
    return id;
  }
  async updateMember(id, patch) {
    const p = {};
    for (const [k, v] of Object.entries(patch)) p[`members.${id}.${k}`] = v;
    await this.updateFamily(p);
  }
  async savePushSubscription(sub) {
    const { doc, setDoc } = this.fs;
    await setDoc(doc(this.db, 'families', this._familyId, 'push', this.uid), {
      uid: this.uid, sub: JSON.parse(JSON.stringify(sub)), updatedAt: Date.now(),
    });
  }
  async leave() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    safeDel('fp-family');
    this._familyId = null;
    this.family = null;
    this.shared.clear(); this.mine.clear();
    this.emit();
  }
}

// Firestore не принимает undefined
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

export function createStore() {
  return firebaseConfig ? new FirebaseStore(firebaseConfig) : new LocalStore();
}
