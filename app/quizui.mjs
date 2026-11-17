// The quiz screen. Endless multiple choice; its own ladder (per word and per direction), kept apart from the reel.
import { buildPool, filterPool, makeQuestion, nextQuestion, pairKey, TYPES } from './quiz.mjs';
import { computeStates, dayKey } from './scheduler.mjs';
import { ic } from './icons.mjs';

const TENSES = [['pres', 'now'], ['pret', 'did'], ['impf', 'used to'], ['fut', 'will'], ['cond', 'would']];
const DIRS = [['mix', 'Mixed'], ['es', 'ES → EN'], ['en', 'EN → ES']];
const DEFAULTS = {
  types: { noun: true, verb: true, form: true, adj: true, adv: true, con: true, other: true },
  topics: null, tenses: null, dir: 'mix', open: false,
  muted: false, autoSpeak: true, autoAdv: true, dOk: 1.2, dBad: 2.6, showEx: true, newCap: 20,
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let A;                    // app api: { lib, byId, getEvents, logEvent, load, save, ladder, openSheet, closeSheet, toast }
let pool, qs, score, states, q = null, n = 0, open = false, timer = null;
const retries = [], recent = [];
let speechMap = {}, current = null;
const $ = id => document.getElementById(id);

export const quizIsOpen = () => open;

export async function initQuiz(api){
  A = api;
  pool = buildPool(A.lib);
  qs = { ...DEFAULTS, ...A.load('spr.quiz', {}) };
  qs.types = { ...DEFAULTS.types, ...(qs.types || {}) };
  score = A.load('spr.qscore', { ok: 0, tot: 0 });
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
function speak(text, src, force = false){
  if(qs.muted && !force) return;
  stopAudio();
  const file = src || (speechMap[text] && 'audio/' + speechMap[text]);
  if(file){ current = new Audio(file); current.play().catch(() => tts(text)); return; }
  tts(text);
}
function tts(text){
  try {
    const u = new SpeechSynthesisUtterance(text); u.lang = 'es-CO'; u.rate = 0.95;
    const v = speechSynthesis.getVoices().find(v => v.lang && v.lang.toLowerCase().startsWith('es'));
    if(v) u.voice = v;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch(e){}
}

/* ---------- questions ---------- */
function filtered(){ return filterPool(pool, qs); }
function quizEvents(){ return A.getEvents().filter(e => e.m === 'quiz'); }
function next(){
  clearTimeout(timer);
  const fp = filtered();
  states = computeStates(quizEvents(), {}, A.ladder());
  const today = dayKey();
  let newToday = 0; for(const s of states.values()) if(s.firstSeen === today) newToday++;
  q = null;
  if(fp.length >= 1){
    for(let tries = 0; tries < 8 && !q; tries++){
      const pick = nextQuestion({ pool: fp, states, dir: qs.dir, today, n, retries, recent, newToday, newCap: qs.newCap });
      if(!pick?.item) break;
      const made = makeQuestion(pick.item, pick.dir, pool);
      if(made) q = { ...made, item: pick.item, dir: pick.dir, kind: pick.kind, chosen: null };
    }
  }
  n++;
  if(q){
    recent.push(pairKey(q.item.key, q.dir));
    if(q.promptLang === 'es' && qs.autoSpeak) setTimeout(() => speak(q.prompt), 150);
  }
  render();
}
function answer(i){
  if(!q) return;
  if(q.chosen !== null) return next();
  q.chosen = i;
  const ok = i === q.answer;
  score.tot++; if(ok) score.ok++; A.save('spr.qscore', score);
  A.logEvent({ m: 'quiz', i: pairKey(q.item.key, q.dir), r: ok ? 'g' : 'r', q: q.kind });
  if(!ok && q.kind !== 'again') retries.push({ key: q.item.key, dir: q.dir, at: n + 4 });
  if(qs.autoSpeak){
    const ex = q.item.examples[0];
    if(q.optionLang === 'es') speak(q.options[q.answer]);
    else if(qs.showEx && ex) speak('', `audio/${ex}_es.mp3`);
  }
  render();
  if(qs.autoAdv) timer = setTimeout(next, (ok ? qs.dOk : qs.dBad) * 1000);
}

/* ---------- rendering ---------- */
function chip(on, label, data){ return `<button class="chip ${on ? 'on' : ''}" ${data}>${ic(on ? 'check' : 'plus')} ${esc(label)}</button>`; }
function render(){
  const topics = [...new Set(A.lib.phrases.map(p => p.topic))].sort();
  const typesOn = TYPES.filter(([k]) => qs.types[k]).map(([, l]) => l);
  const summary = `${typesOn.length === TYPES.length ? 'all word types' : typesOn.join(', ') || 'nothing'} · ${DIRS.find(d => d[0] === qs.dir)[1]}`
    + (qs.topics ? ` · ${qs.topics.length} topic${qs.topics.length > 1 ? 's' : ''}` : '');
  let h = `<div class="qhead"><button class="ib small" id="qback">${ic('arrow-left')} Reel</button><span class="qscore">${score.tot ? `${score.ok} / ${score.tot}` : ''}</span>
    <button class="ib ${qs.muted ? 'muted' : ''}" id="qmute" aria-label="Sound on or off">${ic(qs.muted ? 'volume-off' : 'volume')}</button>
    <button class="ib" id="qmenu" aria-label="Quiz settings">${ic('menu-2')}</button></div>
    <div class="qfilter"><button class="flink" id="qf"><span class="muted">Including:</span> ${esc(summary)} ${ic(qs.open ? 'chevron-up' : 'chevron-down')}</button>`;
  if(qs.open){
    h += `<div class="chips">${TYPES.map(([k, l]) => chip(qs.types[k], l, `data-type="${k}"`)).join('')}</div>`;
    h += `<div class="chips">${chip(!qs.topics, 'All topics', 'data-topic="*"')}${topics.map(t => chip(qs.topics?.includes(t), t, `data-topic="${t}"`)).join('')}</div>`;
    if(qs.types.form) h += `<div class="chips"><span class="faint">Verb forms:</span> ${TENSES.map(([k, l]) => chip(!qs.tenses || qs.tenses.includes(k), l, `data-tense="${k}"`)).join('')}</div>`;
    h += `<div class="chips">${DIRS.map(([k, l]) => chip(qs.dir === k, l, `data-dir="${k}"`)).join('')}</div>`;
  }
  h += `</div><div class="qbody" id="qbody">`;
  const fp = filtered();
  if(!Object.values(qs.types).some(Boolean)) h += `<p class="qwarn">Pick at least one word type.</p>`;
  else if(!q) h += `<p class="qwarn">Too few words match this selection (${fp.length}). Add another word type or topic.</p>`;
  else {
    const it = q.item, answered = q.chosen !== null;
    const tag = q.kind === 'again' ? 'Again · practice only' : q.kind === 'new' ? 'New' : '';
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
    if(answered){
      const ex = A.byId[it.examples[0]];
      if(qs.showEx && ex) h += `<div class="qex"><button class="ib" id="qexsay" aria-label="Play example">${ic('volume')}</button><div><div>${esc(ex.es)}</div><div class="muted">${esc(ex.en)}</div></div></div>`;
      if(!qs.autoAdv) h += `<button class="qnext" id="qnext">Next ${ic('arrow-right')}</button>`;
      else h += `<p class="faint" style="text-align:center;margin-top:10px">Tap anywhere for the next one</p>`;
    }
  }
  h += `</div>`;
  $('quiz').innerHTML = h;
  wire();
}
function wire(){
  $('qback').onclick = closeQuiz;
  $('qmute').onclick = () => { qs.muted = !qs.muted; persist(); if(qs.muted) stopAudio(); render(); };
  $('qmenu').onclick = openSettings;
  $('qf').onclick = () => { qs.open = !qs.open; persist(); render(); };
  const refilter = () => { persist(); retries.length = 0; next(); };
  $('quiz').querySelectorAll('[data-type]').forEach(b => b.onclick = () => { qs.types[b.dataset.type] = !qs.types[b.dataset.type]; refilter(); });
  $('quiz').querySelectorAll('[data-topic]').forEach(b => b.onclick = () => {
    const t = b.dataset.topic;
    if(t === '*') qs.topics = null;
    else { const cur = qs.topics || []; qs.topics = cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t]; if(!qs.topics.length) qs.topics = null; }
    refilter();
  });
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
  $('qexsay')?.addEventListener('click', e => { e.stopPropagation(); const ex = q.item.examples[0]; speak('', `audio/${ex}_es.mp3`, true); });
  $('qnext')?.addEventListener('click', next);
  const body = $('qbody');
  body.onclick = e => { if(q && q.chosen !== null && !e.target.closest('button')) next(); };
}
function onKey(e){
  if(!open || e.target.matches('input, textarea, select') || $('sh').classList.contains('open')) return;
  if(e.key === 'Escape') return closeQuiz();
  if(/^Digit[1-5]$/.test(e.code)) answer(+e.code.slice(5) - 1);
  else if(e.code === 'Digit0' || (e.code === 'Space' && q && q.chosen === null)){ e.preventDefault(); answer(-1); }
  else if((e.key === 'Enter' || e.code === 'Space') && q && q.chosen !== null){ e.preventDefault(); next(); }
}

/* ---------- settings ---------- */
function openSettings(){
  clearTimeout(timer);
  const range = (id, label, val, min, max, step, fmt) => `<div class="sr"><span>${label}</span><span style="display:flex;align-items:center;gap:8px"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><span class="val" id="${id}o">${fmt(val)}</span></span></div>`;
  const check = (id, label, val) => `<div class="sr"><span>${label}</span><input type="checkbox" id="${id}" ${val ? 'checked' : ''}></div>`;
  const sec = v => `${(+v).toFixed(1)} s`;
  A.openSheet(`<div class="head"><h3>Quiz settings</h3><button class="ib" data-close aria-label="Close">${ic('x')}</button></div>
    ${check('q_sound', 'Sound', !qs.muted)}
    ${check('q_speak', 'Speak Spanish automatically', qs.autoSpeak)}
    ${check('q_adv', 'Move on automatically', qs.autoAdv)}
    ${range('q_ok', 'Pause after a right answer', qs.dOk, 0.5, 4, 0.1, sec)}
    ${range('q_bad', 'Pause after a wrong answer', qs.dBad, 1, 8, 0.1, sec)}
    ${check('q_ex', 'Show an example phrase', qs.showEx)}
    ${range('q_new', 'New words per day (at most)', qs.newCap, 0, 60, 5, v => v)}
    <button class="mb muted" id="q_reset">${ic('refresh')}Reset the running score (${score.ok} / ${score.tot})</button>
    <p class="faint">The quiz keeps its own ladder, separate from the reel. Each word is tracked both ways (Spanish → English and English → Spanish); English → Spanish joins in “mixed” once you know a word the easy way round.</p>`);
  const bind = (id, fn, fmt) => { const el = $(id); el.oninput = el.onchange = () => { fn(el.type === 'checkbox' ? el.checked : +el.value); if(fmt) $(id + 'o').textContent = fmt(el.value); persist(); }; };
  bind('q_sound', v => qs.muted = !v); bind('q_speak', v => qs.autoSpeak = v); bind('q_adv', v => qs.autoAdv = v);
  bind('q_ok', v => qs.dOk = v, sec); bind('q_bad', v => qs.dBad = v, sec); bind('q_ex', v => qs.showEx = v); bind('q_new', v => qs.newCap = v, v => v);
  $('q_reset').onclick = () => { score = { ok: 0, tot: 0 }; A.save('spr.qscore', score); A.closeSheet(); render(); A.toast('Score reset'); };
  const sh = $('sh'), close = () => render();
  sh.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  $('ov').addEventListener('click', close, { once: true });
}
