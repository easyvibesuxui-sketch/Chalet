# CHALET — Alpine Villa Atelier

**Live:** https://easyvibesuxui-sketch.github.io/Chalet/
Published from this branch by `.github/workflows/pages.yml` on every push.

A one-page landing site for a fictional company that builds **cozy luxury villas in the mountains**.
Everything on the page is driven by scroll position — including the hero "video".

**Zero dependencies.** No framework, no build step, no CDN — the only network requests the
page makes are the Unsplash photos it hotlinks. Open `index.html` and it runs.

---

## The stage: one scrubbed sequence behind the whole page

> **No autoplay.** There is no `<video>` element, no timer and no playback loop anywhere in this
> project. The source clip was decoded into **80 still frames** (`assets/frames/f001…f080.webp`)
> that are painted onto a `<canvas>` — and a frame is only ever painted in response to a scroll
> position. Stop scrolling and the build freezes exactly where you left it.

There are two acts, and they hand over behind the Materials section:

- **Act I — the drawing resolving.** `assets/frames/`, 80 frames.
  `BLUEPRINT → STRUCTURE → STONE & LARCH → GLASS & WARMTH → DRAWN`
- **Act II — the build itself.** `assets/frames-b/`, 64 frames.
  `GROUNDWORKS → FRAME RAISED → ROOF & CLADDING → GLAZED → HANDOVER`

Two canvases share the stage and swap at the midpoint of Materials. That section
is opaque and so is the hearth below it, so the cut happens with the stage fully
covered and is never seen. Act II is constructed lazily, two and a half viewports
before it is needed — loading 64 more frames up front would compete with the
opening act for bandwidth the reader needs immediately.

The sequence is the page's spine, not a hero effect. `.stage` is fixed to the viewport and driven
by page scroll; sections marked `data-film` are transparent and let it through, and every other
section is opaque and covers it. So the backdrop returns six times between content, and the villa
has visibly moved on at each return:

| Beat | Section | Act | Stage |
|---|---|---|---|
| 1 | Hero | I | BLUEPRINT |
| 2 | Manifesto | I | BLUEPRINT |
| 3 | About the Mountain | I | STONE & LARCH |
| 4 | Stats | I | DRAWN |
| 5 | Owners | II | GROUNDWORKS |
| 6 | Valleys | II | FRAME RAISED |
| 7 | FAQ | II | ROOF & CLADDING |
| 8 | Contact | II | GLAZED → HANDOVER |

The beats are interleaved with content on purpose. Grouped together at the top they all fell inside
the first few frames, and the villa then jumped from drafting paper to finished in one cut; spread
through the page, the arc actually unfolds. The scrub runs from the top of the page to the bottom of
the last beat, so the villa is finished exactly when the closing section arrives rather than
somewhere under the footer.

The clip opens on white drafting paper and ends on a night exterior, so the scrim's `--wash` is
driven from scroll — heavy at the start to sink the paper into the page, nearly gone by the time
the villa is lit.

**Loading strategy:** frames load in a coarse-to-fine order (every 8th, then every 4th, then the
rest) with 6 requests in flight. The scrub becomes usable after ~24 frames; until a frame has
decoded, the nearest decoded neighbour is drawn, so it never flashes blank. The preloader dismisses
on whichever comes first: 24 frames, `window.load`, or a 7-second ceiling.

Regenerate the frames with:

```sh
ffmpeg -i source.mp4 -vf "fps=8,scale=1280:-2" -q:v 58 -c:v libwebp -compression_level 6 \
  assets/frames/f%03d.webp
```

If you change the count, update `FRAME_COUNT` at the top of `assets/js/main.js`.

---

## Sections

| # | Section | Scroll behaviour |
|---|---------|------------------|
| 01 | Hero | pinned 520vh track; canvas frame-scrub; title drifts apart and clears the frame |
| 02 | Ticker | translates with scroll **velocity** — and reverses when you scroll up |
| 03 | Manifesto | word-by-word masked reveal |
| 04 | About the Mountain | parallax backdrop behind a frosted glass panel |
| 05 | Stats | counters that run once on entry |
| 06 | Process | five sticky cards that stack into a deck, each pressed down by the next |
| 07 | Selected villas | pinned section, horizontal translate with a progress rail |
| 08 | Materials | clip-path reveals + per-card parallax |
| 09 | Inside | sticky image column against a scrolling feature list |
| 10 | Valleys | SVG ridge line drawn via `stroke-dashoffset`, pins fade in |
| 11 | Owners | staggered quote reveals |
| 12 | Collections | three glass pricing cards |
| 13 | FAQ | native `<details>` accordion |
| 14 | Contact | validated demo form (nothing is sent anywhere) |
| 15 | Footer | outlined wordmark with parallax |

