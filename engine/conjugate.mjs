// Spanish conjugation engine for the Phrase Reel app.
// Ported from spanish_srs.jsx (verified there against 92 unit tests / 100 verbs / 3400 forms),
// extended with: more everyday verbs, regular-form comparison, stem/ending/irregular
// segmentation (drives the blue/orange colouring) and item-ID classification.
// Works in the browser and in Node (plain ES module, no dependencies).

export const TENSES = ['pres', 'pret', 'impf', 'fut', 'cond', 'subj'];
export const TENSE_LABEL = {
  pres: 'now', pret: 'did', impf: 'used to', fut: 'will', cond: 'would', subj: 'que… (subj.)',
};
// Person keys used in item IDs. 'usted' covers él / ella / usted; 'ellos' covers ellos / ellas / ustedes.
export const PERSONS = ['yo', 'tu', 'usted', 'nosotros', 'ellos'];
export const PERSON_LABEL = {
  yo: 'yo', tu: 'tú', usted: 'él / ella / usted', nosotros: 'nosotros', ellos: 'ellos / ustedes', vos: 'vos',
};
const PERSON_IDX = { yo: 0, tu: 1, usted: 2, nosotros: 3, ellos: 5 };

const VOWEL_ENDINGS = {
  ar: { pres: ['o','as','a','amos','áis','an'], pret: ['é','aste','ó','amos','asteis','aron'],
        impf: ['aba','abas','aba','ábamos','abais','aban'], fut: ['é','ás','á','emos','éis','án'],
        cond: ['ía','ías','ía','íamos','íais','ían'], subj: ['e','es','e','emos','éis','en'] },
  er: { pres: ['o','es','e','emos','éis','en'], pret: ['í','iste','ió','imos','isteis','ieron'],
        impf: ['ía','ías','ía','íamos','íais','ían'], fut: ['é','ás','á','emos','éis','án'],
        cond: ['ía','ías','ía','íamos','íais','ían'], subj: ['a','as','a','amos','áis','an'] },
  ir: { pres: ['o','es','e','imos','ís','en'], pret: ['í','iste','ió','imos','isteis','ieron'],
        impf: ['ía','ías','ía','íamos','íais','ían'], fut: ['é','ás','á','emos','éis','án'],
        cond: ['ía','ías','ía','íamos','íais','ían'], subj: ['a','as','a','amos','áis','an'] },
};
const stemOf = inf => inf.slice(0, -2);
const endingOf = inf => inf.slice(-2);
function swapLast(s, from, to){ const i = s.lastIndexOf(from); return i === -1 ? s : s.slice(0,i)+to+s.slice(i+from.length); }
function applyStemChange(st, type, formIdx, tenseKey, verbEnding){
  const map = { 'e-ie':['e','ie'], 'o-ue':['o','ue'], 'e-i':['e','i'], 'u-ue':['u','ue'] };
  const [from, to] = map[type];
  if(tenseKey === 'pres') return [0,1,2,5].includes(formIdx) ? swapLast(st, from, to) : st;
  if(tenseKey === 'subj'){
    if(verbEnding === 'ir'){
      if(type === 'e-i') return swapLast(st, from, to);
      if([0,1,2,5].includes(formIdx)) return swapLast(st, from, to);
      if([3,4].includes(formIdx)) return swapLast(st, from, type === 'e-ie' ? 'i' : 'u');
    } else {
      return [0,1,2,5].includes(formIdx) ? swapLast(st, from, to) : st;
    }
  }
  return st;
}
function toBackVowelSafe(s, spelling){
  if(spelling === 'guir') return s.replace(/gu$/, 'g');
  if(spelling === 'ger-gir') return s.replace(/g$/, 'j');
  return s;
}
const YO_PRES_IRREG = {
  tener:'tengo', poner:'pongo', salir:'salgo', valer:'valgo', venir:'vengo',
  hacer:'hago', decir:'digo', traer:'traigo',
  conocer:'conozco', conducir:'conduzco', producir:'produzco', traducir:'traduzco', parecer:'parezco',
  ver:'veo', saber:'sé', dar:'doy',
};
const IRREG_SUBJ = {
  dar: ['dé','des','dé','demos','deis','den'],
  estar: ['esté','estés','esté','estemos','estéis','estén'],
  ir: ['vaya','vayas','vaya','vayamos','vayáis','vayan'],
  saber: ['sepa','sepas','sepa','sepamos','sepáis','sepan'],
  ser: ['sea','seas','sea','seamos','seáis','sean'],
  haber: ['haya','hayas','haya','hayamos','hayáis','hayan'],
};
const IRREGULAR_FULL = {
  ser:{pres:['soy','eres','es','somos','sois','son'],pret:['fui','fuiste','fue','fuimos','fuisteis','fueron'],impf:['era','eras','era','éramos','erais','eran'],fut:['seré','serás','será','seremos','seréis','serán'],cond:['sería','serías','sería','seríamos','seríais','serían']},
  estar:{pres:['estoy','estás','está','estamos','estáis','están'],pret:['estuve','estuviste','estuvo','estuvimos','estuvisteis','estuvieron'],impf:['estaba','estabas','estaba','estábamos','estabais','estaban'],fut:['estaré','estarás','estará','estaremos','estaréis','estarán'],cond:['estaría','estarías','estaría','estaríamos','estaríais','estarían']},
  ir:{pres:['voy','vas','va','vamos','vais','van'],pret:['fui','fuiste','fue','fuimos','fuisteis','fueron'],impf:['iba','ibas','iba','íbamos','ibais','iban'],fut:['iré','irás','irá','iremos','iréis','irán'],cond:['iría','irías','iría','iríamos','iríais','irían']},
  haber:{pres:['he','has','ha','hemos','habéis','han'],pret:['hube','hubiste','hubo','hubimos','hubisteis','hubieron'],impf:['había','habías','había','habíamos','habíais','habían'],fut:['habré','habrás','habrá','habremos','habréis','habrán'],cond:['habría','habrías','habría','habríamos','habríais','habrían']},
  dar:{pres:['doy','das','da','damos','dais','dan'],pret:['di','diste','dio','dimos','disteis','dieron'],impf:['daba','dabas','daba','dábamos','dabais','daban'],fut:['daré','darás','dará','daremos','daréis','darán'],cond:['daría','darías','daría','daríamos','daríais','darían']},
  ver:{pres:['veo','ves','ve','vemos','veis','ven'],pret:['vi','viste','vio','vimos','visteis','vieron'],impf:['veía','veías','veía','veíamos','veíais','veían'],fut:['veré','verás','verá','veremos','veréis','verán'],cond:['vería','verías','vería','veríamos','veríais','verían']},
};
const IRREG_PRETERITE_STEM = {
  tener:'tuv', estar:'estuv', andar:'anduv', poder:'pud', poner:'pus', saber:'sup',
  querer:'quis', venir:'vin', hacer:'hic', decir:'dij', traer:'traj',
  conducir:'conduj', producir:'produj', traducir:'traduj',
};
const J_STEM_PRET = new Set(['decir','traer','conducir','producir','traducir']);
function irregularPreteriteForms(inf, root){
  const j = J_STEM_PRET.has(inf);
  const forms = ['e','iste','o','imos','isteis', j ? 'eron' : 'ieron'].map(e => root+e);
  if(inf === 'hacer') forms[2] = 'hizo';
  return forms;
}
const IRREG_FUT_STEM = {
  tener:'tendr', poner:'pondr', salir:'saldr', venir:'vendr', poder:'podr',
  querer:'querr', saber:'sabr', haber:'habr', hacer:'har', decir:'dir', valer:'valdr',
};

