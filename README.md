# Jiu-Jitsu Name Atlas

A small, offline-friendly web app for learning the names in the RFEJYDA
Jiu-Jitsu kyu syllabus. It covers all five kyu belts (5th yellow → 1st brown):
**103 techniques** across 8 categories, with **393 technique frames** and a
**98-term glossary**. The interface is bilingual (Spanish from Spain by
default, English toggle); Japanese names stay Japanese.

The whole app is static: no build step, no server, no dependencies. Open
`index.html` in any modern browser and it works — including from `file://`.

## Views

- **Browse** — search, filter by category, sort by syllabus order, teaching
  order or source-video view count, and open a technique for a large stage with
  selectable phase thumbnails, key points, mistakes and the source video.
- **Flashcards** — name → technique and technique → name, with shuffle and a
  saved "known" list.
- **Speed Round** — 60 seconds, name → picture or picture → name, with a best
  score saved locally.
- **Glossary** — Japanese name parts, basic terms and what each category means.

The belt bar in the header filters every view. The choice is remembered in
`localStorage` and can be set from the URL.

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
