// Phrase Reel — Phase 1 prototype (reel screen). Progress is kept in this browser only (sync comes in Phase 3).
import { computeStates, choosePhrase, dayKey, phraseItems, newItemsToday, todaysVerdict } from './scheduler.mjs';
import { Player, chime } from './player.mjs';
import { segment as conjSegment, conjugate, TENSE_LABEL } from '../engine/conjugate.mjs';
import { adjForm } from '../engine/adjectives.mjs';
import { ic } from './icons.mjs';
import { initQuiz, openQuiz, quizIsOpen } from './quizui.mjs';

/* ---------------- storage ---------------- */
const KEY = { events: 'spr.events', settings: 'spr.settings', fix: 'spr.fix', dev: 'spr.device' };
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(e){ return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){ toast('Could not save — storage full or blocked'); } };

const DEFAULTS = {
  order: 'en', muted: false, hideGap: true, gapMult: 1.0, thinkTime: 1.0, pauseBetween: 1.5, mode: 'auto', chime: true, regColour: true,
  stillThere: 15, newCap: 15,
  startup: { screen: 'cards', mode: 'manual', quizMode: 'auto', muted: false },     // how the app opens (shared with the quiz)
  weights: { pres: 1, pret: 1, impf: 1, fut: 1, cond: 1, subj: 1 },
  ladder: { firstInterval: 1, factor: 2, maxInterval: 180, redDrop: 2 },
};
let settings = { ...DEFAULTS, ...load(KEY.settings, {}) };
settings.weights = { ...DEFAULTS.weights, ...(settings.weights || {}) };
settings.ladder = { ...DEFAULTS.ladder, ...(settings.ladder || {}) };
settings.startup = { ...DEFAULTS.startup, ...(settings.startup || {}) };
settings.mode = settings.startup.mode; settings.muted = settings.startup.muted;
let events = load(KEY.events, []);
let fixList = load(KEY.fix, []);
const device = load(KEY.dev, null) || (() => { const d = 'web-' + Math.random().toString(36).slice(2, 8); save(KEY.dev, d); return d; })();

/* ---------------- state ---------------- */
const $ = id => document.getElementById(id);
let lib, byId, states, availableTenses, started = false;
const history = [];               // cards: { phrase, slot, inst, ratings: {tokenIdx: 'g'|'r'} }
let pos = -1, cardCounter = 0, untouched = 0, playing = false, phase = 'idle', kbd = false;
let stage = 'asking';             // manual mode: 'asking' (answer hidden) -> 'revealed'
const requeue = [];               // { item, at }
const player = new Player(ph => { phase = ph; renderCard(); }, () => onCardDone());

const TENSE_EX = { pres: 'camino, como, vivo', pret: 'caminé, comí, viví', impf: 'caminaba, comía, vivía',
                   fut: 'caminaré, comeré, viviré', cond: 'caminaría, comería, viviría', subj: 'camine, coma, viva' };
const TENSE_FULL = { pres: 'now (present)', pret: 'did (completed past)', impf: 'used to (ongoing past)',
                     fut: 'will (future)', cond: 'would (conditional)', subj: 'que… (subjunctive)' };
