# Apple Blossom Cattery — Website

The public website for Apple Blossom Cattery: marketing pages, gallery, policies,
and an enquiry form that emails the team via Resend. It is a **static site plus a
Netlify Function** — no server to run, no database. It talks to **CatBooker** (the
booking/admin app) over HTTPS when a live availability check is needed.

Live domain: **appleblossomcattery.com**

---

## Repo layout

```
.
├── index.html                     # The whole website (single self-contained SPA bundle)
├── routes.js                      # Route manifest: per-page title/description/canonical
├── prerender.js                   # Build: SEO head + pre-render every route → dist/
├── postbuild.js                   # SEO-head injector (exports injectSeoHead; used by prerender)
├── seo-head.html                  # Shared crawler-facing <head> tags (SEO source of truth)
├── robots.txt                     # Crawl directives + sitemap pointer (copied into dist/)
├── netlify.toml                   # Netlify config (build command + publish dir + functions)
├── .puppeteerrc.cjs               # Pins Chromium cache into the project for the build
├── package.json                   # puppeteer dependency + build scripts
├── netlify/
│   └── functions/
│       └── send-enquiry.js        # Enquiry form → branded emails via Resend
├── dist/                          # Build output (generated; git-ignored). Netlify publishes this.
│   ├── index.html · <route>/index.html   # one pre-rendered page per route
│   ├── sitemap.xml · _redirects          # generated fresh each build
│   └── robots.txt
├── .env.example                   # Documents required environment variables
├── HANDOFF.md                     # GitHub+Netlify setup, update flow, Claude Code spec
└── README.md
```

> `sitemap.xml` and `_redirects` are **generated into `dist/`** by `prerender.js` on every
> build — don't hand-edit them (edit `routes.js` / `prerender.js`).

> **`index.html` is a build artifact — do not hand-edit it.** It is generated from a
> Design Component in the design tool and re-exported whenever the look changes. Editing
> it by hand will be overwritten on the next design update. See **Ownership** below.

---

## Deploy (Netlify)

1. Push this folder to a GitHub repo.
2. In Netlify: **Add new site → Import an existing project** → pick the repo.
3. Build command: `node postbuild.js` (already set in `netlify.toml`). Publish directory:
   `.` (root). Functions: auto-detected from `netlify.toml`.
4. Set the environment variables below (**Site configuration → Environment variables**).
5. Deploy. Every push to the default branch redeploys automatically.

Custom domains: point both `appleblossomcattery.com` and `www.appleblossomcattery.com`
at the Netlify site.

---

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `RESEND_API_KEY` | **Yes** | — | Resend API key (same account as CatBooker is fine). |
| `MAIL_FROM` | No | `Apple Blossom Cattery <enquiries@appleblossomcatterybookings.com>` | Sender. **Must be on a domain VERIFIED in Resend.** `appleblossomcattery.com` could not be verified (Wix blocked the MX transfer), so `appleblossomcatterybookings.com` is the verified sending domain. |
| `MAIL_TO` | No | `laura@appleblossomcattery.com` | Where enquiries land. |
| `MAIL_CC` | No | `bookings@appleblossomcattery.com` | Copied on every enquiry. |
| `CATBOOKER_API_URL` | For live check | — | CatBooker Pen Checker endpoint, e.g. `https://catbooker.netlify.app/api/pen-check`. When set, the site does a live check; when unset it uses the built-in mock. |
| `PEN_CHECK_SECRET` | For live check | — | Shared secret proving the request came from the website. Set the **same value on both** the website and CatBooker. Sent as `Authorization: Bearer <secret>` and `X-Pen-Check-Secret`. |

Copy `.env.example` to `.env` for local dev (`netlify dev`). Never commit `.env`.

---

## Email (Resend)

On enquiry submit, `send-enquiry.js` sends **two branded emails**:

1. **Internal** — to `MAIL_TO`, cc `MAIL_CC`, `reply_to` = the customer (so a reply goes
   straight back to them). Contains the full enquiry.
2. **Customer** — a branded thank-you to the enquirer, `reply_to` = the cattery.

Also included: a hidden honeypot field for spam, and a **mailto fallback** — if the
function is unreachable (e.g. key not set, or opened off-Netlify), the form opens the
visitor's mail app pre-filled so nothing is ever lost.

---

## CatBooker integration (the seam)

The website and CatBooker stay **separate deployments** and join over **one API call**.
The browser never calls CatBooker directly — the Netlify function is the broker. This
keeps the CatBooker key server-side, keeps the pen logic + data private, and lets the
site show the customer only a yes/no.

### Contract — Pen Checker availability

**Request** (server-to-server, from the Netlify function):

```
POST  {CATBOOKER_API_URL}
Authorization: Bearer {PEN_CHECK_SECRET}
X-Pen-Check-Secret: {PEN_CHECK_SECRET}
Content-Type: application/json

{ "start": "2026-08-15", "end": "2026-08-22", "cats": 2 }
```

**Response:**

```json
{
  "possible": true,
  "options": [{ "pen": "Blossom 3", "cats": 2 }],
  "moves":   [{ "booking": "Oreo & Socks", "from": "Pen 2", "to": "Pen 5", "dates": "15–22 Aug" }]
}
```

### Flow

