# The newspaper edition (parked November 2026)

The site as it was before the clean redesign: a broadsheet front page, halftone 3D CAD chapters, and a
contents page with each section at its own address. It is kept here intact so it can come back at any time.

- `index.html` is the whole site. It reads its models and images from the site root (`/models`, `/media`),
  which the new site still ships, so nothing it needs was removed.
- `vercel.json` is the routing it ran with (each page address rewritten to `/index.html`).
- `og-tools/` rendered its link-preview card (`og.png`) from the live halftone plate.

To bring it back: copy `index.html` and `vercel.json` to the repo root and deploy. The last live
version is also tagged in git as `newspaper-edition`.

This folder is listed in `.vercelignore`, so it is not deployed.
