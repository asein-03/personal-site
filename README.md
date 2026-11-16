# albertsein.com

Albert Sein's portfolio: a plain static site on Vercel, with no build step.

## Pages

- `index.html`: the front page. Intro, the Aperture (BCI) work, projects, how I work, experience, skills, outside of
  work, contact.
- `aperture.html`, `snack.html`, `ordo.html`, `builds.html`: one page per project, served at `/aperture` and so on
  (`cleanUrls` in `vercel.json`).
- `404.html`, `sitemap.xml`, `robots.txt`.

Old page addresses from the previous site (`/background`, `/off-the-grid`, `/contact`, `/ordo-desktop`) redirect to
where that content lives now; see `vercel.json`.

## Shared files

- `assets/site.css`: every page's styles.
- `assets/site.js`: the header hairline and fade-in on scroll.
- `assets/viewer.js`: the 3D CAD viewer. Any `<figure class="viewer" data-model="…">` gets a live, drag-to-turn
  model from `/models`, with "Take apart" and "Close the lid" buttons where the model supports them. The figure's
  poster image shows first, and stays if WebGL is missing.

Every page links these with a `?v=` version taken from their contents, so an edit reaches visitors at once instead of
after their browser's cached copy expires. **After editing anything in `assets/`, run `node tools/stamp.mjs`.**

## Assets

- `models/*.bin`: CAD exports, packed with meshopt by `tools/cad/` (`convert.mjs` from the CAD, `repack.mjs` to
  repack).
- `media/renders/*.webp`: poster stills of each model, rendered by `node tools/renders/render.mjs`. Each matches the
  opening view of a viewer on the site, so change both together.
- `og.png`: the link-preview card, rendered from `tools/og/card.html` by `node tools/og/render.mjs`.
- `media/ordo`, `media/covers`, `media/posters`: app screenshots, album covers and film posters.

`tools/` and `archive/` are not deployed (`.vercelignore`).

## The previous site

The newspaper-style edition is kept intact in `archive/newspaper/`, with a note on how to bring it back.
