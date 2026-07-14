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
2. Build command: **`node postbuild.js`**  ·  Publish directory: **`.`**  (both are already in
   `netlify.toml`, so just accept them).
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
(runs `postbuild.js`) and redeploys in 1–2 minutes. No manual file uploads.

| What changed | Who does it | How |
|---|---|---|
| Design, copy, photos, page content | Design tool (me) | I regenerate `index.html`; you commit that one file and push. |
| SEO tags | edit `seo-head.html` | commit + push. |
| Email logic, CatBooker wiring, build/pre-render | Claude Code | edits the relevant files, commits + push. |

Safety nets Netlify gives you for free:
- **Rollback:** Deploys tab → pick a previous deploy → "Publish deploy". Instant revert.
- **Preview builds:** open a pull request and Netlify builds a temporary preview URL, so you
  can see a change before it goes live on the real domain.

> Golden rule: `index.html` is a build artifact. Never hand-edit it — change the source and
> re-export, then push. `postbuild.js` re-applies the SEO head on every build automatically.

---

## 3. The Claude Code stage

### Job 1 — Pre-render the routes (audit item 1) — ~½–1 day

**Why:** the site is one hash-routed SPA, so there is only one indexable URL and crawlers see
almost no body text. `postbuild.js` already fixes the `<head>` + `lang`. This job gives each
page its own real URL with server-rendered content, so the site can rank for local searches
("cattery prices Pontyclun", "cat boarding near junction 34").

**Build a repeatable build step** (extends, or runs alongside, `postbuild.js`) that, after the
bundle exists:
1. Loads the bundled `index.html` in headless Chromium (Puppeteer/Playwright — available in
   Netlify build).
2. For each route, sets the hash, waits for render, and writes the resulting fully-rendered
   HTML to its own path:
   `/` , `/about/`, `/boarding/`, `/pickup/`, `/fees/`, `/hours/`, `/vaccinations/`, `/why/`,
   `/faq/`, `/gallery/`, `/testimonials/`, `/contact/`, `/terms/`, `/privacy/`.
3. Each static page keeps the SPA script (so it still hydrates for users) but has the rendered
   markup in `<body>` (so no-JS crawlers get real text + links).
4. Gives each page its **own `<title>`, meta description and canonical** (per-route map, e.g. a
   small `routes.json`; reuse the `seo-head.html` pattern for the shared tags).
5. Rewrites in-page nav from `#/x` to real `/x/` paths (hash kept as fallback).
6. Emits a **real `sitemap.xml`** with one `<url>` per route (replaces the current root-only
   placeholder), and updates `_redirects` so `/fees` etc. serve the static page directly.

**Acceptance:** `curl -s https://site/fees/ | grep -c "per pen-day"` > 0, and each route returns
200 with a distinct `<title>`.

**Do NOT touch:** `netlify/functions/send-enquiry.js` or the Pen Checker JSON contract (stable);
and never hand-edit `index.html` — pre-render must run *after* each rebundle as a build step,
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
