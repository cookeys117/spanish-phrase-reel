// Sync: two devices against a fake Supabase server (events table with seq, ignore-duplicates, per-user rows).
import { createSync } from '../app/sync.mjs';
let fail = 0; const ok = (c, m) => { if(!c){ fail++; console.log('FAIL', m); } };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.document = { visibilityState: 'visible', addEventListener(){} };
globalThis.window = { addEventListener(){} };

const server = { rows: [], seq: 0, settings: null };
globalThis.fetch = async (url, opt = {}) => {
  const u = new URL(url), body = opt.body ? JSON.parse(opt.body) : null;
  const res = (status, j) => ({ ok: status < 300, status, json: async () => j, text: async () => JSON.stringify(j ?? '') });
  if(u.pathname.endsWith('/events') && opt.method === 'POST'){
    for(const r of body) if(!server.rows.some(x => x.id === r.id)) server.rows.push({ seq: ++server.seq, ...r });
    return res(201, null);
  }
  if(u.pathname.endsWith('/events')){
    const gt = +u.searchParams.get('seq').slice(3), lim = +u.searchParams.get('limit');
    return res(200, server.rows.filter(r => r.seq > gt).slice(0, lim).map(r => ({ seq: r.seq, body: r.body })));
  }
  if(u.pathname.endsWith('/user_settings') && opt.method === 'POST'){ server.settings = body; return res(201, null); }
  if(u.pathname.endsWith('/user_settings')) return res(200, server.settings ? [server.settings] : []);
  return res(404, {});
};
function device(name){
  const store = { 'spr.auth': { access_token: 'x', refresh_token: 'y', expires_at: Date.now() + 3600e3, email: 'me@x' } };
  const events = [];
  const got = [];
  const s = createSync({ getEvents: () => events, load: (k, d) => k in store ? store[k] : d, save: (k, v) => { store[k] = v; },
    onPulled: n => got.push(n), onSettings: r => { store.applied = r; }, toast(){} });
  const add = i => events.push({ id: `${name}-${i}`, t: Date.now() + i, i: 'w:x', r: 'g' });
  return { s, events, store, got, add };
}
const A = device('A'), B = device('B');
for(let i = 0; i < 1203; i++) A.add(i);        // more than one upload chunk (500)
await A.s.run();
ok(server.rows.length === 1203, 'A uploaded everything: ' + server.rows.length);
ok(A.events.every(e => e.s === 1), 'A marked all as sent');
await B.s.run();
ok(B.events.length === 1203, 'B pulled all (more than one page of 1000): ' + B.events.length);
B.add(5000); await B.s.run(); await A.s.run();
ok(A.events.length === 1204 && server.rows.length === 1204, 'B\'s new event reaches A, no duplicates');
await A.s.run(); await B.s.run();
ok(server.rows.length === 1204 && A.events.length === 1204 && B.events.length === 1204, 'repeat syncs add nothing');
ok(A.events.every((e, k, a) => !k || a[k - 1].t <= e.t), 'events kept in time order');
// settings: A changes, B picks it up
A.store['spr.settings'] = { order: 'es' }; A.s.settingsChanged(); await A.s.run();
await new Promise(r => setTimeout(r, 5));
B.store['spr.settingsAt'] = 1; await B.s.run();
ok(B.store.applied?.reel?.order === 'es', 'newer settings from A applied on B');
console.log(fail ? `${fail} sync test(s) FAILED` : 'All sync tests passed');
process.exit(fail ? 1 : 0);
