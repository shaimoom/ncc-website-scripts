# NCC Website Scripts

Motion and interaction scripts for the Newaz Clinical Consulting website, served to the Webflow site through jsDelivr, pinned to a commit.

- `js/`, `css/`: the commented sources. Edit these
- `dist/`: what the site loads. A minified, comment-free mirror of `js/`, `css/` and `vendor/three/`, same file names, so relative imports and the import map's `three/addons/` prefix resolve inside `dist/`. Do not edit by hand
- `img/`: the three value cards' still frames (source copies of the Webflow assets shown when a card cannot animate)
- `vendor/three/`: three.js 0.160.0, unmodified, MIT license included (its header is kept in `dist/`)

## Update the site

1. Edit the sources, then run `npm install` (first time) and `npm run build`
2. Commit `dist/` with the sources and push
3. In Webflow, replace the commit in every URL of the Site Code and Loader embeds. Every URL points into `dist/`
4. Do not use jsDelivr's automatic `.min.js`: it keeps relative imports on the commented files and adds its own comment banner

Built by Shai Creates.
