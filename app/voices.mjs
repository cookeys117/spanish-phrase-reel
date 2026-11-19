// "Generating new voices · 34 / 600" — shows while the automatic voice job is still making clips.
// Compares the phrases (and quiz words) the app has with the clips listed in the audio manifests.
// Checks when the app opens; only keeps checking (every 2 min / when you come back to the app) while something is missing.
const $ = id => document.getElementById(id);
let lib, onNewClips, timer = null, lastMissing = null;

export function startVoiceWatch(library, onChange){
  lib = library; onNewClips = onChange;
  check();
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && lastMissing) check(); });
}

async function check(){
  let phrases = {}, quiz = {};
  try {
    [phrases, quiz] = await Promise.all(['audio/manifest.json', 'audio/quiz-manifest.json']
      .map(f => fetch(f, { cache: 'no-cache' }).then(r => r.ok ? r.json() : {})));
  } catch(e){ return schedule(); }            // offline: try again later
  let missing = 0, total = 0;
  for(const p of lib.phrases){
    if(p.status === 'error') continue;
    for(const lang of ['es', 'en']){ total++; if(phrases[p.id]?.[lang]?.text !== p[lang]) missing++; }
  }
  for(const t of lib.quizSpeech || []){ total++; if(!quiz[t]) missing++; }
  if(lastMissing !== null && missing < lastMissing && onNewClips) onNewClips();
  lastMissing = missing;
  show(missing);
  if(missing) schedule(); else clearTimeout(timer);
}
function schedule(){ clearTimeout(timer); timer = setTimeout(check, 120000); }

function show(missing){
  const b = $('vbanner');
  let base = null;
  try { base = JSON.parse(localStorage.getItem('spr.vbase')); } catch(e){}
  if(!missing){ try { localStorage.removeItem('spr.vbase'); } catch(e){} b.classList.remove('show'); $('app').classList.remove('hasvb'); return; }
  // the "out of" number = how many were missing when this round of voices started
  if(!base || base.v !== lib.version || missing > base.total) base = { v: lib.version, total: missing };
  try { localStorage.setItem('spr.vbase', JSON.stringify(base)); } catch(e){}
  b.textContent = `Generating new voices · ${base.total - missing} / ${base.total}`;
  b.classList.add('show'); $('app').classList.add('hasvb');
}