function conjugateIdx(verb, tense, personIdx){
  const inf = verb.inf;
  if(IRREGULAR_FULL[inf] && tense !== 'subj') return IRREGULAR_FULL[inf][tense][personIdx];
  const end = endingOf(inf);
  let root = stemOf(inf);
  const table = VOWEL_ENDINGS[end];

  if(tense === 'pres'){
    if(verb.stemChange) root = applyStemChange(root, verb.stemChange, personIdx, 'pres', end);
    let localRoot = root;
    if(personIdx === 0 && YO_PRES_IRREG[inf]) return YO_PRES_IRREG[inf];
    if(verb.spelling === 'cer-cir-zc' && personIdx === 0) return root + 'zco';
    if(verb.spelling === 'uir-y' && [0,1,2,5].includes(personIdx)) return root + 'y' + table.pres[personIdx];
    if(personIdx === 0 && (verb.spelling === 'guir' || verb.spelling === 'ger-gir')) localRoot = toBackVowelSafe(localRoot, verb.spelling);
    return localRoot + table.pres[personIdx];
  }
  if(tense === 'pret'){
    if(IRREG_PRETERITE_STEM[inf]) return irregularPreteriteForms(inf, IRREG_PRETERITE_STEM[inf])[personIdx];
    let localRoot = root;
    if(end === 'ir' && verb.stemChange && [2,5].includes(personIdx)){
      if(verb.stemChange === 'e-ie' || verb.stemChange === 'e-i') localRoot = swapLast(root, 'e', 'i');
      if(verb.stemChange === 'o-ue') localRoot = swapLast(root, 'o', 'u');
    }
    if(personIdx === 0){
      if(verb.spelling === 'car') localRoot = localRoot.replace(/c$/, 'qu');
      if(verb.spelling === 'gar') localRoot = localRoot.replace(/g$/, 'gu');
      if(verb.spelling === 'zar') localRoot = localRoot.replace(/z$/, 'c');
    }
    if(verb.spelling === 'uir-y' && [2,5].includes(personIdx)) return localRoot + table.pret[personIdx].replace(/^i/, 'y');
    return localRoot + table.pret[personIdx];
  }
  if(tense === 'impf') return root + table.impf[personIdx];
  if(tense === 'fut'){ const base = IRREG_FUT_STEM[inf] || inf; return base + table.fut[personIdx]; }
  if(tense === 'cond'){ const base = IRREG_FUT_STEM[inf] || inf; return base + table.cond[personIdx]; }
  if(tense === 'subj'){
    if(IRREG_SUBJ[inf]) return IRREG_SUBJ[inf][personIdx];
    const isBoot = [0,1,2,5].includes(personIdx);
    const deepIr = end === 'ir' && verb.stemChange;
    let consonantStem = null;
    if(YO_PRES_IRREG[inf]) consonantStem = YO_PRES_IRREG[inf].slice(0, -1);
    else if(verb.spelling === 'cer-cir-zc') consonantStem = root + 'zc';
    else if(verb.spelling === 'uir-y') consonantStem = root + 'y';
    if(consonantStem) return consonantStem + table.subj[personIdx];
    if(end === 'ar' && ['car','gar','zar'].includes(verb.spelling)){
      let base = verb.stemChange ? applyStemChange(root, verb.stemChange, personIdx, 'pres', end) : root;
      if(verb.spelling === 'car') base = base.replace(/c$/, 'qu');
      if(verb.spelling === 'gar') base = base.replace(/g$/, 'gu');
      if(verb.spelling === 'zar') base = base.replace(/z$/, 'c');
      return base + table.subj[personIdx];
    }
    if(verb.stemChange){
      let s;
      if(deepIr){
        if(verb.stemChange === 'e-i') s = applyStemChange(root, verb.stemChange, personIdx, 'subj', end);
        else if(isBoot) s = applyStemChange(root, verb.stemChange, personIdx, 'pres', end);
        else s = applyStemChange(root, verb.stemChange, personIdx, 'subj', end);
      } else {
        s = isBoot ? applyStemChange(root, verb.stemChange, personIdx, 'pres', end) : root;
      }
      s = toBackVowelSafe(s, verb.spelling);
      return s + table.subj[personIdx];
    }
    return toBackVowelSafe(root, verb.spelling) + table.subj[personIdx];   // escoger → escoja, dirigir → dirija
  }
  throw new Error(`Unknown tense ${tense}`);
}

