"""
Make the phrase audio with Azure neural text-to-speech (runs on YOUR PC; your key stays there).

For every phrase in build/library.json that has no audio yet it creates
    audio/<id>_es.mp3   Spanish, alternating es-CO Salomé / Gonzalo phrase by phrase
    audio/<id>_en.mp3   English, alternating en-GB Sonia / Ryan
and for every Spanish word / verb form the quiz speaks
    audio/q/<word>.mp3  (listed in audio/quiz-manifest.json)
updates the manifests, and finally packs everything into  phrase-audio.zip
(attach that zip in the Claude chat and it gets added to the app).

Safe to re-run: existing clips are skipped, so an interrupted run just resumes.

Normally this runs by itself on GitHub (.github/workflows/audio.yml) whenever new phrases are
pushed, using the repository secrets AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.

To run it by hand instead (PowerShell, in the unzipped repository folder):
    $env:AZURE_SPEECH_KEY = "<your Key 1>"
    $env:AZURE_SPEECH_REGION = "eastus"      # your resource's Location/Region
    python tools\\make_audio.py
"""
import hashlib
import json
import os
import re
import subprocess
import unicodedata
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
QUIZ_MANIFEST = os.path.join(AUDIO, "quiz-manifest.json")
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
        library = json.load(f)
    phrases = library["phrases"]
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

    # quiz words: one clip per distinct Spanish word / verb form
    quiz = {}
    if os.path.exists(QUIZ_MANIFEST):
        with open(QUIZ_MANIFEST, encoding="utf-8") as f:
            quiz = json.load(f)
    os.makedirs(os.path.join(AUDIO, "q"), exist_ok=True)
    for i, text in enumerate(library.get("quizSpeech", [])):
        name = "q/" + slug(text) + ".mp3"
        if quiz.get(text) == name and os.path.exists(os.path.join(AUDIO, name)):
            continue
        jobs.append(("quiz", text, name, text, ES_VOICES[i % 2], "es-CO"))

    print(f"{len(phrases)} phrases, {len(jobs)} clips to make "
          f"(about {len(jobs) * SECONDS_BETWEEN_REQUESTS / 60:.0f} min on the free tier).")
    for n, (pid, lang_key, name, text, voice, lang) in enumerate(jobs, 1):
        audio = synthesize(text, voice, lang, key, region)
        with open(os.path.join(AUDIO, name), "wb") as out:
            out.write(audio)
        if pid == "quiz":
            quiz[lang_key] = name
        else:
            manifest[pid][lang_key] = {"file": name, "voice": voice, "text": text}
        print(f"  [{n}/{len(jobs)}] {voice.split('-')[2][:-6]:7} {text[:60]}")
        if n % 10 == 0:
            write_manifest(manifest, quiz)
        if COMMIT_EVERY and n % COMMIT_EVERY == 0 and n < len(jobs):
            publish(f"Add audio clips {n}/{len(jobs)} (automatic)")
        time.sleep(SECONDS_BETWEEN_REQUESTS)
    write_manifest(manifest, quiz)

    if os.environ.get("MAKE_ZIP", "1") == "0":         # GitHub job: the clips are committed directly
        print("Finished.")
        return
    with zipfile.ZipFile(ZIP_OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for folder, _, files in os.walk(AUDIO):
            for fn in sorted(files):
                path = os.path.join(folder, fn)
                z.write(path, arcname="audio/" + os.path.relpath(path, AUDIO).replace(os.sep, "/"))
    print(f"\nFinished. Attach this file in the Claude chat:\n  {ZIP_OUT}")


# On GitHub: publish the clips in chunks as they're made, so the app can show progress
COMMIT_EVERY = int(os.environ.get("COMMIT_EVERY", "0"))


def publish(message):
    """Commit and push what's been made so far, then ask GitHub Pages to refresh the site."""
    run = lambda *a: subprocess.run(a, cwd=ROOT, check=False)
    run("git", "add", "audio")
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode == 0:
        return
    run("git", "commit", "-q", "-m", message)
    run("git", "pull", "-q", "--rebase", "origin", "main")
    run("git", "push", "-q", "origin", "HEAD:main")
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if token and repo:
        try:
            req = urllib.request.Request(f"https://api.github.com/repos/{repo}/pages/builds", method="POST",
                                         headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
            urllib.request.urlopen(req, timeout=30).read()
        except Exception as e:                      # the site still updates on its own; this just speeds it up
            print(f"    (couldn't ask Pages to refresh: {e})")


def slug(text):
    """File-safe name: 'el ascensor' -> 'el-ascensor-3f9a1c' (the hash keeps está / esta apart)."""
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    plain = re.sub(r"[^a-z0-9]+", "-", plain).strip("-")[:40]
    return f"{plain}-{hashlib.md5(text.encode('utf-8')).hexdigest()[:6]}"


def write_manifest(manifest, quiz):
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    with open(QUIZ_MANIFEST, "w", encoding="utf-8") as f:
        json.dump(quiz, f, ensure_ascii=False, indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
