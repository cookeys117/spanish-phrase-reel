// The quiz screen. Endless multiple choice; its own ladder (per word and per direction), kept apart from the reel.
import { buildPool, filterPool, makeQuestion, nextQuestion, pairKey, TYPES } from './quiz.mjs';
import { computeStates, dayKey } from './scheduler.mjs';
import { ic } from './icons.mjs';

const TENSES = [['pres', 'now'], ['pret', 'did'], ['impf', 'used to'], ['fut', 'will'], ['cond', 'would']];
const DIRS = [['mix', 'Mixed'], ['es', 'ES → EN'], ['en', 'EN → ES']];
const DEFAULTS = {
  types: { noun: true, verb: true, form: true, adj: true, adv: true, con: true, other: true },
  topics: null, tenses: null, dir: 'mix', open: false,
  muted: false, autoSpeak: true, mode: 'auto', dOk: 1.2, readEx: 'wrong', showEx: true, newCap: 20,
  // the quiz's own ladder — gentler than the reel's, because picking from options is easier than recalling
  ladder: { firstInterval: 1, factor: 1.3, maxInterval: 30, redDrop: 2 },
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let A;                    // app api: { lib, byId, getEvents, logEvent, load, save, ladder, openSheet, closeSheet, toast }
let pool, qs, score, states, q = null, n = 0, open = false, timer = null;
const qhist = []; let qpos = -1;           // questions seen this session, for ◀ ▶
const retries = [], recent = [];
let speechMap = {}, current = null;
// "Practise my misses": a separate, unscored round through today's missed words (nothing is logged).
let prac = null;           // { queue: [{key, dir}], total, done: Set, again: Set, saved: {q, qhist, qpos} }
const $ = id => document.getElementById(id);

export const quizIsOpen = () => open;
/** New clips have arrived: pick up the latest list of quiz word clips. */
export async function refreshQuizVoices(){
  try { speechMap = await (await fetch('audio/quiz-manifest.json', { cache: 'no-cache' })).json(); } catch(e){}
}

export async function initQuiz(api){
  A = api;
  pool = buildPool(A.lib);
  qs = { ...DEFAULTS, ...A.load('spr.quiz', {}) };
  qs.types = { ...DEFAULTS.types, ...(qs.types || {}) };
  qs.ladder = { ...DEFAULTS.ladder, ...(qs.ladder || {}) };
  qs.topics = null;                                  // all topics, always (topics stay in the data for grouping)
  qs.muted = A.startup().muted;
  qs.mode = A.startup().quizMode || 'auto';
  rollScore();
  try { speechMap = await (await fetch('audio/quiz-manifest.json', { cache: 'no-cache' })).json(); } catch(e){ speechMap = {}; }
  document.addEventListener('keydown', onKey);
}
const persist = () => A.save('spr.quiz', qs);

export function openQuiz(){
  open = true; $('quiz').classList.add('open');
  if(!q) next(); else render();
}
function closeQuiz(){ open = false; clearTimeout(timer); stopAudio(); $('quiz').classList.remove('open'); }

/* ---------- sound ---------- */
function stopAudio(){ if(current){ current.pause(); current = null; } try { speechSynthesis.cancel(); } catch(e){} }
/** Speak Spanish: the Azure clip if there is one, otherwise the device's voice. Resolves when finished. */
function speak(text, src, force = false){
  if(qs.muted && !force) return Promise.resolve();
  stopAudio();
  const file = src || (speechMap[text] && 'audio/' + speechMap[text]);
  return new Promise(res => {
    const safety = setTimeout(res, 12000);
    const done = () => { clearTimeout(safety); res(); };
    if(file){
      const a = current = new Audio(file);
      a.addEventListener('ended', done, { once: true });
      a.play().catch(() => tts(text, done));
    } else tts(text, done);
  });
}
function tts(text, done = () => {}){
  try {
    if(!text) return done();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'es-CO'; u.rate = 0.95;
    const v = speechSynthesis.getVoices().find(v => v.lang && v.lang.toLowerCase().startsWith('es'));
    if(v) u.voice = v;
    u.onend = done; u.onerror = done;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch(e){ done(); }
}
const exPhrase = () => A.byId[q.item.examples[0]];
const speakExample = (force = false) => { const ex = exPhrase(); return ex ? speak(ex.es, `audio/${ex.id}_es.mp3`, force) : Promise.resolve(); };

/* ---------- questions ---------- */
/** The score shown is today's only: it starts again from 0 at midnight. */
// Today's score is counted from today's recorded quiz answers (after a manual reset, if any).
function todaysAnswers(){
  const d = dayKey(), from = A.load('spr.qreset', 0);
  return quizEvents().filter(e => dayKey(e.t) === d && e.t > from && (e.r === 'g' || e.r === 'r'));
}
function rollScore(){
  const ev = todaysAnswers();
  score = { ok: ev.filter(e => e.r === 'g').length, tot: ev.length };
}
/** Today's words: each word + direction asked today, with misses / rights, most missed first. */
function todaysWords(){
  const byKey = new Map(pool.map(it => [it.key, it])), m = new Map();
  for(const e of todaysAnswers()){
    const [key, dir] = e.i.split('>'); const it = byKey.get(key); if(!it) continue;
    const w = m.get(e.i) || { it, dir, miss: 0, ok: 0, last: 0, lastMiss: 0 };
    if(e.r === 'r'){ w.miss++; w.lastMiss = e.t; } else w.ok++;
    w.last = e.t; m.set(e.i, w);
  }
  const all = [...m.values()];
  const missed = all.filter(w => w.miss).sort((a, b) => b.miss - a.miss || b.lastMiss - a.lastMiss);
  const right = all.filter(w => !w.miss).sort((a, b) => b.last - a.last);
  return { missed, right };
}
const qa = w => w.dir === 'es' ? [w.it.es, w.it.en] : [w.it.en, w.it.es];
function openToday(){
  const { missed, right } = todaysWords();
  const row = w => { const [qq, aa] = qa(w); return `<div class="trow"><button class="ib tsay" data-tsay="${esc(w.it.es)}" aria-label="Play">${ic('volume')}</button><div class="tq">${esc(qq)}</div><div class="ta">${esc(aa)}</div></div>`; };
  A.openSheet(`<div class="head"><h3>Today's words</h3><button class="ib" data-close aria-label="Close">${ic('x')}</button></div>
    <p class="info">${score.tot} answer${score.tot === 1 ? '' : 's'} · ${score.ok} right · ${missed.length} word${missed.length === 1 ? '' : 's'} missed at least once</p>
    ${missed.length ? `<button class="pbtn" id="t_prac">${ic('player-play')} Practise my misses (${missed.length})</button>
      <div class="grp">Missed today · most missed first</div>${missed.map(row).join('')}` : `<p class="muted">Nothing missed today.</p>`}
    ${right.length ? `<button class="fold" id="t_fold">${ic('chevron-down')} Right every time (${right.length})</button><div id="t_right" hidden>${right.map(row).join('')}</div>` : ''}`);
  const sh = $('sh');
  sh.querySelectorAll('[data-tsay]').forEach(b => b.onclick = () => speak(b.dataset.tsay, null, true));
  $('t_fold')?.addEventListener('click', () => { const r = $('t_right'); r.hidden = !r.hidden; $('t_fold').innerHTML = `${ic(r.hidden ? 'chevron-down' : 'chevron-up')} Right every time (${right.length})`; });
  $('t_prac')?.addEventListener('click', () => { A.closeSheet(); startPractice(missed); });
}
function startPractice(missed){
  clearTimeout(timer); stopAudio();
  const queue0 = missed.map(w => ({ key: w.it.key, dir: w.dir }));
  prac = { queue0, queue: queue0.map(k => ({ ...k })), total: missed.length, done: new Set(), again: new Set(),
           saved: { q, qhist: qhist.splice(0), qpos } };
  qpos = -1; q = null; next();
}
function exitPractice(){
  if(!prac) return;
  clearTimeout(timer); stopAudio();
  const sv = prac.saved; prac = null;
  qhist.splice(0, qhist.length, ...sv.qhist); qpos = sv.qpos; q = sv.q;
  if(!q) next(); else render();
}
function againPractice(){ const keys = [...prac.queue0]; prac.queue = keys.map(k => ({ ...k })); prac.done = new Set(); prac.again = new Set(); qhist.length = 0; qpos = -1; next(); }
function filtered(){ return filterPool(pool, qs); }
function quizEvents(){ return A.getEvents().filter(e => e.m === 'quiz'); }
function next(){
  clearTimeout(timer);
  if(prac){                                         // practice round: today's misses, nothing scored
    q = null;
    while(!q && prac.queue.length){
      const k = prac.queue.shift(), it = pool.find(p => p.key === k.key);
      const made = it && makeQuestion(it, k.dir, pool);
      if(made) q = { ...made, item: it, dir: k.dir, kind: 'practice', chosen: null };
      else prac.done.add(k.key + '>' + k.dir);
    }
    if(q){
      qhist.push(q); qpos = qhist.length - 1;
      if(q.promptLang === 'es' && qs.autoSpeak){ const pr = q.prompt; setTimeout(() => speak(pr), 150); }
    }
    render(); return;
  }
  const fp = filtered();
  states = computeStates(quizEvents(), {}, qs.ladder);
  const today = dayKey();
  let newToday = 0; for(const s of states.values()) if(s.firstSeen === today) newToday++;
  const doneToday = new Set(quizEvents().filter(e => dayKey(e.t) === today).map(e => e.i));
  q = null;
  if(fp.length >= 1){
    for(let tries = 0; tries < 8 && !q; tries++){
      const pick = nextQuestion({ pool: fp, states, dir: qs.dir, today, n, retries, recent, newToday, newCap: qs.newCap, doneToday });
      if(!pick?.item) break;
      const made = makeQuestion(pick.item, pick.dir, pool);
      if(made) q = { ...made, item: pick.item, dir: pick.dir, kind: pick.kind, chosen: null };
    }
  }
  n++;
  if(q){
    qhist.push(q); if(qhist.length > 100) qhist.shift();
    qpos = qhist.length - 1;
    recent.push(pairKey(q.item.key, q.dir));
    if(q.promptLang === 'es' && qs.autoSpeak){ const pr = q.prompt; setTimeout(() => speak(pr), 150); }
  }
  render();
}
const reviewing = () => qpos < qhist.length - 1;
/** ◀ : look back at earlier questions (already answered — nothing is scored again). */
function back(){
  if(qpos <= 0) return;
  clearTimeout(timer); stopAudio();
  qpos--; q = qhist[qpos]; render();
}
/** ▶ : forward through earlier questions, then on to a new one. */
function forward(){
  clearTimeout(timer); stopAudio();
  if(reviewing()){ qpos++; q = qhist[qpos]; render(); return; }
  if(q && q.chosen === null) return;           // answer (or "Don't know") the current one first
  next();
}
function answer(i){
  if(!q) return;
  if(q.chosen !== null) return forward();
  q.chosen = i;
  const ok = i === q.answer;
  if(prac){                                          // practice: no event, no score; a miss goes to the back of the round
    const pk = pairKey(q.item.key, q.dir);
    if(ok) prac.done.add(pk); else { prac.again.add(pk); prac.queue.push({ key: q.item.key, dir: q.dir }); }
  } else {
    A.logEvent({ m: 'quiz', i: pairKey(q.item.key, q.dir), r: ok ? 'g' : 'r', q: q.kind });
    rollScore();
    if(!ok && q.kind !== 'again') retries.push({ key: q.item.key, dir: q.dir, at: n + 4 });
  }
  render();
  // sound: the right Spanish word (when the answers were Spanish), then the example phrase if wanted
  const asked = q;
  const readEx = qs.showEx && (qs.readEx === 'always' || (qs.readEx === 'wrong' && !ok));
  (async () => {
    if(qs.autoSpeak && q.optionLang === 'es') await speak(q.options[q.answer]);
    if(readEx && q === asked) await speakExample();
    // Auto: a right answer moves on (after the audio + a short pause); a wrong one waits for you
    if(ok && qs.mode === 'auto' && q === asked && !reviewing()) timer = setTimeout(next, qs.dOk * 1000);
  })();
}

/* ---------- rendering ---------- */
function chip(on, label, data){ return `<button class="chip ${on ? 'on' : ''}" ${data}>${ic(on ? 'check' : 'plus')} ${esc(label)}</button>`; }
function render(){
  const typesOn = TYPES.filter(([k]) => qs.types[k]).map(([, l]) => l);
  const summary = `${typesOn.length === TYPES.length ? 'all word types' : typesOn.join(', ') || 'nothing'} · ${DIRS.find(d => d[0] === qs.dir)[1]}`;
  const segBtn = (m, l) => `<button data-qmode="${m}" class="${qs.mode === m ? 'on' : ''}">${qs.mode === m ? ic('check') + ' ' : ''}${l}</button>`;
  let h = `<div class="qhead"><button class="ib small" id="qback">${ic('arrow-left')} Reel</button><div class="seg">${segBtn('auto', 'Auto')}${segBtn('manual', 'Manual')}</div><span class="qscore">${(rollScore(), score.tot) ? `<button id="qtoday" title="Today's words">Today ${score.ok} / ${score.tot}</button>` : ''}</span>
    <button class="ib ${qs.muted ? 'muted' : ''}" id="qmute" aria-label="Sound on or off">${ic(qs.muted ? 'volume-off' : 'volume')}</button>
    <button class="ib" id="qmenu" aria-label="Quiz settings">${ic('menu-2')}</button></div>
    <div class="qfilter"><button class="flink" id="qf"><span class="muted">Including:</span> ${esc(summary)} ${ic(qs.open ? 'chevron-up' : 'chevron-down')}</button>`;
  if(qs.open){
    h += `<div class="chips">${TYPES.map(([k, l]) => chip(qs.types[k], l, `data-type="${k}"`)).join('')}</div>`;
    if(qs.types.form) h += `<div class="chips"><span class="faint">Verb forms:</span> ${TENSES.map(([k, l]) => chip(!qs.tenses || qs.tenses.includes(k), l, `data-tense="${k}"`)).join('')}</div>`;
    h += `<div class="chips">${DIRS.map(([k, l]) => chip(qs.dir === k, l, `data-dir="${k}"`)).join('')}</div>`;
  }
  h += `</div>`;
  if(prac){
    const finished = !q && !prac.queue.length;
    h += `<div class="pband"><span>${ic('player-play')} Practising today's misses · <b>${finished ? 'done' : `${prac.done.size} of ${prac.total} done`}</b>${finished ? '' : ' · not scored'}</span><button class="pexit" id="pexit">${ic('x')} Exit</button></div>`;
  }
  h += `<div class="qbody" id="qbody">`;
  const fp = filtered();
  if(prac && !q){
    const firstTime = prac.total - prac.again.size;
    h += `<div class="pdone"><div class="pbig">${ic('check')}</div><h3>All ${prac.total} practised</h3>
      <p class="muted">${firstTime} right first time${prac.again.size ? ` · ${prac.again.size} needed another go` : ''}<br>Nothing here changed your scores or schedule.</p>
      <button class="qnext" id="pagain">${ic('refresh')} Go round again</button><button class="opt pback" id="pback">Back to the normal quiz</button></div>`;
  }
  else if(!Object.values(qs.types).some(Boolean)) h += `<p class="qwarn">Pick at least one word type.</p>`;
  else if(!q) h += `<p class="qwarn">Too few words match this selection (${fp.length}). Add another word type or topic.</p>`;
  else {
    const it = q.item, answered = q.chosen !== null;
    const tag = q.kind === 'practice' ? 'Practice' : q.kind === 'again' ? 'Again · practice only' : q.kind === 'new' ? 'New' : '';
    h += `<div class="qtag">${tag}</div>`;
    h += `<div class="qprompt ${q.promptLang}"><span>${esc(q.prompt)}</span>${q.promptLang === 'es' ? `<button class="ib" id="qsay" aria-label="Play">${ic('volume')}</button>` : ''}</div>`;
    if(it.type === 'form' && q.promptLang === 'en') h += `<p class="qctx">${esc(it.inf)} · ${esc(A.lib.verbs[it.inf]?.en || '')}</p>`;
    if(it.ambiguous && q.promptLang === 'es'){ const ex = A.byId[it.examples[0]]; if(ex) h += `<p class="qctx">as in: <i>${esc(ex.es)}</i></p>`; }
    h += q.options.map((o, i) => {
      const cls = answered ? (i === q.answer ? 'right' : i === q.chosen ? 'wrong' : 'dim') : '';
      const say = q.optionLang === 'es' && answered ? `<span class="osay" data-say="${esc(o)}">${ic('volume')}</span>` : '';
      return `<button class="opt ${q.optionLang} ${cls}" data-opt="${i}"><span class="okey">${i + 1}</span><span class="otext">${esc(o)}</span>${say}</button>`;
    }).join('');
    h += `<button class="opt dk ${answered && q.chosen === -1 ? 'chosen' : ''}" data-opt="-1"><span class="okey">0</span>Don't know</button>`;
    const ex = A.byId[it.examples[0]];
    if(qs.showEx && ex) h += answered
      ? `<div class="qex"><button class="ib" id="qexsay" aria-label="Play example">${ic('volume')}</button><div><div>${esc(ex.es)}</div><div class="muted">${esc(ex.en)}</div></div></div>`
      : `<div class="qex hold"><div class="muted">Example phrase shows after you answer</div></div>`;
    if(answered){
      const waits = qs.mode === 'manual' || q.chosen !== q.answer || reviewing();
      if(waits) h += `<button class="qnext" id="qnext">Next ${ic('arrow-right')}</button>`;
    }
  }
  h += `</div>`;
  const behind = qhist.length - 1 - qpos;
  h += `<div class="qbar"><button id="qprev" aria-label="Previous question" ${qpos > 0 ? '' : 'disabled'}>${ic('player-track-prev')}</button>
    <span class="qpos">${behind > 0 ? `Looking back · ${behind} ${behind === 1 ? 'question' : 'questions'} ago` : ''}</span>
    <button id="qfwd" aria-label="Next question">${ic('player-track-next')}</button></div>`;
  $('quiz').innerHTML = h;
  wire();
}
function wire(){
  $('qback').onclick = closeQuiz;
  $('qtoday')?.addEventListener('click', openToday);
  $('pexit')?.addEventListener('click', exitPractice);
  $('pback')?.addEventListener('click', exitPractice);
  $('pagain')?.addEventListener('click', againPractice);
  $('quiz').querySelectorAll('[data-qmode]').forEach(b => b.onclick = () => {
    qs.mode = b.dataset.qmode; persist();
    clearTimeout(timer);
    if(qs.mode === 'auto' && q && q.chosen === q.answer && !reviewing()) timer = setTimeout(next, qs.dOk * 1000);
    render();
  });
  $('qmute').onclick = () => { qs.muted = !qs.muted; persist(); if(qs.muted) stopAudio(); render(); };
  $('qmenu').onclick = openSettings;
  $('qf').onclick = () => { qs.open = !qs.open; persist(); render(); };
  const refilter = () => { persist(); retries.length = 0; next(); };
  $('quiz').querySelectorAll('[data-type]').forEach(b => b.onclick = () => { qs.types[b.dataset.type] = !qs.types[b.dataset.type]; refilter(); });
  $('quiz').querySelectorAll('[data-tense]').forEach(b => b.onclick = () => {
    const all = TENSES.map(t => t[0]), cur = qs.tenses || all, t = b.dataset.tense;
    qs.tenses = cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t];
    if(qs.tenses.length === all.length) qs.tenses = null;
    if(qs.tenses && !qs.tenses.length) qs.tenses = [t];          // keep at least one
    refilter();
  });
  $('quiz').querySelectorAll('[data-dir]').forEach(b => b.onclick = () => { qs.dir = b.dataset.dir; refilter(); });
  $('quiz').querySelectorAll('[data-opt]').forEach(b => b.onclick = e => {
    const s = e.target.closest('.osay');
    if(s){ e.stopPropagation(); speak(s.dataset.say, null, true); return; }
    answer(+b.dataset.opt);
  });
  $('qsay')?.addEventListener('click', e => { e.stopPropagation(); speak(q.prompt, null, true); });
  $('qexsay')?.addEventListener('click', e => { e.stopPropagation(); speakExample(true); });
  $('qnext')?.addEventListener('click', forward);
  $('qprev').onclick = back; $('qfwd').onclick = forward;
  const body = $('qbody');
  body.onclick = e => { if(q && q.chosen !== null && !e.target.closest('button')) forward(); };
}
function onKey(e){
  if(!open || e.target.matches('input, textarea, select') || $('sh').classList.contains('open')) return;
  if(e.key === 'Escape') return prac ? exitPractice() : closeQuiz();
  if(e.key === 'ArrowLeft') return back();
  if(e.key === 'ArrowRight') return forward();
  if(/^Digit[1-5]$/.test(e.code)) answer(+e.code.slice(5) - 1);
  else if(e.code === 'Digit0' || (e.code === 'Space' && q && q.chosen === null)){ e.preventDefault(); answer(-1); }
  else if((e.key === 'Enter' || e.code === 'Space') && q && q.chosen !== null){ e.preventDefault(); forward(); }
}

/* ---------- settings ---------- */
function openSettings(){
  clearTimeout(timer);
  const range = (id, label, val, min, max, step, fmt) => `<div class="sr"><span>${label}</span><span style="display:flex;align-items:center;gap:8px"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><span class="val" id="${id}o">${fmt(val)}</span></span></div>`;
  const check = (id, label, val) => `<div class="sr"><span>${label}</span><input type="checkbox" id="${id}" ${val ? 'checked' : ''}></div>`;
  const sec = v => `${(+v).toFixed(1)} s`;
  A.openSheet(`<div class="head"><h3>Quiz settings</h3><button class="ib" data-close aria-label="Close">${ic('x')}</button></div>
    ${A.startupHTML()}<div class="grp">Quiz</div>
    ${check('q_sound', 'Sound', !qs.muted)}
    ${check('q_speak', 'Speak Spanish automatically', qs.autoSpeak)}
    <div class="sr"><span>Read the example phrase aloud</span><select id="q_readex">${[['wrong', 'Only when I get it wrong'], ['always', 'Always'], ['off', 'Off (just show it)']].map(([v, l]) => `<option value="${v}" ${qs.readEx === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    ${range('q_ok', 'Auto: pause before moving on after a right answer', qs.dOk, 0.3, 4, 0.1, sec)}
    ${check('q_ex', 'Show an example phrase', qs.showEx)}
    ${range('q_new', 'New words per day before review mixes in', qs.newCap, 0, 60, 5, v => v)}
    <div class="grp">Quiz ladder (separate from the reel)</div>
    <p class="faint" style="margin:4px 0 0">How far apart a word comes back after each right answer (one step per day at most). Gaps now: <span id="q_gaps"></span></p>
    ${range('ql_first', 'First interval', qs.ladder.firstInterval, 1, 3, 1, v => `${v} d`)}
    ${range('ql_factor', 'Growth per right answer', qs.ladder.factor, 1.1, 2.5, 0.1, v => `×${(+v).toFixed(1)}`)}
    ${range('ql_max', 'Longest interval', qs.ladder.maxInterval, 7, 180, 1, v => `${v} d`)}
    ${range('ql_drop', 'Steps dropped on a miss', qs.ladder.redDrop, 1, 5, 1, v => v)}
    <button class="mb muted" id="q_reset">${ic('refresh')}Reset today's score (${score.ok} / ${score.tot})</button>
    <p class="faint">The quiz keeps its own ladder, separate from the reel. Each word is tracked both ways (Spanish → English and English → Spanish); English → Spanish joins in “mixed” once you know a word the easy way round.</p>`);
  const bind = (id, fn, fmt) => { const el = $(id); el.oninput = el.onchange = () => { fn(el.type === 'checkbox' ? el.checked : +el.value); if(fmt) $(id + 'o').textContent = fmt(el.value); persist(); }; };
  A.wireStartup(); bind('q_sound', v => qs.muted = !v); bind('q_speak', v => qs.autoSpeak = v);
  $('q_readex').onchange = e => { qs.readEx = e.target.value; persist(); };
  bind('q_ok', v => qs.dOk = v, sec); bind('q_ex', v => qs.showEx = v); bind('q_new', v => qs.newCap = v, v => v);
  const gaps = () => { const L = qs.ladder, out = []; let prev = 0;
    for(let r = 1; r <= 40 && out.length < 14; r++){ const d = Math.max(1, Math.round(Math.min(L.maxInterval, L.firstInterval * Math.pow(L.factor, r - 1)))); out.push(d); if(d >= L.maxInterval) break; }
    $('q_gaps').textContent = out.join(', ') + ' days'; };
  gaps();
  bind('ql_first', v => { qs.ladder.firstInterval = v; gaps(); }, v => `${v} d`);
  bind('ql_factor', v => { qs.ladder.factor = v; gaps(); }, v => `×${(+v).toFixed(1)}`);
  bind('ql_max', v => { qs.ladder.maxInterval = v; gaps(); }, v => `${v} d`);
  bind('ql_drop', v => qs.ladder.redDrop = v, v => v);
  $('q_reset').onclick = () => { A.save('spr.qreset', Date.now()); rollScore(); A.closeSheet(); render(); A.toast('Score reset'); };
  const sh = $('sh'), close = () => render();
  sh.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  $('ov').addEventListener('click', close, { once: true });
}
