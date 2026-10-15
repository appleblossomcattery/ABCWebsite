/*
 * Seasonal availability banner: a small dismissible card shown on every page
 * (bottom left; the WhatsApp button holds bottom right) between `from` and
 * `until`, then gone by itself. Edit the wording or dates here and push; set
 * `enabled: false` to take it down early. Dates are inclusive, UK time.
 *
 * Autumn 2026 (owner, 15 Oct 2026): Christmas itself (23-29 Dec) is all but
 * full, so the banner sells the dates that still have pens: November and the
 * first three weeks of December.
 */
module.exports = {
  enabled: true,
  from: '2026-10-15',
  until: '2026-12-19',
  headline: 'Christmas is nearly full',
  text: 'We still have pens in November and early December.',
  cta: 'Check your dates',
  href: '/#/contact',
};
