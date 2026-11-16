# Spanish Phrase Reel

A personal Spanish learning app: a continuous, radio-like reel of English ⇄ Spanish phrases with
spaced repetition underneath, plus an endless vocabulary quiz. Standard Colombian Spanish.

The full design is in the Claude project doc `plan/phrase-reel-decisions.md`.

**Status: Phase 0 (foundations).** No app screens yet; this is the engine, the content format,
the validator, the first phrase batch and the audio script.

## What's here

| Folder | What it is |
|---|---|
| `engine/conjugate.mjs` | Conjugation engine (ported from `spanish_srs.jsx`, ~160 verbs). Also works out which part of each form is a regular ending (blue) or irregular (orange), and which learning items a verb form belongs to. |
| `engine/adjectives.mjs` | Adjective agreement groups (cansado/a, grande, fácil, español/a, naranja), shortened forms (gran, buen…), noun plurals. |
| `content/` | The phrases and vocabulary, written as plain text (format below). **This is the source of truth.** |
| `tools/build.mjs` | Validates every phrase and writes `build/library.json`, the file the app reads. |
| `tools/review.mjs` | Writes `build/review.html`, a colour-coded list of every phrase for checking a batch. |
| `tools/make_audio.py` | Makes the MP3s with Azure (run on your PC, see below). |
| `tests/` | Engine tests. |

## Commands (Node 18+)

```
node tests/engine.test.mjs     # engine tests
node tools/build.mjs           # validate content -> build/library.json + build/report.txt
node tools/review.mjs          # build/review.html
```

`build.mjs` refuses (exit code 1) if any phrase has an error, e.g. a wrong conjugation, a word
missing from the vocabulary list, an untagged word, or a question without ¿.

## Content format

`content/phrases/*.txt`: a `# topic: name` line sets the topic. Each phrase is two lines:

```
p0037 | You have to take this pill every eight hours
  Tiene:v:tener.pres.usted que tomar:i:tomar esta pastilla:w:pastilla#pill cada:w:cada#each ocho:w:ocho#eight horas:w:hora#hour.p +c:tener-que@0-1
```

Token codes: `w:lemma#meaning` (word; add `.p` for plural) · `v:infinitive.tense.person`
(tense: pres pret impf fut cond subj; person: yo tu usted nosotros ellos) · `i:infinitive` ·
`a:lemma#meaning.gender.number` (adjective; add `.short` for gran/buen…) · plain words are not
rateable · `_` inside a token means a space (`por_favor`) · `+c:construction@first-last` marks a
multi-word construction. Vocabulary lives in `content/words.txt`, constructions in
`content/constructions.txt`.

## Making the audio (on your Windows PC)

1. On GitHub: **Code → Download ZIP**, and unzip it.
2. In PowerShell, inside the unzipped folder:
   ```
   $env:AZURE_SPEECH_KEY = "<your Key 1>"
   $env:AZURE_SPEECH_REGION = "eastus"
   python tools\make_audio.py
   ```
3. It makes `phrase-audio.zip`. Attach it in the Claude chat and it gets added here.

Spanish alternates Salomé / Gonzalo (es-CO); English alternates Sonia / Ryan (en-GB).
Re-running only makes clips that are missing or whose text has changed.
