// Vocabulary quiz: the pool of questions, wrong-answer choice and the question queue.
// Pure functions (no DOM) so they can be tested in Node and used by tools/build.mjs.
import { english, NO_FORM_QUIZ } from '../engine/english.mjs';
import { conjugate, getVerb } from '../engine/conjugate.mjs';

export const TYPES = [
  ['noun', 'Nouns'], ['verb', 'Verbs (meaning)'], ['form', 'Verb forms'], ['adj', 'Adjectives'],
  ['adv', 'Adverbs'], ['con', 'Constructions'], ['other', 'Other words'],
];
const POS_TYPE = { noun: 'noun', adj: 'adj', adv: 'adv', expr: 'other', num: 'other', det: 'other', conj: 'other', pron: 'other' };
const EL_FEMININE = new Set(['agua', 'hambre']);            // feminine, but "el agua", "el hambre"
const PLURAL_ONLY = new Set(['urgencias']);
const FORM_TENSES = ['pres', 'pret', 'impf', 'fut', 'cond'];
const PERSONS = ['yo', 'tu', 'usted', 'nosotros', 'ellos'];

export function withArticle(lemma, w){
  if(w.pos !== 'noun' || !w.gender) return lemma;
  if(PLURAL_ONLY.has(lemma)) return (w.gender === 'f' ? 'las ' : 'los ') + lemma;
  if(EL_FEMININE.has(lemma)) return 'el ' + lemma;
  return (w.gender === 'f' ? 'la ' : 'el ') + lemma;
}

/** Every quiz item, built from what appears in the phrases. */
export function buildPool(lib){
  const items = new Map();
  const add = (key, make, ph) => {
    if(!items.has(key)){ const it = make(); if(!it) return; items.set(key, { key, topics: new Set(), examples: [], ...it }); }
    const it = items.get(key);
    it.topics.add(ph.topic);
    if(!it.examples.includes(ph.id)) it.examples.push(ph.id);
  };
  for(const ph of lib.phrases){
    if(ph.status === 'error') continue;
    for(const t of ph.tokens){
      for(const id of t.items || []){
        if(!id.startsWith('w:')) continue;
        const k = id.slice(2);
        if(lib.words[k]){
          const w = lib.words[k], type = POS_TYPE[w.pos];
          if(!type) continue;                                       // names etc.
          const lemma = k.split('#')[0];
          add(id, () => ({ type, lemma, es: withArticle(lemma, w), en: w.en, note: w.note }), ph);
        } else if(lib.verbs[k]){
          add(id, () => ({ type: 'verb', lemma: k, es: k, en: lib.verbs[k].en }), ph);
        }
      }
      if(t.verb && t.verb.tense !== 'inf' && FORM_TENSES.includes(t.verb.tense) && !NO_FORM_QUIZ.has(t.verb.inf)){
        const { inf, tense, p } = t.verb;
        const en = english(inf, tense, p);
        if(en) add(`vf:${inf}|${tense}|${p}`, () => ({ type: 'form', lemma: inf, inf, tense, person: p, es: conjugate(inf, tense, p), en }), ph);
      }
    }
    for(const c of ph.constructions || []){
      const x = lib.constructions[c.item.slice(2)];
      if(x) add(c.item, () => ({ type: 'con', lemma: c.item, es: x.es, en: x.en }), ph);
    }
  }
  // words with more than one meaning get a context sentence, so the question is fair
  const byLemma = new Map();
  for(const it of items.values()) if(it.type !== 'form'){ byLemma.set(it.lemma + it.type, (byLemma.get(it.lemma + it.type) || 0) + 1); }
  for(const it of items.values()) if(it.type !== 'form' && byLemma.get(it.lemma + it.type) > 1) it.ambiguous = true;
  return [...items.values()];
}

