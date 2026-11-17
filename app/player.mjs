// Plays one card: first language -> gap -> second language -> pause between cards.
// Pausing stops mid-way; resuming restarts the phase that was interrupted.

const wait = ms => new Promise(r => setTimeout(r, ms));
let ctx = null;

/** Soft two-note chime (irregular-verb cue). */
export function chime(volume = 0.15){
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [[880, 0], [1320, 0.12]].forEach(([f, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, now + d);
      g.gain.linearRampToValueAtTime(volume, now + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + d + 0.5);
      o.connect(g).connect(ctx.destination); o.start(now + d); o.stop(now + d + 0.55);
    });
  } catch(e){ /* no audio context: skip the cue */ }
}

function makeClip(src, text, lang){
  const clip = { src, text, lang, audio: null, duration: null };
  if(src){
    clip.audio = new Audio(src);
    clip.audio.preload = 'auto';
    clip.ready = new Promise(res => {
      clip.audio.addEventListener('loadedmetadata', () => { clip.duration = clip.audio.duration; res(); }, { once: true });
      clip.audio.addEventListener('error', () => { clip.audio = null; res(); }, { once: true });
      setTimeout(res, 4000);
    });
  } else clip.ready = Promise.resolve();
  return clip;
}
const estimate = clip => clip.duration && isFinite(clip.duration) ? clip.duration : Math.max(1, clip.text.length * 0.075);

export class Player {
  constructor(onPhase, onDone){ this.onPhase = onPhase; this.onDone = onDone; this.run = 0; this.phase = 'idle'; this.card = null; this.current = null; }

  /** card: { first: {src,text,lang}, second: {...}, chime: bool } */
  load(card){
    this.stop();
    this.card = { ...card, first: makeClip(card.first.src, card.first.text, card.first.lang),
                           second: makeClip(card.second.src, card.second.text, card.second.lang) };
    this.phase = 'ready';
  }

  async start(settings, fromPhase = 'first'){
    if(!this.card) return;
    const id = ++this.run, alive = () => id === this.run;
    const c = this.card;
    const order = ['first', 'gap', 'second', 'after'];
    for(const ph of order.slice(order.indexOf(fromPhase))){
      if(!alive()) return;
      this.phase = ph; this.onPhase(ph);
      if(ph === 'first') await this.play(c.first, alive);
      else if(ph === 'gap'){
        await c.second.ready;
        if(c.chime && settings.chime) chime();
        await wait(estimate(c.second) * settings.gapMult * 1000 + settings.thinkTime * 1000);
      }
      else if(ph === 'second') await this.play(c.second, alive);
      else if(ph === 'after') await wait(settings.pauseBetween * 1000);
    }
    if(!alive()) return;
    this.phase = 'done'; this.onPhase('done'); this.onDone();
  }

  play(clip, alive = () => true){
    return clip.ready.then(() => new Promise(res => {
      if(!alive()) return res();
      if(clip.audio){
        this.current = clip.audio;
        clip.audio.currentTime = 0;
        const end = () => { clip.audio.removeEventListener('ended', end); res(); };
        clip.audio.addEventListener('ended', end);
        clip.audio.play().catch(() => { clip.audio.removeEventListener('ended', end); this.speak(clip).then(res); });
      } else this.speak(clip).then(res);
    }));
  }

  speak(clip){                       // fallback: the device's own voice
    return new Promise(res => {
      try {
        const u = new SpeechSynthesisUtterance(clip.text);
        u.lang = clip.lang; u.onend = res; u.onerror = res;
        speechSynthesis.cancel(); speechSynthesis.speak(u);
        setTimeout(res, 15000);
      } catch(e){ res(); }
    });
  }

  /** Replay just one language (pauses the reel first). */
  replay(which){
    if(!this.card) return;
    this.pause();
    this.play(this.card[which]);
  }

  pause(){
    this.run++;                                   // cancels the running sequence
    if(this.current){ this.current.pause(); }
    try { speechSynthesis.cancel(); } catch(e){}
    return this.phase;
  }
  stop(){ this.pause(); this.phase = 'idle'; }
}
