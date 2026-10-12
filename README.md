# M2

Build modern, easy-to-use mind maps.

A map is a canvas of dotted paper. It grows out from one central idea:
each main idea gets its own colour, its branches curve outward and get
thinner as they go, and outer ideas are text underlined in the branch's
colour. Ideas are added, renamed, dragged and deleted; everything saves
on its own as you work.

## How it is put together

- `public/js/map-model.js` is the map model, shared by the page and the
  server (`server.js` requires it), so both validate a map the same way.
  A map is one JSONB document: `{ v: 1, nodes: [{ id, parent, text, x, y,
  color }] }`, exactly one root at 0,0, colour on main ideas only. An
  optional `links: [{ id, from, to, text }]` holds named lines between any
  two ideas, drawn dashed apart from the tree.
- `public/js/canvas.js` draws and edits one map; `public/js/maps-list.js`
  draws Your maps; `public/js/app.js` routes between them and runs the
  autosave queue (700 ms debounce, one PUT in flight, retrying after
  2, 5 and 10 s).
- `server.js` keeps the API under `/api/*`: list, welcome (first visit
  makes the example map), create, open, save, delete. Tables: `maps`,
  `profiles`, `demo_seeds`, all `staging:private` — maps are personal
  notes, so each person sees only their own.
- The look lives in `styles/tailwind-input.css` (colour tokens, light and
  dark) and `tailwind.config.js`; the design is written down in
  `CLAUDE.md` under "## Design".

## Staging demo

On a staging preview, open the app with `?demo=1`: the first call to
`GET /api/maps` seeds your account with eight made-up maps (Lisbon
weekend, Thesis outline, …) in one idempotent transaction, once per
viewing account. Your own edits and deletions to them stay; a reload
seeds nothing new. Production never writes demo rows.

## Brand

`brand/icon.png` is the home-screen tile and `brand/featured.png` the
featured card; see `brand/ICON.md`. The creator's sketch card is
`design/sketch.json`, kept as it is.
