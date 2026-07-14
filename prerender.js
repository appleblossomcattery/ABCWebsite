#!/usr/bin/env node
/*
 * Apple Blossom Cattery — pre-render build (audit item 1).
 *
 * WHY THIS EXISTS
 * The site is one hash-routed Design-Component SPA: only "/" is indexable, so
 * Google collapses /#/fees, /#/about … into the home page and the site can't
 * rank for local searches ("cattery prices Pontyclun"). This build renders
 * every route (routes.js) to its own real URL with crawler-visible content and
 * a distinct <title>/description/canonical.
 *
 * HOW IT WORKS
 *   1. Take the bundled index.html and inject the shared SEO <head>
 *      (postbuild.injectSeoHead) — this is the "base" bundle, untouched
 *      otherwise, so every page keeps the full working SPA (enquiry form,
 *      Pen Checker, gallery, mobile nav all keep working after hydration).
 *   2. Serve the base over http and drive it in headless Chromium: for each
 *      route set the hash, wait for render, and lift the rendered #dc-root
 *      markup (real text + links).
 *   3. Assemble each route's static page from the base bundle by:
 *        - swapping the initial <title> + SEO meta (description, canonical,
 *          og:*, twitter:*) to the per-route values, for no-JS crawlers and
 *          the Facebook/WhatsApp/iMessage scrapers;
 *        - injecting the pre-rendered #dc-root into the <body> (with in-page
 *          #/x nav rewritten to real /x/ paths) so no-JS crawlers get content
 *          and links, and users see content instantly instead of a splash;
 *        - injecting a tiny window-scoped SEO-persist script. The bundle boots
 *          by replacing the whole <html>, which would otherwise wipe our head
 *          AND the app never sets per-route titles itself; the persist script
 *          (whose window listeners survive the swap) re-stamps the correct
 *          title/canonical/description for the current route, so Googlebot's
 *          RENDERED view also gets distinct, non-duplicate signals;
 *        - injecting a hash bootstrap so a deep-linked page opens on its route.
 *   4. Write each page to dist/<path>/index.html (home → dist/index.html),
 *      emit a real sitemap.xml (one <url> per route), and copy the static
 *      files. Netlify publishes dist/. Source files are never mutated, so the
 *      build is safe to re-run and survives the design tool re-exporting
 *      index.html.
 *
 * Wired via netlify.toml:  [build] command = "node prerender.js", publish "dist".
 * Do NOT hand-edit index.html — re-export from the design tool and rebuild.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const { injectSeoHead } = require('./postbuild');
const { BASE_URL, ROUTES } = require('./routes');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const GALLERY_DIR = path.join(ROOT, 'gallery');
const PORT = 8799;

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const canonicalFor = (r) => BASE_URL + (r.path === '/' ? '/' : r.path);

// ---- filesystem helpers ---------------------------------------------------
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function writePage(routePath, html) {
  const outDir = routePath === '/' ? DIST : path.join(DIST, routePath);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
}
function copyIfExists(name, destName = name) {
  const src = path.join(ROOT, name);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DIST, destName));
}
function copyDir(name) {
  const src = path.join(ROOT, name);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(DIST, name), { recursive: true });
}

// ---- image migration (audit item 5) ---------------------------------------
// The photos hotlinked from static.wixstatic.com are self-hosted under
// /images/ (downloaded once into the committed images/ folder). Rewrite every
// wixstatic media URL in the bundle to its local copy at build time, so the
// live site no longer depends on the old Wix media host. The gallery builds
// its URLs from a `static.wixstatic.com/media/{{img.id}}/v1/fill/.../{{img.id}}`
// template, so the {{img.id}} placeholder is preserved and resolves to
// /images/<id> at runtime. The 1200x630 social-card image maps to a dedicated
// /images/og-card.jpg (absolute URL, as social scrapers require).
const OG_WIX_1200 =
  'static.wixstatic.com/media/097757_78afd216873344198b33f5e8da8b734f~mv2.jpg/v1/fill/w_1200,h_630,al_c,q_85,enc_auto/097757_78afd216873344198b33f5e8da8b734f~mv2.jpg';
const OG_CARD_ABS = BASE_URL + '/images/og-card.jpg';
const LIGHTBOX_MID = '/v1/fit/w_1600,h_1200,q_88,enc_auto/';
function migrateImages(html) {
  // 1) Social-card 1200x630 URL → absolute local og-card (handle every prefix form).
  for (const pre of ['https://', 'http://', '//', '']) {
    html = html.split(pre + OG_WIX_1200).join(OG_CARD_ABS);
  }
  // 2) Every full wixstatic media URL (the gallery thumbnail template + any
  //    stray) → /images/<id>. <id> is captured up to the first slash, so the
  //    /v1/fill/.../<id> transform suffix is dropped; {{img.id}} is preserved
  //    for the gallery to fill at runtime.
  html = html.replace(
    /(?:https?:)?\/\/static\.wixstatic\.com\/media\/([^/"'`\\ )]+)(?:\/v1\/[^"'`\\ )]*)?/g,
    (_m, id) => '/images/' + id,
  );
  // 3) The lightbox builds its URL by concatenation, not as one literal:
  //      'https://static.wixstatic.com/media/' + id + LIGHTBOX_MID + id
  //    Only a bare prefix (no id) survives step 2. Point it at the large-image
  //    dir and turn the transform middle into '#', so the concatenation yields
  //    '/images/lg/<id>#<id>' — the browser requests '/images/lg/<id>' and the
  //    trailing id is an ignored URL fragment.
  html = html.split('https://static.wixstatic.com/media/').join('/images/lg/');
  html = html.split('//static.wixstatic.com/media/').join('/images/lg/');
  html = html.split(LIGHTBOX_MID).join('#');
  return html;
}

// ---- folder-driven gallery ------------------------------------------------
// Drop ordinary photos into gallery/ (order = filename order, e.g. 01-…,
// 02-…). This resizes each into a 600x600 grid thumbnail (dist/images/gallery/)
// and a ≤1600px lightbox version (dist/images/lg/gallery/), and replaces the
// design bundle's hard-coded `images = [...]` list with entries generated from
// the folder. So adding, removing, replacing or reordering gallery photos is
// just managing files — no design tool, no cryptic IDs. Alt text (used for
// accessibility + SEO) is derived from the filename. If gallery/ is empty the
// design's built-in photos are kept unchanged.
const GALLERY_EXT = /\.(jpe?g|png|webp|gif)$/i;
function galleryAlt(file) {
  return file
    .replace(/\.[^.]+$/, '')      // drop extension
    .replace(/^\d+[-_ ]*/, '')    // drop the NN- ordering prefix
    .replace(/[-_]+/g, ' ')       // dashes/underscores → spaces
    .trim()
    .replace(/^./, (c) => c.toUpperCase()) || 'Apple Blossom Cattery photo';
}
async function buildGallery(html) {
  if (!fs.existsSync(GALLERY_DIR)) { console.log("  gallery/: not present — keeping the design's built-in photos"); return html; }
  const files = fs.readdirSync(GALLERY_DIR).filter((f) => GALLERY_EXT.test(f)).sort();
  if (!files.length) { console.log("  gallery/: empty — keeping the design's built-in photos"); return html; }

  const thumbDir = path.join(DIST, 'images', 'gallery');
  const largeDir = path.join(DIST, 'images', 'lg', 'gallery');
  fs.mkdirSync(thumbDir, { recursive: true });
  fs.mkdirSync(largeDir, { recursive: true });

  for (const f of files) {
    const src = path.join(GALLERY_DIR, f);
    if (/\.gif$/i.test(f)) {
      // Preserve animation — copy the gif untouched to both sizes.
      fs.copyFileSync(src, path.join(thumbDir, f));
      fs.copyFileSync(src, path.join(largeDir, f));
    } else {
      // .rotate() honours EXIF orientation (phone photos); cover-crop the
      // square grid tile, fit the lightbox within 1600x1200 without enlarging.
      await sharp(src).rotate().resize(600, 600, { fit: 'cover', position: 'attention' }).toFile(path.join(thumbDir, f));
      await sharp(src).rotate().resize(1600, 1200, { fit: 'inside', withoutEnlargement: true }).toFile(path.join(largeDir, f));
    }
  }

  // Alt text is single-quoted in the bundle; strip any apostrophes to stay safe.
  const entries = files.map((f) => `{ id:'gallery/${f}', alt:'${galleryAlt(f).replace(/'/g, '')}' }`).join(',');
  if (!/images = \[.*?\];/s.test(html)) {
    throw new Error(
      'buildGallery: could not find the gallery `images = [...]` array in the bundle. ' +
      'The design export structure changed — update the replace in prerender.js (or remove gallery/ to fall back to the design photos).',
    );
  }
  html = html.replace(/images = \[.*?\];/s, () => 'images = [' + entries + '];');
  console.log(`  gallery/: ${files.length} photos → resized + injected (grid 600px, lightbox 1600px)`);
  return html;
}

