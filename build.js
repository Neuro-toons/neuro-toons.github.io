#!/usr/bin/env node
// Neuro-toons static site builder — only dependency is sharp (for watermarking images).
//   node build.js           → builds the site into public/
//   node build.js --serve   → dev mode: serves http://localhost:8080 and rebuilds on every change
//                             (builds into a temp folder, so no public/ folder is created)
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONTENT = path.join(ROOT, 'content');
const SERVE = process.argv.includes('--serve');
const OUT = SERVE ? path.join(require('os').tmpdir(), 'neurotoons-dev') : path.join(ROOT, 'public');
const COLORS = ['pink', 'green', 'yellow', 'blue', 'purple'];
const WATERMARK_EXT = /\.(png|jpe?g|webp|avif)$/i;
const WATERMARK_MIN_WIDTH = 300; // smaller images (icons, thumbnails) are left alone

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isExternal = p => /^(https?:|mailto:|tel:|data:|\/\/)/.test(p);
// Web links open in a new tab; mailto:/tel: links don't (they'd leave an empty tab behind).
const newTab = p => /^(https?:|\/\/)/.test(p) ? ' target="_blank" rel="noopener"' : '';
const isVideoFile = p => /\.(mp4|webm|mov)$/i.test(p || '') && !isExternal(p);
// Turns a content path ("images/x.png", "/images/x.png", "comics.html") into a link relative to the current page.
const url = (p, root) => (!p || isExternal(p) || p.startsWith('#')) ? (p || '#') : root + p.replace(/^\/+/, '');
// Section anchors like "#comics" only exist on the home page.
const href = (p, root, isHome) => (p && p.startsWith('#') && !isHome) ? `${root}index.html${p === '#home' ? '' : p}` : url(p, root);
const pick = (value, list, i) => (value && list.includes(value)) ? value : list[i % list.length];
const warn = msg => console.warn(`  ⚠ ${msg}`);

function formatDate(d) {
  const date = new Date(d);
  if (isNaN(date)) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function youtubeEmbed(link) {
  const m = String(link || '').match(/(?:youtu\.be\/|[?&]v=|shorts\/|embed\/)([\w-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

// ---------- front matter ----------
function parseValue(v) {
  if (v === '') return '';
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map(s => parseValue(s.trim())).filter(x => x !== '');
  if (/^".*"$/.test(v) || /^'.*'$/.test(v)) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function parseFrontMatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: src };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (kv) data[kv[1]] = parseValue(kv[2].trim());
  }
  return { data, body: m[2] };
}

// ---------- markdown ----------
function inline(s, root) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, alt, src, title) => `<img src="${url(src, root)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, text, link) => `<a href="${url(link, root)}"${newTab(link)}>${text}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[i]);
}

const LIST_ITEM = /^\s*([-*+]|\d+\.)\s+(.*)$/;
const BLOCK_START = /^(#{1,6}\s|>|```|\s*([-*+]|\d+\.)\s|<|(---|\*\*\*|___)\s*$)/;

function markdown(src, root) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0, m;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      out.push(`<h${m[1].length}>${inline(m[2], root)}</h${m[1].length}>`);
      i++;
    } else if (/^(---|\*\*\*|___)\s*$/.test(line)) {
      out.push('<hr>');
      i++;
    } else if (line.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${markdown(buf.join('\n'), root)}</blockquote>`);
    } else if ((m = line.match(LIST_ITEM))) {
      const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
      const items = [];
      while (i < lines.length && (m = lines[i].match(LIST_ITEM))) {
        let item = m[2];
        i++;
        while (i < lines.length && /^\s+\S/.test(lines[i]) && !LIST_ITEM.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item, root)}</li>`);
      }
      out.push(`<${tag}>${items.join('')}</${tag}>`);
    } else if (line.startsWith('<')) {
      const buf = [];
      while (i < lines.length && lines[i].trim()) buf.push(lines[i++]);
      out.push(buf.join('\n'));
    } else {
      const buf = [lines[i++].trim()];
      while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) buf.push(lines[i++].trim());
      out.push(`<p>${inline(buf.join(' '), root)}</p>`);
    }
  }
  return out.join('\n');
}

// ---------- content ----------
function loadCollection(dir, kind) {
  const full = path.join(CONTENT, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full)
    .filter(f => f.endsWith('.md') && !f.startsWith('_'))
    .map(f => {
      const { data, body } = parseFrontMatter(fs.readFileSync(path.join(full, f), 'utf8'));
      return { ...data, kind, slug: String(data.slug || f.replace(/\.md$/, '')), body };
    })
    .filter(p => p.draft !== true);
}

