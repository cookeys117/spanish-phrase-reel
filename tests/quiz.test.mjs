// Run: node tests/quiz.test.mjs   (needs build/library.json: node tools/build.mjs)
import { readFileSync } from 'node:fs';
import { buildPool, makeQuestion, nextQuestion, filterPool, pairKey } from '../app/quiz.mjs';
import { computeStates, dayKey } from '../app/scheduler.mjs';

let fail = 0;
const ok = (c, msg) => { if(!c){ fail++; console.log('FAIL ' + msg); } };
const lib = JSON.parse(readFileSync(new URL('../build/library.json', import.meta.url)));
const pool = buildPool(lib);

// every item can make a fair question both ways: 5 distinct options, exactly one right
for(const it of pool) for(const dir of ['es', 'en']){
  const q = makeQuestion(it, dir, pool);
  ok(q, `question for ${it.key} ${dir}`);
  if(!q) continue;
  ok(new Set(q.options).size === 5, `5 distinct options for ${it.key} ${dir}: ${q.options}`);
  ok(q.options[q.answer] === (dir === 'es' ? it.en : it.es), `right answer for ${it.key} ${dir}`);
  ok(!q.options.includes(q.prompt), `prompt not among options for ${it.key}`);
}
// other meanings of the same word are never offered (la cuenta = bill / account)
const bill = pool.find(i => i.key === 'w:cuenta#bill');
for(let k = 0; k < 30; k++) ok(!makeQuestion(bill, 'en', pool).options.filter((o, i) => o === 'la cuenta').slice(1).length, 'no duplicate cuenta');
ok(bill.ambiguous, 'cuenta is marked ambiguous (gets a context line)');

// verb-form wrong answers never share the right answer's spelling (caminamos now = did)
for(const it of pool.filter(i => i.type === 'form')){
  const q = makeQuestion(it, 'es', pool);
  ok(q.options.filter(o => o === it.en).length === 1, `form ${it.key} has one right English`);
}

// queue: new words obey the daily cap; English->Spanish waits in "mixed" until rung 2
const fp = filterPool(pool, { types: { noun: true }, topics: null, tenses: null });
const today = dayKey();
const base = { pool: fp, states: new Map(), dir: 'mix', today, n: 1, retries: [], recent: [], newToday: 0, newCap: 20, random: () => 0.3 };
const first = nextQuestion(base);
ok(first.kind === 'new' && first.dir === 'es', 'first question is a new word, Spanish -> English');
ok(nextQuestion({ ...base, newToday: 20, random: () => 0.9 }).kind === 'practice', 'cap reached -> some review mixed in');
ok(nextQuestion({ ...base, newToday: 20, random: () => 0.3 }).kind === 'new', 'cap reached -> new words still keep coming');
{ // extra practice skips words already answered today, preferring earlier days' words
  const st = new Map(fp.slice(0, 4).map(it => [pairKey(it.key, 'es'), { rung: 1, due: '2999-01-01', rated: true, firstSeen: today }]));
  const done = new Set(fp.slice(0, 3).map(it => pairKey(it.key, 'es')));
  const few = { ...base, pool: fp.slice(0, 4), states: st, newToday: 99, doneToday: done, random: () => 0.9 };
  for(let k = 0; k < 20; k++) ok(nextQuestion({ ...few, random: () => k / 20 }).item.key === fp[3].key, 'not-yet-asked-today word is picked');
}
const retries = [{ key: fp[3].key, dir: 'es', at: 1 }];
ok(nextQuestion({ ...base, retries }).item.key === fp[3].key, 'retry comes back when due');

// one promotion per day in the quiz too
const k = pairKey('w:x', 'es'), t = Date.now();
const s = computeStates([{ t, i: k, r: 'g' }, { t: t + 1000, i: k, r: 'g' }], {}).get(k);
ok(s.rung === 1, 'two right answers the same day = one rung');

console.log(fail ? `${fail} failures` : `All quiz tests passed (${pool.length} items)`);
process.exit(fail ? 1 : 0);