// ---- <head> rewriting -----------------------------------------------------
// Replace the content="" of a meta/link tag matched by an attribute selector,
// scoped to the real <head> only (never the bundled template string, which
// lives inside a <script>). Adds the tag before </head> if missing.
function setTag(html, testAttr, buildTag) {
  const headEnd = html.search(/<\/head>/i);
  if (headEnd === -1) return html;
  const head = html.slice(0, headEnd);
  const rest = html.slice(headEnd);
  const re = new RegExp('<(?:meta|link)\\b[^>]*' + testAttr + '[^>]*>', 'i');
  if (re.test(head)) return head.replace(re, buildTag) + rest;
  return head + buildTag + '\n' + rest;
}

function applyRouteHead(html, r) {
  const url = canonicalFor(r);
  // Initial <title> (real head) — the first, non-template one.
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escAttr(r.title)}</title>`);
  html = setTag(html, 'rel=("|\')canonical\\1', `<link rel="canonical" href="${escAttr(url)}">`);
  html = setTag(html, 'name=("|\')description\\1', `<meta name="description" content="${escAttr(r.description)}">`);
  html = setTag(html, 'property=("|\')og:url\\1', `<meta property="og:url" content="${escAttr(url)}">`);
  html = setTag(html, 'property=("|\')og:title\\1', `<meta property="og:title" content="${escAttr(r.title)}">`);
  html = setTag(html, 'property=("|\')og:description\\1', `<meta property="og:description" content="${escAttr(r.description)}">`);
  html = setTag(html, 'name=("|\')twitter:title\\1', `<meta name="twitter:title" content="${escAttr(r.title)}">`);
  html = setTag(html, 'name=("|\')twitter:description\\1', `<meta name="twitter:description" content="${escAttr(r.description)}">`);
  // FAQPage structured data only belongs on the FAQ page and home; drop it elsewhere.
  if (!r.faq) {
    html = html.replace(/<script type="application\/ld\+json">\s*\{[^]*?"@type":\s*"FAQPage"[^]*?<\/script>/i, '');
  }
  return html;
}

// ---- runtime SEO-persist script -------------------------------------------
// The bundle boots with `document.documentElement.replaceWith(...)`, discarding
// our injected <head>, and the app never sets per-route titles. Window
// listeners survive the swap (the bundle relies on the same fact for its error
// sink), so we re-stamp the head for the current hash route — on load, on the
// document swap, and on every client-side route change.
function persistScript() {
  const map = {};
  for (const r of ROUTES) map[r.hash] = { t: r.title, c: canonicalFor(r), d: r.description };
  const json = JSON.stringify(map).replace(/<\//g, '<\\/');
  return `<script>(function(){
  var M=${json};
  function cur(){var h=location.hash||'#/';if(h==='#')h='#/';return M[h]||M['#/'];}
  function meta(name,attr){var e=document.head&&document.head.querySelector('meta['+attr+'="'+name+'"]');if(!e&&document.head){e=document.createElement('meta');e.setAttribute(attr.indexOf('property')===0?'property':'name',name);document.head.appendChild(e);}return e;}
  function apply(){try{var s=cur();if(!s||!document.head)return;
    if(document.title!==s.t)document.title=s.t;
    var c=document.head.querySelector('link[rel="canonical"]');if(!c){c=document.createElement('link');c.rel='canonical';document.head.appendChild(c);}c.href=s.c;
    var d=meta('description','name');if(d)d.content=s.d;
    var ou=meta('og:url','property');if(ou)ou.content=s.c;
    var ot=meta('og:title','property');if(ot)ot.content=s.t;
  }catch(e){}}
  window.addEventListener('hashchange',apply,true);
  window.addEventListener('load',apply,true);
  // The bundle swaps <html> on boot (a childList change on document); re-stamp then.
  try{new MutationObserver(apply).observe(document,{childList:true});}catch(e){}
  // Belt-and-braces for the hydration window on slower devices.
  var n=0,iv=setInterval(function(){apply();if(++n>25)clearInterval(iv);},200);
  apply();
})();</script>`;
}

// ---- per-route page assembly ----------------------------------------------
function assemble(base, r, dcRootHtml) {
  let html = applyRouteHead(base, r);
  // Persist script goes first inside <head> so it registers before the bundle.
  html = html.replace(/<head[^>]*>/i, (m) => m + '\n' + persistScript());
  // Remove the splash thumbnail so no-JS crawlers/users see real content, not a logo.
  html = html.replace(/<div id="__bundler_thumbnail">[\s\S]*?<\/div>\s*<\/div>/i, '');
  // Inject the pre-rendered content + (for non-home) a hash bootstrap, right
  // after <body>. Both are wiped on hydration; they exist for the first paint
  // and for crawlers that don't run the bundle.
  const boot = r.path === '/'
    ? ''
    : `<script>if(!location.hash)location.hash=${JSON.stringify(r.hash)};</script>\n`;
  const seoMarkup = `<div id="abc-prerender">${dcRootHtml}</div>`;
  html = html.replace(/<body([^>]*)>/i, (m) => `${m}\n${boot}${seoMarkup}`);
  return html;
}

// Lift the rendered content and rewrite in-page hash nav to real paths.
function cleanDcRoot(rawHtml) {
  let h = rawHtml;
  // #/x  ->  /x/   (home stays "/"). Keeps crawlers on real URLs; the live app
  // re-renders its own #/x nav after hydration for snappy client routing.
  h = h.replace(/href="#\/([a-z]*)"/gi, (m, seg) => `href="/${seg ? seg + '/' : ''}"`);
  // Drop dead blob: URLs from the capture (bundle assets are per-render blobs).
  h = h.replace(/blob:[^"')\s]+/g, '');
  // Defensive: self-host any wixstatic URL that reached the rendered markup.
  h = migrateImages(h);
  return h;
}

// ---- main -----------------------------------------------------------------
async function main() {
  const srcIndex = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const seoHead = fs.readFileSync(path.join(ROOT, 'seo-head.html'), 'utf8');
  let base = migrateImages(injectSeoHead(srcIndex, seoHead));
  // Normalise the served host to the apex everywhere (the design bundle
  // hard-codes www in its own head/JSON-LD; the server 301s www → apex, so
  // canonical/og/schema must all point at the apex, including post-hydration).
  base = base.split('www.appleblossomcattery.com').join('appleblossomcattery.com');

  // Fresh dist; self-host the migrated images, build the folder-driven gallery
  // (resizes gallery/ photos into dist/ and swaps them into the bundle), then
  // write the base bundle so the render server can serve it locally.
  rmrf(DIST);
  fs.mkdirSync(DIST, { recursive: true });
  copyDir('images');
  base = await buildGallery(base);
  fs.writeFileSync(path.join(DIST, 'index.html'), base);

  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0].split('#')[0];
    const file = url === '/' ? '/index.html' : url;
    fs.readFile(path.join(DIST, file), (err, buf) => {
      if (err) { res.statusCode = 404; res.end('not found'); return; }
      res.end(buf);
    });
  }).listen(PORT);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  // Don't fetch remote images while rendering — we only need text + structure,
  // and the wixstatic hits slow every route down. Abort them.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.resourceType() === 'image') req.abort().catch(() => {});
    else req.continue().catch(() => {});
  });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0', timeout: 90000 });

  const heading = () => page.evaluate(() => {
    const el = document.getElementById('dc-root');
    return (el && el.querySelector('h1,h2')?.innerText.trim()) || '';
  });

  const captured = {};
  let prevHeading = await heading(); // home renders on first load
  for (const r of ROUTES) {
    await page.evaluate((h) => { location.hash = h; }, r.hash);
    // Wait until the route has actually (re)rendered: the #dc-root heading must
    // change from the previous route's, so we never capture stale content if a
    // route renders slowly. (The home route's heading is already showing.)
    if (r.hash !== '#/') {
      await page.waitForFunction(
        (prev) => {
          const el = document.getElementById('dc-root');
          const h = el && el.querySelector('h1,h2')?.innerText.trim();
          return h && h !== prev && el.innerText.trim().length > 40;
        },
        { timeout: 20000 }, prevHeading,
      ).catch(() => {});
    }
    await new Promise((res) => setTimeout(res, 300));
    const dc = await page.evaluate(() => {
      const el = document.getElementById('dc-root');
      return el ? el.outerHTML : '';
    });
    captured[r.hash] = cleanDcRoot(dc);
    prevHeading = await heading();
    console.log(`  rendered ${r.hash.padEnd(16)} ${(captured[r.hash].length / 1024).toFixed(0)} KB  “${prevHeading.slice(0, 32)}”`);
  }

  await browser.close();
  server.close();

  // Assemble + write every route (home last — it overwrites the served base).
  for (const r of ROUTES) {
    const dc = captured[r.hash] || '';
    if (!dc) { console.warn(`  WARNING: no content captured for ${r.hash}`); }
    writePage(r.path, assemble(base, r, dc));
  }

  writeSitemap();
  writeRedirects();
  copyIfExists('robots.txt');
  checkImages(captured);

  console.log(`prerender: wrote ${ROUTES.length} routes + sitemap.xml to dist/`);
}

// ---- image check ----------------------------------------------------------
// Every /images/<id> the rendered pages reference must exist in dist/images/.
// Warns (doesn't fail the build) if a photo was added in the design tool but
// its file isn't in the committed images/ folder yet — download it into
// images/ and commit, or it will 404.
function checkImages(captured) {
  const referenced = new Set();
  for (const dc of Object.values(captured)) {
    for (const m of String(dc).matchAll(/\/images\/([^"'`\\ )>]+)/g)) referenced.add(m[1]);
  }
  const missing = [...referenced].filter((f) => !fs.existsSync(path.join(DIST, 'images', f)));
  if (missing.length) {
    console.warn(`  WARNING: ${missing.length} referenced image(s) not in images/ (will 404 — download + commit them):`);
    missing.forEach((f) => console.warn('    /images/' + f));
  } else {
    console.log(`  images: ${referenced.size} referenced, all present in dist/images/`);
  }
}