function checkImage(p, where) {
  if (p && !isExternal(p) && !fs.existsSync(path.join(ROOT, p.replace(/^\/+/, '')))) warn(`${where}: image not found → ${p}`);
}

function loadContent() {
  const site = JSON.parse(fs.readFileSync(path.join(CONTENT, 'site.json'), 'utf8'));
  const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.title).localeCompare(String(b.title));
  const byDate = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.title).localeCompare(String(b.title));

  const topics = loadCollection('topics', 'topics').sort(byOrder);
  topics.forEach((t, i) => { t.color = pick(t.color, COLORS, [0, 1, 3, 4, 2][i % 5]); });
  const topicMap = Object.fromEntries(topics.map(t => [t.slug, t]));

  const comics = loadCollection('comics', 'comics').sort(byDate);
  const shorts = loadCollection('shorts', 'shorts').sort(byDate);
  comics.forEach((p, i) => { p.color = pick(p.color, COLORS, [2, 3, 1, 0, 4][i % 5]); });
  shorts.forEach((p, i) => { p.color = pick(p.color, COLORS, i); });

  for (const p of [...comics, ...shorts]) {
    const where = `content/${p.kind}/${p.slug}.md`;
    if (p.topic && !topicMap[p.topic]) warn(`${where}: unknown topic "${p.topic}" (add content/topics/${p.topic}.md)`);
    p.topicData = topicMap[p.topic];
    p.tag = p.tag || (p.topicData ? String(p.topicData.title).toUpperCase() : '');
    checkImage(p.image, where);
    if (isVideoFile(p.video)) checkImage(p.video, where);
  }
  topics.forEach(t => checkImage(t.icon, `content/topics/${t.slug}.md`));
  checkImage(site.todays_toon?.image, 'content/site.json (todays_toon)');
  return { site, topics, comics, shorts };
}

