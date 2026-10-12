# M2's brand assets

- **`icon.svg` / `icon.png`** — the home-screen tile the platform shows: the
  platform's tile template on the teal pair `#34D3C3` → `#0B7D84` (the colour
  suggested for drawing tools), with M2's glyph in white on the inner group.
  The glyph is a small mind map — an ink centre with four curved branches to
  four dots — drawn on Lucide's 24-unit grid with Lucide's 2 px round strokes,
  because Lucide has no mind-map icon of its own. The PNG is 512 × 512, opaque,
  and ships with the app (`dapp.json` points `icon.image` at it; the 🧠 emoji
  stays as the fallback).
- **`featured.svg` / `featured.png`** — the featured card, 1200 × 630: the
  light paper ground with its dot grid, the tile, "M2" and the tagline
  "Clear, colourful mind maps" on the left, and a mind map drawn exactly like
  the canvas on the right (ink central pill, five main pills in the five
  branch colours, underlined outer ideas, curves that thin outward). The
  platform has no setting that points at it, so it is a committed asset ready
  to use.
- **`sketch.json` is not here on purpose**: `design/sketch.json` in the repo
  root is the card the app's creator was shown while describing the idea. It
  is context, not a design, and stays as it is.
