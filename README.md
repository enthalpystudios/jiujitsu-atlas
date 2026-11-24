# Jiu-Jitsu Name Atlas

A small, offline-friendly web app for learning the names in the RFEJYDA
Jiu-Jitsu kyu syllabus. It covers all five kyu belts (5th yellow → 1st brown):
**112 techniques** across 8 categories, with **430 technique frames** and a
**124-term glossary**. The interface is bilingual (Spanish from Spain by
default, English toggle); Japanese names stay Japanese.

The whole app is static: no build step, no server, no dependencies. Open
`index.html` in any modern browser and it works — including from `file://`.

## Views

- **Browse** — search, filter by category, sort by syllabus order, teaching
  order or source-video view count, and open a technique for a large stage with
  selectable phase thumbnails, key points, mistakes and the source video.
- **Flashcards** — name → technique and technique → name, with shuffle and a
  saved "known" list.
- **Ronda** — two modes. *Quick round*: 60 seconds, name → picture or picture →
  name, with a best score saved locally. *Training rounds*: the class drill — a
  bell, a clock and a swap. Choose the exercises to drill, the number of rounds,
  the work and the rest in seconds, and whether it is in pairs. The app speaks
  the 4-3-2-1 in and out (Mónica / Samantha, rendered to clips), names the technique for each round and holds the
  screen awake while you play your own music. It runs offline.
- **Glossary** — two halves. *Words* is the dictionary: every Japanese term
  with its kanji and its kana reading, and the techniques it builds. *Guide*
  holds the technique families, how a name is read, and the five kyus as a
  tickable **exam checklist** — each kyu shows what you have signed off.

The belt scope filters every view. The choice is remembered in
`localStorage` and can be set from the URL.

Every kanji is paired with its kana reading — the same romaji-to-hiragana map
the speech uses, so the written reading and the spoken one can never disagree.

## On a phone

The phone layout is not the desktop layout squeezed down — the chrome is
reduced and the controls move to where a thumb can reach them:

- **One row of chrome.** The header is a single 60 px bar: the mark, a scope
  chip showing the active belt, and two icon buttons. On desktop the belt rail
  and the theme/language controls stay inline; on a phone they move into sheets.
- **Bottom tab bar.** The four views live in the thumb zone, with 54 px targets
  and safe-area padding, instead of a rail under the chin.
- **Scope chip → belt sheet.** Tapping the chip opens a sheet of full-width belt
  rows with colour dots and counts. Picking one closes the sheet and rescopes
  every view.
- **Filters sheet.** Search stays inline and sticky; the category filter and
  "only my review" live behind one button that shows a badge when a filter is on.
- **Settings sheet.** Theme (auto/light/dark) and language, which are set-once
  preferences, move out of the header entirely.
- **Drag a sheet down to dismiss it.** The card, the belt picker, the filters and
  the settings all spring back if the pull is short.
- **The card opens as a sheet,** with the frames on top and the notes below.
- **Flashcards become a loop.** One card, a counter with a progress bar, and a
  single action row pinned above the tab bar: "Mostrar respuesta" on the front,
  then "Otra vez" / "La sé" on the back, where assessing the card is what moves
  on. Swipe left and right to change card. The chevrons, the "Barajar" button
  and the bare "Me la sé" checkbox stay for desktop only.
- **The answer leads with one readable frame** at 4:3 with paging dots, instead
  of a 16:5 strip crushed behind its own phase labels. The notes lose their
  three-line clamp and the remaining key points sit behind one tap.
- **The marketing prelude is dropped** so the first technique appears in the
  first screen rather than ~635 px down.
- **It installs to the home screen and runs offline.** A web-app manifest and a
  service worker cache the shell; the technique frames are cached as they are
  seen. Once visited, it opens on the mat with no signal.

Every interactive control has a minimum 44 px touch target. The phone rules live
in one `@media (max-width: 719px)` block at the end of `styles.css`, so the
desktop layout is untouched.

## Run it

Open `index.html` directly, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deep links and URL parameters

- `#browse`, `#flashcards`, `#speed`, `#glossary`
- `#card/katame.kote-gaeshi`
- `?lang=en|es`, `?sort=syllabus|teaching|views`, `?grade=all|5th|4th|3rd|2nd|1st`
- `?theme=light|dark|auto`

Example: `index.html?lang=es&sort=teaching&grade=4th#browse`

## Deploy to GitHub Pages

The repository root is already the published site.

1. Create a repository and push this folder to `main`.
2. On GitHub: **Settings → Pages → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. The app appears at `https://<user>.github.io/<repo>/`.

`.nojekyll` is included so Pages serves the files as-is.

## Structure

```
index.html      markup and view shells
styles.css      all styling (light/dark themes)
app.js          rendering, routing, flashcards, speed round, audio
i18n.js         English/Spanish interface strings
data.js         all technique, category and glossary content
cards/<id>/     technique frame images (01.jpg … 05.jpg)
sw.js           service worker: offline shell, cached frames
manifest.webmanifest   installable web app
favicon.png     app icon, from the RFEJYDA Jiu-Jitsu patch (64 px)
apple-touch-icon.png   home-screen icon (180 px)
icon-512.png    large icon (512 px)
```

`data.js` is the single source of content. Each technique carries its Japanese
name, translation, cue, key points, mistakes, source video and frame list.

## Audio

Every Japanese name and word chip has a speaker button. It uses the browser's
`speechSynthesis` with a Japanese voice when one is installed, converting the
romaji name to hiragana first so the voice cannot misread a kanji. If no
Japanese voice is installed the app says so once and falls back to the default.

## Sources and scope

Frames are stills from the credited YouTube sources; every card names its
source and links to the full video. The material is for private study. Where
Maria Merino Fernández's channel does not cover a technique, another credited
channel is used (for example El Idrissi Judo Academy, Efficient Judo, Pudsey
Judo, Kyushin Ryu). Dan material is out of scope.
