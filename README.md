<div align="center">

# सुर · Sur

**Riyaz for your voice.**

Sur listens to you sing, works out the range you can sing *comfortably*, places
your **Sa** inside it, and then builds every exercise around that — so the
alankars sit where your voice actually lives.

You find your Sa once. It is still there next week.

</div>

---

## Run it

Needs **Node 22.5 or newer** (for its built-in SQLite). Nothing to install.

**macOS** — double-click `Start Sur.command`.

**Anything else**

```bash
npm start          # or: node server.mjs --open
```

Then open **http://localhost:7070**. Allow the microphone when asked.

The server binds to `127.0.0.1` only — this is your practice log, not something
on the network.

---

## The three things it does

### 1. Finds your range

A guided test, about three minutes. You sing one comfortable note to start
from, then follow the app a semitone at a time down, and then up. It never
pushes: a **“That is as far as I go”** button is on screen the whole time, and
your answer always wins over the microphone's.

It also stops on its own if a note goes wobbly or breathy — those are the edge
of the *comfortable* range, which is the one exercises should be built on, not
the outer limit you can just about reach.

Everything is named in swaras from the note you started on, because that is how
a singer hears it. Western note names are there in small grey text for anyone
cross-checking against a keyboard.

### 2. Places your Sa

From the measured range Sur proposes a Sa, named the way a teacher would —
**kali 1**, **safed 3** — and shows what it buys you:

> **G♯3 · kali 4** — Recommended
> Sits your voice evenly around Sa, mandra Pa to taar Sa.
> *down to mandra Ga · up to taar Re*

If there is genuinely room to move it, you get a lower option (better for
kharaj) and a higher one (more room for taans). If there is not, you get one
honest answer instead of three that look like guessing.

### 3. Tailors the practice

Ten alankars over ten thaats, generated rather than hard-coded — each is stored
as a short motif that walks up the scale, which is how they are taught. If your
range cannot reach taar Sa, the pattern stops at the highest swara you *do*
have, always on a whole phrase, and says so:

> *Shortened to stop at Pa, the highest swara inside your range. That is not a
> limitation to worry about — it is the exercise fitting you rather than the
> other way round.*

Plus a tanpura tuned to your Sa, a scrolling pitch ribbon against swara
gridlines, and per-swara accuracy so you can see which swaras you actually
drift on.

---

## It remembers

A real SQLite database in `sur.db`, next to the app — not browser storage that
vanishes when you clear your history.

| | |
|---|---|
| `singer` | your Sa, range, thaat, tuning and tolerance |
| `range_test` | every test you have taken, so you can watch your range open up |
| `session` | every practice session, with duration and accuracy |
| `swara_stat` | per-swara drift, aggregated across sessions |

More than one person can use one copy — each singer keeps their own Sa.

It is plain SQLite: copy the file to back it up, open it with any SQLite tool
to look inside.

---

## Layout

```
server.mjs        zero-dependency HTTP server + JSON API
lib/pitch.mjs     FFT-accelerated McLeod Pitch Method detector
lib/music.mjs     swaras, thaats, alankars, Sa selection, range tailoring
lib/db.mjs        SQLite schema and queries
public/           the app — index.html, app.css, app.js, audio.js
test/run.mjs      the whole suite
```

`lib/` is imported by the browser, the server **and** the tests, so the tests
exercise the code that actually ships.

---

## Tests

```
$ npm test

Thaats — all 10, 7 swaras each, ascending, within an octave
Sa recommendation from a measured range
  bass       E2-E4   24 semis  minimal   C♯3  kali 1
  tenor      C3-C5   24 semis  minimal   A3   safed 6
  narrow     C4-G4    7 semis  narrow    C4   safed 1
  implausible range (C4-C6) -> refused
Range tailoring — the whole point of the app
  singer can reach only up to Pa (top degree 4):
    Chaar swar      runs to P  (shortened)
    Vakra           skipped — needs 4 notes of range above Sa; you have 3

Singing voice, E2 (82 Hz) to C6 (1047 Hz), with vibrato and breath noise
  W=2048  64 tests  missed 0  octave-errors 0  worst 20.1c  0.096ms/call

Database — a range measured once must still be there next week
  reopened: Sa C♯3 (kali 1), range G2–G4, 1 session kept
HTTP API · path traversal blocked
```

---

## Voice is not a flute

Sur reuses a pitch detector built for a bansuri, and four things had to change.
Each was measured, not assumed:

**The tanpura must sound your own Sa.** A flute drone can sit an octave below
the instrument. A singer is *matching* the drone, so the middle strings have to
be the actual Sa — and its partials must stay harmonic. Detuning partial *n* by
`n × 1.8` cents is a pleasant shimmer under a flute and an ambiguous reference
under a voice.

**Drone bleed is real.** A tanpura through laptop speakers gets picked up by the
microphone, and the detector locks onto it — every note reads as a flawless Sa.
A bansuri is loud enough to drown its own drone; a voice at riyaz volume is not.
Sur asks for headphones and watches for it: a pitch sitting on a drone note,
quiet, and implausibly pure is reported as **“Tanpura only”** rather than
scored.

**The window follows the voice.** 2048 samples is 2.9 periods at 69 Hz — right
at the method's cliff. Any singer whose range reaches below 150 Hz gets 4096.

**Just intonation is the default.** Against a drone that is what the ear wants:
komal Ga at 315.6 cents, not 300. Equal temperament is the keyboard's
compromise, and it is one switch away.

### Constants that were measured

| Constant | Value | How it was chosen |
|---|---:|---|
| MPM key-maximum `k` | `0.93` | Swept 0.88–0.98 over 5 voice spectra × 15 pitches (69–880 Hz) × 3 microphone rolloffs × 2 windows. **Zero octave errors anywhere in that band**, including a completely missing fundamental. |
| Clarity gate | `0.45` on / `0.35` off | Real sung notes stay above 0.76 even when very breathy; vocal fry lands near 0.51 and should be caught rather than dropped; room tone sits below 0.3. |
| Detector window | `2048`, `4096` below 150 Hz | Measured good to 65 Hz at 48 kHz, but only ~2.9 periods at 44.1 kHz. |
| Detection range | `65–1300 Hz` | Below the lowest bass, above the highest soprano. |

---

## What v1 does not do yet

Sargam-syllable onset handling, a metronome and the dugun/chaugun tempo ladder,
taans, and gating the komal-Re thaats behind a passing Bilawal score. The
exercise engine is built in degree-space, so these slot in without reshaping it.

## Safety

Sur will not push you. It asks you to warm up first, keeps the stop button in
reach, and treats your own judgement about strain as the final word — no app
can feel your throat. If singing ever hurts, stop.

## Licence

MIT.
