# Neuro-toons Website

A content-driven blog. Write posts as Markdown files, drop pictures into `images/`, run one command, and the site is built into `public/`. Needs Node.js; run `npm install` once to get `sharp`, which watermarks the pictures.

## Folders

```
content/              ← ALL TEXT lives here
  site.json           ← homepage text: hero, today's toon, section titles, about, footer & social links
  topics/*.md         ← one file per topic card (Neuroscience, Biology, …)
  comics/*.md         ← one file per comic post
  shorts/*.md         ← one file per short/video post
  */_template.md      ← copy these to start a new file (files starting with _ are ignored)
images/               ← ALL PICTURES live here
  comics/  shorts/  topics/  site/
styles.css            ← the original design (do not edit)
blog.css              ← extra styles for post/topic pages only
build.js              ← the generator
public/               ← GENERATED website — upload this folder. Never edit it by hand.
```

## Commands

```bash
npm run dev      # preview at http://localhost:8080, rebuilds whenever you save (no public/ folder created)
npm run build    # build once into public/
```

(Same as `node build.js --serve` / `node build.js`.) You can also just open `public/index.html` in a browser.

## Add a comic

1. Put the picture in `images/comics/`, e.g. `images/comics/synapse.png`.
2. Copy `content/comics/_template.md` to `content/comics/synapse.md`.
3. Fill in the top section (title, summary, date, topic, `image: images/comics/synapse.png`) and write the post below it in Markdown. Remove `draft: true`.
4. Run `npm run build`. The page appears at `public/comics/synapse.html`. It is added to the comics page and its topic page, and to the homepage if it is among the 3 newest.

Shorts work the same way (`content/shorts/`). Add `video:` with a YouTube link to embed it.

## Writing tips

- **Front matter fields**: see the `_template.md` files — each field is explained there.
- **Pictures inside a post**: `![description](images/comics/panel-2.png)`
- **No image yet?** Leave `image:` empty — the card shows the coloured cover (`cover_text` / `emoji`) like the original design.
- **Colours**: `color: pink | green | yellow | blue | purple`
- **Hide from homepage**: `home: false` · **Hide completely**: `draft: true` · **Show as "Coming soon"** (card only, no page): `coming_soon: true`
- **Homepage order**: newest `date` first; topics by `order`.
- The build prints a ⚠ warning when an image path or topic doesn't exist.
- **Watermark**: every PNG/JPG/WebP/AVIF picture 300px or wider gets "© Neuro-toons" stamped in its bottom-left corner in `public/`. Your originals in `images/` are never changed.

## Publishing

The site is hosted on GitHub Pages at https://neuro-toons.github.io from the `Neuro-toons/neuro-toons.github.io` repo.
Every push to `main` runs `.github/workflows/deploy.yml`, which builds the site and publishes `public/`; you never commit `public/` yourself.

```bash
git add -A
git commit -m "Add new comic"
git push
```

Progress shows in the repo's **Actions** tab; the site updates a minute or two after the push.
One-time setup (already needed before the first deploy): repo **Settings → Pages → Source: GitHub Actions**.

Any other static host works too: run `npm run build` and upload the contents of `public/`. All links are relative, so it also works from a sub-folder.

Footer links whose `link` is still `"#"` in `content/site.json` are hidden until you fill them in.