// ---------- templates ----------
function layout({ site, root, isHome, title, description, main }) {
  const nav = site.nav.map(n => `      <a href="${href(n.link, root, isHome)}">${n.label}</a>`).join('\n');
  // Footer links without a real address yet ("#" or empty) are left out until one is filled in.
  const links = site.footer.links.filter(l => l.link && l.link !== '#').map(l => `<a href="${url(l.link, root)}"${newTab(l.link)}>${l.label}</a>`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${esc(description)}">
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="${root}styles.css">
  <link rel="stylesheet" href="${root}blog.css">
</head>
<body>
  <header class="site-header">
    <a class="logo" href="${isHome ? '#home' : root + 'index.html'}" aria-label="${esc(site.name)} home">
      <span class="logo-brain">${site.logo.emoji}</span>
      <span>${site.logo.text}</span>
    </a>
    <button class="menu-btn" aria-label="Open menu">☰</button>
    <nav class="nav">
${nav}
    </nav>
  </header>

${main}

  <footer>
    <div class="footer-brand"><span>${site.logo.emoji}</span> ${site.name}</div>
    <p>${site.footer.tagline}</p>
    <div class="footer-links">${links}</div>
    <small>${site.footer.copyright}</small>
  </footer>

  <script>
    const btn = document.querySelector('.menu-btn');
    const nav = document.querySelector('.nav');
    btn.addEventListener('click', () => nav.classList.toggle('open'));
    document.querySelectorAll('.nav a').forEach(a => a.addEventListener('click', () => nav.classList.remove('open')));
  </script>
</body>
</html>
`;
}

const img = (src, alt, root) => `<img src="${url(src, root)}" alt="${esc(alt)}" loading="lazy">`;

// A topic's drawn icon (icon: in its .md file), falling back to its emoji.
const topicIcon = (t, root, cls = 'topic-icon') => t.icon ? `<img class="${cls}" src="${url(t.icon, root)}" alt="">` : (t.emoji || '');

const topicCard = (t, root) =>
  `<a class="topic-card bg-${t.color}" href="${root}topics/${t.slug}.html"><span>${topicIcon(t, root)}</span><h3>${t.title}</h3><p>${t.description || ''}</p></a>`;

// "Coming soon" posts (coming_soon: true) show a card with a badge, but no link and no page of their own.
const cardOpen = (p, cls, root) => p.coming_soon ? `<div class="${cls} coming-soon">` : `<a class="${cls}" href="${root}${p.kind}/${p.slug}.html">`;
const cardClose = p => p.coming_soon ? '</div>' : '</a>';
const soonBadge = p => p.coming_soon ? '<span class="soon-badge">COMING SOON</span>' : '';

// Card thumbnail: the image, else the first frame of a local video file, else the emoji.
const shortThumb = (p, root) => p.image ? img(p.image, p.title, root)
  : isVideoFile(p.video) ? `<video src="${url(p.video, root)}#t=0.1" muted playsinline preload="metadata" aria-hidden="true"></video>`
  : (p.emoji || '');

const shortCard = (p, root) =>
  `${cardOpen(p, 'short-card', root)}<div class="thumb bg-${p.color}${p.image || isVideoFile(p.video) ? ' has-image' : ''}">${shortThumb(p, root)}<span>▶</span></div><h3>${soonBadge(p)}${p.title}</h3><p>${p.summary || ''}</p>${cardClose(p)}`;

const comicCard = (p, root) =>
  `${cardOpen(p, 'comic-card', root)}<div class="comic-image bg-${p.color}${p.image ? ' has-image' : ''}">${p.image ? img(p.image, p.title, root) : (p.cover_text || p.title)}</div><div><span class="tag">${p.tag}</span><h3>${soonBadge(p)}${p.title}</h3><p>${p.summary || ''}</p></div>${cardClose(p)}`;

const cards = (list, fn, root, indent = '        ') => list.map(p => indent + fn(p, root)).join('\n');

function homePage(c) {
  const { site } = c, root = '', s = site.sections, hero = site.hero, toon = site.todays_toon;
  const forHome = list => list.filter(p => p.home !== false);
  const main = `  <main id="home">
    <section class="hero">
      <div class="doodle doodle-one">✦</div>
      <div class="hero-copy">
        <p class="eyebrow">${hero.eyebrow}</p>
        <h1>${hero.title}<br><span>${hero.title_highlight}</span></h1>
        <p class="hero-text">${hero.text}</p>
        <div class="hero-actions">
          <a class="btn primary" href="${href(hero.primary_button.link, root, true)}">${hero.primary_button.label}</a>
          <a class="btn secondary" href="${href(hero.secondary_button.link, root, true)}">${hero.secondary_button.label}</a>
        </div>
        <div class="mini-stats">
${hero.stats.map(st => `          <div><strong>${st.value}</strong><span>${st.label}</span></div>`).join('\n')}
        </div>
      </div>
      <div class="hero-art">
        <${toon.link ? `a href="${href(toon.link, root, true)}"` : 'div'} class="paper-card">
          <div class="card-label">${toon.label}</div>
          <div class="brain-character${toon.image ? ' has-image' : ''}">${toon.image ? img(toon.image, toon.speech.replace(/<[^>]+>/g, ' '), root) : toon.emoji}</div>
          <div class="speech">${toon.speech}</div>
          <div class="scribble">${toon.scribble}</div>
          <div class="watermark">${site.name}</div>
        </${toon.link ? 'a' : 'div'}>
      </div>
    </section>

    <section class="section" id="topics">
      <div class="section-heading">
        <div><p class="eyebrow">${s.topics.eyebrow}</p><h2>${s.topics.title}</h2></div>
        <p>${s.topics.text}</p>
      </div>
      <div class="topic-grid">
${cards(c.topics, topicCard, root)}
      </div>
    </section>

    <section class="section tinted" id="shorts">
      <div class="section-heading">
        <div><p class="eyebrow">${s.shorts.eyebrow}</p><h2>${s.shorts.title}</h2></div>
        <a class="text-link" href="shorts.html">${s.shorts.link_label}</a>
      </div>
      <div class="shorts-grid">
${cards(forHome(c.shorts).slice(0, s.shorts.home_count ?? 3), shortCard, root)}
      </div>
    </section>

    <section class="section" id="comics">
      <div class="section-heading">
        <div><p class="eyebrow">${s.comics.eyebrow}</p><h2>${s.comics.title}</h2></div>
        <a class="text-link" href="comics.html">${s.comics.link_label}</a>
      </div>
      <div class="comic-grid">
${cards(forHome(c.comics).slice(0, s.comics.home_count ?? 3), comicCard, root)}
      </div>
    </section>

    <section class="learn-banner" id="learn">
      <div>
        <p class="eyebrow">${site.learn.eyebrow}</p>
        <h2>${site.learn.title}</h2>
        <p>${site.learn.text}</p>
      </div>
      <a class="btn primary" href="${href(site.learn.button.link, root, true)}">${site.learn.button.label}</a>
    </section>

    <section class="section about" id="about">
      <div class="about-card">
        <div class="about-icon">${site.about.emoji}</div>
        <div><p class="eyebrow">${site.about.eyebrow}</p><h2>${site.about.title}</h2>
        <p>${site.about.text}</p></div>
      </div>
    </section>
  </main>`;
  return layout({ site, root, isHome: true, title: site.page_title, description: site.description, main });
}

function listingPage(c, kind) {
  const { site } = c, root = '', s = site.sections[kind];
  const list = c[kind];
  const grid = kind === 'comics' ? 'comic-grid' : 'shorts-grid';
  const fn = kind === 'comics' ? comicCard : shortCard;
  const main = `  <main>
    <section class="section">
      <div class="section-heading">
        <div><p class="eyebrow">${s.eyebrow}</p><h2>${s.title}</h2></div>
        <p>${s.page_text || ''}</p>
      </div>
      ${list.length ? `<div class="${grid}">\n${cards(list, fn, root)}\n      </div>` : '<p class="empty-note">Nothing here yet — check back soon!</p>'}
    </section>
  </main>`;
  return layout({ site, root, isHome: false, title: `${s.title.replace(/<[^>]+>/g, '')} | ${site.name}`, description: s.page_text || site.description, main });
}

function topicPage(c, t) {
  const { site } = c, root = '../';
  const comics = c.comics.filter(p => p.topic === t.slug);
  const shorts = c.shorts.filter(p => p.topic === t.slug);
  const body = t.body.trim() ? `\n      <div class="post-body">\n${markdown(t.body, root)}\n      </div>` : '';
  const main = `  <main>
    <section class="section">
      <a class="text-link post-back" href="${root}index.html#topics">← All topics</a>
      <div class="section-heading">
        <div><p class="eyebrow">TOPIC</p><h2>${topicIcon(t, root, 'topic-icon-inline')} ${t.title}</h2></div>
        <p>${t.description || ''}</p>
      </div>${body}
    </section>
${comics.length ? `
    <section class="section">
      <div class="section-heading"><div><p class="eyebrow">${site.sections.comics.eyebrow}</p><h2>${site.sections.comics.title}</h2></div></div>
      <div class="comic-grid">
${cards(comics, comicCard, root)}
      </div>
    </section>` : ''}${shorts.length ? `
    <section class="section tinted">
      <div class="section-heading"><div><p class="eyebrow">${site.sections.shorts.eyebrow}</p><h2>${site.sections.shorts.title}</h2></div></div>
      <div class="shorts-grid">
${cards(shorts, shortCard, root)}
      </div>
    </section>` : ''}${!comics.length && !shorts.length ? `
    <section class="section"><p class="empty-note">No posts in this topic yet — check back soon!</p></section>` : ''}
  </main>`;
  return layout({ site, root, isHome: false, title: `${t.title} | ${site.name}`, description: t.description || site.description, main });
}

function postPage(c, p) {
  const { site } = c, root = '../';
  const isComic = p.kind === 'comics';
  const embed = youtubeEmbed(p.video);
  let cover;
  if (embed) {
    const vertical = p.video_shape ? p.video_shape === 'vertical' : /shorts\//.test(p.video);
    cover = `<div class="post-video${vertical ? ' vertical' : ''}"><iframe src="${embed}" title="${esc(p.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  } else if (isVideoFile(p.video)) {
    const vertical = p.video_shape !== 'horizontal';
    cover = `<div class="post-video${vertical ? ' vertical' : ''}"><video src="${url(p.video, root)}" controls autoplay muted loop playsinline preload="metadata" title="${esc(p.title)}"></video></div>`;
  } else if (p.image) {
    cover = `<figure class="post-cover has-image${isComic ? '' : ' vertical'}">${img(p.image, p.image_alt || p.title, root)}</figure>`;
  } else {
    cover = `<div class="post-cover bg-${p.color}${isComic ? ' comic-image' : ' vertical'}">${isComic ? (p.cover_text || p.title) : (p.emoji || '')}</div>`;
  }
  const related = c[p.kind].filter(x => x !== p && x.topic === p.topic && !x.coming_soon).slice(0, 3);
  const meta = [p.tag, formatDate(p.date)].filter(Boolean).join(' · ');
  const main = `  <main>
    <article class="section post${isComic ? ' comic-post' : ''}">
      <a class="text-link post-back" href="${root}${p.kind}.html">← All ${p.kind}</a>
      <header class="post-header">
        <p class="eyebrow">${meta}</p>
        <h1>${p.title}</h1>
        ${p.summary ? `<p class="post-summary">${p.summary}</p>` : ''}
      </header>
      ${cover}
      ${p.body.trim() ? `<div class="post-body">\n${markdown(p.body, root)}\n      </div>` : ''}
      ${p.topicData ? `<p class="post-topic">Filed under <a class="text-link" href="${root}topics/${p.topic}.html">${topicIcon(p.topicData, root, 'topic-icon-inline')} ${p.topicData.title}</a></p>` : ''}
    </article>
${related.length ? `
    <section class="section tinted">
      <div class="section-heading"><div><p class="eyebrow">KEEP GOING</p><h2>More like this.</h2></div></div>
      <div class="${isComic ? 'comic-grid' : 'shorts-grid'}">
${cards(related, isComic ? comicCard : shortCard, root)}
      </div>
    </section>` : ''}
  </main>`;
  return layout({ site, root, isHome: false, title: `${p.title.replace(/<[^>]+>/g, '')} | ${site.name}`, description: p.summary || site.description, main });
}

