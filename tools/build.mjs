// Validate the content and build the library the app reads.
//   node tools/build.mjs            -> validates content/, writes build/library.json + build/report.txt
// Exits with code 1 if any phrase has an error (errors are listed in build/report.txt).
//
// Content is written in the plain-text files described in tools/textformat.mjs; they are
// parsed into this shape (one phrase) before validation:
// { "id": "p0001", "topic": "apartment", "en": "...", "es": "...",
//   "tokens": [ "que",                                     // plain string = not rateable
//               {"t":"Tuvimos","v":"tener","tense":"pret","p":"nosotros"},   // conjugated verb
//               {"t":"salir","inf":"salir"},               // infinitive -> verb meaning item
//               {"t":"temprano","w":"temprano#early"},     // word (lemma#meaning)
//               {"t":"puentes","w":"puente#bridge","n":"p"},           // plural noun
//               {"t":"cansada","adj":"cansado#tired","g":"f","n":"s"}  // adjective (short:true for gran/buen…)
//             ],
//   "constructions": [ {"c":"tener-que","tokens":[0,1]} ] }
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conjugate, classify, segment, table, getVerb, VERB_BY_INF, TENSE_LABEL, PERSON_LABEL } from '../engine/conjugate.mjs';
import { adjAnalysis, pluralOf, AGREEMENT_PATTERNS } from '../engine/adjectives.mjs';
import { readWords, readConstructions, readPhrases } from './textformat.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = join(root, 'content');
const words = readWords(contentDir);
const constructions = readConstructions(contentDir);
const phrases = readPhrases(contentDir);

// Words that are never rateable on their own (articles, pronouns, prepositions, conjunctions…)
const STOP = new Set(`el la los las un una unos unas lo al del
yo tú usted él ella nosotros nosotras ellos ellas ustedes me te se nos le les
mi mis tu tus su sus nuestro nuestra nuestros nuestras
este esta estos estas ese esa esos esas esto eso aquí allá ahí acá
a de en con por para sin sobre hasta desde entre hacia según
y e o u pero que si no sí ni como cuando donde muy más menos también tan
qué cómo cuándo dónde cuánto cuánta cuántos cuántas quién quiénes cuál`.split(/\s+/));

