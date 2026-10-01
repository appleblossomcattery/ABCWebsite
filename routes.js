/*
 * Apple Blossom Cattery — route manifest (SEO source of truth for pre-rendering).
 *
 * The website is one hash-routed Design-Component SPA (a single index.html).
 * prerender.js renders each route below to its own static URL with real,
 * crawler-visible content and a distinct <title>/description/canonical, so the
 * site can rank for local searches instead of collapsing to one indexable page.
 *
 * Titles and descriptions for /about/, /boarding/, /hours/ and /contact/ were
 * rewritten on 1 Oct 2026: Search Console showed them on page one (positions
 * 4-8) but clicked by under 1% of searchers, so they now lead with the
 * reasons to click (award, 4.9★, climate control, J34, instant availability).
 *
 * Edit titles/descriptions HERE — they flow into the pre-rendered <head>, the
 * runtime SEO-persist script (so they survive SPA hydration and client-side
 * route changes), and sitemap.xml. `hash` is the in-app route; `path` is the
 * real URL the route is written to (always trailing-slash, home = '/').
 */
// Apex host — this is what the server serves (www 301-redirects to it), so
// every canonical / og:url / sitemap entry must point here, not at www.
const BASE_URL = 'https://appleblossomcattery.com'

// Shared social-share image, self-hosted (migrated off static.wixstatic.com).
const OG_IMAGE = BASE_URL + '/images/og-card.jpg'

const ROUTES = [
  {
    hash: '#/',
    path: '/',
    title: 'Apple Blossom Cattery - Luxury Cat Boarding in Talygarn, Pontyclun',
    description:
      'Award-winning, fully climate-controlled cat boarding in Talygarn, Pontyclun (Vale of Glamorgan). Family-run since 2019, rated 4.9★ on Google and recommended by local vets. Your cat, loved like our own.',
    faq: true,
  },
  {
    hash: '#/about',
    path: '/about/',
    title: 'About Us - Family-Run Cattery since 2019 | Apple Blossom Cattery',
    description:
      'The family behind Apple Blossom Cattery: Cattery of the Year 2026/27 (Prestige Awards), rated 4.9★ on Google, licensed and fully climate-controlled. Just off M4 Junction 34 near Pontyclun.',
  },
  {
    hash: '#/boarding',
    path: '/boarding/',
    title: 'Cattery Pens: Single, Double & Family | Apple Blossom Cattery',
    description:
      'Climate-controlled single, double and family pens, plus a quiet space for timid cats. Award-winning cattery off M4 Junction 34 near Pontyclun, rated 4.9★ on Google. Book a viewing.',
  },
  {
    hash: '#/pickup',
    path: '/pickup/',
    title: 'Cat Pick-Up & Drop-Off Service - Apple Blossom Cattery',
    description:
      'Busy before a trip? Apple Blossom Cattery can usually collect and return your cat around Pontyclun, Talygarn and the Vale of Glamorgan. Ask about our pick-up and drop-off service.',
  },
  {
    hash: '#/fees',
    path: '/fees/',
    title: 'Boarding Fees & Prices - Apple Blossom Cattery, Pontyclun',
    description:
      'Honest cat boarding prices, charged per pen per day from £17/day for one cat. No themed-room tiers, no hidden extras. Climate-controlled cattery near Pontyclun, Vale of Glamorgan.',
  },
  {
    hash: '#/hours',
    path: '/hours/',
    title: 'Opening Hours & Drop-Off Times | Apple Blossom Cattery',
    description:
      'Drop-offs, collections and viewings by appointment, normally 10am–4pm, seven days a week, so every cat gets our full attention. Call or WhatsApp 07855 475851 to book a time.',
  },
  {
    hash: '#/vaccinations',
    path: '/vaccinations/',
    title: 'Vaccinations & Cat Health Requirements - Apple Blossom Cattery',
    description:
      'What we ask before your cat’s stay: up-to-date cat flu and feline enteritis vaccinations, flea and parasite control, and medication we can administer, plus our downloadable vaccination chart of accepted products. Cattery near Pontyclun.',
  },
  {
    hash: '#/why',
    path: '/why/',
    title: 'Why Use a Cattery? - Apple Blossom Cattery, Pontyclun',
    description:
      'Why a professional, licensed cattery beats a house-sitter, and what to look for when choosing one. Trained, insured cat boarding near Pontyclun and Cardiff.',
  },
  {
    hash: '#/faq',
    path: '/faq/',
    title: 'Cat Boarding FAQs - Apple Blossom Cattery, Pontyclun',
    description:
      'Answers to the questions owners ask most: vaccinations, what to bring, food, medication, sharing pens, opening times and minimum stays. Apple Blossom Cattery, Vale of Glamorgan.',
    faq: true,
  },
  {
    hash: '#/gallery',
    path: '/gallery/',
    title: 'Photo Gallery - Apple Blossom Cattery, Pontyclun',
    description:
      'Real photographs of Apple Blossom Cattery: our climate-controlled pens, the countryside setting near Pontyclun, and happy cats being themselves.',
  },
  {
    hash: '#/testimonials',
    path: '/testimonials/',
    title: 'Reviews & Testimonials - Apple Blossom Cattery, Pontyclun',
    description:
      'What our customers say: Apple Blossom Cattery is rated 4.9★ on Google and recommended by local vets. Read recent reviews from cat owners across the Vale of Glamorgan.',
  },
  {
    hash: '#/contact',
    path: '/contact/',
    title: 'Contact & Check Availability | Apple Blossom Cattery, Pontyclun',
    description:
      'Check your dates online in seconds, or call, text or WhatsApp 07855 475851. Award-winning, climate-controlled cattery on Cowbridge Road, Talygarn, Pontyclun CF72 9JU, off M4 J34.',
  },
  {
    hash: '#/terms',
    path: '/terms/',
    title: 'Terms & Conditions of Boarding - Apple Blossom Cattery',
    description:
      'The 2026 terms and conditions of boarding for Apple Blossom Cattery, Talygarn, Vale of Glamorgan (CF72 9JU).',
  },
  {
    hash: '#/privacy',
    path: '/privacy/',
    title: 'Privacy Notice - Apple Blossom Cattery',
    description:
      'How Apple Blossom Cattery collects, uses and protects your personal information.',
  },
]

module.exports = { BASE_URL, OG_IMAGE, ROUTES }