/* ---------------------------------------------------------------------
   VERB LIST: the original 99 from spanish_srs.jsx plus everyday additions
   (marked "added"). cat: regular | stem-change | spelling-change | irregular
   --------------------------------------------------------------------- */
export const VERBS = [
  // regular -ar
  ['hablar','to speak'],['trabajar','to work'],['estudiar','to study'],['caminar','to walk'],
  ['mirar','to look at'],['escuchar','to listen to'],['comprar','to buy'],['llamar','to call'],
  ['necesitar','to need'],['ayudar','to help'],['preguntar','to ask'],['tomar','to take / drink'],
  ['llevar','to carry / take'],['dejar','to leave / let'],['ganar','to win / earn'],['olvidar','to forget'],
  ['terminar','to finish'],
  // regular -er / -ir
  ['comer','to eat'],['beber','to drink'],['aprender','to learn'],['comprender','to comprehend'],
  ['vender','to sell'],['deber','to owe / should'],['correr','to run'],['meter','to put in'],
  ['vivir','to live'],['escribir','to write'],['decidir','to decide'],['permitir','to allow'],
  ['recibir','to receive'],['describir','to describe'],['subir','to go up'],['discutir','to argue / discuss'],
  ['abrir','to open'],
  // added regulars (everyday Colombian life)
  ['arreglar','to fix'],['cambiar','to change'],['limpiar','to clean'],['revisar','to check / inspect'],
  ['cobrar','to charge'],['reservar','to book'],['alquilar','to rent'],['mandar','to send'],
  ['esperar','to wait / hope'],['entrar','to go in'],['gastar','to spend'],['ahorrar','to save (money)'],
  ['cocinar','to cook'],['pintar','to paint'],['instalar','to install'],['funcionar','to work (function)'],
  ['dañar','to damage / break'],['quedar','to stay / be located'],['gustar','to please (like)'],['faltar','to be missing'],
  ['regalar','to give (as a gift)'],['invitar','to invite'],['visitar','to visit'],['cancelar','to cancel / pay off'],
  ['preparar','to prepare'],['usar','to use'],['bajar','to go down'],['desayunar','to have breakfast'],
  ['manejar','to drive'],['parquear','to park'],['demorar','to take (time)'],['tardar','to take long'],
  ['contestar','to answer'],['levantar','to lift / get up'],['firmar','to sign'],['quejar','to complain'],
  ['molestar','to bother'],['cenar','to have dinner'],['bailar','to dance'],['viajar','to travel'],
  ['cuidar','to look after'],['lavar','to wash'],['echar','to throw / put'],['romper','to break'],
  ['responder','to reply'],['ocurrir','to happen'],['compartir','to share'],['asistir','to attend'],
  ['enfermar','to make ill (enfermarse = to get ill)'],['cubrir','to cover'],
  ['descansar','to rest'],['pasar','to pass / go through'],['prestar','to lend'],['parar','to stop'],
  ['encantar','to delight (me encanta = I love)'],['celebrar','to celebrate'],
  ['dudar','to doubt'],['mejorar','to improve (mejorarse = to get better)'],['avisar','to let (someone) know'],
  ['acompañar','to go with / keep company'],['llenar','to fill / fill in'],['casar','to marry (casarse = to get married)'],
  ['regresar','to come back'],['cumplir','to fulfil / turn (an age)'],['prender','to turn on (Colombian)'],
].map(([inf, en]) => ({ inf, en, cat: 'regular' })).concat([
  // stem-changers
  {inf:'pensar',en:'to think',stemChange:'e-ie'},{inf:'cerrar',en:'to close',stemChange:'e-ie'},
  {inf:'entender',en:'to understand',stemChange:'e-ie'},{inf:'perder',en:'to lose',stemChange:'e-ie'},
  {inf:'sentar',en:'to seat',stemChange:'e-ie'},{inf:'despertar',en:'to wake (someone)',stemChange:'e-ie'},
  {inf:'recomendar',en:'to recommend',stemChange:'e-ie'},
  {inf:'querer',en:'to want / love',stemChange:'e-ie',irregPret:'quis',irregFut:'querr',cat:'irregular'},
  {inf:'sentir',en:'to feel',stemChange:'e-ie'},{inf:'preferir',en:'to prefer',stemChange:'e-ie'},
  {inf:'mentir',en:'to lie',stemChange:'e-ie'},{inf:'divertir',en:'to amuse',stemChange:'e-ie'},
  {inf:'sugerir',en:'to suggest',stemChange:'e-ie'},
  {inf:'atender',en:'to attend to / serve',stemChange:'e-ie'},{inf:'calentar',en:'to heat up',stemChange:'e-ie'},
  {inf:'contar',en:'to count / tell',stemChange:'o-ue'},{inf:'encontrar',en:'to find',stemChange:'o-ue'},
  {inf:'recordar',en:'to remember',stemChange:'o-ue'},{inf:'mostrar',en:'to show',stemChange:'o-ue'},
  {inf:'costar',en:'to cost',stemChange:'o-ue'},{inf:'volver',en:'to return',stemChange:'o-ue'},
  {inf:'poder',en:'to be able to',stemChange:'o-ue',irregPret:'pud',irregFut:'podr',cat:'irregular'},
  {inf:'dormir',en:'to sleep',stemChange:'o-ue'},{inf:'morir',en:'to die',stemChange:'o-ue'},
  {inf:'doler',en:'to hurt',stemChange:'o-ue'},{inf:'acostar',en:'to put to bed / lie down',stemChange:'o-ue'},
  {inf:'probar',en:'to try / taste',stemChange:'o-ue'},{inf:'devolver',en:'to give back',stemChange:'o-ue'},
  {inf:'almorzar',en:'to have lunch',stemChange:'o-ue',spelling:'zar'},
  {inf:'llover',en:'to rain',stemChange:'o-ue'},{inf:'mover',en:'to move',stemChange:'o-ue'},
  {inf:'pedir',en:'to ask for / order',stemChange:'e-i'},{inf:'servir',en:'to serve / work (be useful)',stemChange:'e-i'},
  {inf:'repetir',en:'to repeat',stemChange:'e-i'},{inf:'medir',en:'to measure / try on',stemChange:'e-i'},{inf:'vestir',en:'to dress',stemChange:'e-i'},
  {inf:'seguir',en:'to follow / continue',stemChange:'e-i',spelling:'guir'},
  {inf:'conseguir',en:'to get / manage to',stemChange:'e-i',spelling:'guir'},
  {inf:'empezar',en:'to begin',stemChange:'e-ie',spelling:'zar'},
  {inf:'negar',en:'to deny',stemChange:'e-ie',spelling:'gar'},
  {inf:'jugar',en:'to play (game / sport)',stemChange:'u-ue',spelling:'gar'},
  {inf:'corregir',en:'to correct',stemChange:'e-i',spelling:'ger-gir'},
  {inf:'elegir',en:'to choose / elect',stemChange:'e-i',spelling:'ger-gir'},
].map(v => ({ cat: 'stem-change', ...v }))).concat([
  // spelling-changers
  {inf:'buscar',en:'to look for',spelling:'car'},{inf:'tocar',en:'to touch / play (instrument)',spelling:'car'},
  {inf:'sacar',en:'to take out',spelling:'car'},{inf:'practicar',en:'to practise',spelling:'car'},
  {inf:'explicar',en:'to explain',spelling:'car'},{inf:'marcar',en:'to dial / mark',spelling:'car'},
  {inf:'pagar',en:'to pay',spelling:'gar'},{inf:'llegar',en:'to arrive',spelling:'gar'},
  {inf:'entregar',en:'to deliver / hand in',spelling:'gar'},
  {inf:'apagar',en:'to turn off',spelling:'gar'},{inf:'alcanzar',en:'to reach / have time to',spelling:'zar'},
  {inf:'recoger',en:'to pick up / collect',spelling:'ger-gir'},
  {inf:'conocer',en:'to know (people / places)',spelling:'cer-cir-zc'},
  {inf:'conducir',en:'to drive',spelling:'cer-cir-zc',irregPret:'conduj'},
  {inf:'producir',en:'to produce',spelling:'cer-cir-zc',irregPret:'produj'},
  {inf:'traducir',en:'to translate',spelling:'cer-cir-zc',irregPret:'traduj'},
  {inf:'parecer',en:'to seem',spelling:'cer-cir-zc'},
  {inf:'construir',en:'to build',spelling:'uir-y'},{inf:'destruir',en:'to destroy',spelling:'uir-y'},
  {inf:'incluir',en:'to include',spelling:'uir-y'},
  {inf:'escoger',en:'to choose',spelling:'ger-gir'},{inf:'proteger',en:'to protect',spelling:'ger-gir'},
  {inf:'dirigir',en:'to direct / manage',spelling:'ger-gir'},
].map(v => ({ cat: 'spelling-change', ...v }))).concat([
  // irregulars
  {inf:'tener',en:'to have',stemChange:'e-ie'},{inf:'poner',en:'to put'},{inf:'salir',en:'to leave / go out'},
  {inf:'valer',en:'to be worth'},{inf:'venir',en:'to come',stemChange:'e-ie'},{inf:'hacer',en:'to do / make'},
  {inf:'decir',en:'to say / tell',stemChange:'e-i'},{inf:'traer',en:'to bring'},
  {inf:'ser',en:'to be (essence)'},{inf:'estar',en:'to be (state / location)'},{inf:'ir',en:'to go'},
  {inf:'dar',en:'to give'},{inf:'ver',en:'to see'},{inf:'saber',en:'to know (facts)'},
  {inf:'andar',en:'to walk / go around',irregPret:'anduv'},{inf:'haber',en:'there is / to have (auxiliary)'},
].map(v => ({ cat: 'irregular', ...v })));

