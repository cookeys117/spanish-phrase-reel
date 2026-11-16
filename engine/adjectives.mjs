// Adjective agreement and noun plurals.
// Groups (see plan, data format):
//   oa      cansado / cansada / cansados / cansadas
//   e       grande / grandes            (same for both genders)
//   cons    fácil / fáciles, feliz / felices   (same for both genders)
//   cons-a  español / española / españoles / españolas   (the trap: consonant but takes -a)
//   inv     naranja, rosa, gratis       (never changes)
// Shortened before a singular noun: bueno→buen, malo→mal, grande→gran, primero→primer…

const DEACCENT = { 'á':'a', 'é':'e', 'í':'i', 'ó':'o', 'ú':'u' };
function deaccentLast(w){
  // remove the written accent from the last syllable (alemán → aleman-, reunión → reunion-)
  return w.replace(/([áéíóú])([^aeiouáéíóú]*)$/, (m, v, rest) => DEACCENT[v] + rest);
}

export function pluralOf(w){
  if(/[aeiouáéó]$/.test(w)) return w + 's';
  if(/z$/.test(w)) return w.slice(0, -1) + 'ces';
  if(/[áéíóú][ns]$/.test(w)) return deaccentLast(w) + 'es';
  if(/[íú]$/.test(w)) return w + 'es';
  return w + 'es';
}

export const SHORT_FORMS = {
  bueno:'buen', malo:'mal', grande:'gran', primero:'primer', tercero:'tercer', alguno:'algún', ninguno:'ningún',
};

/** Expected form for an adjective lemma. g: m|f, n: s|p, short: boolean */
export function adjForm(lemma, group, g = 'm', n = 's', short = false){
  if(short){
    if(!SHORT_FORMS[lemma]) throw new Error(`No shortened form for ${lemma}`);
    if(lemma === 'grande') return 'gran';            // gran works for both genders
    if(g === 'm' && n === 's') return SHORT_FORMS[lemma];
    throw new Error(`Shortened form only exists for masculine singular (${lemma})`);
  }
  switch(group){
    case 'oa': {
      const b = lemma.slice(0, -1);
      return { ms: lemma, fs: b + 'a', mp: b + 'os', fp: b + 'as' }[g + n];
    }
    case 'e': case 'cons': return n === 's' ? lemma : pluralOf(lemma);
    case 'cons-a': {
      if(g === 'm') return n === 's' ? lemma : pluralOf(lemma);
      return deaccentLast(lemma) + (n === 's' ? 'a' : 'as');
    }
    case 'inv': return lemma;
    default: throw new Error(`Unknown adjective group ${group}`);
  }
}

/** Coloured parts + pattern items for an adjective token. */
export function adjAnalysis(lemma, group, g = 'm', n = 's', short = false){
  const form = adjForm(lemma, group, g, n, short);
  const items = [];
  let parts;
  if(short){
    parts = [[form, 'irr']];
    items.push('ap:short');
  } else if(group === 'oa' && !(g === 'm' && n === 's')){
    const end = { fs:'a', mp:'os', fp:'as' }[g + n];
    parts = [[form.slice(0, -end.length), ''], [end, 'reg']];
  } else if((group === 'e' || group === 'cons') && n === 'p'){
    const end = form.endsWith('es') && !lemma.endsWith('e') ? (lemma.endsWith('z') ? 'ces' : 'es') : 's';
    parts = [[form.slice(0, -end.length), ''], [end, lemma.endsWith('z') ? 'irr' : 'reg']];
  } else if(group === 'cons-a' && g === 'f'){
    const end = n === 's' ? 'a' : 'as';
    parts = [[form.slice(0, -end.length), ''], [end, 'irr']];
    items.push('ap:cons-a');
  } else if(group === 'cons-a' && n === 'p'){
    parts = [[form.slice(0, -2), ''], ['es', 'reg']];
  } else if(group === 'inv' && (g === 'f' || n === 'p')){
    parts = [[form, 'irr']];
    items.push('ap:inv');
  } else {
    parts = [[form, '']];
  }
  return { form, parts: parts.filter(p => p[0]), items };
}

export const AGREEMENT_PATTERNS = {
  'ap:cons-a': 'Consonant-ending nationality and -or adjectives DO take -a (española, trabajadora)',
  'ap:short': 'Shortened before a noun: gran, buen, mal, primer, tercer, algún, ningún',
  'ap:inv': 'Colours named after things never change (naranja, rosa) — nor does gratis',
};
