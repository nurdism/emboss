# Emboss

A browser tool that turns text and an SVG into a two colour 3MF sign, ready to
open in Bambu Studio or OrcaSlicer and print on an AMS or other multi material
setup. Everything runs client side. No upload, no server.

```
pnpm install     # or npm install
npm run dev      # http://localhost:5173
npm run check    # geometry and package validation
npm run build    # static bundle in dist/
```

## How the colour split works

The sign is exported as one object made of several parts, each pinned to a
filament slot in `Metadata/model_settings.config`, so it opens already split by
colour. Pick the actual filaments in the slicer. The colour pickers in the app
only affect the preview.

Two tone is the default:

| Part    | Slot | What it is                       |
| ------- | ---- | -------------------------------- |
| Plate   | 1    | The sign body and mounting holes |
| Artwork | 2    | Text, icon and border together   |

Switch Colours to "a colour per element" and each one gets its own body and its
own slot:

| Part   | Slot | What it is                  |
| ------ | ---- | --------------------------- |
| Plate  | 1    | The sign body               |
| Text   | 2    | The label                   |
| Icon   | 3    | The imported SVG or icon    |
| Border | 4    | The rim                     |

Slots are handed out in order over the parts that actually exist, so a sign with
no icon uses 1, 2 and 3 rather than leaving a gap.

## The panel

Start from a preset along the top, then open the group you want. Groups
remember whether you left them open, and a collapsed group shows a one line
digest of its settings. Download and Copy link stay pinned to the bottom, so
they are always one click away.

Drag the panel's right edge to widen it, or use the chevron in the header to
hide it and give the preview the whole window. Ctrl+Z and Ctrl+Shift+Z undo and
redo, and the arrows in the header do the same.

## Controls

**Text**. Any label, newlines make new lines. Search the whole Google Fonts
catalogue, around 1,900 families, and pick a weight. Six faces ship with the app
so it still works offline, and you can drop in your own TTF or OTF. Size in
millimetres, tracking, line spacing, alignment, and a nudge if you want it off
centre.

