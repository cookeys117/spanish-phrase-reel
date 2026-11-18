// Scheduling: the ladder, the event log and choosing the next phrase.
// Pure functions (no DOM, no storage) so they can be tested in Node.
//
// Event shape: { t: timestamp ms, d: device, m: 'reel', ph: phrase id, c: card instance,
//                i: item id (absent for 'shown'), r: 'g' | 'r' | 'x' | 'shown' }
//   g = knew it (green), r = didn't know (red), x = rating cleared / undone, shown = card was played

export const DEFAULT_LADDER = { firstInterval: 1, factor: 2, maxInterval: 180, redDrop: 2 };

export function dayKey(ts = Date.now()){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(key, n){
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n, 12).getTime());
}

function hash(s){
  let h = 2166136261;
  for(const c of s){ h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;  // mix the bits
  return (h >>> 0) / 4294967296;
}

/** Days until next showing for a rung (rung 0 = still learning: tomorrow). */
export function intervalFor(rung, ladder = DEFAULT_LADDER, seed = ''){
  if(rung <= 0) return 1;
  let days = Math.min(ladder.maxInterval, ladder.firstInterval * Math.pow(ladder.factor, rung - 1));
  if(days >= 4) days *= 1 + (hash(seed) - 0.5) * 0.24;          // ±12% so items don't clump
  return Math.max(1, Math.round(days));
}

/** All items a phrase carries (tokens + constructions). */
export function phraseItems(ph){
  const s = new Set();
  for(const t of ph.tokens) for(const i of t.items || []) s.add(i);
  for(const c of ph.constructions || []) s.add(c.item);
  return [...s];
}

/**
 * Replay the event log into per-item state:
 *   { rung, due (dayKey), rated, firstSeen (dayKey) }
 * Rules (plan): one verdict per item per day; red stands over green; 'x' clears the day's verdict.
 * Green promotes one rung, but only if the item was due (or never rated). Red drops N rungs.
 */
export function computeStates(events, phrasesById, ladder = DEFAULT_LADDER){
  const verdicts = new Map();          // item -> Map(day -> 'g'|'r')
  const firstSeen = new Map();
  const sorted = [...events].sort((a, b) => a.t - b.t);
  for(const e of sorted){
    const day = dayKey(e.t);
    if(e.r === 'shown'){
      const ph = phrasesById[e.ph];
      if(ph) for(const i of phraseItems(ph)) if(!firstSeen.has(i)) firstSeen.set(i, day);
      continue;
    }
    if(!e.i) continue;
    if(!verdicts.has(e.i)) verdicts.set(e.i, new Map());
    const m = verdicts.get(e.i), cur = m.get(day);
    if(e.r === 'r') m.set(day, 'r');
    else if(e.r === 'g'){ if(cur !== 'r') m.set(day, 'g'); }
    else if(e.r === 'x') m.delete(day);
    if(!firstSeen.has(e.i)) firstSeen.set(e.i, day);
  }
  const states = new Map();
  for(const [item, m] of verdicts){
    let rung = 0, due = null, rated = false;
    for(const day of [...m.keys()].sort()){
      const v = m.get(day);
      if(v === 'g'){
        if(due === null || day >= due){ rung += 1; due = addDays(day, intervalFor(rung, ladder, item + day)); rated = true; }
      } else if(v === 'r'){
        rung = Math.max(0, rung - ladder.redDrop);
        due = addDays(day, intervalFor(rung, ladder, item + day)); rated = true;
      }
    }
    states.set(item, { rung, due, rated, firstSeen: firstSeen.get(item) });
  }
  for(const [item, day] of firstSeen) if(!states.has(item)) states.set(item, { rung: 0, due: null, rated: false, firstSeen: day });
  return states;
}

/** Today's verdict for an item (for showing red/green on a card again). */
export function todaysVerdict(events, item, today = dayKey()){
  let v = null;
  for(const e of events){
    if(e.i !== item || dayKey(e.t) !== today) continue;
    if(e.r === 'r') v = 'r'; else if(e.r === 'g' && v !== 'r') v = 'g'; else if(e.r === 'x') v = null;
  }
  return v;
}

/** Theme of the day: weighted random from the tense sliders, stable for the whole day. */
export function pickTheme(day, weights, availableTenses){
  const options = availableTenses.filter(t => (weights[t] ?? 0) > 0);
  if(!options.length) return availableTenses[0] || 'pres';
  const total = options.reduce((s, t) => s + weights[t], 0);
  let x = hash('theme' + day) * total;
  for(const t of options){ x -= weights[t]; if(x <= 0) return t; }
  return options[options.length - 1];
}

/**
 * Choose the next phrase.
 *  ctx: { phrases, states, today, theme, themeShare (0–1), recent: [phrase ids, newest last],
 *         newToday, newCap, requeueItem (item to bring back after a red, or null), random }
 */
export function choosePhrase(ctx){
  const { phrases, states, today, theme, themeShare, recent, newToday, newCap, requeueItem } = ctx;
  const rnd = ctx.random || Math.random;
  const usable = phrases.filter(p => p.status !== 'error');
  if(requeueItem){
    const carriers = usable.filter(p => phraseItems(p).includes(requeueItem));
    const fresh = carriers.filter(p => p.id !== recent[recent.length - 1]);
    const pool = fresh.length ? fresh : carriers;
    if(pool.length) return { phrase: pool[Math.floor(rnd() * pool.length)], slot: 'requeue' };
  }
  let dueTotal = 0;
  for(const s of states.values()) if(s.rated && s.due && s.due <= today) dueTotal++;
  const newAllowed = newToday < newCap && dueTotal < 40;
  const slot = rnd() < themeShare ? 'theme' : 'review';
  const recentSet = new Set(recent.slice(-25));
  let best = null, bestScore = -Infinity;
  for(const p of usable){
    const onTheme = p.tenses.includes(theme);
    let score = rnd() * 1.5;
    if(theme){
      if(slot === 'theme') score += onTheme ? 6 : -6;
      else score += onTheme ? -2 : 1;
    }
    if(ctx.tenseWeights && p.tenses.length){          // tense sliders: 0 = never, 1 = normal, 3 = lots
      const w = Math.max(...p.tenses.map(t => ctx.tenseWeights[t] ?? 1));
      if(w <= 0) continue;
      score += (w - 1) * 2.5;
    }
    let fresh = 0;
    for(const i of phraseItems(p)){
      const s = states.get(i);
      if(!s || (!s.rated && !s.firstSeen)) fresh++;
      else if(s.rated && s.due && s.due <= today) score += 3;
      else if(!s.rated) score += 1;                    // seen but never rated: keep it coming round
      else score -= 0.5;                                // known, not due: fine as a carrier
    }
    if(fresh === 1) score += newAllowed ? 1.5 : -3;
    if(fresh > 1) score -= newAllowed ? 2.5 * (fresh - 1) : 4 * fresh;
    if(recentSet.has(p.id)) score -= 20 + (25 - recent.slice(-25).reverse().indexOf(p.id));
    if(score > bestScore){ bestScore = score; best = p; }
  }
  return { phrase: best, slot };
}

/** Items first seen today (for the daily new-item cap). */
export function newItemsToday(states, today){
  let n = 0;
  for(const s of states.values()) if(s.firstSeen === today) n++;
  return n;
}
