// Writes build/review.html: every phrase with colour-coded Spanish, for checking a batch by eye.
//   node tools/review.mjs      (run tools/build.mjs first)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lib = JSON.parse(readFileSync(join(root, 'build', 'library.json'), 'utf8'));
const esc = s => s.replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const TENSE = { pres:'now', pret:'did', impf:'used to', fut:'will', cond:'would', subj:'subj.' };

function tokenHTML(t){
  if(!t.items) return esc(t.t);
  const word = t.t.slice((t.pre || '').length, t.t.length - (t.post || '').length);
  const inner = t.parts ? t.parts.map(([s, k]) => k ? `<span class="${k}">${esc(s)}</span>` : esc(s)).join('') : esc(word);
  return `${esc(t.pre || '')}<span class="tk" title="${esc(t.m + ' — ' + t.info + '\n' + t.items.join('  '))}">${inner}</span>${esc(t.post || '')}`;
}

const rows = lib.phrases.map(p => `<tr>
  <td class="id">${p.id}</td><td class="topic">${p.topic}</td>
  <td>${esc(p.en)}</td><td class="es">${p.tokens.map(tokenHTML).join(' ')}</td>
  <td class="tense">${p.tenses.map(t => TENSE[t]).join(', ')}</td></tr>`).join('\n');

writeFileSync(join(root, 'build', 'review.html'), `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Phrase batch review</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:24px;color:#222;background:#fff}
h1{font-size:20px;font-weight:600;margin:0 0 4px} p{color:#666;font-size:14px;margin:0 0 16px}
table{border-collapse:collapse;width:100%;font-size:15px}
td,th{border-bottom:1px solid #eee;padding:8px 10px;text-align:left;vertical-align:top}
th{font-weight:600;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.04em}
.es{font-size:17px;background:#fbe7ef}.id,.topic,.tense{color:#888;font-size:13px;white-space:nowrap}
.tk{border-bottom:1.5px dotted #aaa;cursor:help}.reg{color:#2f7fd6}.irr{color:#d4542b;font-weight:600}
@media (prefers-color-scheme:dark){body{background:#1c1c1c;color:#eee}.es{background:#4a2433}td,th{border-color:#333}}
</style></head><body>
<h1>Phrase batch review · ${lib.counts.phrases} phrases</h1>
<p><span class="reg">blue = regular ending</span> · <span class="irr">orange = irregular part</span> ·
dotted words are rateable (hover for meaning and item IDs) · built ${lib.version.slice(0, 16).replace('T', ' ')}</p>
<table><tr><th>ID</th><th>Topic</th><th>English</th><th>Spanish</th><th>Tense</th></tr>
${rows}
</table></body></html>`);
console.log('Wrote build/review.html');