const PUNCT = /^[¿¡"'(«]+|[?!.,;:"')»…]+$/g;
const clean = t => t.replace(PUNCT, '');
const lc = s => s.toLocaleLowerCase('es');

const report = [];
let errorCount = 0, warnCount = 0;
const usedVerbs = new Set();
const seenIds = new Set(), seenEs = new Map();

function analyseToken(tok, ph, i, err){
  if(typeof tok === 'string'){
    const w = lc(clean(tok));
    if(w && !STOP.has(w)) err(`token ${i} "${tok}" is not tagged and not a stop word`);
    if(w === 'vos') err(`vos is switched off`);
    return { t: tok };
  }
  const text = clean(tok.t), low = lc(text);
  const out = { t: tok.t };
  // punctuation around the word, so the app can colour the word itself: ¿ + Puedo + ?
  const pre = tok.t.match(/^[¿¡"'(«]+/)?.[0], post = tok.t.match(/[?!.,;:"')»…]+$/)?.[0];
  if(pre) out.pre = pre;
  if(post) out.post = post;
  if(tok.v){
    if(!VERB_BY_INF[tok.v]) { err(`token ${i}: verb "${tok.v}" is not in the engine`); return out; }
    let expected;
    try { expected = conjugate(tok.v, tok.tense, tok.p); } catch(e){ err(`token ${i}: ${e.message}`); return out; }
    if(low !== expected) { err(`token ${i}: "${text}" should be "${expected}" (${tok.v} ${tok.tense} ${tok.p})`); return out; }
    const c = classify(tok.v, tok.tense, tok.p);
    usedVerbs.add(tok.v);
    out.parts = segment(tok.v, tok.tense, tok.p);
    if(text[0] !== text[0].toLowerCase()) out.parts[0][0] = out.parts[0][0][0].toUpperCase() + out.parts[0][0].slice(1);
    out.items = [...c.formItems, c.meaningItem];
    out.verb = { inf: tok.v, tense: tok.tense, p: tok.p, kind: c.kind };
    const sc = getVerb(tok.v).stemChange;
    const formLabel = c.kind === 'regular' ? 'regular form' : c.kind === 'stem' ? `stem change ${sc.replace('-', '→')}` : 'irregular form';
    out.info = `${tok.v} · ${TENSE_LABEL[tok.tense]} · ${PERSON_LABEL[tok.p]} · ${formLabel}`;
    out.m = getVerb(tok.v).en;
    return out;
  }
  if(tok.inf){
    if(!VERB_BY_INF[tok.inf]) { err(`token ${i}: verb "${tok.inf}" is not in the engine`); return out; }
    if(low !== tok.inf && !low.startsWith(tok.inf)) err(`token ${i}: "${text}" is not the infinitive ${tok.inf}`);
    usedVerbs.add(tok.inf);
    out.items = [`w:${tok.inf}`];
    out.verb = { inf: tok.inf, tense: 'inf' };
    out.info = `${tok.inf} · infinitive`;
    out.m = getVerb(tok.inf).en;
    return out;
  }
  if(tok.adj){
    const w = words[tok.adj];
    if(!w) { err(`token ${i}: adjective "${tok.adj}" missing from words.json`); return out; }
    if(w.pos !== 'adj') err(`token ${i}: "${tok.adj}" is not marked as an adjective`);
    const lemma = tok.adj.split('#')[0];
    let a;
    try { a = adjAnalysis(lemma, w.group, tok.g || 'm', tok.n || 's', !!tok.short); } catch(e){ err(`token ${i}: ${e.message}`); return out; }
    if(low !== a.form) { err(`token ${i}: "${text}" should be "${a.form}" (${lemma}, ${tok.g || 'm'} ${tok.n || 's'}${tok.short ? ', shortened' : ''})`); return out; }
    out.parts = a.parts;
    out.items = [...a.items, `w:${tok.adj}`];
    out.adj = { lemma, group: w.group, g: tok.g || 'm', n: tok.n || 's', short: !!tok.short };
    out.info = `adjective · ${w.group === 'oa' ? '-o/-a' : w.group}`;
    out.m = w.en;
    return out;
  }
  if(tok.w){
    const w = words[tok.w];
    if(!w) { err(`token ${i}: word "${tok.w}" missing from words.json`); return out; }
    const lemma = tok.w.split('#')[0];
    const expected = tok.n === 'p' ? (w.plural || pluralOf(lemma)) : lemma;
    if(w.pos === 'adj') err(`token ${i}: "${tok.w}" is an adjective, use "adj" not "w"`);
    if(low !== lc(expected) && !w.forms?.includes(low)) err(`token ${i}: "${text}" does not match "${expected}"`);
    out.items = [`w:${tok.w}`];
    out.info = w.pos + (w.gender ? ` · ${w.gender === 'm' ? 'el' : 'la'} ${lemma}` : '');
    out.m = w.en;
    return out;
  }
  err(`token ${i}: unknown token shape ${JSON.stringify(tok)}`);
  return out;
}

const built = [];
for(const ph of phrases){
  const errs = [], warns = [];
  const err = m => errs.push(m), warn = m => warns.push(m);
  if(!ph.id) err('missing id');
  if(seenIds.has(ph.id)) err(`duplicate id ${ph.id}`); seenIds.add(ph.id);
  if(seenEs.has(ph.es)) err(`duplicate Spanish text (also ${seenEs.get(ph.es)})`); seenEs.set(ph.es, ph.id);
  if(!ph.en || !ph.es) err('missing en or es');
  if(!ph.topic) err('missing topic');
  const joined = ph.tokens.map(t => typeof t === 'string' ? t : t.t).join(' ');
  if(joined !== ph.es) err(`tokens rejoin to "${joined}"`);
  if(/\?$/.test(ph.es) && !/¿/.test(ph.es)) err('question without opening ¿');
  if(/!$/.test(ph.es) && !/¡/.test(ph.es)) err('exclamation without opening ¡');
  const n = ph.tokens.length;
  if(n < 3 || n > 13) warn(`${n} words (aim for 4–12)`);
  const toks = ph.tokens.map((t, i) => analyseToken(t, ph, i, err));
  toks.forEach((t, i) => {
    if(!t.parts) return;
    const word = t.t.slice((t.pre || '').length, t.t.length - (t.post || '').length);
    if(t.parts.map(p => p[0]).join('') !== word) err(`token ${i}: colour parts don't spell "${word}"`);
  });
  const cons = (ph.constructions || []).map(c => {
    if(!constructions[c.c]) err(`construction "${c.c}" missing from constructions.json`);
    if(!c.tokens?.every(i => i >= 0 && i < n)) err(`construction ${c.c} has bad token range`);
    return { item: `c:${c.c}`, tokens: c.tokens };
  });
  const tenses = [...new Set(toks.filter(t => t.verb && t.verb.tense !== 'inf').map(t => t.verb.tense))];
  const persons = toks.filter(t => t.verb?.p).map(t => t.verb.p);
  const register = persons.includes('tu') ? 'tu' : (ph.register || (persons.includes('usted') ? 'usted/3rd' : 'none'));
  const status = errs.length ? 'error' : (ph.status || 'unreviewed');
  if(errs.length){ errorCount += errs.length; report.push(`ERROR ${ph.id}  ${ph.es}\n  - ${errs.join('\n  - ')}`); }
  if(warns.length){ warnCount += warns.length; report.push(`warn  ${ph.id}  ${ph.es}\n  - ${warns.join('\n  - ')}`); }
  built.push({ id: ph.id, topic: ph.topic, en: ph.en, es: ph.es, tenses, register, status,
               source: ph.source || 'generated', tokens: toks, constructions: cons });
}

// Words referenced in words.json but never used are fine; words used but missing are errors (above).
const verbs = {};
for(const inf of [...usedVerbs].sort()){
  const v = getVerb(inf);
  verbs[inf] = { en: v.en, cat: v.cat, stemChange: v.stemChange || null, table: table(inf) };
}
const library = {
  version: new Date().toISOString(),
  counts: { phrases: built.length, ok: built.filter(p => p.status !== 'error').length, verbs: Object.keys(verbs).length,
            words: Object.keys(words).length, constructions: Object.keys(constructions).length },
  verbs, words, constructions, patterns: AGREEMENT_PATTERNS, phrases: built,
};
mkdirSync(join(root, 'build'), { recursive: true });
writeFileSync(join(root, 'build', 'library.json'), JSON.stringify(library));

// Tense/topic summary
const tally = (key) => built.reduce((m, p) => { for(const k of [].concat(p[key])) m[k] = (m[k] || 0) + 1; return m; }, {});
const summary = [
  `Phrases: ${built.length} (${library.counts.ok} OK, ${built.length - library.counts.ok} with errors)`,
  `Errors: ${errorCount}   Warnings: ${warnCount}`,
  `Verbs used: ${library.counts.verbs}   Words: ${library.counts.words}   Constructions: ${library.counts.constructions}`,
  `By tense: ${JSON.stringify(tally('tenses'))}`,
  `By topic: ${JSON.stringify(tally('topic'))}`,
  `By register: ${JSON.stringify(tally('register'))}`,
];
writeFileSync(join(root, 'build', 'report.txt'), summary.join('\n') + '\n\n' + report.join('\n\n') + '\n');
console.log(summary.join('\n'));
if(report.length) console.log('\n' + report.join('\n\n'));
process.exit(errorCount ? 1 : 0);
