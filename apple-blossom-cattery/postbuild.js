#!/usr/bin/env node
/*
 * Apple Blossom Cattery — post-build SEO injector.
 *
 * WHY THIS EXISTS
 * The website is a Design Component bundled into a single index.html. The
 * bundler keeps the page's <head> tags inside a JavaScript string
 * (<script type="__bundler/template">), so search engines and the Facebook /
 * WhatsApp / iMessage link scrapers — none of which run that JavaScript —
 * see only the <title>. This script lifts the real, crawler-facing tags
 * (meta description, Open Graph, Twitter card, canonical, JSON-LD structured
 * data) from seo-head.html into index.html's actual <head> on every deploy,
 * and sets <html lang="en">.
 *
 * It is idempotent: safe to run repeatedly (Netlify runs it on each build).
 *
 * Wired via netlify.toml:  [build] command = "node postbuild.js"
 */
const fs = require('fs');
const path = require('path');

const idxPath = path.join(__dirname, 'index.html');
const headPath = path.join(__dirname, 'seo-head.html');

let html = fs.readFileSync(idxPath, 'utf8');
const before = html;

// 1) Ensure <html lang="en"> on the OUTER (first) <html> tag.
html = html.replace(/<html(\s[^>]*)?>/i, (m, attrs) => {
  if (/\blang\s*=/i.test(m)) return m;
  return '<html lang="en"' + (attrs || '') + '>';
});

// 2) Inject the crawler-facing head block once, just before </head>.
if (html.indexOf('abc-seo-start') === -1) {
  const head = fs.readFileSync(headPath, 'utf8').trim();
  html = html.replace(/<\/head>/i,
    '<!--abc-seo-start-->\n' + head + '\n<!--abc-seo-end-->\n</head>');
}

if (html !== before) {
  fs.writeFileSync(idxPath, html);
  console.log('postbuild: injected SEO head + lang="en" into index.html');
} else {
  console.log('postbuild: nothing to do (already applied)');
}