// ---- sitemap + redirects --------------------------------------------------
function writeSitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = ROUTES.map((r) => {
    const priority = r.path === '/' ? '1.0' : r.path === '/contact/' ? '0.9' : '0.7';
    return `  <url>\n    <loc>${escXml(canonicalFor(r))}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
  }).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generated by prerender.js — one <url> per pre-rendered route. -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), xml);
}

function writeRedirects() {
  // Legacy Wix URLs + no-slash conveniences → the new real paths. The SPA
  // fallback stays LAST so any unmatched path still loads the app (which then
  // hash-routes), and old shared /#/x deep links keep working client-side.
  const lines = [
    '# Apple Blossom Cattery — Netlify redirects (generated by prerender.js).',
    '# Legacy Wix URLs → the matching pre-rendered page (recover indexing authority).',
    '/contact              /contact/           301',
    '/testimonials         /testimonials/      301',
    '/photo-gallery        /gallery/           301',
    '/privacy-notice       /privacy/           301',
    '/about-4              /about/             301',
    '/copy-of-contact      /fees/              301',
    '/copy-of-boarding-1   /boarding/          301',
    '',
    '# No-slash / alternative spellings → canonical trailing-slash path.',
    '/about                /about/             301',
    '/boarding             /boarding/          301',
    '/pickup               /pickup/            301',
    '/fees                 /fees/              301',
    '/hours                /hours/             301',
    '/opening-hours        /hours/             301',
    '/vaccinations         /vaccinations/      301',
    '/why                  /why/               301',
    '/faq                  /faq/               301',
    '/gallery              /gallery/           301',
    '/terms                /terms/             301',
    '/privacy              /privacy/           301',
    '',
    '# SPA fallback — any other path serves the app (hash-routes client-side).',
    '/*                    /index.html         200',
    '',
  ];
  fs.writeFileSync(path.join(DIST, '_redirects'), lines.join('\n'));
}

main().catch((err) => { console.error(err); process.exit(1); });
