// Readers for the plain-text content files (easier to write and review than JSON).
//
// content/words.txt          key | pos | english | gender (nouns: m/f) or group (adjectives) | note
//                            key = lemma#meaning, e.g.  banco#bank   banco#bench   por_favor#please
//                            nouns may add  plural=exámenes  in the note column for odd plurals
// content/constructions.txt  id | spanish pattern | english
// content/phrases/*.txt      a "# topic: name" line sets the topic for the phrases below it.
//                            Each phrase is two lines:
//                              p0001 | English sentence
//                                tok tok:code tok:code ...  [+c:construction@start-end ...]
//                            token codes:  w:key  w:key.p (plural)  v:inf.tense.person  i:inf
//                                          a:key.g.n  a:key.g.n.short   ( _ inside a token = space )
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const rows = file => readFileSync(file, 'utf8').split(/\r?\n/)
  .map(l => l.replace(/\s+$/, '')).filter(l => l.trim() && !l.trim().startsWith('//'));
const unscore = s => s.replace(/_/g, ' ');

export function readWords(dir){
  const out = {};
  for(const l of rows(join(dir, 'words.txt'))){
    if(l.startsWith('#')) continue;
    const [key, pos, en, extra = '', note = ''] = l.split('|').map(s => s.trim());
    const k = unscore(key);
    if(out[k]) throw new Error(`words.txt: duplicate ${k}`);
    const w = { pos, en };
    if(pos === 'noun' && extra) w.gender = extra;
    if(pos === 'adj') w.group = extra;
    const pl = note.match(/plural=(\S+)/);
    if(pl) w.plural = pl[1];
    const n = note.replace(/plural=\S+/, '').trim();
    if(n) w.note = n;
    out[k] = w;
  }
  return out;
}

export function readConstructions(dir){
  const out = {};
  for(const l of rows(join(dir, 'constructions.txt'))){
    if(l.startsWith('#')) continue;
    const [id, es, en] = l.split('|').map(s => s.trim());
    out[id] = { es, en };
  }
  return out;
}

function parseToken(raw){
  const i = raw.indexOf(':');
  if(i === -1) return unscore(raw);
  const t = unscore(raw.slice(0, i)), code = raw.slice(i + 1);
  const [kind, rest] = [code[0], code.slice(2)];
  if(code[1] !== ':') throw new Error(`bad token code ${raw}`);
  if(kind === 'w'){ const [key, n] = rest.split('.'); return n ? { t, w: unscore(key), n } : { t, w: unscore(key) }; }
  if(kind === 'v'){ const [v, tense, p] = rest.split('.'); return { t, v, tense, p }; }
  if(kind === 'i') return { t, inf: rest };
  if(kind === 'a'){ const [key, g, n, s] = rest.split('.'); return { t, adj: unscore(key), g, n, ...(s === 'short' ? { short: true } : {}) }; }
  throw new Error(`unknown token kind in ${raw}`);
}

export function readPhrases(dir){
  const pdir = join(dir, 'phrases');
  const out = [];
  for(const f of readdirSync(pdir).filter(f => f.endsWith('.txt')).sort()){
    let topic = null, pending = null;
    for(const l of rows(join(pdir, f))){
      const tm = l.match(/^#\s*topic:\s*(\S+)/);
      if(tm){ topic = tm[1]; continue; }
      if(l.startsWith('#')) continue;
      if(/^p\d+\s*\|/.test(l.trim())){
        const [id, en, ...opts] = l.split('|').map(s => s.trim());
        pending = { id, topic, en, file: f };
        for(const o of opts){ const [k, v] = o.split('='); if(k === 'addr') pending.addr = v; }   // e.g.  | addr=tu
        continue;
      }
      if(!pending) throw new Error(`${f}: token line without a phrase header: ${l}`);
      const parts = l.trim().split(/\s+/);
      const cons = [], toks = [];
      for(const p of parts){
        if(p.startsWith('+c:')){
          const [c, range] = p.slice(3).split('@');
          const [a, b] = range.split('-').map(Number);
          cons.push({ c, tokens: Array.from({ length: (b ?? a) - a + 1 }, (_, k) => a + k) });
        } else toks.push(parseToken(p));
      }
      pending.tokens = toks;
      pending.es = toks.map(t => typeof t === 'string' ? t : t.t).join(' ');
      if(cons.length) pending.constructions = cons;
      out.push(pending);
      pending = null;
    }
  }
  return out;
}