export const VERB_BY_INF = Object.fromEntries(VERBS.map(v => [v.inf, v]));
for(const v of VERBS){
  if(v.irregPret) IRREG_PRETERITE_STEM[v.inf] = v.irregPret;
  if(v.irregFut) IRREG_FUT_STEM[v.inf] = v.irregFut;
}

export function getVerb(inf){
  const v = VERB_BY_INF[inf];
  if(!v) throw new Error(`Verb not in engine: ${inf}`);
  return v;
}

/** The real conjugated form. person: yo | tu | usted | nosotros | ellos */
export function conjugate(inf, tense, person){
  const v = getVerb(inf);
  if(!(person in PERSON_IDX)) throw new Error(`Unknown person ${person}`);
  return conjugateIdx(v, tense, PERSON_IDX[person]);
}

/** What the form WOULD be if the verb were completely regular. */
export function regularForm(inf, tense, person){
  const end = endingOf(inf);
  const idx = PERSON_IDX[person];
  if(tense === 'fut' || tense === 'cond') return inf + VOWEL_ENDINGS[end][tense][idx];
  return stemOf(inf) + VOWEL_ENDINGS[end][tense][idx];
}
function regularEnding(inf, tense, person){
  return VOWEL_ENDINGS[endingOf(inf)][tense][PERSON_IDX[person]];
}

