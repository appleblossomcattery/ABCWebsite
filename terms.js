// The T&Cs shown on the Terms page and offered as the PDF download.
//
// CatBooker holds the master of every edition and serves only the one in force
// today (UK date): this repository is public, so it never holds an edition
// before its first day. The build bakes the edition in force into the page;
// TERMS_API is asked again in the browser, so a new edition replaces the text
// at midnight on its first day without waiting for a rebuild.
//
// terms-current.json is the fallback for a build that cannot reach CatBooker:
// a snapshot of the edition in force when it was last refreshed (it is
// rewritten from the API on every build that reaches it).
const fs = require('fs');
const path = require('path');

const TERMS_API = 'https://catbooker.netlify.app/api/terms';
const TERMS_PDF = 'https://catbooker.netlify.app/api/terms.pdf';
const SNAPSHOT = path.join(__dirname, 'terms-current.json');

const valid = (t) => t && /^\d{4}$/.test(t.edition) && typeof t.html === 'string' && t.html.length > 1000 && /^\d{4}-\d{2}-\d{2}$/.test(t.from);

async function currentTerms() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    const res = await fetch(TERMS_API, { signal: ctl.signal });
    clearTimeout(timer);
    const t = res.ok ? await res.json() : null;
    if (valid(t)) {
      fs.writeFileSync(SNAPSHOT, JSON.stringify(t, null, 1));
      console.log(`  terms: ${t.edition} edition from CatBooker`);
      return t;
    }
    console.warn(`  terms: CatBooker answered ${res.status} — using the snapshot`);
  } catch (e) {
    console.warn(`  terms: CatBooker unreachable (${e.message}) — using the snapshot`);
  }
  const t = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  if (!valid(t)) throw new Error('terms-current.json is not a valid terms edition');
  console.log(`  terms: ${t.edition} edition from the snapshot`);
  return t;
}

/** "1 July 2026" */
const longDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

module.exports = { TERMS_API, TERMS_PDF, currentTerms, longDate };