const PERSONS = ['yo', 'tu', 'usted', 'nosotros', 'ellos'];
const PERSON_LABEL = { yo: 'yo', tu: 'tú', usted: 'él / ella / usted', nosotros: 'nosotros', ellos: 'ellos / ustedes' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = () => dayKey();
const cur = () => history[pos];

function refreshStates(){ states = computeStates(events.filter(e => e.m !== 'quiz'), byId, settings.ladder); }
function logEvent(e){ events.push({ t: Date.now(), d: device, m: 'reel', ...e }); save(KEY.events, events); }

/* ---------------- choosing cards ---------------- */
const forced = new URLSearchParams(location.search).get('ph');   // ?ph=p0059 opens that phrase first (for testing)
function newCard(){
  if(forced && !history.length && byId[forced]) return { phrase: byId[forced], slot: 'forced', inst: `${device}-${Date.now()}`, ratings: {} };
  const recent = history.map(c => c.phrase.id);
  const dueRe = requeue.findIndex(r => r.at <= cardCounter);
  const requeueItem = dueRe >= 0 ? requeue.splice(dueRe, 1)[0].item : null;
  const { phrase, slot } = choosePhrase({
    phrases: lib.phrases, states, today: today(), theme: null, themeShare: 0, tenseWeights: settings.weights, recent,
    newToday: newItemsToday(states, today()), newCap: settings.newCap, requeueItem,
  });
  cardCounter++;
  const ratings = {};
  phrase.tokens.forEach((t, i) => { if(t.items){ const v = todaysVerdict(events, t.items[0]); if(v) ratings[i] = v; } });
  return { phrase, slot, inst: `${device}-${Date.now()}`, ratings };
}

function goTo(newPos, autoplay = true){
  player.stop();
  pos = newPos;
  loadCurrent();
  renderAll();
  if(autoplay) startPlaying();
}
function next(){
  if(pos < history.length - 1) return goTo(pos + 1);
  if(untouched >= settings.stillThere && settings.stillThere > 0 && playing){
    untouched = 0; playing = false; chime(0.2); renderAll(); toast('Paused — still there?'); return;
  }
  history.push(newCard());
  if(history.length > 40){ history.shift(); }
  goTo(history.length - 1);
}
function prev(){ if(pos > 0) goTo(pos - 1); }

function audioSrc(id, lang){ return `audio/${id}_${lang}.mp3`; }
function loadCurrent(){
  const c = cur(); if(!c) return;
  const p = c.phrase;
  const en = { src: audioSrc(p.id, 'en'), text: p.en, lang: 'en-GB' }, es = { src: audioSrc(p.id, 'es'), text: p.es, lang: 'es-CO' };
  const hasUnmasteredIrregular = p.tokens.some(t => (t.items || []).some(i => i.startsWith('vc:') && (states.get(i)?.rung ?? 0) < 3));
  player.load({ first: settings.order === 'en' ? en : es, second: settings.order === 'en' ? es : en, chime: hasUnmasteredIrregular });
}
const manual = () => settings.mode === 'manual';
function startPlaying(fromPhase){
  playing = true; started = true;
  if(manual()){
    // Manual: play the first language, then wait (answer hidden) for a tap to reveal.
    stage = 'asking'; renderAll();
    player.start(settings, 'first', { phases: ['first'], onEnd: () => { playing = false; renderAll(); } });
    return;
  }
  renderAll();
  player.start(settings, fromPhase);
}
function reveal(){
  touch();
  stage = 'revealed'; playing = true; renderAll();
  player.start(settings, 'second', { phases: ['second'], onEnd: () => { playing = false; markShown(); renderAll(); } });
}
function markShown(){
  const c = cur();
  if(c && !c.shown){ c.shown = true; logEvent({ ph: c.phrase.id, c: c.inst, r: 'shown' }); refreshStates(); }
}
function pausePlaying(){ playing = false; player.pause(); renderAll(); }
function togglePlay(){
  touch();
  if(manual()) return stage === 'asking' ? (player.pause(), reveal()) : next();
  if(playing) return pausePlaying();
  if(phase === 'done' || phase === 'after') return next();
  startPlaying(['first', 'gap', 'second'].includes(phase) ? phase : 'first');
}
function onCardDone(){
  markShown();
  if(settings.mode === 'auto' && playing){ untouched++; next(); }
  else { playing = false; renderAll(); }
}
function touch(){ untouched = 0; }

/* ---------------- rating ---------------- */
function constructionItemsFor(c, idx){ return (c.phrase.constructions || []).filter(k => k.tokens.includes(idx)).map(k => k.item); }
function rate(idx, verdict, which){
  touch();
  const c = cur(), t = c.phrase.tokens[idx];
  let items;
  if(verdict === 'r' && which === 'form') items = t.items.filter(i => !i.startsWith('w:'));
  else if(verdict === 'r' && which === 'meaning') items = t.items.filter(i => i.startsWith('w:'));
  else if(verdict === 'r' && which) items = [which];                         // a construction
  else items = [...t.items, ...constructionItemsFor(c, idx)];
  const r = verdict === 'g' ? 'g' : verdict === 'r' ? 'r' : 'x';
  for(const i of items) logEvent({ ph: c.phrase.id, c: c.inst, i, r });
  if(verdict === 'r') for(const i of items) requeue.push({ item: i, at: cardCounter + 10 });
  if(verdict) c.ratings[idx] = verdict; else delete c.ratings[idx];
  refreshStates(); renderAll();
}
function tapToken(idx){
  const c = cur();
  rate(idx, c.ratings[idx] === 'g' ? null : 'g');
}

/* ---------------- rendering ---------------- */
function tokenHTML(t, idx, rating){
  const word = t.t.slice((t.pre || '').length, t.t.length - (t.post || '').length);
  if(!t.items) return esc(t.t);
  const inner = t.parts ? t.parts.map(([s, k]) => k ? `<span class="${k}">${esc(s)}</span>` : esc(s)).join('') : esc(word);
  const rateable = cur().phrase.tokens.filter(x => x.items).indexOf(t) + 1;
  const badge = kbd && rateable <= 9 ? `<sup>${rateable}</sup>` : '';
  return `${esc(t.pre || '')}<span class="tk ${rating || ''}" data-i="${idx}">${inner}${badge}</span>${esc(t.post || '')}`;
}
function renderCard(){
  const c = cur(); if(!c) return;
  const p = c.phrase;
  const showSecond = manual() ? stage === 'revealed'
    : (!settings.hideGap || !playing || !['first', 'gap', 'ready', 'idle'].includes(phase));
  const firstLang = settings.order;
  const speaking = lang => playing && ((phase === 'first' && firstLang === lang) || (phase === 'second' && firstLang !== lang));
  const box = lang => {
    const isFirst = lang === firstLang, show = isFirst || showSecond;
    const body = lang === 'en' ? esc(p.en) : p.tokens.map((t, i) => tokenHTML(t, i, c.ratings[i])).join(' ');
    return `<div class="bx ${lang}"><div class="lb"><span>${lang === 'en' ? 'English' : 'Español'}</span>
      <button class="spk ${speaking(lang) ? 'on' : ''}" data-say="${isFirst ? 'first' : 'second'}" aria-label="Play again">${ic('volume')}</button></div>
      <p>${show ? body : '<span class="hidden-txt">…</span>'}</p></div>`;
  };
  $('card').innerHTML = box(firstLang) + box(firstLang === 'en' ? 'es' : 'en');
  $('card').classList.toggle('noreg', !settings.regColour);
  // notes: word notes and constructions, once the answer is showing
  const notes = [];
  if(showSecond){
    for(const k of p.constructions || []){ const x = lib.constructions[k.item.slice(2)]; if(x) notes.push(`<div><b>${esc(x.es)}</b> = ${esc(x.en)}</div>`); }
    for(const t of p.tokens){ const w = t.items && lib.words[t.items.find(i => i.startsWith('w:'))?.slice(2)]; if(w?.note) notes.push(`<div><b>${esc(t.t.replace(/[¿?¡!,.]/g, ''))}</b>: ${esc(w.note)}</div>`); }
  }
  $('hn').innerHTML = notes.join('') || `<span class="faint">${showSecond ? 'No notes on this phrase' : 'Notes appear once the answer shows'}</span>`;
}
function renderAll(){
  renderCard();
  $('mA').classList.toggle('on', settings.mode === 'auto'); $('mM').classList.toggle('on', settings.mode === 'manual');
  $('mA').innerHTML = (settings.mode === 'auto' ? ic('check') + ' ' : '') + 'Auto';
  $('mM').innerHTML = (settings.mode === 'manual' ? ic('check') + ' ' : '') + 'Manual';
  $('mute').innerHTML = ic(settings.muted ? 'volume-off' : 'volume'); $('mute').classList.toggle('muted', settings.muted);
  $('mute').setAttribute('aria-label', settings.muted ? 'Sound is off' : 'Sound is on');
  $('ord').textContent = settings.order === 'en' ? 'English first' : 'Spanish first';
  $('pp').innerHTML = ic(playing ? 'player-pause' : 'player-play');
  $('status').textContent = manual() ? (stage === 'asking' ? 'Tap to reveal' : 'Tap for next') : (playing ? '' : started ? 'Paused' : 'Tap ▶ to start');
  if(manual()) $('pp').innerHTML = ic(stage === 'asking' ? 'eye' : 'player-track-next');
  const start = Math.max(0, history.length - 10);
  $('dots').innerHTML = history.slice(start).map((c, k) => {
    const v = Object.values(c.ratings);
    return `<span class="dot ${v.includes('r') ? 'r' : v.includes('g') ? 'g' : ''} ${start + k === pos ? 'cur' : ''}" data-j="${start + k}"></span>`;
  }).join('');
  $('legend').innerHTML = `<span class="reg">regular</span> · <span class="stem">stem / spelling change</span> · <span class="irr">irregular</span> · tap = knew it · hold = more`;
}

/* ---------------- sheets ---------------- */
function openSheet(html, keepPlaying = false){
  if(!keepPlaying && playing) pausePlaying();
  $('sh').innerHTML = html; $('sh').scrollTop = 0; $('sh').classList.add('open'); $('ov').style.display = 'block';
  $('sh').querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheet);
}
function closeSheet(){ $('sh').classList.remove('open'); $('ov').style.display = 'none'; }
const closeBtn = `<button class="ib" data-close aria-label="Close">${ic('x')}</button>`;

