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

  // Pen-day rates aligned to the locked commercial model (model.xlsx): 3 cats
  // £24→£25, 4 cats £26→£27 (1- and 2-cat rates already match). These appear on
  // the fees page and in terms clause 2.3, both inside the design bundle;
  // correct them here until the design source is regenerated with the right
  // figures. Only these two exact rates are touched — see prerender README note.
  for (const [from, to] of [['£24', '£25'], ['£26', '£27']]) base = base.split(from).join(to);

  // Publish the animal boarding licence number where the site already mentions
  // the Vale of Glamorgan inspection (audit: the number reassures and is
  // expected in the sector). Held by Rhys & Laura Johns as individuals — there
  // is no company number, and their home address is deliberately not published.
  base = base.split('Vale of Glamorgan Animal Welfare team, and fully insured')
    .join('Vale of Glamorgan Animal Welfare team (Animal Boarding Licence no. BOE028), and fully insured');

  // Spell out the updates owners get — photos, videos and a FaceTime call on
  // request (their most-praised habit in reviews; the site under-mentioned it).
  base = base.split('and photos during their stay, so you know')
    .join('photos and videos during their stay, and a FaceTime call with your cat on request, so you know');

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
    '',
    '# SPA fallback — any other path serves the app (hash-routes client-side).',
    '/*                    /index.html         200',
    '',
  ];
  fs.writeFileSync(path.join(DIST, '_redirects'), lines.join('\n'));
}

main().catch((err) => { console.error(err); process.exit(1); });
