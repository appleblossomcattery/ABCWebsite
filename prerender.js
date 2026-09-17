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
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const mammoth = require('mammoth');
const { injectSeoHead } = require('./postbuild');
const { BASE_URL, ROUTES } = require('./routes');
const { AREAS, FACTS } = require('./areas');

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

  // Every gallery image is served as WebP (~30-50% smaller than JPEG at the
  // same visual quality; universally supported). Animated gifs additionally
  // get a STATIC grid tile with the animation kept in the click-to-enlarge
  // version only (the 12MB source gif costs the grid ~30KB this way).
  const outputs = [];
  for (const f of files) {
    const src = path.join(GALLERY_DIR, f);
    const out = f.replace(/\.[^.]+$/, '.webp');
    if (/\.gif$/i.test(f)) {
      await sharp(src).resize(600, 600, { fit: 'cover' }).webp({ quality: 75 }).toFile(path.join(thumbDir, out));
      await sharp(src, { animated: true }).resize(1600, 1200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 75, effort: 4 }).toFile(path.join(largeDir, out));
    } else {
      // .rotate() honours EXIF orientation (phone photos); cover-crop the
      // square grid tile, fit the lightbox within 1600x1200 without enlarging.
      await sharp(src).rotate().resize(600, 600, { fit: 'cover', position: 'attention' }).webp({ quality: 78 }).toFile(path.join(thumbDir, out));
      await sharp(src).rotate().resize(1600, 1200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(largeDir, out));
    }
    outputs.push(out);
  }

  // Alt text is single-quoted in the bundle; strip any apostrophes to stay safe.
  const entries = outputs.map((f) => `{ id:'gallery/${f}', alt:'${galleryAlt(f).replace(/'/g, '')}' }`).join(',');
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