function verbTableHTML(inf, hereTense, herePerson){
  const v = lib.verbs[inf]; if(!v) return '';
  const tenses = Object.keys(v.table);
  let h = `<div class="tbl" id="vt"><table class="ct"><tr><th></th>${tenses.map(t => `<th data-t="${t}">${TENSE_LABEL[t]}</th>`).join('')}</tr>`;
  for(const p of PERSONS){
    h += `<tr><th>${PERSON_LABEL[p]}</th>` + tenses.map(t => {
      const cell = v.table[t][p];
      const inner = cell.parts.map(([s, k]) => k ? `<span class="${k}">${esc(s)}</span>` : esc(s)).join('');
      return `<td class="${t === hereTense && p === herePerson ? 'here' : ''}">${inner}</td>`;
    }).join('') + '</tr>';
  }
  return h + '</table></div>';
}
function adjTableHTML(a){
  const cell = (g, n) => { try { return esc(adjForm(a.lemma, a.group, g, n)); } catch(e){ return '–'; } };
  const here = (g, n) => !a.short && a.g === g && a.n === n ? 'here' : '';
  return `<div class="tbl"><table class="ct"><tr><th></th><th>singular</th><th>plural</th></tr>
    <tr><th>masculine</th><td class="${here('m','s')}">${cell('m','s')}</td><td class="${here('m','p')}">${cell('m','p')}</td></tr>
    <tr><th>feminine</th><td class="${here('f','s')}">${cell('f','s')}</td><td class="${here('f','p')}">${cell('f','p')}</td></tr></table></div>`;
}
function openPanel(idx){
  touch();
  const c = cur(), t = c.phrase.tokens[idx];
  const word = t.t.slice((t.pre || '').length, t.t.length - (t.post || '').length);
  const isVerb = t.verb && t.verb.tense !== 'inf';
  const cons = (c.phrase.constructions || []).filter(k => k.tokens.includes(idx));
  const VCAT = { regular: ['regular', 'vc-reg'], 'stem-change': ['stem-changing', 'vc-stem'], 'spelling-change': ['spelling change', 'vc-stem'], irregular: ['irregular', 'vc-irr'] };
  let h;
  if(t.verb){
    const vb = lib.verbs[t.verb.inf] || {};
    const [lab, cls] = VCAT[vb.cat] || ['', ''];
    // the change itself, as small blue tags:  e → ie   z → c
    const SPELL = { car: 'c → qu', gar: 'g → gu', zar: 'z → c', 'cer-cir-zc': 'c → zc', 'uir-y': 'i → y', 'ger-gir': 'g → j', guir: 'gu → g' };
    const tags = [vb.stemChange && vb.stemChange.replace('-', ' → '), vb.spelling && SPELL[vb.spelling]].filter(Boolean)
      .map(x => `<span class="chg">${esc(x)}</span>`).join('');
    h = `<div class="head"><h3>${esc(t.verb.inf)} <span class="vcat ${cls}">(${lab})</span>${tags}</h3>${closeBtn}</div><p class="m" style="margin-bottom:10px">${esc(t.m || '')}</p>`;
  } else {
    h = `<div class="head"><h3>${esc(word)}</h3>${closeBtn}</div><p class="m">${esc(t.m || '')}</p><p class="info">${esc(t.info || '')}</p>`;
  }
  h += `<div class="negs">` + (isVerb
    ? `<button class="mb red" data-neg="form">${ic('x')}Didn't know the form</button><button class="mb red" data-neg="meaning">${ic('x')}Didn't know the meaning</button>`
    : `<button class="mb red" data-neg="all">${ic('x')}Didn't know it</button>`) + `</div>`;
  for(const k of cons){ const x = lib.constructions[k.item.slice(2)]; h += `<button class="mb red" data-neg="${k.item}">${ic('x')}Didn't know “${esc(x?.es || k.item)}”</button>`; }
  if(c.ratings[idx]) h += `<button class="mb muted" data-clear>${ic('eraser')}Clear rating</button>`;
  if(t.verb) h += `<div style="margin-top:12px"></div>` + verbTableHTML(t.verb.inf, t.verb.tense, t.verb.p);
  if(t.adj) h += `<div class="sec">${esc(t.adj.lemma)} · agreement</div>` + adjTableHTML(t.adj);
  const w = lib.words[(t.items.find(i => i.startsWith('w:')) || '').slice(2)];
  if(w?.note) h += `<div class="sec">Note</div><p class="m">${esc(w.note)}</p>`;
  for(const i of t.items.filter(i => i.startsWith('ap:'))) h += `<div class="sec">Pattern</div><p class="m">${esc(lib.patterns[i])}</p>`;
  h += `<div class="sec">Memory hooks</div><p class="faint">Generated hooks arrive in a later phase (they need the Claude connection).</p>`;
  h += `<button class="mb muted" data-report>${ic('flag')}Report a problem with this phrase</button>`;
  openSheet(h);
  const sh = $('sh');
  sh.querySelectorAll('[data-neg]').forEach(b => b.onclick = () => {
    const n = b.dataset.neg; rate(idx, 'r', n === 'all' ? null : n); closeSheet(); toast('Marked — it will come back soon');
  });
  sh.querySelector('[data-clear]')?.addEventListener('click', () => { rate(idx, null); closeSheet(); });
  sh.querySelector('[data-report]').onclick = () => openReport(c.phrase);
  const vt = $('vt'); const th = vt?.querySelector(`th[data-t="${t.verb?.tense}"]`);
  if(vt && th) vt.scrollLeft = Math.max(0, th.offsetLeft - vt.querySelector('th').offsetWidth - 4);
}
function openReport(p){
  openSheet(`<div class="head"><h3>Report a problem</h3>${closeBtn}</div><p class="info">${esc(p.es)}<br>${esc(p.en)}</p>
    <textarea id="rep" placeholder="What's wrong? (e.g. sounds unnatural, wrong translation, audio cut off)"></textarea>
    <p id="reperr" class="faint" style="color:var(--red);min-height:16px"></p><button class="mb" id="repsave">${ic('check')}Save to fix list</button>`);
  $('rep').oninput = () => $('reperr').textContent = '';
  $('repsave').onclick = () => {
    const note = $('rep').value.trim();
    if(!note){ $('reperr').textContent = 'Write a few words about the problem first'; return; }
    fixList.push({ t: Date.now(), ph: p.id, es: p.es, en: p.en, note }); save(KEY.fix, fixList); closeSheet(); toast('Added to the fix list');
  };
}

