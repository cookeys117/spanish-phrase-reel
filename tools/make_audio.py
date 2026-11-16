"""
Make the phrase audio with Azure neural text-to-speech (runs on YOUR PC; your key stays there).

For every phrase in build/library.json that has no audio yet it creates
    audio/<id>_es.mp3   Spanish, alternating es-CO Salomé / Gonzalo phrase by phrase
    audio/<id>_en.mp3   English, alternating en-GB Sonia / Ryan
updates audio/manifest.json, and finally packs everything into  phrase-audio.zip
(attach that zip in the Claude chat and it gets added to the app).

Safe to re-run: existing clips are skipped, so an interrupted run just resumes.

Setup (PowerShell, in the unzipped repository folder):
    $env:AZURE_SPEECH_KEY = "<your Key 1>"
    $env:AZURE_SPEECH_REGION = "eastus"      # your resource's Location/Region
    python tools\\make_audio.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIBRARY = os.path.join(ROOT, "build", "library.json")
AUDIO = os.path.join(ROOT, "audio")
MANIFEST = os.path.join(AUDIO, "manifest.json")
ZIP_OUT = os.path.join(ROOT, "phrase-audio.zip")

ES_VOICES = ["es-CO-SalomeNeural", "es-CO-GonzaloNeural"]
EN_VOICES = ["en-GB-SoniaNeural", "en-GB-RyanNeural"]
# The free (F0) tier allows about 20 requests per minute, so pace them.
SECONDS_BETWEEN_REQUESTS = 3.2


def ssml(text, voice, lang):
    return (
        f'<speak version="1.0" xml:lang="{lang}" xmlns="http://www.w3.org/2001/10/synthesis">'
        f'<voice name="{voice}">{escape(text)}</voice></speak>'
    ).encode("utf-8")


def synthesize(text, voice, lang, key, region):
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    req = urllib.request.Request(url, data=ssml(text, voice, lang), method="POST", headers={
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "spanish-phrase-reel",
    })
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                wait = 10 * (attempt + 1)
                print(f"    Azure busy ({e.code}), waiting {wait}s...")
                time.sleep(wait)
                continue
            if e.code in (401, 403):
                sys.exit("Azure rejected the key/region (HTTP %d). Check AZURE_SPEECH_KEY "
                         "and AZURE_SPEECH_REGION." % e.code)
            raise
    raise RuntimeError("Azure kept refusing requests; try again later.")


def main():
    key = os.environ.get("AZURE_SPEECH_KEY", "").strip()
    region = os.environ.get("AZURE_SPEECH_REGION", "").strip().lower().replace(" ", "")
    if not key or not region:
        sys.exit("Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION first (see top of this file).")
    if not os.path.exists(LIBRARY):
        sys.exit(f"Can't find {LIBRARY}. Run this from the unzipped repository folder.")

    with open(LIBRARY, encoding="utf-8") as f:
        phrases = json.load(f)["phrases"]
    os.makedirs(AUDIO, exist_ok=True)
    manifest = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            manifest = json.load(f)

    jobs = []
    for i, p in enumerate(phrases):
        if p.get("status") == "error":
            continue
        entry = manifest.setdefault(p["id"], {})
        for lang_key, text, voices, lang in (("es", p["es"], ES_VOICES, "es-CO"),
                                             ("en", p["en"], EN_VOICES, "en-GB")):
            name = f'{p["id"]}_{lang_key}.mp3'
            voice = voices[i % 2]
            # Re-make the clip if the text changed since it was generated.
            done = entry.get(lang_key)
            if done and done.get("text") == text and os.path.exists(os.path.join(AUDIO, name)):
                continue
            jobs.append((p["id"], lang_key, name, text, voice, lang))

    print(f"{len(phrases)} phrases, {len(jobs)} clips to make "
          f"(about {len(jobs) * SECONDS_BETWEEN_REQUESTS / 60:.0f} min on the free tier).")
    for n, (pid, lang_key, name, text, voice, lang) in enumerate(jobs, 1):
        audio = synthesize(text, voice, lang, key, region)
        with open(os.path.join(AUDIO, name), "wb") as out:
            out.write(audio)
        manifest[pid][lang_key] = {"file": name, "voice": voice, "text": text}
        print(f"  [{n}/{len(jobs)}] {voice.split('-')[2][:-6]:7} {text[:60]}")
        if n % 10 == 0:
            write_manifest(manifest)
        time.sleep(SECONDS_BETWEEN_REQUESTS)
    write_manifest(manifest)

    with zipfile.ZipFile(ZIP_OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for fn in sorted(os.listdir(AUDIO)):
            z.write(os.path.join(AUDIO, fn), arcname=f"audio/{fn}")
    print(f"\nFinished. Attach this file in the Claude chat:\n  {ZIP_OUT}")


def write_manifest(manifest):
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