/** Form with ONLY the verb's stem change applied (no other irregularity). */
function stemChangeOnlyForm(v, tense, person){
  if(!v.stemChange) return null;
  const end = endingOf(v.inf), idx = PERSON_IDX[person];
  const root = stemOf(v.inf);
  let s = root;
  if(tense === 'pres') s = applyStemChange(root, v.stemChange, idx, 'pres', end);
  else if(tense === 'subj'){
    const deepIr = end === 'ir';
    if(deepIr && v.stemChange === 'e-i') s = applyStemChange(root, v.stemChange, idx, 'subj', end);
    else if([0,1,2,5].includes(idx)) s = applyStemChange(root, v.stemChange, idx, 'pres', end);
    else if(deepIr) s = applyStemChange(root, v.stemChange, idx, 'subj', end);
  } else if(tense === 'pret' && end === 'ir' && [2,5].includes(idx)){
    if(v.stemChange === 'e-ie' || v.stemChange === 'e-i') s = swapLast(root, 'e', 'i');
    if(v.stemChange === 'o-ue') s = swapLast(root, 'o', 'u');
  } else return null;
  return s + VOWEL_ENDINGS[end][tense][idx];
}

/**
 * Split a conjugated form into coloured parts:
 *   ['', plain] , ['reg' = regular ending, blue] , ['irr' = irregular part, orange]
 * Method: compare with the fully regular form; the shared beginning is plain,
 * the part that differs is irregular, and a shared regular ending is blue.
 */