## The hearth

The Inside section is a lit fire in a stone hearth with snow falling behind the
whole section. Neither layer is autoplaying media: the embers and the snow are
two canvas particle layers that run only while the section is on screen, and are
never created at all under `prefers-reduced-motion`. The firelight itself is a
CSS radial gradient on a slow breathing keyframe.

## Photography

Eleven section photographs come from Unsplash, hotlinked at full resolution and
sized per slot (`?auto=format&fit=crop&w=…&h=…&q=80`) — the pattern Unsplash asks
for, so views are counted for the photographers. Credits are in `CREDITS.md`;
`tools/photos.txt` is the manifest (slot, target aspect, photo file, id,
photographer).

Eleven photographers do not agree on a colour palette, so every stock photo runs
through one grade — `--grade` in the stylesheet, plus a low-opacity moss overlay
in `mix-blend-mode: color` on the cards — which pulls the set into the same
winter-forest register. Hover lifts the grade back toward the original.

`assets/img/` also holds a small cached copy of each photo. Those are what the
self-contained build inlines, since a published Artifact has no egress at all.

To self-host the photos at full resolution instead of hotlinking, or to swap in
different ones, edit `tools/photos.txt` and run:

```sh
tools/fetch-unsplash.sh                          # download what the file names
UNSPLASH_ACCESS_KEY=… tools/fetch-unsplash.sh --search   # or fill blanks by search
```

It centre-crops each photo to its slot's aspect, encodes WebP into `assets/img/`,
triggers the download endpoint the Unsplash API guidelines require, and rewrites
`CREDITS.md`. Only the public Access Key is ever needed — never the Secret Key.
Requires `ffmpeg`, `curl` and `jq`.

The hero frame sequence, the five `stage-*` stills and `blueprint-wide` are not
from Unsplash: they are the blueprint-to-house sequence decoded from the source
clip, and stock photography cannot tell that story.

## Files

```
index.html
assets/css/style.css     design tokens, layout, reveal primitives
assets/css/fonts.css     self-hosted @font-face (latin + latin-ext)
assets/js/main.js        the whole scroll engine (~500 lines, no deps)
assets/frames/           80 scrub frames
assets/img/              section imagery, cut from the same source clip
assets/fonts/            Archivo · Inter · DM Mono · Instrument Serif
```

## How the scroll engine works

One `requestAnimationFrame` loop drives every scroll-linked effect (`onScroll(fn)` registers a
task), which keeps layout reads batched into a single pass per frame. Discrete entrance animations
use `IntersectionObserver` instead, so they cost nothing while idle.

One gotcha worth knowing: an element with `clip-path: inset(0 0 100% 0)` reports an **empty
intersection rectangle**, so `IntersectionObserver` will never fire for it. Clip reveals therefore
register their parent as a `data-clip-group` and the parent releases the whole row.

## Accessibility

`prefers-reduced-motion: reduce` collapses the hero track to 150vh, skips the scrub entirely and
paints the **finished** villa, and resolves every reveal to its final state. Nothing is animation-gated.

## Design notes — Deep Frost

Near-black grounds (`#05090A` → `#121C1E`) carrying a cyan-green bias, so the neutrals belong to
the accent rather than sitting under it. Ice (`#9DB8B4`) does the talking; ember (`#C0703A`) is
spent only where we want a click.

Type is Bodoni Moda for display, Manrope for body, JetBrains Mono for labels, and Bodoni's own
italic for the one script accent. A Didone needs the opposite tracking to a grotesque, so every
negative letter-spacing in the stylesheet was opened back up to roughly zero. Bodoni's hairlines
also thin out badly over photography, which is why the manifesto runs at weight 600 and the one
em-dash inside it is set in the body face — as a hairline it disappeared into the film entirely.

The frosted-glass panels, vertical side text, oversized blended display type and pill buttons come
from the supplied UI references.

CHALET is a fictional brand, built as a scroll-animation demo. The hero sequence comes from the
supplied source clip; the section photography comes from Unsplash and is credited in `CREDITS.md`.
