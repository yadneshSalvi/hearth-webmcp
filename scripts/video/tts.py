#!/usr/bin/env python3
"""Narration via Gemini 3.1 TTS → WAV files (24 kHz mono PCM). Usage: python3 scripts/video/tts.py [voice]"""
import base64, json, os, struct, subprocess, sys, tempfile
KEY = next((l.split("=",1)[1].strip() for l in open(".env") if l.startswith("GEMINI_API_KEY=")), None)
assert KEY, "GEMINI_API_KEY missing in .env"
MODEL = "gemini-3.1-flash-tts-preview"
VOICE = sys.argv[1] if len(sys.argv) > 1 else "Kore"
BEATS = [
 ("01-open", "This is Hearth — an interior-design studio that you and your agent share."),
 ("02-claim", "Hearth registers thirty-six WebMCP tools on the page. Your agent doesn't scrape pixels — it gets the same verbs you have."),
 ("03-read", "It reads the room: walls, free spans, door swings, every item in centimetres."),
 ("04-place", "Semantic anchors turn a sentence into a position — no coordinates in the conversation."),
 ("05-conflict", "Conflicts are diagrams, not alarms — and every fix is one tool call away."),
 ("06-drag", "You stay in control. Drag anything; the agent sees the same scene."),
 ("07-a11y", "Ask for accessibility, and it reasons about turning circles and ninety-centimetre paths."),
 ("08-shop", "The catalog is a real Shopify store. Try-before-you-buy is a ghost in the room."),
 ("09-compare", "Two layouts, one slider."),
 ("10-evening", "Golden hour to evening in one call; a design critique in another."),
 ("11-checkout", "Purchases stay yours: the agent hands you the link."),
 ("12-fallback", "It works in ChatGPT's browser, in Chrome, and with a built-in fallback that drives the very same tools."),
 ("13-close", "Hearth. Design a home with your agent. hearth dot yadneshsalvi dot com."),
]
def wav(pcm: bytes, rate=24000, ch=1, width=2) -> bytes:
    return b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE" + b"fmt " + struct.pack("<IHHIIHH", 16, 1, ch, rate, rate*ch*width, ch*width, width*8) + b"data" + struct.pack("<I", len(pcm)) + pcm
for name, text in BEATS:
    body = {"contents": [{"parts": [{"text": f"Say this warmly, unhurried, like a calm product narrator: {text}"}]}],
            "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOICE}}}}}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
        json.dump(body, tf); tf_path = tf.name
    proc = subprocess.run(["curl", "-sS", "--max-time", "180", "-H", "Content-Type: application/json", "-H", f"x-goog-api-key: {KEY}", "-d", f"@{tf_path}", f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"], capture_output=True, text=True)
    os.unlink(tf_path)
    try:
        res = json.loads(proc.stdout)
    except json.JSONDecodeError:
        print(name, "bad response:", proc.stdout[:300], proc.stderr[:200]); sys.exit(1)
    if "candidates" not in res:
        print(name, "API error:", json.dumps(res)[:400]); sys.exit(1)
    part = res["candidates"][0]["content"]["parts"][0]["inlineData"]
    mime = part.get("mimeType", ""); rate = 24000
    if "rate=" in mime: rate = int(mime.split("rate=")[1].split(";")[0])
    pcm = base64.b64decode(part["data"])
    out = f"plans/video/narration/{name}.wav"; open(out, "wb").write(wav(pcm, rate))
    print(f"{name}: {len(pcm)/(rate*2):.1f}s ({mime})")
