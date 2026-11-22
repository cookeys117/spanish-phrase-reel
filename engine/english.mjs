// English renderings of Spanish verb forms, for the quiz ("tuvimos" = "we had").
// Each verb has one English gloss: [base, past]. 3rd-person -s and "used to / will / would" are built by rule.

const E = {
  hablar:['speak','spoke'], trabajar:['work'], estudiar:['study'], caminar:['walk'], mirar:['look at'], escuchar:['listen to'],
  comprar:['buy','bought'], llamar:['call'], necesitar:['need'], ayudar:['help'], preguntar:['ask'], tomar:['take','took'],
  llevar:['carry'], dejar:['leave','left'], ganar:['earn'], olvidar:['forget','forgot'], terminar:['finish'],
  comer:['eat','ate'], beber:['drink','drank'], aprender:['learn'], comprender:['comprehend'], vender:['sell','sold'],
  deber:['owe'], correr:['run','ran'], meter:['put in','put in'], vivir:['live'], escribir:['write','wrote'],
  decidir:['decide'], permitir:['allow'], recibir:['receive'], describir:['describe'], subir:['go up','went up'],
  discutir:['argue'], abrir:['open'], arreglar:['fix'], cambiar:['change'], limpiar:['clean'], revisar:['check'],
  cobrar:['charge'], reservar:['book'], alquilar:['rent'], mandar:['send','sent'], esperar:['wait'], entrar:['go in','went in'],
  gastar:['spend','spent'], ahorrar:['save'], cocinar:['cook'], pintar:['paint'], instalar:['install'], funcionar:['work'],
  dañar:['damage'], quedar:['stay'], gustar:['please'], faltar:['be missing'], regalar:['give as a gift','gave as a gift'],
  invitar:['invite'], visitar:['visit'], cancelar:['cancel','cancelled'], preparar:['prepare'], usar:['use'], bajar:['go down','went down'],
  desayunar:['have breakfast','had breakfast'], manejar:['drive','drove'], parquear:['park'], demorar:['take long','took long'],
  tardar:['take long','took long'], contestar:['answer'], levantar:['lift'], firmar:['sign'], quejar:['complain'], molestar:['bother'],
  cenar:['have dinner','had dinner'], bailar:['dance'], viajar:['travel','travelled'], cuidar:['look after'], lavar:['wash'],
  echar:['throw','threw'], romper:['break','broke'], responder:['reply'], ocurrir:['happen'], compartir:['share'], asistir:['attend'],
  enfermar:['get ill','got ill'], cubrir:['cover'], descansar:['rest'], pasar:['go through','went through'],
  prestar:['lend','lent'], parar:['stop','stopped'], encantar:['delight'], celebrar:['celebrate'], medir:['try on','tried on'],
  pensar:['think','thought'], cerrar:['close'], entender:['understand','understood'], perder:['lose','lost'], sentar:['seat'],
  despertar:['wake','woke'], recomendar:['recommend'], querer:['want'], sentir:['feel','felt'], preferir:['prefer','preferred'],
  mentir:['lie','lied'], divertir:['have fun','had fun'], sugerir:['suggest'], atender:['serve'], calentar:['heat up'],
  contar:['tell','told'], encontrar:['find','found'], recordar:['remember'], mostrar:['show'], costar:['cost','cost'],
  volver:['return'], poder:['can','could'], dormir:['sleep','slept'], morir:['die'], doler:['hurt','hurt'], acostar:['lie down','lay down'],
  probar:['try','tried'], devolver:['give back','gave back'], almorzar:['have lunch','had lunch'], pedir:['ask for','asked for'],
  servir:['serve'], repetir:['repeat'], vestir:['dress'], seguir:['follow'], conseguir:['get','got'], empezar:['begin','began'],
  negar:['deny','denied'], jugar:['play'], corregir:['correct'], elegir:['choose','chose'], buscar:['look for'], tocar:['touch'],
  sacar:['take out','took out'], practicar:['practise'], explicar:['explain'], marcar:['dial','dialled'], pagar:['pay','paid'],
  llegar:['arrive'], entregar:['deliver'], conocer:['know','knew'], conducir:['drive','drove'], producir:['produce'],
  traducir:['translate'], parecer:['seem'], construir:['build','built'], destruir:['destroy'], incluir:['include'],
  escoger:['choose','chose'], proteger:['protect'], dirigir:['manage'], tener:['have','had'], poner:['put','put'],
  salir:['go out','went out'], valer:['be worth'], venir:['come','came'], hacer:['do','did'], decir:['say','said'],
  traer:['bring','brought'], ser:['be'], estar:['be'], ir:['go','went'], dar:['give','gave'], ver:['see','saw'],
  saber:['know','knew'], andar:['walk around','walked around'],
  dudar:['doubt'], mejorar:['improve'], avisar:['let (someone) know','let (someone) know'], acompañar:['go with','went with'],
  llenar:['fill in','filled in'], casar:['get married','got married'], regresar:['come back','came back'],
  cumplir:['turn (an age)','turned (an age)'], prender:['turn on','turned on'], llover:['rain'], mover:['move'],
  apagar:['turn off','turned off'], alcanzar:['reach'], recoger:['pick up','picked up'],
};
// conocer / saber change meaning in the past ("conocí" = I met, "supe" = I found out)
const PAST_OVERRIDE = { conocer: 'met', saber: 'found out' };
const SUBJECT = { yo: 'I', tu: 'you', usted: 'he/she', nosotros: 'we', ellos: 'they' };
// Verbs whose forms don't make sense as a person drill (one-person verbs, auxiliaries)
export const NO_FORM_QUIZ = new Set(['haber', 'gustar', 'encantar', 'doler', 'faltar', 'ocurrir', 'costar', 'funcionar', 'valer', 'llover']);

const third = w => w === 'have' ? 'has' : w === 'do' ? 'does' : w === 'go' ? 'goes' : w === 'can' ? 'can'
  : /(s|sh|ch|x|z)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's';
function regularPast(w){
  if(/e$/.test(w)) return w + 'd';
  if(/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ied';
  return w + 'ed';
}
const splitBase = b => { const i = b.indexOf(' '); return i === -1 ? [b, ''] : [b.slice(0, i), b.slice(i)]; };

export function hasEnglish(inf){ return !!E[inf]; }

/** "tuvimos" -> "we had". tense: pres pret impf fut cond */
export function english(inf, tense, person){
  const g = E[inf]; if(!g) return null;
  const [base, pastGiven] = g;
  const [head, tail] = splitBase(base);
  const s = SUBJECT[person];
  const isBe = head === 'be';
  if(inf === 'poder'){
    return { pres: `${s} can`, pret: `${s} could (managed to)`, impf: `${s} could (was able to)`,
             fut: `${s} will be able to`, cond: `${s} could (would be able to)` }[tense];
  }
  switch(tense){
    case 'pres':
      if(isBe) return `${s} ${person === 'yo' ? 'am' : person === 'usted' ? 'is' : 'are'}${tail}`;
      return `${s} ${person === 'usted' ? third(head) : head}${tail}`;
    case 'pret': {
      if(isBe) return `${s} ${person === 'yo' || person === 'usted' ? 'was' : 'were'}${tail}`;
      const past = PAST_OVERRIDE[inf] || pastGiven || regularPast(head) + tail;
      return `${s} ${past}`;
    }
    case 'impf': return `${s} used to ${base}`;
    case 'fut': return `${s} will ${base}`;
    case 'cond': return `${s} would ${base}`;
    default: return null;
  }
}
