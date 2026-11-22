// Run: node tests/scheduler.test.mjs
import { computeStates, intervalFor, addDays, dayKey, pickTheme, choosePhrase, todaysVerdict } from '../app/scheduler.mjs';

let fail = 0;
const eq = (got, exp, msg) => { if(JSON.stringify(got) !== JSON.stringify(exp)){ fail++; console.log(`FAIL ${msg}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(got)}`); } };
const at = (day, hour = 10) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, hour).getTime(); };
const ev = (day, r, i = 'w:x', hour = 10) => ({ t: at(day, hour), r, i, ph: 'p1' });

// intervals ×2: 1, 2, 4(±12%), 8…
eq(intervalFor(0), 1, 'rung 0'); eq(intervalFor(1), 1, 'rung 1'); eq(intervalFor(2), 2, 'rung 2');
eq(intervalFor(3, undefined, 'a') >= 4 && intervalFor(3, undefined, 'a') <= 5, true, 'rung 3 ≈4');
eq(intervalFor(20), Math.round(intervalFor(20)), 'cap stays integer');
eq(intervalFor(20) <= 202, true, 'cap ≈180 ±12%');

// green promotes one rung per day only
let s = computeStates([ev('2026-11-01', 'g'), ev('2026-11-01', 'g', 'w:x', 15)], {}).get('w:x');
eq([s.rung, s.due], [1, '2026-11-02'], 'two greens same day = one rung');

// green before due = practice only
s = computeStates([ev('2026-11-01', 'g'), ev('2026-11-02', 'g'), ev('2026-11-03', 'g')], {}).get('w:x');
eq([s.rung, s.due], [2, '2026-11-04'], 'g d1 (rung1 due d2), g d2 (rung2 due d4), g d3 not due');

// red stands over green the same day, drops 2 rungs
s = computeStates([ev('2026-11-01', 'g'), ev('2026-11-02', 'g'), ev('2026-11-04', 'g'), ev('2026-11-05', 'r', 'w:x', 9), ev('2026-11-05', 'g', 'w:x', 11)], {}).get('w:x');
eq(s.rung, 1, 'rung 3 then red -> 1');
eq(s.due, '2026-11-06', 'red -> due tomorrow');

// clear removes the day's verdict
s = computeStates([ev('2026-11-01', 'g'), ev('2026-11-01', 'x', 'w:x', 11)], {}).get('w:x');
eq([s.rung, s.rated], [0, false], 'cleared item is seen but unrated');

// never below bottom
s = computeStates([ev('2026-11-01', 'r')], {}).get('w:x');
eq([s.rung, s.due], [0, '2026-11-02'], 'red on new item');

// today's verdict
eq(todaysVerdict([ev('2026-11-01', 'g'), ev('2026-11-01', 'r', 'w:x', 11)], 'w:x', '2026-11-01'), 'r', 'verdict r');

// theme is stable for a day and respects zero weights
const w = { pres: 1, pret: 1, impf: 0 };
eq(pickTheme('2026-11-16', w, ['pres','pret','impf']) === pickTheme('2026-11-16', w, ['pres','pret','impf']), true, 'stable theme');
const themes = new Set(); for(let i = 1; i <= 28; i++) themes.add(pickTheme(`2026-11-${String(i).padStart(2,'0')}`, w, ['pres','pret','impf']));
eq(themes.has('impf'), false, 'zero-weight tense never chosen');
eq(themes.size, 2, 'both weighted tenses get chosen over a month');

// phrase choice: theme slot prefers theme tense, avoids recent, requeue honoured
const P = (id, tense, items) => ({ id, tenses: [tense], status: 'ok', tokens: items.map(i => ({ items: [i] })) });
const phrases = [P('a', 'pret', ['w:1']), P('b', 'pres', ['w:2']), P('c', 'pret', ['w:3']), P('d', 'pres', ['w:9'])];
const states = computeStates([], {});
const base = { phrases, states, today: '2026-11-16', theme: 'pret', themeShare: 1, recent: [], newToday: 0, newCap: 15, random: () => 0.5 };
eq(['a','c'].includes(choosePhrase(base).phrase.id), true, 'theme slot picks a pret phrase');
eq(choosePhrase({ ...base, recent: ['a'] }).phrase.id, 'c', 'recent phrase avoided');
eq(choosePhrase({ ...base, requeueItem: 'w:9' }).phrase.id, 'd', 'requeue brings the red item back');

// Undo on one card doesn't wipe the same item's green from another card that day
{
  const e = (r, c, h) => ({ ...ev('2026-11-01', r, 'vp:er|pret|yo', h), c });
  eq(computeStates([e('g', 'A', 9), e('g', 'B', 10), e('x', 'B', 11)], {}).get('vp:er|pret|yo').rung, 1, 'green from card A survives undo on card B');
  eq(computeStates([e('g', 'A', 9), e('x', 'A', 11)], {}).get('vp:er|pret|yo').rung, 0, 'undo on the same card clears it');
  eq(computeStates([e('r', 'A', 9), e('g', 'B', 10)], {}).get('vp:er|pret|yo').rung, 0, 'red on one card still stands over green on another');
}

console.log(fail ? `${fail} failures` : 'All scheduler tests passed');
process.exit(fail ? 1 : 0);