const shuffle = (a, rnd) => { a = a.slice(); for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/**
 * Five options (one right). dir 'es' = Spanish prompt, English options; 'en' = the reverse.
 * Returns { prompt, options: [{text, lang, key?}], answer: index } or null if not enough options.
 */
export function makeQuestion(item, dir, pool, rnd = Math.random){
  const ask = dir === 'es' ? 'es' : 'en', give = dir === 'es' ? 'en' : 'es';
  let wrong = [];
  if(item.type === 'form'){
    // same verb, other person / tense — but never a cell that is spelled the same (caminamos now = did)
    const cells = [];
    for(const t of FORM_TENSES) for(const p of PERSONS){
      if(t === item.tense && p === item.person) continue;
      const es = conjugate(item.inf, t, p), en = english(item.inf, t, p);
      if(!en || es === item.es || en === item.en) continue;
      const score = (t === item.tense ? 2 : 0) + (p === item.person ? 2 : 0) + rnd();
      cells.push({ es, en, score });
    }
    cells.sort((a, b) => b.score - a.score);
    const seen = new Set([item[give]]);
    for(const c of cells){ if(seen.has(c[give])) continue; seen.add(c[give]); wrong.push(c); if(wrong.length === 4) break; }
  } else {
    const same = pool.filter(o => o.type === item.type && o.key !== item.key && o.lemma !== item.lemma);
    const ranked = shuffle(same, rnd).sort((a, b) => sharedTopic(b, item) - sharedTopic(a, item));
    const seen = new Set([item[give], item[ask]]);
    for(const o of ranked){
      if(seen.has(o[give]) || seen.has(o[ask])) continue;
      seen.add(o[give]); wrong.push(o);
      if(wrong.length === 4) break;
    }
  }
  if(wrong.length < 4) return null;
  const options = shuffle([{ text: item[give], right: true }, ...wrong.map(o => ({ text: o[give] }))], rnd);
  return { prompt: item[ask], promptLang: ask, optionLang: give, options: options.map(o => o.text), answer: options.findIndex(o => o.right) };
}
const sharedTopic = (a, b) => [...a.topics].some(t => b.topics.has(t)) ? 1 : 0;

/** Which items pass the filters. */
export function filterPool(pool, f){
  return pool.filter(it => f.types[it.type]
    && (!f.topics || [...it.topics].some(t => f.topics.includes(t)))
    && (it.type !== 'form' || !f.tenses || f.tenses.includes(it.tense)));
}

/**
 * Next question. Order: retries that are due -> due words -> new words (daily cap) -> extra practice.
 * ctx: { pool (filtered), states (Map pairKey -> state), dir: 'mix'|'es'|'en', today, n (question number),
 *        retries: [{key, dir, at}], recent: [pairKeys], newToday, newCap, random }
 */
export const pairKey = (key, dir) => `${key}>${dir}`;
export function nextQuestion(ctx){
  const { pool, states, dir, today, n, retries, recent, newToday, newCap } = ctx;
  const rnd = ctx.random || Math.random;
  const ri = retries.findIndex(r => r.at <= n && pool.some(p => p.key === r.key));
  if(ri >= 0){ const r = retries.splice(ri, 1)[0]; return { item: pool.find(p => p.key === r.key), dir: r.dir, kind: 'again' }; }

  const pairs = [];
  for(const it of pool){
    const esState = states.get(pairKey(it.key, 'es'));
    if(dir !== 'en') pairs.push({ it, d: 'es', s: esState });
    // English -> Spanish is harder: in "mixed", it opens up once Spanish -> English is on rung 2+
    if(dir === 'en' || (dir === 'mix' && ((esState?.rung ?? 0) >= 2 || states.get(pairKey(it.key, 'en'))))) pairs.push({ it, d: 'en', s: states.get(pairKey(it.key, 'en')) });
  }
  const window = Math.min(10, Math.max(0, Math.floor(pairs.length / 2)));
  const recentSet = new Set(recent.slice(-window));
  const fresh = pairs.filter(p => !recentSet.has(pairKey(p.it.key, p.d)) && !recentSet.has(pairKey(p.it.key, p.d === 'es' ? 'en' : 'es')));
  const from = fresh.length ? fresh : pairs;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];

  const due = from.filter(p => p.s?.rated && p.s.due && p.s.due <= today);
  if(due.length){
    due.sort((a, b) => a.s.due.localeCompare(b.s.due));            // most overdue first, a little shuffled
    const p = pick(due.slice(0, 5));
    return { item: p.it, dir: p.d, kind: 'due' };
  }
  const unseen = from.filter(p => !p.s);
  if(unseen.length && newToday < newCap){ const p = pick(unseen); return { item: p.it, dir: p.d, kind: 'new' }; }
  // extra practice: lower rungs come up more often; never moves anything up early (scheduler rule)
  const seen = from.filter(p => p.s);
  const pool2 = seen.length ? seen : from;
  const weighted = pool2.flatMap(p => Array(Math.max(1, 5 - (p.s?.rung ?? 0))).fill(p));
  const p = pick(weighted);
  return { item: p.it, dir: p.d, kind: 'practice' };
}

/** Spanish strings the quiz may speak (for the audio script). */
export function quizSpeech(pool){
  return [...new Set(pool.filter(it => it.type !== 'con').map(it => it.es))].sort();
}
