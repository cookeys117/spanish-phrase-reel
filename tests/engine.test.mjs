// Run: node tests/engine.test.mjs
import { conjugate, classify } from '../engine/conjugate.mjs';

const cases = [
  // [inf, tense, person, expected form]
  ['hablar','pres','yo','hablo'], ['comer','pret','usted','comió'], ['vivir','impf','nosotros','vivíamos'],
  ['tener','pres','yo','tengo'], ['tener','pret','nosotros','tuvimos'], ['tener','fut','yo','tendré'],
  ['ser','pres','tu','eres'], ['ser','pret','ellos','fueron'], ['ir','pret','yo','fui'], ['ir','impf','yo','iba'],
  ['estar','pret','usted','estuvo'], ['hacer','pret','usted','hizo'], ['decir','pret','ellos','dijeron'],
  ['poder','pret','yo','pude'], ['querer','pret','usted','quiso'], ['poner','pret','yo','puse'],
  ['venir','pres','tu','vienes'], ['dar','pret','yo','di'], ['ver','impf','usted','veía'], ['saber','pres','yo','sé'],
  ['pensar','pres','usted','piensa'], ['volver','pres','ellos','vuelven'], ['pedir','pret','usted','pidió'],
  ['dormir','pret','ellos','durmieron'], ['jugar','pres','tu','juegas'], ['seguir','pres','yo','sigo'],
  ['buscar','pret','yo','busqué'], ['pagar','pret','yo','pagué'], ['empezar','pret','yo','empecé'],
  ['almorzar','pres','yo','almuerzo'], ['almorzar','pret','yo','almorcé'], ['almorzar','subj','usted','almuerce'],
  ['probar','pres','yo','pruebo'], ['devolver','pres','usted','devuelve'], ['doler','pres','ellos','duelen'],
  ['entregar','pret','yo','entregué'], ['explicar','subj','usted','explique'], ['conocer','pres','yo','conozco'],
  ['construir','pres','ellos','construyen'], ['traer','pret','ellos','trajeron'], ['haber','impf','usted','había'],
  ['dañar','pret','usted','dañó'], ['atender','pres','ellos','atienden'], ['calentar','pres','usted','calienta'],
  ['servir','pres','usted','sirve'], ['sentir','pret','usted','sintió'], ['salir','fut','nosotros','saldremos'],
];
let fail = 0;
for(const [inf, t, p, exp] of cases){
  const got = conjugate(inf, t, p);
  if(got !== exp){ fail++; console.log(`FAIL ${inf} ${t} ${p}: expected ${exp}, got ${got}`); }
}
const kinds = [
  ['caminar','pret','usted','regular'], ['pensar','pres','yo','stem'], ['tener','pret','yo','irregular'],
  ['pensar','pret','yo','regular'], ['buscar','pret','yo','irregular'], ['dormir','pret','usted','stem'],
];
for(const [inf, t, p, exp] of kinds){
  const got = classify(inf, t, p).kind;
  if(got !== exp){ fail++; console.log(`FAIL kind ${inf} ${t} ${p}: expected ${exp}, got ${got}`); }
}
console.log(fail ? `${fail} failures` : `All ${cases.length + kinds.length} engine tests passed`);
process.exit(fail ? 1 : 0);