1. Customer enters **date range + number of cats** on the site.
2. Site → Netlify function → CatBooker Pen Checker (contract above).
3. Customer sees only **"Available"** or **"Not currently available — we'll check the
   diary and get back to you."** (`options`/`moves` are never sent to the browser.)
4. On enquiry submit, Laura's email includes the Pen Checker detail — **which pens it
   fits in, and which moves would be needed.**

> Status: **built.** The Book/Enquire page has a live "Check availability" module. It
> submits to `send-enquiry`, which calls the Pen Checker, tells the customer only
> *Available* / *Not currently available*, and puts the full pen-fit + moves detail in
> Laura's email. Until `CATBOOKER_API_URL` + `PEN_CHECK_SECRET` are set it uses a safe
> built-in mock (available for ≤4 cats) so the flow is demoable; set both (the same secret
> on CatBooker) and redeploy both sites to go live. The contract the mock emulates is above.

---

## Ownership (avoid collisions)

| Area | Owner | Notes |
|---|---|---|
| `index.html` (design/HTML/copy) | **Design tool** | Regenerated on design changes. Do not hand-edit. |
| `netlify/functions/*` | **Claude Code** | Plain JS. Safe to edit/commit directly. |
| `netlify.toml`, env, deploy | **Claude Code** | |
| CatBooker API + Pen Checker | **Claude Code** | Separate repo. |

The two apps meet **only at the JSON contract above** — neither pastes code into the
other. When the design changes, a fresh `index.html` is handed over to commit (one file).

---

## SEO & crawlability (14 Jul 2026 audit remediation)

The website was audited against 28 UK cattery sites. It had the best content but was the
least machine-readable: the DC bundler keeps all `<head>` tags and body copy inside a
JavaScript string, so crawlers and the Facebook / WhatsApp / iMessage scrapers (none of
which run that JS) saw only the `<title>`. Shares rendered as blank cards and there was
no structured data.

**Done in this repo (works on deploy):**

- **Pre-rendering (audit item 1, `prerender.js` + `routes.js`)** — the biggest SEO fix. The
  build renders all 14 routes to their own real URLs (`/fees/`, `/about/`, …) with
  crawler-visible content and a distinct `<title>`/description/canonical each, while every
  page keeps the full working SPA (a `window`-scoped script re-stamps the head after
  hydration, so Googlebot's rendered view gets distinct signals too). See HANDOFF.md §Job 1.
- **`seo-head.html` + `postbuild.js`** — injects a real, crawler-visible shared `<head>` into
  the bundle: meta description, canonical, Open Graph + Twitter card (fixes the blank social
  cards), `content-language`, geo tags, and two JSON-LD blocks — `LocalBusiness` (address,
  phone, opening hours, `priceRange`, **4.9 aggregateRating**) and `FAQPage`. Also sets
  `<html lang="en">`. Idempotent. **`seo-head.html` is the source of truth for the shared
  tags; `routes.js` for the per-page ones** — edit them there, not in `index.html`.
- **`_redirects`** (generated) — 301s every legacy Wix URL (`/contact`, `/testimonials`,
  `/photo-gallery`, `/privacy-notice`, `/about-4`, `/copy-of-contact`,
  `/copy-of-boarding-1`, …) to the matching new pre-rendered route, recovering indexing
  authority, plus an SPA fallback so no path 404s.
- **`robots.txt` + `sitemap.xml`** — published (were missing); the sitemap now lists one
  URL per pre-rendered route (generated each build).
- **Content fixes** (in the design source): headline rating corrected 5★ → **4.9★**;
  "ICC accredited" → "ICC trained" (ICC does not accredit catteries); Google review
  **relative dates → absolute** so they can't silently rot; "NEW" badges removed.
- **New FAQ page** consolidating answers already scattered across the site.
- **Terms** clauses 2.4 (retention) and 2.9 (abandonment) redrafted to remove the two
  legally exposed / PR-risky provisions; "or otherwise lawfully dispose" removed.
- **Privacy** — the enquiry form no longer writes the visitor's details to `localStorage`.

**Still needs a build step or a decision (NOT done here):**

| Audit item | Why it's not in this repo | Owner |
|---|---|---|
| **5. Migrate images off `static.wixstatic.com`** | All photos are still hotlinked from the old Wix media host; if that subscription lapses the images vanish. Migrating needs the original image files (they can't be re-fetched from here). Upload them and they can be re-hosted, or download at build time. | **Owner / Claude Code** |
| **9. Reconcile prices with `model.xlsx`** | The audit found the site prices disagree with the locked commercial model on the 3- and 4-cat tiers, and the £60 suite sits oddly beside the "no tiers" manifesto. The model is authoritative — must be checked before changing figures. | **Owner** |
| **10 (part). Take a deposit** | Clause 2.6 charges for non-arrival but nothing collects it. Needs a payment mechanism + a commercial decision. | **Owner** |
| **12. Bring the cameras to market** | Hardware + DPIA exist; whether/how to advertise (and pricing) is a business call. | **Owner** |
| Licence number, company identity, insurance wording | Need the actual licence no., trading entity, and the Brooks Braithwaite policy to quote correctly. | **Owner** |
| "~15 local vets" claim | An objective advertising claim that must be substantiable on request (the pre-migration site said 3). Confirm the number before it stays. | **Owner** |