/** True when this cell comes from a genuinely irregular source (not just a stem or spelling change). */
function fromIrregularSource(inf, tense, idx){
  if(IRREGULAR_FULL[inf] && tense !== 'subj') return true;
  // c -> zc (conozco, conozca) is taught as a spelling change, so it's blue, not red
  if(getVerb(inf).spelling === 'cer-cir-zc' && (tense === 'subj' || (tense === 'pres' && idx === 0))) return false;
  if(tense === 'subj' && (IRREG_SUBJ[inf] || YO_PRES_IRREG[inf])) return true;
  if(tense === 'pres' && idx === 0 && YO_PRES_IRREG[inf]) return true;
  if(tense === 'pret' && IRREG_PRETERITE_STEM[inf]) return true;
  if((tense === 'fut' || tense === 'cond') && IRREG_FUT_STEM[inf]) return true;
  return false;
}

/**
 * Colour classes: 'reg' = regular ending (green), 'stem' = stem or spelling change (blue),
 * 'irr' = truly irregular part (red), '' = plain.
 */
export function segment(inf, tense, person){
  const form = conjugate(inf, tense, person);
  const reg = regularForm(inf, tense, person);
  const end = regularEnding(inf, tense, person);
  if(form === reg){
    return [[form.slice(0, form.length - end.length), ''], [end, 'reg']].filter(p => p[0]);
  }
  // Pure stem change: highlight the whole changed vowel group (p-ie-nsa, d-ue-le, p-i-do).
  const v = getVerb(inf);
  if(form.endsWith(end) && stemChangeOnlyForm(v, tense, person) === form){
    const newRoot = form.slice(0, form.length - end.length), oldRoot = stemOf(inf);
    const fromVowel = v.stemChange.split('-')[0];           // e | o | u
    const i = oldRoot.lastIndexOf(fromVowel);               // the vowel that changes
    const len = newRoot.length - oldRoot.length + 1;        // ie/ue = 2, i/u = 1
    return [[newRoot.slice(0, i), ''], [newRoot.slice(i, i + len), 'stem'], [newRoot.slice(i + len), ''], [end, 'reg']]
      .filter(x => x[0]);
  }
  let p = 0;
  while(p < form.length && p < reg.length && form[p] === reg[p]) p++;
  let s = 0;
  while(s < form.length - p && s < reg.length - p && form[form.length-1-s] === reg[reg.length-1-s]) s++;
  const parts = [];
  if(p) parts.push([form.slice(0, p), '']);
  parts.push([form.slice(p, form.length - s), fromIrregularSource(inf, tense, PERSON_IDX[person]) ? 'irr' : 'stem']);
  if(s){
    const suffix = form.slice(form.length - s);
    if(s >= end.length){
      if(s > end.length) parts.push([suffix.slice(0, s - end.length), '']);
      parts.push([end, 'reg']);
    } else parts.push([suffix, '']);
  }
  return parts.filter(x => x[0]);
}

