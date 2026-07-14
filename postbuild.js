#!/usr/bin/env node
/*
 * Apple Blossom Cattery — post-build SEO injector.
 *
 * WHY THIS EXISTS
 * The website is a Design Component bundled into a single index.html. The
 * bundler keeps the page's <head> tags inside a JavaScript string
 * (<script type="__bundler/template">), so search engines and the Facebook /
 * WhatsApp / iMessage link scrapers — none of which run that JavaScript —
 * see only the <title>. This lifts the real, crawler-facing tags (meta
 * description, Open Graph, Twitter card, canonical, JSON-LD structured data)
 * from seo-head.html into index.html's actual <head>, and sets
 * <html lang="en">.
 *
 * The logic lives in injectSeoHead() so prerender.js can reuse it on the
 * in-memory bundle without touching the source file. It is idempotent: the
 * abc-seo-start marker guards against double-injection.
 *
 * Run directly (`node postbuild.js`) it applies the tags to ./index.html in
 * place — kept for local use. The wired Netlify build command is
 * `node prerender.js`, which calls injectSeoHead() itself (see netlify.toml).
 */
const fs = require('fs');
const path = require('path');

/**
 * Inject the crawler-facing <head> block and lang="en" into a bundle HTML
 * string. Pure and idempotent — returns the (possibly unchanged) HTML.
 * @param {string} html  the bundled index.html contents
 * @param {string} [seoHead]  seo-head.html contents; read from disk if omitted
 */
function injectSeoHead(html, seoHead) {
  // 1) Ensure <html lang="en"> on the OUTER (first) <html> tag.
  html = html.replace(/<html(\s[^>]*)?>/i, (m, attrs) => {
    if (/\blang\s*=/i.test(m)) return m;
    return '<html lang="en"' + (attrs || '') + '>';
  });

  // 2) Inject the crawler-facing head block once, just before </head>.
  if (html.indexOf('abc-seo-start') === -1) {
    const head = (seoHead != null
      ? seoHead
      : fs.readFileSync(path.join(__dirname, 'seo-head.html'), 'utf8')
    ).trim();
    html = html.replace(/<\/head>/i,
      '<!--abc-seo-start-->\n' + head + '\n<!--abc-seo-end-->\n</head>');
  }
  return html;
}

module.exports = { injectSeoHead };

// CLI mode: apply to ./index.html in place (local convenience).
if (require.main === module) {
  const idxPath = path.join(__dirname, 'index.html');
  const before = fs.readFileSync(idxPath, 'utf8');
  const after = injectSeoHead(before);
  if (after !== before) {
    fs.writeFileSync(idxPath, after);
    console.log('postbuild: injected SEO head + lang="en" into index.html');
  } else {
    console.log('postbuild: nothing to do (already applied)');
  }
}