// ---------- watermark ----------
// Stamps "© <site name>" in the bottom-left corner (bottom-right is where the comics carry their own signature) of every raster image in the OUTPUT folder.
// The originals in images/ are never modified.
async function watermarkImages(site) {
  let sharp;
  try { sharp = require('sharp'); } catch { throw new Error('watermarking needs sharp — run `npm install` first'); }
  const text = esc(`© ${site.name}`);
  const dir = path.join(OUT, 'images');
  const files = fs.readdirSync(dir, { recursive: true }).filter(f => WATERMARK_EXT.test(f));
  await Promise.all(files.map(async rel => {
    const file = path.join(dir, rel);
    const { data, info } = await sharp(file).rotate().toBuffer({ resolveWithObject: true });
    if (info.width < WATERMARK_MIN_WIDTH) return;
    const size = Math.round(Math.max(14, info.width * 0.035));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}">
      <text x="${size}" y="${info.height - size}" text-anchor="start" font-family="sans-serif" font-weight="bold"
        font-size="${size}" fill="#fff" fill-opacity="0.7" stroke="#000" stroke-opacity="0.4" stroke-width="${size / 10}"
        paint-order="stroke">${text}</text></svg>`;
    await sharp(data).composite([{ input: Buffer.from(svg) }]).toFile(file);
  }));
  return files.length;
}

// ---------- build ----------
function write(rel, html) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

async function build() {
  const started = Date.now();
  const c = loadContent();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  write('index.html', homePage(c));
  write('comics.html', listingPage(c, 'comics'));
  write('shorts.html', listingPage(c, 'shorts'));
  c.topics.forEach(t => write(`topics/${t.slug}.html`, topicPage(c, t)));
  const posts = [...c.comics, ...c.shorts].filter(p => !p.coming_soon);
  posts.forEach(p => write(`${p.kind}/${p.slug}.html`, postPage(c, p)));

  for (const f of ['styles.css', 'blog.css']) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
  fs.cpSync(path.join(ROOT, 'images'), path.join(OUT, 'images'), { recursive: true });
  await watermarkImages(c.site);

  console.log(`✓ Built ${3 + c.topics.length + posts.length} pages${SERVE ? '' : ' into public/'} in ${Date.now() - started}ms`);
}

// Builds run one after another so a rebuild never deletes the folder while another is still writing to it.
let building = Promise.resolve();
const safeBuild = () => (building = building.then(build).catch(e => console.error('✗ Build failed:', e.message)));

if (SERVE) {
  const http = require('http');
  const port = Number(process.env.PORT) || 8080;
  const types = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
    '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm',
  };
  safeBuild();
  http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(OUT, path.normalize(p));
    if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(port, () => console.log(`→ Serving http://localhost:${port} (edits to content/, images/ or CSS rebuild automatically)`));

  let timer;
  const rebuild = () => { clearTimeout(timer); timer = setTimeout(safeBuild, 150); };
  for (const dir of ['content', 'images']) fs.watch(path.join(ROOT, dir), { recursive: true }, rebuild);
  // The CSS files are watched through their folder: watching a file directly stops working once an editor replaces it on save.
  fs.watch(ROOT, (_, file) => { if (file === 'styles.css' || file === 'blog.css') rebuild(); });
} else {
  build().catch(e => { console.error('✗ Build failed:', e.message); process.exit(1); });
}