/**
 * Item IDs a verb token carries (see plan: data format).
 *   regular cell      -> pattern item  vp:<ar|er|ir>|<tense>|<person>
 *   stem change only  -> vs:<inf>|<change>  +  the pattern item
 *   anything else     -> vc:<inf>|<tense>|<person>  (irregular cell)
 * plus always the verb's meaning item  w:<inf>
 */
export function classify(inf, tense, person){
  const v = getVerb(inf);
  const form = conjugate(inf, tense, person);
  const pattern = `vp:${endingOf(inf)}|${tense}|${person}`;
  let kind, formItems;
  if(form === regularForm(inf, tense, person)){ kind = 'regular'; formItems = [pattern]; }
  else if(stemChangeOnlyForm(v, tense, person) === form){ kind = 'stem'; formItems = [`vs:${inf}|${v.stemChange}`, pattern]; }
  else { kind = 'irregular'; formItems = [`vc:${inf}|${tense}|${person}`]; }
  return { form, kind, formItems, meaningItem: `w:${inf}` };
}

/** Full table for the long-press panel: { tense: { person: {form, parts, kind} } } */
export function table(inf){
  const out = {};
  for(const t of TENSES){
    out[t] = {};
    for(const p of PERSONS){
      const c = classify(inf, t, p);
      out[t][p] = { form: c.form, parts: segment(inf, t, p), kind: c.kind };
    }
  }
  return out;
}