/* ---------------- menu, settings, fix list ---------------- */
function openMenu(){
  openSheet(`<div class="head"><h3>Menu</h3>${closeBtn}</div>
    <button class="mb" id="m1">${ic('settings')}Reel settings</button>
    <button class="mb" id="m2">${ic('flag')}Fix list (${fixList.length})</button>
    <button class="mb" id="m3">${ic('download')}Export my progress (backup file)</button>
    <p class="faint" style="margin-top:14px">Library: ${lib.counts.ok} phrases · built ${lib.version.slice(0, 10)}. Progress is saved in this browser only until sync arrives (Phase 3).</p>`);
  $('m1').onclick = openSettings; $('m2').onclick = openFixList;
  $('m3').onclick = () => {
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), device, settings, events, fixList }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `phrase-reel-backup-${today()}.json`; a.click();
  };
}
function openFixList(){
  openSheet(`<div class="head"><h3>Fix list</h3>${closeBtn}</div>` + (fixList.length
    ? fixList.map((f, i) => `<div class="fix"><b>${esc(f.es)}</b><br><span class="muted">${esc(f.en)}</span><br>${esc(f.note)} <button class="small" data-del="${i}">Remove</button></div>`).join('')
      + `<p class="faint">Send these to Claude in chat to get them fixed (Export in the menu includes them).</p>`
    : '<p class="muted">Nothing reported yet.</p>'));
  $('sh').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { fixList.splice(+b.dataset.del, 1); save(KEY.fix, fixList); openFixList(); });
}
function openSettings(){
  const range = (id, label, val, min, max, step, fmt = v => v) => `<div class="sr"><span>${label}</span><span style="display:flex;align-items:center;gap:8px"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><span class="val" id="${id}o">${fmt(val)}</span></span></div>`;
  const check = (id, label, val) => `<div class="sr"><span>${label}</span><input type="checkbox" id="${id}" ${val ? 'checked' : ''}></div>`;
  const sel = (id, label, val, opts) => `<div class="sr"><span>${label}</span><select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
  const sec = s => `${(+s).toFixed(1)} s`, x = v => `×${(+v).toFixed(1)}`, pct = v => `${v}%`, days = v => `${v} d`;
  const L = settings.ladder;
  let h = `<div class="head"><h3>Reel settings</h3>${closeBtn}</div>
    ${startupHTML()}
    <div class="grp">Playback</div>
    ${sel('s_order', 'Which language first', settings.order, [['en', 'English first'], ['es', 'Spanish first']])}
    ${check('s_hide', 'Hide the answer during the gap', settings.hideGap)}
    ${range('s_gap', 'Gap length (× answer length)', settings.gapMult, 0.5, 2.5, 0.1, x)}
    ${range('s_think', 'Extra thinking time', settings.thinkTime, 0, 4, 0.5, sec)}
    ${range('s_pause', 'Pause between cards', settings.pauseBetween, 0.5, 5, 0.5, sec)}
    ${check('s_chime', 'Chime for irregular verbs not yet learned', settings.chime)}
    ${check('s_reg', 'Colour regular endings green', settings.regColour)}
    ${range('s_still', '“Still there?” after this many untouched cards (0 = off)', settings.stillThere, 0, 50, 5)}
    <div class="grp">How often each tense comes up (0 = never)</div>
    ${['pres', 'pret', 'impf', 'fut', 'cond', 'subj'].map(t => range('w_' + t, TENSE_FULL[t] + (availableTenses.includes(t) ? '' : ' <span class="faint">(no phrases yet)</span>'), settings.weights[t], 0, 3, 0.5)).join('')}
    ${range('s_new', 'New items per day (at most)', settings.newCap, 0, 50, 1)}
    <div class="grp">Advanced · the ladder</div>
    ${range('l_first', 'First interval', L.firstInterval, 1, 3, 1, days)}
    ${range('l_factor', 'Growth factor', L.factor, 1.5, 3, 0.1, x)}
    ${range('l_max', 'Longest interval', L.maxInterval, 30, 365, 5, days)}
    ${range('l_drop', 'Rungs to drop on a red', L.redDrop, 1, 5, 1)}
    <p class="faint">Changes to the ladder recalculate everything from your history.</p>`;
  openSheet(h);
  const bind = (id, fn, fmt) => { const el = $(id); el.oninput = el.onchange = () => { fn(el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value); if($(id + 'o') && fmt) $(id + 'o').textContent = fmt(el.value); persist(); }; };
  const persist = () => { save(KEY.settings, settings); refreshStates(); renderAll(); };
  bind('s_order', v => { settings.order = v; loadCurrent(); });
  bind('s_hide', v => settings.hideGap = v);
  bind('s_gap', v => settings.gapMult = v, x); bind('s_think', v => settings.thinkTime = v, sec); bind('s_pause', v => settings.pauseBetween = v, sec);
  wireStartup(); bind('s_chime', v => settings.chime = v); bind('s_reg', v => settings.regColour = v);
  bind('s_still', v => settings.stillThere = v, v => v);
  for(const t of ['pres', 'pret', 'impf', 'fut', 'cond', 'subj']) bind('w_' + t, v => settings.weights[t] = v, v => v);
  bind('s_new', v => settings.newCap = v, v => v);
  bind('l_first', v => L.firstInterval = v, days); bind('l_factor', v => L.factor = v, x); bind('l_max', v => L.maxInterval = v, days); bind('l_drop', v => L.redDrop = v, v => v);
}

/* ---------------- start-up settings (shared by both settings pages) ---------------- */
function startupHTML(){
  const S = settings.startup, opt = (v, cur, l) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  return `<div class="grp">When the app opens</div>
    <div class="sr"><span>Open with</span><select id="st_screen">${opt('cards', S.screen, 'Phrase cards')}${opt('quiz', S.screen, 'Quiz')}</select></div>
    <div class="sr"><span>Cards start in</span><select id="st_mode">${opt('manual', S.mode, 'Manual')}${opt('auto', S.mode, 'Auto')}</select></div>
    <div class="sr"><span>Quiz starts in</span><select id="st_qmode">${opt('auto', S.quizMode, 'Auto (moves on after right answers)')}${opt('manual', S.quizMode, 'Manual')}</select></div>
    <div class="sr"><span>Sound</span><select id="st_sound">${opt('on', S.muted ? 'off' : 'on', 'On')}${opt('off', S.muted ? 'off' : 'on', 'Off (muted)')}</select></div>`;
}
export function wireStartup(){
  const set = (k, v) => { settings.startup[k] = v; save(KEY.settings, settings); };
  $('st_screen').onchange = e => set('screen', e.target.value);
  $('st_mode').onchange = e => set('mode', e.target.value);
  $('st_qmode').onchange = e => set('quizMode', e.target.value);
  $('st_sound').onchange = e => set('muted', e.target.value === 'off');
}

/* ---------------- toast ---------------- */
let toastTimer;
function toast(msg){ const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }

/* ---------------- input: taps, holds, swipes, keys ---------------- */
function wireInput(){
  const card = $('card');
  let press = null, holdTimer = null, sx = null, sy = null, moved = false;
  card.addEventListener('contextmenu', e => { const tk = e.target.closest('.tk'); if(tk){ e.preventDefault(); clearTimeout(holdTimer); press = null; openPanel(+tk.dataset.i); } });
  card.addEventListener('pointerdown', e => {
    sx = e.clientX; sy = e.clientY; moved = false;
    const tk = e.target.closest('.tk');
    if(tk && e.button === 0){ press = +tk.dataset.i; holdTimer = setTimeout(() => { const i = press; press = null; if(i !== null) openPanel(i); }, 500); }
  });
  card.addEventListener('pointermove', e => { if(sx !== null && (Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12)){ moved = true; clearTimeout(holdTimer); press = null; } });
  card.addEventListener('pointerup', e => {
    clearTimeout(holdTimer);
    const dx = sx === null ? 0 : e.clientX - sx; sx = null;
    if(e.target.closest('.spk')){ press = null; return; }
    if(moved && Math.abs(dx) > 50){ press = null; touch(); dx < 0 ? next() : prev(); return; }
    if(press !== null){ const i = press; press = null; tapToken(i); return; }
    if(!moved && e.button === 0) togglePlay();
  });
  card.addEventListener('click', e => { const b = e.target.closest('.spk'); if(b){ touch(); pausePlaying(); player.replay(b.dataset.say); } });
  $('dots').onclick = e => { const d = e.target.closest('.dot'); if(d){ touch(); goTo(+d.dataset.j); } };
  $('pp').onclick = togglePlay;
  $('nxt').onclick = () => { touch(); next(); };
  $('prv').onclick = () => { touch(); prev(); };
  $('mA').onclick = () => { if(manual()){ settings.mode = 'auto'; save(KEY.settings, settings); goTo(pos); } };
  $('mM').onclick = () => { if(!manual()){ settings.mode = 'manual'; save(KEY.settings, settings); goTo(pos); } };
  $('ord').onclick = () => { settings.order = settings.order === 'en' ? 'es' : 'en'; save(KEY.settings, settings); goTo(pos); };
  $('mnu').onclick = openMenu;
  $('mute').onclick = () => {
    settings.muted = !settings.muted; save(KEY.settings, settings); renderAll();
    if(settings.muted && playing){                     // silence whatever is speaking right now
      if(manual()) player.pause(), (playing = false), renderAll();
      else { player.pause(); startPlaying(['first', 'gap', 'second'].includes(phase) ? phase : 'first'); }
    }
    toast(settings.muted ? 'Sound off · the speaker buttons still play' : 'Sound on');
  };
  $('ov').onclick = closeSheet;
  $('add').onclick = () => toast('Adding your own phrases comes in Phase 3');
  $('qz').onclick = () => { if(playing) pausePlaying(); openQuiz(); };
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape' && $('sh').classList.contains('open')) return closeSheet();
    if(e.target.matches('input, textarea, select') || quizIsOpen()) return;
    if(e.key === 'Escape') return closeSheet();
    if($('sh').classList.contains('open')) return;
    const rateable = cur()?.phrase.tokens.map((t, i) => t.items ? i : -1).filter(i => i >= 0) || [];
    if(e.code === 'Space' || e.key === 'Enter'){ e.preventDefault(); togglePlay(); }
    else if(e.key === 'ArrowRight'){ touch(); next(); }
    else if(e.key === 'ArrowLeft'){ touch(); prev(); }
    else if(/^Digit[1-9]$/.test(e.code)){
      const i = rateable[+e.code.slice(5) - 1];
      if(!kbd){ kbd = true; renderCard(); }
      if(i === undefined) return;
      e.shiftKey ? openPanel(i) : tapToken(i);
    }
  });
}

/* ---------------- start ---------------- */
async function init(){
  try {
    lib = await (await fetch('build/library.json', { cache: 'no-cache' })).json();
  } catch(e){
    $('card').innerHTML = `<p class="muted" style="padding:20px">Couldn't load the phrases. Check your connection and reload.</p>`; return;
  }
  byId = Object.fromEntries(lib.phrases.map(p => [p.id, p]));
  const counts = {};
  for(const p of lib.phrases) for(const t of p.tenses) counts[t] = (counts[t] || 0) + 1;
  availableTenses = Object.keys(counts).filter(t => counts[t] >= 5);
  refreshStates();
  document.querySelectorAll('[data-ic]').forEach(el => el.outerHTML = ic(el.dataset.ic));
  await initQuiz({ lib, byId, getEvents: () => events, logEvent, load, save, ladder: () => settings.ladder, openSheet, closeSheet, toast,
    startup: () => settings.startup, setStartup: (k, v) => { settings.startup[k] = v; save(KEY.settings, settings); }, startupHTML, wireStartup });
  wireInput();
  // open straight onto the first card (no start screen)
  history.push(newCard()); pos = 0; loadCurrent(); renderAll();
  document.addEventListener('pointerdown', () => chime(0.0001), { once: true });   // unlock audio on the first tap
  if(manual()) startPlaying();                 // speaks the first language if the browser allows; tap reveals the answer
  if(settings.startup.screen === 'quiz') openQuiz();
}
init();
