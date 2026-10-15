# MayoChord

**English** · [中文](README.md)

**Try it: <https://yisoragoto.github.io/mayochord/>**

MayoChord is a web app for practising chords on a MIDI keyboard. The goal: see a chord name and play it without thinking, move smoothly between chords, keep time, and remember it all.

Every answer is measured over MIDI — right or wrong, reaction time, whether the notes landed together, and how far from the beat — and graded automatically. Reviews are scheduled with spaced repetition (FSRS): you review just before you would forget, and don't waste time on what you already know. Open **Today** and work through the tasks in order.

![Today: daily tasks, XP and streak](docs/screenshots/today.png)

> Work in progress. M0–M6 are done; M7 (import sheet music and play along) is in development. See the roadmap below.

## What you need

- **Chrome or Edge on a computer.** The app reads your keyboard through Web MIDI, which Safari and every browser on iPhone/iPad lack.
- **A MIDI keyboard** connected over USB. Developed and measured on a Roland JUNO-D7; other USB MIDI keyboards work too.
- No keyboard? You can still answer with the on-screen keyboard (mouse or touch) or your computer keyboard.

## Getting started

1. Open the site, click **Connect MIDI device** and allow MIDI access when the browser asks.
2. In **Settings**, do an **octave calibration** first: press middle C once. If OCTAVE / TRANSPOSE on the keyboard changed, every note is shifted; calibration corrects that. For metronome practice, also do a **latency calibration**.
3. Already know some chords? Take the **placement test** to skip what you know.
4. Go back to **Today** and work through the tasks.
5. To choose what to practise yourself, use **Practice** (chords, ear training or play-along); to look up a voicing, use the **Chord library**.

The UI defaults to Chinese; switch to English in **Settings → Appearance**.

All data stays in your browser (IndexedDB) and is never uploaded. Export a backup (JSON) or the answer log (CSV) under **Settings → Data**, and import the backup on a new device. The site can be installed to your home screen and works offline.

## Features

**The system plans what to practise**

- **Today**: warm-up, targeted fixes, due reviews, quizzes and new lessons, fitted to your daily time. Skip tasks or swap a new lesson.
- **Knowledge map**: 30 topics from finding the keys to the Marunouchi Sadistic progression, with prerequisites and each topic's status. Skip ahead when you already know a topic.
- **Lessons**: explanation and demo → guided practice → independent practice → mastery check.
- **Placement test**: find your starting point in a few minutes.
- **Quizzes and targeted fixes**: a regular quiz across recent topics; the chords and changes you miss are practised again the next day.
- **Implicit repetition**: reviewing a harder topic also counts for the simpler topics it contains.

![Knowledge map](docs/screenshots/graph.png)

**Practice**

- **Name → chord** and **chord changes**: judged automatically; extra and missing notes are marked. Keys are only shown after a wrong answer or timeout, so you recall first.
- **Play along**: after a count-in, play a whole progression with the metronome and see how many milliseconds early or late each chord was. Supports 16th-note anticipation.
- **Voice-leading diagram**: shows which notes stay and which move by a semitone or whole tone between two chords.
- **Ear training**: hear a cadence to set the key, then a chord; tap its Roman numeral or play it. The listening challenge plays a chord with no key and you pick it from a group.
- **Contrast pairs**: chords one note apart, such as C/Cm, C7/CM7, Am7/Am7♭5.
- **Read the staff**, **read Roman numerals**, **build chords in 12 keys** (from words like “E♭ minor”), note names, intervals and inversions.
- **85% rule**: time limits (and suggested tempos when playing along) adapt to your recent accuracy, keeping practice hard but doable.

![Play along](docs/screenshots/progression.png)

**Tools**

- **Stats**: reaction-time curves, a chord-change heatmap, daily practice, beat-offset distribution and topic mastery.
- **Chord library**: voicing for each chord (hands and fingering), chord tones, semitone formula (e.g. Am = A +3 C +4 E), staff notation, playback and a try-it panel.
- **MIDI monitor**: live notes, channels, velocities and recognised chords, with raw data export.
- **Day / night** themes, Chinese / English UI, works in portrait on phones.

![Stats](docs/screenshots/stats.png)

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M0 | Skeleton, design system, MIDI monitor, JUNO-D7 measurements | Done |
| M1 | Theory, chord recognition and judging, content packs, local database, chord library | Done |
| M2 | Name → chord, chord changes, auto grading, spaced repetition, focus-mode practice | Done |
| M3 | Knowledge map, lessons, daily tasks, XP | Done |
| M4 | Metronome, latency calibration, play-along, voice-leading visualisation | Done |
| M5 | Ear training, contrast pairs, 12-key building, reading the staff | Done |
| M6 | Stats, quizzes and placement test, data export/import, offline (PWA), English UI | Done |
| M7 | Import sheet music (MusicXML / MIDI) to play along, staff and falling-notes views | In progress |

## Development

Requires Node.js 22+ and pnpm 12.

```bash
pnpm install
pnpm dev          # dev server at http://localhost:5173/mayochord/
pnpm lint         # Biome
pnpm typecheck    # TypeScript
pnpm test         # unit tests
pnpm coverage     # unit tests + core coverage (90% threshold)
pnpm build        # build to apps/web/dist
pnpm e2e          # end-to-end tests (Playwright with simulated MIDI)
```

Every push to `main` runs the full checks in GitHub Actions and deploys to GitHub Pages.

```
packages/core      Pure TypeScript core: theory, chord recognition and judging, grading, scheduling, knowledge map, timing (no browser APIs)
packages/content   Content pack format (Zod-validated) and built-in content: chords, voicings, progressions, topics and lessons
apps/web           The web app: React 19, Vite, TanStack Router, Tailwind CSS, Dexie
```

Documentation (in Chinese):

- [Architecture and extension points](docs/architecture.md)
- [Content pack format](docs/content-pack.md)
- [Learning science and references](docs/learning-science.md)
- [Contributing](CONTRIBUTING.md)
- Requirements and design: [MAYOCHORD_SPEC.md](MAYOCHORD_SPEC.md)
- Development conventions and JUNO-D7 measurements: [CLAUDE.md](CLAUDE.md)

## Copyright and licences

- Code is under the [MIT licence](LICENSE).
- Piano samples: Salamander Grand Piano by Alexander Holm (CC-BY 3.0). Fonts are under the SIL Open Font License. See [NOTICE](NOTICE).
- The repository contains only generic chords and progressions — no copyrighted lyrics, recordings, sheet music or artist images.