// ---- bundle externalisation ------------------------------------------------
// The DC bundle inlines its 2.2MB asset manifest and ~250KB template into the
// HTML, and because every pre-rendered route embeds the full bundle, the whole
// app re-downloads on every route. Extract both into content-hashed files
// under /assets/ (cached immutably — see netlify.toml) and patch the
// bootstrap to fetch them instead: the app then downloads ONCE and every
// route's HTML drops to a fraction of the size. Fail-safe: if any anchor is
// missing (a future design export changed the bootstrap), keep everything
// inline and warn — heavier but correct.
function externalizeBundle(html) {
  const mMatch = html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
  const tMatch = html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);
  const bootRe = /const manifestEl = document\.querySelector\('script\[type="__bundler\/manifest"\]'\);\s*const templateEl = document\.querySelector\('script\[type="__bundler\/template"\]'\);\s*if \(!manifestEl \|\| !templateEl\) \{[\s\S]*?\n\s*\}\s*const manifest = JSON\.parse\(manifestEl\.textContent\);\s*let template = JSON\.parse\(templateEl\.textContent\);/;
  if (!mMatch || !tMatch || !bootRe.test(html)) {
    console.warn('  bundle: externalisation anchors not found — keeping the bundle inline (heavier pages)');
    return html;
  }
  const assetsDir = path.join(DIST, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const h10 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
  const mName = `app-manifest-${h10(mMatch[1])}.json`;
  const tName = `app-template-${h10(tMatch[1])}.json`;
  fs.writeFileSync(path.join(assetsDir, mName), mMatch[1]);
  fs.writeFileSync(path.join(assetsDir, tName), tMatch[1]);
  html = html.replace(mMatch[0], '').replace(tMatch[0], '');
  html = html.replace(bootRe, () =>
    `let [manifest, template] = await Promise.all([
      fetch('/assets/${mName}').then((r) => { if (!r.ok) throw new Error('manifest fetch ' + r.status); return r.json(); }),
      fetch('/assets/${tName}').then((r) => { if (!r.ok) throw new Error('template fetch ' + r.status); return r.json(); }),
    ]);`);
  console.log(`  bundle: manifest+template externalised to /assets/ (${(mMatch[1].length / 1048576).toFixed(1)}MB + ${(tMatch[1].length / 1024).toFixed(0)}KB, content-hashed, cached immutable)`);
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
  // FAQPage structured data only belongs on the FAQ page and home; drop it
  // elsewhere. The (?!</script>) guard keeps the match INSIDE the FAQPage's own
  // <script> — without it the match starts at the earlier LocalBusiness script
  // and deletes that too.
  if (!r.faq) {
    html = html.replace(/<script type="application\/ld\+json">(?:(?!<\/script>)[\s\S])*?"@type":\s*"FAQPage"(?:(?!<\/script>)[\s\S])*?<\/script>/i, '');
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

// ---- runtime floating WhatsApp button -------------------------------------
// A sitewide "Chat on WhatsApp" button. Like the SEO-persist script it must
// survive the bundle's document swap, so it re-appends itself after hydration
// and on every route change. It's a direct child of <body> (position:fixed), so
// the app's per-route re-render of #dc-root leaves it in place. Plum, not
// WhatsApp green, to stay on brand.
function floatingContactScript() {
  const glyph = 'M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.15h-.01c-1.53 0-3.03-.41-4.34-1.18l-.31-.18-3.23.85.86-3.15-.2-.32a8.19 8.19 0 0 1-1.26-4.35c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.32-8.23 8.32zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43-.14-.01-.31-.01-.48-.01-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.25 3.74.59.26 1.06.41 1.42.52.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29z';
  return `<script>(function(){
  var HREF='https://wa.me/447855475851';
  function ensure(){try{
    if(!document.body||document.getElementById('abc-wa'))return;
    var a=document.createElement('a');
    a.id='abc-wa';a.href=HREF;a.target='_blank';a.rel='noopener';
    a.setAttribute('aria-label','Chat with us on WhatsApp');
    a.style.cssText='position:fixed;right:18px;bottom:18px;z-index:9998;width:56px;height:56px;border-radius:50%;background:#9B4880;box-shadow:0 8px 22px rgba(124,58,102,.32);display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent';
    a.innerHTML='<svg width="30" height="30" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="${glyph}"/></svg>';
    document.body.appendChild(a);
  }catch(e){}}
  window.addEventListener('hashchange',ensure,true);
  window.addEventListener('load',ensure,true);
  try{new MutationObserver(ensure).observe(document,{childList:true});}catch(e){}
  var n=0,iv=setInterval(function(){ensure();if(++n>30)clearInterval(iv);},300);
  ensure();
})();</script>`;
}

// ---- per-route page assembly ----------------------------------------------
function assemble(base, r, dcRootHtml) {
  let html = applyRouteHead(base, r);
  // Persist + floating-WhatsApp scripts go first inside <head> so they register
  // (on window) before the bundle swaps the document.
  html = html.replace(/<head[^>]*>/i, (m) => m + '\n' + persistScript() + '\n' + floatingContactScript());
  // Remove the splash thumbnail so no-JS crawlers/users see real content, not a
  // logo. The thumbnail div holds only an <svg> (no nested div), so match up to
  // its SINGLE closing </div>. (Matching "</div></div>" over-ran to a far-away
  // pair and devoured the 2 MB asset bundle — which broke every image.)
  html = html.replace(/<div id="__bundler_thumbnail">[\s\S]*?<\/div>/i, '');
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

  // (The 3- and 4-cat rates — £25 / £27 — are now correct in the design source itself.)

  // Pen dimensions + disease-control architecture (source: the licensing
  // schedule "ABC Pen Dimensions" for BOE028 — family 6.37m², double 4.58m²,
  // walk-in singles 2.60–3.52m²; plus full-length sneeze barriers in every pen
  // and the metre-wide two-door safety corridor). Audit benchmark: every
  // 9-10-scoring cattery publishes dimensions and disease-control design.
  const penCopy = [
    ['each with a warm sleeping area and room to stretch, climb and watch the world go by.',
     'each with a warm sleeping area and room to stretch, climb and watch the world go by. Each double gives its guests 4.58 m² across the sleeping cabin, exercise run and shelving, and our cosier walk-in singles range from 2.6 to 3.5 m². Three pairs of doubles can link through an airtight internal access hatch to form 9.16 m² two-pen suites — the roomiest accommodation we offer.'],
    ['or a mother cat and her kittens — so families can stay together.',
     'or a mother cat and her kittens — so families can stay together. At 6.37 m² apiece, they are the largest individual pens in the house.'],
    ['the national market leader in cattery building.<\\u002Fp>\\n          <\\u002Fdiv>',
     'the national market leader in cattery building.<\\u002Fp>\\n            <p style=\\"font-size:16.5px;line-height:1.75;color:#56565A;margin:14px 0 0\\">Every pen is separated from its neighbours by full-length sneeze barriers, and the pens themselves are constructed so cats can scent the fresh air whilst remaining secure indoors — with a metre-wide safety corridor running the length of the cattery.<\\u002Fp>\\n          <\\u002Fdiv>'],
    // Storm guards + outlook (Rhys, Aug 2026): drop-away external guards keep
    // the pens dry in bad weather and open the cattery to fresh air, scent and
    // sound on fine days — which, with the clear views, is what actually
    // serves a cat's welfare rather than roaming outside.
    ['— with a metre-wide safety corridor running the length of the cattery.<\\u002Fp>',
     '— with a metre-wide safety corridor running the length of the cattery.<\\u002Fp>\\n            <p style=\\"font-size:16.5px;line-height:1.75;color:#56565A;margin:14px 0 0\\">External storm guards keep the pens dry in wet weather — and on fine days we drop or remove them, filling the cattery with fresh air and the scents and sounds of the countryside while everything stays secure. Paired with every pen’s clear outlook, that means there is something to smell, hear and watch all day, at no risk to the cat.<\\u002Fp>'],
  ];
  for (const [from, to] of penCopy) {
    if (base.includes(from)) base = base.split(from).join(to);
    else console.warn('  pens: anchor missing, copy not injected: ' + from.slice(0, 50) + '…');
  }

  // De-AI pass (Sep 2026): the design copy carried a few stock phrases
  // ("rest assured", "state-of-the-art", "we understand that…") — swap them
  // for plainer wording without touching the voice. Same fail-safe pattern.
  const copyFixes = [
    ["Happy guests, in their own words and whiskers",
     "Happy guests, in photos and kind words"],
    ["Rest assured your loved ones are in good hands",
     "Your cat will be in good hands"],
    ["and we understand that a cattery can only grow and be successful if it has happy customers who return to us and tell their friends how pleased they are",
     "and a cattery only grows one way: happy customers who come back, and tell their friends"],
    ["A state-of-the-art, purpose-built, climate-controlled environment",
     "A purpose-built, climate-controlled environment"],
  ];
  for (const [from, to] of copyFixes) {
    if (base.includes(from)) base = base.split(from).join(to);
    else console.warn('  copy: anchor missing, phrase not de-AIed: ' + from.slice(0, 50) + '…');
  }

  // Publish the animal boarding licence number where the site already mentions
  // the Vale of Glamorgan inspection (audit: the number reassures and is
  // expected in the sector). Held by Rhys & Laura Johns as individuals — there
  // is no company number, and their home address is deliberately not published.
  base = base.split('Vale of Glamorgan Animal Welfare team, and fully insured')
    .join('Vale of Glamorgan Animal Welfare team (Animal Boarding Licence no. BOE028), and fully insured');

  // Publish the full policies document (documents/apple-blossom-policies.pdf —
  // a stable URL; replace the file keeping the same name when a new edition is
  // issued). Linked from the Licensed & insured block, right after the licence
  // number — the natural transparency context. The PDF is image-based (a
  // designed document), so a PDF download is the right format, not HTML.
  base = base.split('BOE028), and fully insured.<\\u002Fp>')
    .join('BOE028), and fully insured. <a href=\\"/policies/\\" style=\\"color:#9B4880;font-weight:600\\">Read our full policies &amp; procedures</a>.<\\u002Fp>'
      // PIF membership badge (member no. 70099347, joined Aug 2026). On
      // renewal: drop the new badge over images/pif-member.webp via
      // PIF_Member_Logo_<year>.png and update the year in this alt text.
      + '<a href=\\"https://www.petfederation.co.uk\\" target=\\"_blank\\" rel=\\"noopener\\" style=\\"display:inline-block;margin-top:14px\\">'
      + '<img src=\\"/images/pif-member.webp\\" alt=\\"Pet Industry Federation — The Trade Association for Pet Businesses — 2026 Member\\" style=\\"width:220px;max-width:100%;height:auto;border-radius:10px;display:block\\"></a>');

  // Point the bundle's OWN favicon links at the real files. The design tool
  // inlines the icon as a data: URI, and because hydration replaces the whole
  // document those links are the ones the browser ends up honouring — so the
  // tab and address bar showed the bundle's plum tile while our published files
  // were ignored, and Google (which cannot fetch a data: URI for a search
  // result) fell back to its generic globe. Rewriting them here means one icon
  // everywhere: the blossom from the site's own header.
  {
    const iconLinks = /<link rel=\\"(icon|apple-touch-icon)\\"[^>]*?href=\\"data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\\">/g;
    const before = (base.match(iconLinks) || []).length;
    if (before > 0) {
      base = base.replace(iconLinks, (_m, rel) =>
        rel === 'icon'
          ? '<link rel=\\"icon\\" href=\\"/favicon.ico\\" sizes=\\"any\\">'
          : '<link rel=\\"apple-touch-icon\\" href=\\"/apple-touch-icon.png\\">');
      console.log(`  icons: ${before} inline data: URI favicon link(s) repointed at the published files`);
    } else {
      console.warn('  icons: no inline data: URI favicon links found — the bundle may now use real files (check the tab icon)');
    }
  }

  // NO motion CSS is injected into the design-tool pages, deliberately.
  //
  // A previous attempt added hover-lift, image zoom and a blanket
  // prefers-reduced-motion gate here. All three were wrong:
  //
  //   · The bundle ALREADY ships them, author-named and better tuned —
  //     [data-lift] (translateY(-5px) with a shadow) on 36 elements and
  //     [data-zoom] (img scale 1.07) on 25 of them on the gallery alone.
  //   · The bundle ALREADY honours reduced motion, in its own rule:
  //     @media (prefers-reduced-motion:reduce){ .abc-reveal.abc-in{animation:
  //     abcFadeOnly ...} [data-lift]:hover{transform:none!important} ... }
  //   · Worst of all, a blanket `animation-name:none!important` under reduce
  //     BLANKS THE SITE. Every .abc-reveal starts at opacity:0 and is carried
  //     to visible by its abcUp/abcFadeOnly animation; kill the animation and
  //     the content never appears. Measured on the live page: computed opacity
  //     went 1 → 0 across 28 elements — for precisely the visitors the gate was
  //     meant to protect.
  //
  // If motion is ever wanted on these pages, add it with data-lift/data-zoom in
  // the design tool, not with CSS injected from here.

  // Link the service-area pages from the address block, so they are reachable
  // from the site itself and not only from the sitemap — an unlinked landing
  // page carries almost no weight. The anchor is the visible address; it also
  // appears on the contact card, and links are welcome in both places.
  {
    const addr = 'Cowbridge Road, Talygarn,<br>Pontyclun, CF72 9JU';
    const hits = base.split(addr).length - 1;
    if (hits > 0) {
      const links = AREAS.map((a) => `<a href=\\"/${a.slug}/\\" style=\\"color:#9B4880\\">${a.name}</a>`).join(' · ');
      base = base.split(addr).join(addr +
        '<div style=\\"margin-top:10px;font-size:13px;line-height:1.7;color:#7C7D81\\">Cat boarding for ' + links + '<\\u002Fdiv>');
      console.log(`  areas: footer links injected at ${hits} address block(s)`);
    } else {
      console.warn('  areas: address anchor not found — area pages left unlinked from the app');
    }
  }

  // Vaccination wall chart: a highlighted download card on the Vaccinations &
  // Health page, injected right after "Cats cannot be accepted without proof
  // of vaccination." — the exact chart the front desk checks cards against
  // (documents/apple-blossom-vaccination-chart.pdf; replace the file keeping
  // the same name when the chart is next reviewed).
  base = base.split('Cats cannot be accepted without proof of vaccination.<\\u002Fstrong><\\u002Fp>')
    .join('Cats cannot be accepted without proof of vaccination.<\\u002Fstrong><\\u002Fp>'
      + '<div style=\\"background:#FBEEF4;border:1px solid #F0D8E4;border-radius:16px;padding:16px 18px;margin-top:14px\\">'
      + '<p style=\\"margin:0 0 6px;font-weight:700;color:#7C3A66;font-family:Quicksand,sans-serif;font-size:16px\\">Which vaccines count?<\\u002Fp>'
      + '<p style=\\"margin:0;font-size:15px;line-height:1.65;color:#56565A\\">Our vaccination chart lists every product we accept, what each one covers, and the dates we check \\u2014 the same chart our team uses when they check your cat\\u2019s card. If your vet uses something not on it, just ask \\u2014 we\\u2019ll confirm it with them. <a href=\\"/documents/apple-blossom-vaccination-chart.pdf\\" target=\\"_blank\\" rel=\\"noopener\\" style=\\"color:#9B4880;font-weight:700\\">Download the vaccination chart (PDF)<\\u002Fa>.<\\u002Fp><\\u002Fdiv>');

  // Spell out the updates owners get — photos, videos and a FaceTime call on
  // request (their most-praised habit in reviews; the site under-mentioned it).
  // Present-continuous ending: these are live updates DURING the trip, unlike
  // the original past-tense line which only fitted the departure report.
  base = base.split('and photos during their stay, so you know how your cat got on while you were away.')
    .join('photos and videos during their stay, and a FaceTime call with your cat on request, so you know how your cat is getting on during your trip.');

  // Surface the review count in the headline rating stat (audit/eval: show
  // "4.9★ from N reviews"). 69 matches the aggregateRating schema and the
  // site's other stat ("69 Google reviews"), so it stays substantiable.
  base = base.split('>Google &amp; Facebook reviews<').join('>from 69 Google reviews<');

  // Lift Fees and FAQ into the top navigation and out of the Services dropdown.
  // Injected links match the sibling styling AND the active-state underline
  // (an sc-if on {{isFees}}/{{isFaq}}, which the bundle already computes), so
  // they highlight in plum on their own page like every other top-level link.
  // Fail-safe on the insertion anchor; the dropdown removal is a no-op if the
  // items aren't found.
  const navAnchor = '<a href=\\"#/testimonials\\" style=\\"position:relative;font-weight:600;font-size:15px;color:#46474A;padding:4px 0\\"';
  const navSty = 'style=\\"position:relative;font-weight:600;font-size:15px;color:#46474A;padding:4px 0\\" style-hover=\\"color:#9B4880\\"';
  const uline = (v) => `<sc-if value=\\"{{${v}}}\\"><span style=\\"position:absolute;left:0;right:0;bottom:-5px;height:2px;background:#9B4880;border-radius:2px\\"></span></sc-if>`;
  if (base.split(navAnchor).length === 2) {
    base = base.replace(navAnchor, `<a href=\\"#/fees\\" ${navSty}>Fees${uline('isFees')}</a><a href=\\"#/faq\\" ${navSty}>FAQ${uline('isFaq')}</a>${navAnchor}`);
    console.log('  nav: added Fees + FAQ as top-level links (with active underline)');
  } else {
    console.warn('  nav: Testimonials anchor not unique — left nav unchanged (design bundle may have changed)');
  }
  // Remove Fees + FAQ from the Services dropdown now that they are top-level.
  const dropItem = (href, label) => `<a href=\\"${href}\\" style=\\"display:block;padding:11px 14px;border-radius:11px;font-weight:600;font-size:14.5px;color:#46474A\\" style-hover=\\"background:#FBEEF4;color:#9B4880\\">${label}<\\u002Fa>`;
  for (const [href, label] of [['#/fees', 'Fees'], ['#/faq', 'FAQ']]) {
    const item = dropItem(href, label);
    if (base.includes(item)) base = base.split(item).join('');
    else console.warn(`  nav: Services dropdown item "${label}" not found (left as-is)`);
  }
  // Drop fees/faq from the "Services active" set too, so the Services button no
  // longer underlines on those pages (they highlight themselves now).
  base = base.split("['boarding','pickup','fees','hours','vaccinations','why','faq']")
    .join("['boarding','pickup','hours','vaccinations','why']");

  // Testimonials page: the "read every review on our live listings" section only
  // linked Facebook. Add a matching Google reviews card (star icon, same plum
  // style) before it, linking to the Google business listing. Fail-safe on the
  // Facebook card anchor.
  const fbCardAnchor = '<a href=\\"https://www.facebook.com/appleblossomcattery/reviews\\"';
  const googleCard =
    '<a href=\\"https://g.page/r/CfJm8Hnbu3CYEBE\\" target=\\"_blank\\" rel=\\"noopener\\" ' +
    'style=\\"display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #ECE0E7;border-radius:18px;padding:20px 22px\\" ' +
    'style-hover=\\"border-color:#9B4880;transform:translateY(-3px)\\">' +
    '<span style=\\"flex:none;width:44px;height:44px;border-radius:12px;background:#FBEEF4;color:#9B4880;display:inline-flex;align-items:center;justify-content:center\\">' +
    '<svg width=\\"22\\" height=\\"22\\" sc-camel-view-box=\\"0 0 24 24\\" fill=\\"currentColor\\"><path d=\\"M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z\\"></path></svg></span>' +
    '<div><div style=\\"font-family:\'Quicksand\',sans-serif;font-weight:700;font-size:15px;color:#46474A\\">Google</div>' +
    '<div style=\\"font-size:13px;color:#7C7D81\\">Read our reviews</div></div></a>\\n            ';
  if (base.split(fbCardAnchor).length === 2) {
    base = base.replace(fbCardAnchor, googleCard + fbCardAnchor);
    console.log('  reviews: added Google reviews card on Testimonials');
  } else {
    console.warn('  reviews: Facebook card anchor not unique — skipped Google card');
  }

  // Homepage feature strip: add a "Photos, videos & FaceTime" card (the
  // most-praised habit in reviews deserves front-page billing). Inserted before
  // the closing "Loved like our own" card, styled identically to its siblings
  // (video-camera icon, same tile/heading/body styles). The strip's auto-fit
  // minimum drops 230px → 190px so five cards still sit across on desktop.
  const lovedH4 = '>Loved like our own<';
  const cardOpen = '<div style=\\"background:#fff;border:1px solid #ECE0E7;border-radius:18px;padding:24px 22px\\">';
  const updatesCard =
    cardOpen +
    '<span style=\\"width:46px;height:46px;border-radius:13px;background:#FBEEF4;color:#9B4880;display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px\\">' +
    '<svg width=\\"24\\" height=\\"24\\" sc-camel-view-box=\\"0 0 24 24\\" fill=\\"none\\" stroke=\\"currentColor\\" stroke-width=\\"1.7\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"><polygon points=\\"23 7 16 12 23 17 23 7\\"></polygon><rect x=\\"1\\" y=\\"5\\" width=\\"15\\" height=\\"14\\" rx=\\"2\\" ry=\\"2\\"></rect></svg></span>' +
    '<h4 style=\\"font-weight:800;font-size:16px;color:#46474A;margin:0 0 6px\\">Photos, videos &amp; FaceTime</h4>' +
    '<p style=\\"margin:0;font-size:14.5px;line-height:1.6;color:#7C7D81\\">Photo and video updates during their stay — and a FaceTime call with your cat on request.</p>' +
    '</div>\\n          ';
  const h4Idx = base.indexOf(lovedH4);
  const insertAt = h4Idx > -1 ? base.lastIndexOf(cardOpen, h4Idx) : -1;
  if (insertAt > -1) {
    base = base.slice(0, insertAt) + updatesCard + base.slice(insertAt);
    console.log('  home: added "Photos, videos & FaceTime" feature card');
    base = base.split('minmax(230px,1fr));gap:16px\\" class=\\"abc-4col\\"')
      .join('minmax(190px,1fr));gap:16px\\" class=\\"abc-4col\\"');
  } else {
    console.warn('  home: feature-strip anchor not found — skipped updates card');
  }

  // Fresh dist; self-host the migrated images, build the folder-driven gallery
  // (resizes gallery/ photos into dist/ and swaps them into the bundle), then
  // write the base bundle so the render server can serve it locally.
  rmrf(DIST);
  fs.mkdirSync(DIST, { recursive: true });
  copyDir('images');
  // Favicons at the conventional root names. Crawlers and browsers ask for
  // /favicon.ico directly when the <head> carries no icon link — which is what
  // happens here after hydration replaces the document — so the file must exist
  // at the root, not only be referenced from seo-head.html.
  copyIfExists('favicon.ico');
  copyIfExists('apple-touch-icon.png');
  copyIfExists('icon-512.png');
  // Publish only the PDF from documents/ — the .docx is the private working
  // master (it feeds the generated /policies/ page, but is not itself served).
  fs.mkdirSync(path.join(DIST, 'documents'), { recursive: true });
  copyIfExists('documents/apple-blossom-policies.pdf', 'documents/apple-blossom-policies.pdf');
  // The vaccination wall chart — the exact acceptance list the front desk uses,
  // published for owners and linked from the Vaccinations & Health page.
  copyIfExists('documents/apple-blossom-vaccination-chart.pdf', 'documents/apple-blossom-vaccination-chart.pdf');
  await buildPoliciesPage();
  buildAreaPages();
  base = await buildGallery(base);
  base = externalizeBundle(base);
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
  write404();
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
  // /policies/ is a generated standalone page (not an app route in ROUTES).
  const policies = `  <url>\n    <loc>${escXml(BASE_URL + '/policies/')}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`;
  // Service-area pages (areas.js) — also generated, also outside ROUTES. High
  // priority: these are the pages meant to win "cattery <town>" searches.
  const areas = AREAS.map((a) =>
    `  <url>\n    <loc>${escXml(BASE_URL + '/' + a.slug + '/')}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`
  ).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generated by prerender.js — one <url> per pre-rendered route. -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n${policies}\n${areas}\n</urlset>\n`;
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
    '/copy-of-boarding     /hours/             301',
    '# Catch any other stray Wix "copy-of-…" duplicate so none linger as 200s.',
    '/copy-of-*            /                   301',
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
    '/policies             /policies/          301',
    '',
    '# Service-area pages (areas.js): no-slash → canonical trailing-slash path.',
    // NB explicit separators, not padEnd alone: these slugs are longer than the
    // column widths used above, and padEnd adds nothing once the string already
    // exceeds the width — which silently glued source, destination and status
    // into one unparseable token.
    ...AREAS.map((a) => `/${a.slug}`.padEnd(26) + '  ' + `/${a.slug}/`.padEnd(26) + '  301'),
    '',
    '# Anything else is genuinely missing: serve a real 404 (no soft-404 — a',
    '# missing upload must FAIL detectably, not silently show the homepage).',
    '# Old hash deep-links (/#/fees) are unaffected: the hash never reaches the',
    '# server, so they resolve against / like always.',
    '/*                    /404.html           404',
    '',
  ];
  fs.writeFileSync(path.join(DIST, '_redirects'), lines.join('\n'));
}

// ---- 404 page --------------------------------------------------------------
// A small, self-contained branded page. Served with a real 404 status by the
// catch-all redirect, so broken links and missing files are detectable.
function write404() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Page not found — Apple Blossom Cattery</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Quicksand:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { min-height:100vh; display:flex; align-items:center; justify-content:center; background:#F5F1EC; font-family:'Quicksand',sans-serif; color:#46474A; padding:24px; }
  .card { max-width:520px; text-align:center; }
  .blossom { margin-bottom:18px; }
  h1 { font-family:'Dancing Script',cursive; font-weight:700; font-size:44px; color:#7C3A66; margin-bottom:10px; }
  p { font-size:16px; line-height:1.6; color:#56565A; margin-bottom:24px; }
  a.btn { display:inline-block; background:#9B4880; color:#fff; font-weight:700; font-size:15px; padding:13px 26px; border-radius:999px; text-decoration:none; box-shadow:0 8px 18px rgba(124,58,102,.24); }
  a.plain { display:inline-block; margin-left:14px; color:#9B4880; font-weight:600; font-size:15px; text-decoration:none; padding:13px 4px; }
</style>
</head>
<body>
<div class="card">
  <svg class="blossom" width="56" height="56" viewBox="0 0 400 400" role="img" aria-label="Apple Blossom Cattery">
    <g transform="translate(200,196)">
      <circle cx="0" cy="-48" r="35" fill="#E89BC0"/><circle cx="46" cy="-15" r="35" fill="#CE6D9E"/>
      <circle cx="28" cy="39" r="35" fill="#C58AB0"/><circle cx="-28" cy="39" r="35" fill="#E89BC0"/>
      <circle cx="-46" cy="-15" r="35" fill="#F3C4DA"/><circle cx="0" cy="-4" r="21" fill="#9B4880"/>
    </g>
  </svg>
  <h1>We can't find that page</h1>
  <p>The page or file you're after isn't here — the link may be old, or things may have moved around.</p>
  <a class="btn" href="/">Back to the cattery</a><a class="plain" href="/contact/">Contact us</a>
</div>
</body>
</html>
`;
  fs.writeFileSync(path.join(DIST, '404.html'), html);
}

// ---- policies page ---------------------------------------------------------
// The published policies PDF is a designed, image-based export with no text
// layer, so search engines and screen readers get nothing from it. The
// canonical machine-readable version is this generated page: at build time the
// Word master (documents/apple-blossom-policies.docx — kept OUT of the
// published site) is converted to semantic HTML via mammoth and wrapped in a
// branded, indexable page at /policies/, which also offers the designed PDF
// as the download. Replace the .docx (same filename) alongside the PDF when a
// new edition is issued and both stay in step.
async function buildPoliciesPage() {
  const docx = path.join(ROOT, 'documents', 'apple-blossom-policies.docx');
  if (!fs.existsSync(docx)) { console.warn('  policies: docx master missing — /policies/ page NOT generated'); return; }
  let { value: body } = await mammoth.convertToHtml({ path: docx });

  // The manual ends with the blank Veterinary Treatment Authorisation form
  // (FORM 01). It stays in the designed PDF download but is deliberately NOT
  // published on the web page — it's a signature document completed at
  // book-in, not something to print-and-fill from the web. References to
  // "Form 01" elsewhere in the manual remain. Cut from the form's start
  // marker to the end (which also drops a garbled converted page-footer);
  // fail the build if the marker moves so the form can't silently reappear.
  const formCut = body.search(/<p>[^<]*FORM 01<\/p>/);
  if (formCut === -1) {
    throw new Error('buildPoliciesPage: "FORM 01" start marker not found — confirm the vet authorisation form is still excluded from /policies/');
  }
  body = body.slice(0, formCut);

  // Strip conversion artefacts that leaked from the designed document's page
  // furniture into the docx body: stray "RA01" margin badges, and repeated
  // page-footer lines (script-font strapline came through as mojibake + the
  // address/licence line). The index row "RA 01" (spaced) and prose licence
  // mentions ("licence no. BOE028") don't match these patterns and remain.
  body = body.replace(/<p>RA01<\/p>/g, '');
  body = body.replace(/<p>---[^<]*<\/p>/g, ''); // "--- SOP 05" page-break markers
  // Leaked page-footer paragraphs (may carry the strapline as an inline
  // <img>, so allow tags before the licence text). Exact-case "Licence
  // BOE028" is the footer format; prose says "licence no. BOE028".
  body = body.replace(/<p>(?:(?!<\/p>)[\s\S])*?Licence BOE028[^<]*<\/p>/g, '');

  // Exactly one <h1> per page (the page title below); demote the document's
  // own heading levels one step so the outline nests under it. Full chain
  // deepest-first — the docx natively uses h4s too, so a partial shift would
  // collide two levels.
  body = body
    .replace(/<(\/?)h5\b/g, '<$1h6')
    .replace(/<(\/?)h4\b/g, '<$1h5')
    .replace(/<(\/?)h3\b/g, '<$1h4')
    .replace(/<(\/?)h2\b/g, '<$1h3')
    .replace(/<(\/?)h1\b/g, '<$1h2');

  const textChars = body.replace(/<[^>]+>/g, '').length;
  if (textChars < 10000) throw new Error(`buildPoliciesPage: conversion produced only ${textChars} chars — refusing to publish a truncated policies page`);

  const head = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Policies &amp; Procedures — Apple Blossom Cattery</title>
<meta name="description" content="The full operations manual for Apple Blossom Cattery: booking in, feeding, cleaning, medication, supervision, risk assessment and privacy — everything we do with your cat, written down and published.">
<link rel="canonical" href="${BASE_URL}/policies/">
<meta property="og:title" content="Policies &amp; Procedures — Apple Blossom Cattery">
<meta property="og:description" content="Everything we do with your cat, written down. Our full operations manual, published.">
<meta property="og:url" content="${BASE_URL}/policies/">
<meta property="og:image" content="${BASE_URL}/images/og-card.jpg">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Quicksand:wght@500;600;700&family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#F5F1EC; color:#46474A; font-family:'Nunito Sans',sans-serif; }
  .top { background:#FBEEF4; border-bottom:1px solid #F0D8E4; padding:14px 24px; }
  .top a { display:inline-flex; align-items:center; gap:10px; text-decoration:none; color:#7C3A66; font-family:'Quicksand',sans-serif; font-weight:700; font-size:15px; }
  main { max-width:840px; margin:0 auto; padding:40px 24px 70px; }
  .eyebrow { font-family:'Quicksand',sans-serif; font-weight:600; font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:#9B4880; margin-bottom:8px; }
  .pagetitle { font-family:'Quicksand',sans-serif; font-weight:700; font-size:clamp(30px,5vw,42px); color:#46474A; line-height:1.1; margin-bottom:10px; }
  .standfirst { font-size:16.5px; line-height:1.6; color:#56565A; max-width:640px; }
  .pdfcard { display:flex; align-items:center; gap:14px; background:#fff; border:1px solid #ECE0E7; border-radius:18px; padding:18px 20px; margin:26px 0 8px; }
  .pdfcard a { color:#9B4880; font-family:'Quicksand',sans-serif; font-weight:700; text-decoration:none; font-size:15px; }
  .pdfcard small { display:block; color:#7C7D81; font-size:13px; margin-top:2px; }
  article { background:#fff; border:1px solid #ECE0E7; border-radius:22px; padding:clamp(22px,4vw,48px); margin-top:26px; overflow-wrap:break-word; }
  article h2 { font-family:'Quicksand',sans-serif; font-weight:700; font-size:27px; color:#7C3A66; margin:38px 0 14px; }
  article h2:first-child { margin-top:0; }
  article h3 { font-family:'Quicksand',sans-serif; font-weight:700; font-size:21px; color:#9B4880; margin:30px 0 12px; }
  article h4 { font-family:'Quicksand',sans-serif; font-weight:700; font-size:17px; color:#46474A; margin:24px 0 10px; }
  article h5 { font-family:'Quicksand',sans-serif; font-weight:700; font-size:15.5px; color:#56565A; margin:20px 0 8px; }
  article p { font-size:15.5px; line-height:1.75; margin:0 0 13px; }
  article ul, article ol { margin:0 0 16px 22px; }
  article li { font-size:15.5px; line-height:1.7; margin-bottom:7px; }
  article table { border-collapse:collapse; width:100%; margin:18px 0; display:block; overflow-x:auto; }
  article th, article td { border:1px solid #ECE0E7; padding:9px 12px; font-size:14.5px; text-align:left; vertical-align:top; }
  article th { background:#FBF7F4; font-family:'Quicksand',sans-serif; font-weight:700; }
  article img { max-width:100%; height:auto; }
  article a { color:#9B4880; }
  article strong { color:#3A3B3E; }
  footer { text-align:center; padding:0 24px 50px; font-size:14px; color:#8A8B8F; }
  footer a { color:#9B4880; font-weight:600; }
</style>`;

  // The PDF keeps its filename across editions and /documents/* is cached for
  // a day with stale-while-revalidate, so a browser that has opened an older
  // edition would keep serving it. A query string keyed to the file's content
  // makes every new edition a new URL without renaming the file.
  const pdfFile = path.join(ROOT, 'documents', 'apple-blossom-policies.pdf');
  const pdfVersion = fs.existsSync(pdfFile) ? '?v=' + crypto.createHash('md5').update(fs.readFileSync(pdfFile)).digest('hex').slice(0, 8) : '';

  const page = '<!DOCTYPE html>\n<html lang="en">\n<head>\n' + head + '\n</head>\n<body>\n' +
    '<div class="top"><a href="/"><svg width="26" height="26" viewBox="0 0 400 400" aria-hidden="true"><g transform="translate(200,196)"><circle cx="0" cy="-48" r="35" fill="#E89BC0"/><circle cx="46" cy="-15" r="35" fill="#CE6D9E"/><circle cx="28" cy="39" r="35" fill="#C58AB0"/><circle cx="-28" cy="39" r="35" fill="#E89BC0"/><circle cx="-46" cy="-15" r="35" fill="#F3C4DA"/><circle cx="0" cy="-4" r="21" fill="#9B4880"/></g></svg>Apple Blossom Cattery</a></div>\n' +
    '<main>\n<div class="eyebrow">Operations Manual · 2026 Edition</div>\n<h1 class="pagetitle">Policies &amp; Procedures</h1>\n' +
    '<p class="standfirst">Everything we do with your cat, written down — how a cat is booked in, fed, cleaned around, watched over and handed back, together with our risk assessment and privacy notice. We publish it because we have nothing to hide.</p>\n' +
    '<div class="pdfcard"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#9B4880" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><div><a href="/documents/apple-blossom-policies.pdf' + pdfVersion + '" target="_blank" rel="noopener">Download the designed print edition</a><small>PDF, 15&nbsp;MB — the same document, laid out for print</small></div></div>\n' +
    '<article>\n' + body + '\n</article>\n</main>\n' +
    '<footer>Apple Blossom Cattery, Cowbridge Road, Talygarn, Pontyclun CF72 9JU · <a href="/">appleblossomcattery.com</a> · <a href="/contact/">Contact us</a></footer>\n' +
    '</body>\n</html>\n';

  const outDir = path.join(DIST, 'policies');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), page);
  console.log(`  policies: /policies/ generated from the docx master (${(textChars / 1000).toFixed(1)}k chars of indexable text)`);
}

// ---- service-area pages ----------------------------------------------------
// Standalone pages (like /policies/), NOT app routes: the design tool owns
// index.html, so a new app route cannot be added from here. See areas.js for
// why these exist and where their numbers come from.
function escH(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const AREA_CSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#F5F1EC; color:#46474A; font-family:'Nunito Sans',sans-serif; }
  .top { background:#FBEEF4; border-bottom:1px solid #F0D8E4; padding:14px 24px; display:flex; flex-wrap:wrap; gap:8px 22px; align-items:center; justify-content:space-between; }
  .top .brand { display:inline-flex; align-items:center; gap:10px; text-decoration:none; color:#7C3A66; font-family:'Quicksand',sans-serif; font-weight:700; font-size:15px; }
  .top nav { display:flex; flex-wrap:wrap; gap:16px; }
  .top nav a { color:#7C3A66; text-decoration:none; font-family:'Quicksand',sans-serif; font-weight:600; font-size:14px; }
  main { max-width:840px; margin:0 auto; padding:40px 24px 60px; }
  .eyebrow { font-family:'Quicksand',sans-serif; font-weight:600; font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:#9B4880; margin-bottom:8px; }
  h1 { font-family:'Quicksand',sans-serif; font-weight:700; font-size:clamp(30px,5vw,42px); color:#46474A; line-height:1.12; margin-bottom:12px; }
  .standfirst { font-size:17px; line-height:1.65; color:#56565A; max-width:660px; }
  .cta { display:flex; flex-wrap:wrap; gap:12px; margin:26px 0 8px; }
  .cta a { display:inline-block; text-decoration:none; font-family:'Quicksand',sans-serif; font-weight:700; font-size:15px; padding:13px 22px; border-radius:999px; }
  .cta .primary { background:#9B4880; color:#fff; }
  .cta .ghost { background:#fff; color:#9B4880; border:1px solid #ECD6E3; }
  section { background:#fff; border:1px solid #ECE0E7; border-radius:22px; padding:clamp(22px,4vw,38px); margin-top:22px; }
  section h2 { font-family:'Quicksand',sans-serif; font-weight:700; font-size:24px; color:#7C3A66; margin-bottom:14px; }
  section p { font-size:16px; line-height:1.75; margin:0 0 14px; }
  section p:last-child { margin-bottom:0; }
  .places { display:flex; flex-wrap:wrap; gap:8px; margin-top:4px; }
  .places span { background:#FBEEF4; color:#7C3A66; border-radius:999px; padding:6px 13px; font-size:14px; font-weight:600; }
  .facts { list-style:none; display:grid; gap:10px; }
  .facts li { font-size:15.5px; line-height:1.6; padding-left:26px; position:relative; }
  .facts li::before { content:'✓'; position:absolute; left:0; color:#9B4880; font-weight:700; }
  .areas { margin-top:22px; font-size:15px; line-height:1.9; color:#56565A; }
  .areas a { color:#9B4880; font-weight:600; }
  footer { text-align:center; padding:0 24px 50px; font-size:14px; color:#8A8B8F; line-height:1.7; }
  footer a { color:#9B4880; font-weight:600; }

  /* ---- Motion -------------------------------------------------------------
     These pages are plain generated HTML with no hydration, so motion here
     cannot be undone by the design bundle. The easing and the keyframe name
     deliberately match the bundle's own (abcUp, cubic-bezier(.22,.61,.36,1)),
     so a visitor moving between a town page and the main site does not feel
     the hand change. Transform and opacity only — nothing here reflows. */
  @keyframes abcUp { from { opacity:0; transform:translateY(18px) } to { opacity:1; transform:none } }

  section { transition: transform .26s cubic-bezier(.22,.61,.36,1), box-shadow .3s ease, border-color .2s ease; }
  section:hover { transform:translateY(-3px); box-shadow:0 14px 34px rgba(124,58,102,.10); border-color:#E6D2DF; }

  .cta a { transition: transform .26s cubic-bezier(.22,.61,.36,1), box-shadow .3s ease, background-color .2s ease; }
  .cta .primary { box-shadow:0 8px 20px rgba(124,58,102,.22); }
  .cta a:hover { transform:translateY(-2px); }
  .cta .primary:hover { background:#7C3A66; box-shadow:0 12px 26px rgba(124,58,102,.30); }
  .cta .ghost:hover { border-color:#9B4880; box-shadow:0 10px 22px rgba(124,58,102,.12); }
  .cta a:active { transform:translateY(0); transition-duration:.05s; }

  /* The village chips are the one flourish on the page: they lift a little on
     hover, staggered on arrival so the list of places assembles itself. */
  .places span { transition: transform .2s cubic-bezier(.22,.61,.36,1), background-color .2s ease; }
  .places span:hover { transform:translateY(-2px); background:#F6DFEC; }

  .facts li::before { transition: transform .2s cubic-bezier(.22,.61,.36,1); }
  .facts li:hover::before { transform:scale(1.25); }

  .top .brand svg { transition: transform .4s cubic-bezier(.22,.61,.36,1); }
  .top .brand:hover svg { transform:rotate(8deg) scale(1.06); }

  .top nav a, .areas a, footer a { transition: color .2s ease; }
  .top nav a:hover, .areas a:hover, footer a:hover { color:#9B4880; }

  /* Sections rise in on load, each a beat after the last. No scroll observer:
     these pages are short, and a JS reveal that fails leaves content invisible
     — this way the content is always there, animated or not. */
  @media (prefers-reduced-motion: no-preference) {
    main > section { animation: abcUp .5s cubic-bezier(.22,.61,.36,1) both; }
    main > section:nth-of-type(1) { animation-delay:.04s }
    main > section:nth-of-type(2) { animation-delay:.10s }
    main > section:nth-of-type(3) { animation-delay:.16s }
    main > section:nth-of-type(4) { animation-delay:.22s }
    main > section:nth-of-type(5) { animation-delay:.28s }
  }

  /* Asked for stillness: everything drawn, nothing moving. The hover shadow
     stays so "this is interactive" still reads without movement. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration:.01ms !important; animation-iteration-count:1 !important;
      animation-name:none !important; transition-duration:.01ms !important; scroll-behavior:auto !important;
    }
    section:hover, .cta a:hover, .places span:hover { transform:none; }
  }
`;

const BLOSSOM = '<svg width="26" height="26" viewBox="0 0 400 400" aria-hidden="true"><g transform="translate(200,196)"><circle cx="0" cy="-48" r="35" fill="#E89BC0"/><circle cx="46" cy="-15" r="35" fill="#CE6D9E"/><circle cx="28" cy="39" r="35" fill="#C58AB0"/><circle cx="-28" cy="39" r="35" fill="#E89BC0"/><circle cx="-46" cy="-15" r="35" fill="#F3C4DA"/><circle cx="0" cy="-4" r="21" fill="#9B4880"/></g></svg>';

function areaPageHtml(a) {
  const url = `${BASE_URL}/${a.slug}/`;
  // Schema mirrors the LocalBusiness in seo-head.html, narrowed to this area —
  // same address and coordinates, because the cattery has ONE location and the
  // page must never imply otherwise.
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: 'Apple Blossom Cattery',
    description: a.description,
    url,
    telephone: FACTS.phone,
    image: `${BASE_URL}/images/og-card.jpg`,
    priceRange: '££',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Cowbridge Road, Talygarn',
      addressLocality: 'Pontyclun',
      addressRegion: 'Vale of Glamorgan',
      postalCode: 'CF72 9JU',
      addressCountry: 'GB',
    },
    geo: { '@type': 'GeoCoordinates', latitude: 51.505458, longitude: -3.409968 },
    areaServed: a.places.map((p) => ({ '@type': 'Place', name: p })),
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: FACTS.rating,
      reviewCount: FACTS.reviews,
      bestRating: '5',
    },
  };
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE_URL}/` },
      { '@type': 'ListItem', position: 2, name: `Cat boarding near ${a.name}`, item: url },
    ],
  };

  const others = AREAS.filter((x) => x.slug !== a.slug)
    .map((x) => `<a href="/${x.slug}/">${escH(x.name)}</a>`).join(' · ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escH(a.title)}</title>
<meta name="description" content="${escH(a.description)}">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#9B4880">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Apple Blossom Cattery">
<meta property="og:title" content="${escH(a.title)}">
<meta property="og:description" content="${escH(a.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${BASE_URL}/images/og-card.jpg">
<meta name="geo.placename" content="Talygarn, Pontyclun">
<meta name="geo.position" content="51.505458;-3.409968">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@600;700&family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700&display=swap" rel="stylesheet">
<style>${AREA_CSS}</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<script type="application/ld+json">${JSON.stringify(crumbs)}</script>
</head>
<body>
<div class="top">
  <a class="brand" href="/">${BLOSSOM}Apple Blossom Cattery</a>
  <nav><a href="/boarding/">Pens</a><a href="/fees/">Fees</a><a href="/vaccinations/">Vaccinations</a><a href="/gallery/">Photos</a><a href="/testimonials/">Reviews</a><a href="/contact/">Contact</a></nav>
</div>
<main>
  <div class="eyebrow">${escH(a.region)}</div>
  <h1>${escH(a.h1)}</h1>
  <p class="standfirst">${escH(a.standfirst)}</p>
  <div class="cta">
    <a class="primary" href="/contact/">Check availability</a>
    <a class="ghost" href="tel:${FACTS.phoneHref}">Call ${escH(FACTS.phone)}</a>
  </div>

  <section>
    <h2>Getting here from ${escH(a.name)}</h2>
    ${a.journey.map((p) => `<p>${escH(p)}</p>`).join('\n    ')}
  </section>

  <section>
    <h2>Villages and districts we board cats from</h2>
    <div class="places">${a.places.map((p) => `<span>${escH(p)}</span>`).join('')}</div>
  </section>

  <section>
    <h2>${escH(a.angle.h2)}</h2>
    ${a.angle.paras.map((p) => `<p>${escH(p)}</p>`).join('\n    ')}
  </section>

  <section>
    <h2>The essentials</h2>
    <ul class="facts">
      <li>Licensed and inspected by the Vale of Glamorgan Animal Welfare team — Animal Boarding Licence no. ${escH(FACTS.licence)} — and fully insured.</li>
      <li>Purpose-built in 2019 and fully climate-controlled, with sneeze barriers between pens, and pens constructed so cats can scent the fresh air whilst remaining secure indoors behind a safety corridor.</li>
      <li>Rated ${escH(FACTS.rating)} out of 5 from ${escH(FACTS.reviews)} Google reviews, and 5 out of 5 from ${escH(FACTS.yellVotes)} reviews on Yell.</li>
      <li>Charged per pen per day, from £17 a day for one cat — cats from the same household share a pen and a rate.</li>
      <li>Medication given where we can safely give it, at no extra charge. <a href="/vaccinations/">Vaccinations are checked on arrival, every time</a>.</li>
      <li>Members of the Pet Industry Federation, and our <a href="/policies/">full policies and procedures are published</a> for anyone to read before booking.</li>
      <li>Ask about <a href="/pickup/">pick-up and drop-off</a> when you enquire — we can often collect and return, depending on the day and the distance.</li>
    </ul>
  </section>

  <section>
    <h2>Come and see it first</h2>
    <p>Viewings are welcome and always by appointment, seven days a week, so that whoever shows you round is not also settling an arrival. We will show you the actual pen your cat would have, not a photograph of one.</p>
    <p>Call ${escH(FACTS.phone)}, <a href="/contact/">send an enquiry</a>, or come and find us at ${escH(FACTS.address)}.</p>
  </section>

  <div class="areas">We also board cats from ${others}.</div>
</main>
<footer>Apple Blossom Cattery · ${escH(FACTS.address)} · ${escH(FACTS.phone)}<br><a href="/">appleblossomcattery.com</a> · <a href="/contact/">Contact</a> · <a href="/fees/">Fees</a> · <a href="/policies/">Policies &amp; procedures</a></footer>
</body>
</html>
`;
}

function buildAreaPages() {
  for (const a of AREAS) {
    const outDir = path.join(DIST, a.slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), areaPageHtml(a));
  }
  console.log(`  areas: ${AREAS.length} service-area pages generated (${AREAS.map((a) => a.name).join(', ')})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
