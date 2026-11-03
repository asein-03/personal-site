# albertsein.com

Personal site and engineering portfolio for **Albert Sein**, materials and systems engineering at UVA.

A single static page with no build step. It follows the Aperture site's look: black, grey and white, Newsreader for display type, and the CAD models rendered live with three.js (loaded from jsDelivr, as are Lenis and Google Fonts).

- `index.html`: the whole site. Each project is a `.chapter`; each `.step` inside it sets the model's pose with `data-yaw`, `data-pitch`, `data-explode`, `data-zoom` and `data-measure`.
- `models/*.bin`: the CAD models, converted from the real STEP, STL and OBJ exports. Electronics appear as the plain blocks Fusion uses (no copper or part numbers). Snack is built from the Otto R07 rights-clean export, which leaves out third-party supplier models.
- `tools/cad/`: the converter. Run `cd tools/cad && npm install && npm run models` after a CAD change; `node inspect.mjs file.step` lists a STEP file's bodies so you can pick them. None of it is deployed (see `.vercelignore`).
- `albert-sein-resume.pdf`: résumé, linked from the nav and the contact section.

## Deploy

Static hosting. On Vercel: import the repo, framework preset **Other**, no build command, output directory = repo root. Then add the custom domain `albertsein.com`.