**Artwork**. Search Iconify, which indexes well over a hundred thousand open
licensed icons, and click one to drop it on the sign. You can also browse the
full [Iconify icon sets](https://icon-sets.iconify.design/) and paste an id such
as `mdi:home` straight in, or load your own SVG file. Either way it is scaled so its longest side matches the size you set.
Place it above, below, left, or right of the text with a gap, or switch to
manual and position it yourself. Filled paths work best. Stroke only drawings
are extruded as if filled, with a warning.

**Plate**. Rectangle, rounded rectangle, square, circle, ellipse, pill,
triangle, hexagon, octagon, stop sign, or shield. Square, circle and stop sign
are always as tall as they are wide, so they take a single size. Leave "fit
plate to artwork" on and the plate sizes itself around the text with the padding
you choose, including extra room for mounting holes and the border. Turn it off
to set width and height by hand.

**Border**. A rim that follows the plate outline, printed in the artwork colour
at the artwork depth. The width slider sets its thickness, zero turns it off,
and the inset slider sets how far in from the edge it sits. It is a true
perpendicular offset, so the rim keeps an even width all the way round on every
shape. Mounting holes move inside the rim when one is on, and a border too wide
for the plate, or one that would cross the artwork, is refused with a message
rather than producing a broken mesh.

**Depth**. Two styles:

- *Raised on top* puts the artwork on the plate surface. Total height is plate
  depth plus art depth.
- *Inlaid flush* mills a recess into the plate and fills it with the second
  colour, so the face is smooth. If the art depth reaches the plate depth it
  becomes a through cut.

**Mounting holes**. Top centre, top corners, or four corners. Holes that would
run off the plate, collide with each other, or cut into the artwork are dropped
and reported rather than producing a broken mesh.

**View**. Guides beside the sign call out its width, height, and total build
height in millimetres. The buttons on the canvas fit the view, look straight
down, swing back to an angle, and turn the guides off.

Every measurement has a slider for feel and a number box next to it for an exact
figure. The two stay in step, so drag or type, whichever suits.

## Sharing a design

Every setting is written to the address bar as you work, so the link in the
browser is the design. "Copy link to this sign" puts it on the clipboard.

The link carries the artwork too. Settings and the SVG are packed into JSON,
deflated, and base64 encoded into the fragment, which takes a typical icon down
to a few hundred characters. Only settings that differ from the defaults are
included. Nothing is uploaded, because a fragment never leaves the browser.

An uploaded font file is the one exception. Those run to hundreds of kilobytes
and would not survive the trip, so pick a Google font if you want the link to
carry the typeface.

The share button next to Copy link opens the operating system's share sheet
where the browser supports it, and posts to Bluesky, Mastodon, X, Reddit or
email otherwise.

### Short links

A design with an icon in it makes for a long URL, and some apps trim those.
`worker/` is a small Cloudflare Worker that trades the fragment for a short id,
turning the link into `.../#s=ab12cd`. It is deployed at
**https://emboss-shortener.nurdism.dev**.

There is no compression involved and no database in the usual sense. The Worker
takes the fragment exactly as the app produced it, generates ten random
characters from a 32 letter alphabet, and stores the pair in Workers KV. The
short link is pure indirection: opening one fetches `/api/expand/<id>` and the
app decodes the payload that comes back as if it had been in the URL all along.

| Endpoint            | Method | Does                                     |
| ------------------- | ------ | ---------------------------------------- |
| `/api/shorten`      | POST   | Stores `{payload}` and returns `{id}`    |
| `/api/expand/<id>`  | GET    | Returns `{payload}`                      |
| `/health`           | GET    | Liveness check                           |

Payloads are opaque to the Worker, capped at 128 KB, and expire after a year.
Ids are drawn with `crypto.getRandomValues` and checked for collisions before
writing, so one link tells you nothing about the next. `ALLOWED_ORIGINS` in
`wrangler.jsonc` limits who may call it, and any localhost port is allowed so
local development needs no configuration.

To run your own:

```
cd worker
npx wrangler kv namespace create LINKS           # paste the id into wrangler.jsonc
npx wrangler kv namespace create LINKS --preview # paste as preview_id
npx wrangler deploy
```

Then point the app at it with `VITE_SHORTENER_URL` (see `.env.example`, or the
`SHORTENER_URL` repository variable for the deploy workflow). Left unset, the
option simply does not appear and full links keep working.

## Printing notes

- Inlay style prints with a flat top face and needs no supports.
- Raised style with a small art depth (0.6 to 1.0 mm) is usually two or three
  layers of the second colour, which keeps filament changes cheap.
- Detail thinner than a nozzle width will not come out as a separate colour. The
  app warns when inlay artwork drops below 0.8 mm.
- The sign is placed at the centre of the bed you select.

## Layout

```
src/core/
  types.ts      sign configuration and defaults
  contours.ts   contour nesting, the even-odd solid and hole rule
  fonts.ts      Google Fonts catalogue and TrueType loading
  icons.ts      Iconify search and icon fetching
  text.ts       glyph outlines via opentype.js
  svg.ts        SVG parsing into contours
  plate.ts      plate outlines, corner rounding, inward offset, hole placement
  repair.ts     normalises overlapping and self-crossing outlines
  mesh.ts       extrusion, cap triangulation, pocketed solids
  build.ts      composes everything into plate and artwork meshes
  threemf.ts    Bambu and Orca project 3MF writer
  share.ts      packs the design into the address bar
  shortlink.ts  optional short links via the Cloudflare Worker
  presets.ts    starting points offered above the controls
src/ui/
  viewer.ts     three.js preview
  dimensions.ts measurement guides drawn in the scene
  fontpreview.ts lazy font previews in the picker
  panel.ts      resizing and hiding the left panel
  share-menu.ts where a link can be sent
src/main.ts     control binding and export
scripts/
  validate.ts   watertightness and package checks
  make-og.mjs   renders the social card from the app
worker/
  src/index.ts  the link shortener
```

### Why a custom extruder

`ExtrudeGeometry` triangulates caps with earcut, which bridges holes using edges
that can run straight through other vertices. That leaves T-junctions, and a
plate with several letters cut into it stops being watertight. `mesh.ts` splits
every such edge at the vertices lying on it, welds vertices as it goes, and
builds inlay plates as a single pocketed solid instead of two stacked ones. The
checks in `scripts/validate.ts` assert the result: in a closed mesh every
directed edge appears exactly as often as its reverse.

### Why outlines are unioned before use

TrueType fills with the nonzero winding rule, and real fonts lean on it hard.
Playfair Display draws serifs as separate contours lapping over the stem, and
its `8` is a single self-crossing stroke whose counters exist only because the
path doubles back. Nesting rings by containment cannot describe that, and
feeding such outlines to a triangulator produced a surface full of holes.

`repair.ts` unions the outlines first, which resolves every overlap and self
crossing into plain nested rings before anything measures or extrudes them.
`scripts/fixtures/PlayfairDisplay-Regular.ttf` is checked in for exactly this
reason, and `npm run check` asserts that face still comes out watertight.

### Why the border is a half-plane intersection

Offsetting an outline inwards edge by edge folds the corners through themselves
once the distance passes the corner radius, which quietly produced a broken
mesh. Every plate outline here is convex, and the inward offset of a convex
polygon is exactly the intersection of its edge half-planes pushed inwards, so
`offsetInward` in `plate.ts` builds it that way. Corners get clipped instead of
inverted, and the outline simply runs out when the border is too wide.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. Turn it on once in the repository settings under
Pages by setting the source to GitHub Actions. Pull requests and other branches
run the same type check, geometry assertions, and build through
`.github/workflows/ci.yml` without deploying.

The build uses relative asset paths, so it works from a project subpath such as
`user.github.io/emboss/` without further configuration.

## Fonts

The bundled faces in `public/fonts` are DejaVu (free licence) and Liberation
(SIL Open Font License). The Google Fonts catalogue is fetched from
`api.fontsource.org`, and the TrueType files come from jsDelivr at
`cdn.jsdelivr.net/fontsource/fonts/<id>@latest/<subset>-<weight>-normal.ttf`.
Both are fetched only when you use them, and the app falls back to the bundled
faces if they cannot be reached. In the picker each family name is drawn in its
own face, subset to just the characters in the name, so browsing the list stays
cheap. Drop any TTF or OTF into the custom file field to use your own.

Icons come from the Iconify API at `api.iconify.design`, fetched only when you
search.
