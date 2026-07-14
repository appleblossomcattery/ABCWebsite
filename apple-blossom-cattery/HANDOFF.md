# Apple Blossom Cattery — Handoff & Operations

This file covers three things:
1. **Getting the site onto GitHub + Netlify** (do this once — nothing else works without it).
2. **How to update the site afterwards** (the day-to-day flow).
3. **The Claude Code stage** — pre-rendering routes (audit item 1) and image migration (item 5).

No third-party platforms beyond ones already in play: **GitHub** (repo), **Netlify** (host/build),
**Resend** (email). No new subscriptions. Headless Chromium for pre-render runs inside Netlify's build.

---

## 1. One-time setup: GitHub → Netlify

**A. Put this folder in a GitHub repo**
1. Create a new repo at github.com (e.g. `apple-blossom-website`), Private is fine.
2. Upload this whole folder to it — either drag the files into GitHub's "upload files" page,
   or, with git installed:
   ```
   cd apple-blossom-cattery
   git init && git add . && git commit -m "Initial site"
   git branch -M main
   git remote add origin https://github.com/<you>/apple-blossom-website.git
   git push -u origin main
   ```

**B. Connect the repo to Netlify**
1. Netlify → **Add new site → Import an existing project → GitHub** → pick the repo.
2. Build command: **`node prerender.js`**  ·  Publish directory: **`dist`**  (both are already in
   `netlify.toml`, so just accept them). Netlify runs `npm install` first, which downloads the
   headless Chromium the pre-render needs.
3. **Deploy site.**

**C. Set environment variables** (Netlify → Site configuration → Environment variables):
- `RESEND_API_KEY` — required for the enquiry emails.
- `CATBOOKER_API_URL` + `PEN_CHECK_SECRET` — when you're ready to switch the availability
  check from the demo mock to live CatBooker (same secret on both sites).
- `MAIL_FROM` / `MAIL_TO` / `MAIL_CC` — optional overrides (see `.env.example`).
Redeploy after setting them (Deploys → Trigger deploy).

**D. Custom domain:** Netlify → Domain settings → add `appleblossomcattery.com` and
`www.appleblossomcattery.com`, and point the DNS as Netlify instructs. (Email MX stays on Wix —
don't change MX records.)

---

## 2. Updating the site afterwards

Once A–C are done, **every update is just a push to GitHub** — Netlify auto-builds
(runs `prerender.js`) and redeploys in 1–2 minutes. No manual file uploads.

| What changed | Who does it | How |
|---|---|---|
| Design, copy, photos, page content | Design tool (me) | I regenerate `index.html`; you commit that one file and push. |
| SEO tags (shared) | edit `seo-head.html` | commit + push. |
| Per-page titles / descriptions | edit `routes.js` | commit + push. |
| Email logic, CatBooker wiring, build/pre-render | Claude Code | edits the relevant files, commits + push. |

Safety nets Netlify gives you for free:
- **Rollback:** Deploys tab → pick a previous deploy → "Publish deploy". Instant revert.
- **Preview builds:** open a pull request and Netlify builds a temporary preview URL, so you
  can see a change before it goes live on the real domain.

> Golden rule: `index.html` is a build artifact. Never hand-edit it — change the source and
> re-export, then push. The build re-applies the SEO head and pre-renders every route on each
> deploy automatically. If you re-export a design that **adds or renames a page/route**, tell
> Claude Code so `routes.js` is updated to match.

---

## 3. The Claude Code stage

### Job 1 — Pre-render the routes (audit item 1) — ✅ DONE

**Why:** the site is one hash-routed SPA, so there is only one indexable URL and crawlers see
almost no body text. This gives each page its own real URL with server-rendered content, so the
site can rank for local searches ("cattery prices Pontyclun", "cat boarding near junction 34").

**How it was built** — `prerender.js` is the Netlify build command (`netlify.toml`; publish dir
is now `dist/`). On each deploy it:
1. Injects the shared SEO `<head>` (`seo-head.html`, via `postbuild.injectSeoHead`) into the
   bundle **in memory** — source files are never mutated, so the build is safe to re-run and
   survives the design tool re-exporting `index.html`.
2. Serves that bundle and drives it in headless Chromium (Puppeteer, downloaded by
   `npm install`), rendering each route in `routes.js` and lifting its `#dc-root` markup.
3. Writes each route to its own path under `dist/` (`/`, `/about/`, `/boarding/`, `/pickup/`,
   `/fees/`, `/hours/`, `/vaccinations/`, `/why/`, `/faq/`, `/gallery/`, `/testimonials/`,
   `/contact/`, `/terms/`, `/privacy/`), each with the rendered content in `<body>` and its own
   `<title>` / description / canonical / OG tags (all from `routes.js`).
4. In-page `#/x` nav is rewritten to real `/x/` paths for crawlers; emits a real `sitemap.xml`
   (one `<url>` per route) and a `_redirects` that points legacy Wix URLs at the new pages.

**Why it still works for users (important):** every page keeps the **whole working SPA**, so
after hydration the enquiry form, Pen Checker availability module, gallery and mobile nav all
function exactly as before, and client-side routing stays snappy. The bundle boots by replacing
the entire `<html>` and never sets per-route titles itself, so a small `window`-scoped
SEO-persist script (injected by `prerender.js`, and whose listeners survive that swap) re-stamps
the correct `<title>`/canonical/description for the current route — so Googlebot's *rendered*
view also gets distinct, non-duplicate signals, not a page full of `/`-canonicals.

**Acceptance (met):** each of the 14 routes returns 200 with a distinct `<title>`, and the raw
(no-JS) HTML carries the page's real content — e.g. `curl -s https://site/fees/` contains the
boarding fees ("per pen, per day", "£17"). Verified end-to-end (raw crawler view + full
hydration + interactivity) across all routes.

**If a design change adds/renames a route:** update the `ROUTES` array in `routes.js` to match.

**Do NOT touch:** `netlify/functions/send-enquiry.js` or the Pen Checker JSON contract (stable);
and never hand-edit `index.html` — pre-render runs *after* each rebundle as a build step,
because the design tool regenerates `index.html` on every design change.

### Job 2 — Migrate images off Wix (audit item 5) — ~1–2 hrs

Every photo is hotlinked from `static.wixstatic.com`; if that subscription lapses the images
vanish. At build time (or once): download the image IDs (gallery IDs are in the DC's `images`
array; inline photos are direct `wixstatic` URLs), store under `/images/`, and rewrite the
`src`s to `/images/<id>.jpg`. Removes the silent dependency on the old Wix account.

### Contract reminder (website ↔ CatBooker)
`POST {CATBOOKER_API_URL}` with `Authorization: Bearer {PEN_CHECK_SECRET}` (also sent as
`X-Pen-Check-Secret`), body `{ "start", "end", "cats" }`; response
`{ "possible": bool, "options": [...], "moves": [...] }`. See README "CatBooker integration".
