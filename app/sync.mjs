// Phrase Reel — automatic sync with Supabase (Phase 3).
// Every rating / quiz answer is an event with a unique id. Events not yet uploaded carry s:0 (or no s);
// they are sent in the background and marked s:1. New events from other devices are pulled in by server
// sequence number. Nothing is ever edited or deleted, so merging is just "add what you don't have".
// Settings (reel + quiz) sync as one blob, newest wins.
// The project URL and publishable key below are designed to be public; access is limited by row-level
// security to the signed-in owner. No secret keys live in the app.

const SB_URL = 'https://ixilvqncvtcldhfmiznr.supabase.co';
const SB_KEY = 'sb_publishable_Fjcvu3G4WM5BvLSGOE68fQ_BoR7-faq';
const AUTH = 'spr.auth', CURSOR = 'spr.syncSeq', LAST = 'spr.syncLast', SET_AT = 'spr.settingsAt';
const site = () => location.origin + location.pathname;

export function createSync({ getEvents, load, save, onPulled, onSettings, toast }){
  let busy = false, again = false, timer = null, status = 'idle', lastError = '';
  const listeners = new Set();
  const emit = () => listeners.forEach(f => f());
  const session = () => load(AUTH, null);

  /* ---------- auth ---------- */
  function takeRedirect(){
    // After clicking the emailed link, Supabase sends you back here with the tokens in the # part of the address.
    const h = new URLSearchParams(location.hash.slice(1));
    if(h.get('access_token')){
      save(AUTH, { access_token: h.get('access_token'), refresh_token: h.get('refresh_token'),
                   expires_at: Date.now() + (+h.get('expires_in') || 3600) * 1000, email: emailFromToken(h.get('access_token')) });
      history.replaceState(null, '', site() + location.search);
      return 'signed-in';
    }
    if(h.get('error')){
      history.replaceState(null, '', site() + location.search);
      return 'error:' + (h.get('error_description') || h.get('error')).replace(/\+/g, ' ');
    }
    return null;
  }
  function emailFromToken(t){ try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; } catch(e){ return ''; } }
  async function sendLink(email){
    const r = await fetch(`${SB_URL}/auth/v1/otp?redirect_to=${encodeURIComponent(site())}`, {
      method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, create_user: true }) });
    if(!r.ok){ const j = await r.json().catch(() => ({})); throw new Error(j.msg || j.message || j.error_description || `error ${r.status}`); }
  }
  async function token(){
    const s = session(); if(!s) return null;
    if(s.expires_at - Date.now() > 60_000) return s.access_token;
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
    if(!r.ok){ if(r.status === 400 || r.status === 401){ save(AUTH, null); status = 'signed-out'; emit(); } throw new Error('sign-in expired'); }
    const j = await r.json();
    save(AUTH, { ...s, access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + j.expires_in * 1000 });
    return j.access_token;
  }
  function signOut(){ save(AUTH, null); save(CURSOR, 0); status = 'signed-out'; emit(); }

  /* ---------- data ---------- */
  const api = async (path, opt = {}) => {
    const t = await token();
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...opt, headers: { apikey: SB_KEY, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
    if(!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
    return r.status === 204 || opt.method === 'POST' ? null : r.json();
  };
  async function push(){
    const evs = getEvents(), todo = evs.filter(e => !e.s);
    for(let i = 0; i < todo.length; i += 500){
      const chunk = todo.slice(i, i + 500);
      await api('events?on_conflict=user_id,id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(chunk.map(({ s, ...e }) => ({ id: e.id, t: e.t, body: e })) ) });
      for(const e of chunk) e.s = 1;
      save('spr.events', evs);
    }
    return todo.length;
  }
  async function pull(){
    const evs = getEvents(), have = new Set(evs.map(e => e.id));
    let cursor = load(CURSOR, 0), added = 0;
    for(;;){
      const rows = await api(`events?select=seq,body&seq=gt.${cursor}&order=seq.asc&limit=1000`);
      for(const r of rows){ if(!have.has(r.body.id)){ evs.push({ ...r.body, s: 1 }); have.add(r.body.id); added++; } cursor = r.seq; }
      if(rows.length < 1000) break;
    }
    if(added){ evs.sort((a, b) => a.t - b.t); save('spr.events', evs); }
    save(CURSOR, cursor);
    return added;
  }
  async function syncSettings(){
    const rows = await api('user_settings?select=settings,updated_at');
    const localAt = load(SET_AT, 0), remote = rows[0];
    const remoteAt = remote ? Date.parse(remote.updated_at) : 0;
    if(remote && remoteAt > localAt && remote.settings?.reel){
      save(SET_AT, remoteAt); onSettings(remote.settings);              // newer on another device: take it
    } else if(!remote || localAt > remoteAt){                    // first sync, or changed here since
      const at = localAt || Date.now(); save(SET_AT, at);
      await api('user_settings?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ settings: { reel: load('spr.settings', {}), quiz: load('spr.quiz', {}) }, updated_at: new Date(at).toISOString() }) });
    }
  }
  async function run(){
    if(!session()){ status = 'signed-out'; emit(); return; }
    if(busy){ again = true; return; }
    if(!navigator.onLine){ status = 'offline'; emit(); return; }
    busy = true; status = 'syncing'; emit();
    try {
      const sent = await push();
      const got = await pull();
      await syncSettings();
      save(LAST, Date.now()); status = 'ok'; lastError = '';
      if(got) onPulled(got);
      return { sent, got };
    } catch(e){ status = session() ? 'error' : 'signed-out'; lastError = String(e.message || e); }
    finally { busy = false; emit(); if(again){ again = false; setTimeout(run, 500); } }
  }
  const soon = (ms = 3000) => { clearTimeout(timer); timer = setTimeout(run, ms); };

  /* ---------- wiring ---------- */
  function start(){
    const r = takeRedirect();
    if(r === 'signed-in') toast('Signed in — syncing your progress');
    else if(r?.startsWith('error:')) toast('Sign-in link problem: ' + r.slice(6));
    run();
    setInterval(() => { if(document.visibilityState === 'visible') run(); }, 60_000);
    document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') run(); });
    window.addEventListener('online', () => run());
  }
  return {
    start, run, soon, sendLink, signOut,
    settingsChanged(){ save(SET_AT, Date.now()); soon(); },
    on(f){ listeners.add(f); return () => listeners.delete(f); },
    info(){
      const s = session(), pending = getEvents().filter(e => !e.s).length;
      return { signedIn: !!s, email: s?.email || '', status, lastError, last: load(LAST, 0), pending };
    },
  };
}
