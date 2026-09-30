// Apple Blossom Cattery — enquiry form → branded emails via Resend
// Deployed as a Netlify Function. RESEND_API_KEY lives in Netlify's
// environment variables (Site settings → Environment variables), NEVER in
// the front-end, so it is never exposed to visitors.
//
// Sends TWO emails on each enquiry:
//   1. Internal — to laura@, cc bookings@, reply-to = customer (so Laura
//      can just hit Reply). Contains the full enquiry details.
//   2. Customer — a branded thank-you acknowledgement to the enquirer.
//
// Requires Node 18+ (Netlify default) for the global fetch().

// The "from" address MUST be on a domain VERIFIED in Resend. Until 30 Sep 2026
// that was appleblossomcatterybookings.com: Wix will not publish an MX record on
// a subdomain, which Resend's original setup needed. Customers saw a lookalike
// domain and much of the mail went to junk. appleblossomcattery.com itself is
// now verified with Resend's CNAME-based records, which Wix does support, so
// mail comes from the name customers know. Recipients (below) can be on any
// domain — only the sender's domain needs verifying. All three are
// env-overridable so you can change addresses without touching code.
const FROM = process.env.MAIL_FROM || 'Apple Blossom Cattery <bookings@appleblossomcattery.com>';
const TO_OWNER = process.env.MAIL_TO || 'laura@appleblossomcattery.com';
const CC_OWNER = process.env.MAIL_CC || 'bookings@appleblossomcattery.com';

const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// Person-name casing: every word becomes Capital + lowercase ("DEBORAH" →
// "Deborah", "rhys" → "Rhys"), across hyphens and apostrophes, with one
// carve-out — a typed Mc surname keeps its inner capital ("McKenzie").
// Mirrors nameCase() in CatBooker's src/lib/text.ts — keep in lockstep, so the
// name recorded against the enquiry there matches what CatBooker itself would
// derive.
const nameCase = (s) => String(s == null ? '' : s)
  .replace(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g, (w) => {
    if (/^Mc[A-Z]/.test(w)) return 'Mc' + w[2].toUpperCase() + w.slice(3).toLowerCase();
    return w[0].toUpperCase() + w.slice(1).toLowerCase();
  })
  .replace(/\s+/g, ' ')
  .trim();

// The email design is CatBooker's (owner, 30 Sep 2026): the multi-shaded
// Apple Blossom logo, blush page, white card, Quicksand text and
// the "Loved like our own" footer, so a website enquiry reads as the same
// cattery as every booking email that follows. Mirrors CatBooker's
// src/lib/emailFrame.ts; change the two together.
const LOGO_URL = 'https://catbooker.appleblossomcattery.com/email-logo.jpg';
const TAGLINE_URL = 'https://catbooker.appleblossomcattery.com/tagline-script.png';
const FONTS_CSS = "@import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600;700&family=Quicksand:wght@500;600;700&display=swap');";
// The site's own fine, rounded Quicksand, at 500 so small text stays readable.
// Gmail and Outlook ignore web fonts: the stack then falls back to fine system
// faces (Avenir Next on Apple, Segoe UI on Windows), never a heavy default.
const BODY_FONT = "'Quicksand','Avenir Next','Avenir','Segoe UI','Helvetica Neue',Arial,sans-serif";
const HEAD_FONT = BODY_FONT;
const SCRIPT_FONT = "'Dancing Script','Snell Roundhand','Brush Script MT',cursive";
const PLUM = '#9b4880';
const INK = '#46474a';
// As in CatBooker's Settings: the footer address customers see on every email.
const CO_NAME = 'Apple Blossom Cattery';
const CO_ADDRESS = 'Cowbridge Road, Ystradowen, Vale of Glamorgan, CF72 9JU';
const CO_PHONE = '07855 475851';

function footer() {
  return '<div style="text-align:center;margin-top:20px">' +
    '<div style="margin:0 auto 10px;line-height:1">' +
      '<span style="display:inline-block;vertical-align:middle;width:52px;height:1px;background:#e7dae1"></span>' +
      '<span style="display:inline-block;vertical-align:middle;color:#cf9dbd;font-size:14px;padding:0 10px">&#10048;</span>' +
      '<span style="display:inline-block;vertical-align:middle;width:52px;height:1px;background:#e7dae1"></span>' +
    '</div>' +
    '<div style="margin-bottom:5px"><img src="' + TAGLINE_URL + '" alt="Loved like our own" width="190" height="21" style="display:inline-block;width:190px;max-width:70%;height:auto;border:0"></div>' +
    '<div style="font-family:' + HEAD_FONT + ';font-weight:700;font-size:13.5px;color:' + PLUM + ';letter-spacing:.02em">' + CO_NAME + '</div>' +
    '<div style="color:#8a7f86;font-size:12px;line-height:1.8;margin-top:3px">' +
      '<a style="color:#8a7f86;text-decoration:none">' + CO_ADDRESS + '</a><br>' +
      '<a href="tel:+447855475851" style="color:#8a7f86;text-decoration:none">' + CO_PHONE + '</a>' +
      '<span style="color:#cbbfc6">&nbsp;&middot;&nbsp;</span>' +
      '<a href="https://www.appleblossomcattery.com" style="color:' + PLUM + ';text-decoration:none;font-weight:600">appleblossomcattery.com</a>' +
    '</div>' +
    '<div style="margin-top:12px;color:#c4b8bf;font-size:10.5px">Powered by <span style="font-family:' + SCRIPT_FONT + ';font-weight:700;font-size:14px;color:#b394a6">CatBooker</span></div>' +
  '</div>';
}

// Branded email shell: CatBooker's frame (inline styles = email-safe).
function shell(preheader, bodyHtml) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">' +
    '<style>' + FONTS_CSS + '</style></head>' +
    '<body style="margin:0;padding:0;background:#f5edf0;font-family:' + BODY_FONT + ';font-weight:500;color:' + INK + ';-webkit-text-size-adjust:100%">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f5edf0">' + esc(preheader) + '</div>' +
    // Font on the wrapper too: Gmail drops <body> styles.
    '<div style="max-width:560px;margin:0 auto;padding:26px 20px;font-family:' + BODY_FONT + ';font-weight:500;color:' + INK + '">' +
      '<div style="text-align:center;margin:2px 0 16px">' +
        '<img src="' + LOGO_URL + '" alt="' + CO_NAME + '" width="210" style="width:210px;max-width:62%;height:auto;border:0;display:inline-block">' +
      '</div>' +
      '<div style="background:#ffffff;border:1px solid #efe3ea;border-radius:18px;padding:26px 24px;font-size:14.5px;line-height:1.6">' + bodyHtml + '</div>' +
      footer() +
    '</div></body></html>';
}

function detailsTable(rows) {
  const body = rows.map((r) =>
    '<tr><td style="padding:7px 18px 7px 0;color:#8a7f86;font-weight:600;white-space:nowrap;vertical-align:top;font-size:13px;letter-spacing:.02em">' +
    esc(r[0]) + '</td><td style="padding:7px 0;color:#46474a;font-size:14.5px">' + esc(r[1]) + '</td></tr>'
  ).join('');
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">' + body + '</table>';
}

function messageBlock(msg) {
  return '<div style="font-family:' + HEAD_FONT + ';font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8a7f86;margin:20px 0 7px">Message</div>' +
    '<div style="background:#fbf6f9;border:1px solid #efe3ea;border-radius:12px;padding:14px 16px;font-size:14.5px;line-height:1.6;white-space:pre-wrap;color:#46474a">' +
    esc(msg || '(none)') + '</div>';
}

async function sendEmail(key, payload) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// The production Pen Checker. Kept as a fallback because this URL is not a
// secret, and treating a missing env var as fatal cost us two days of enquiries:
// website enquiries are RECORDED by this call (CatBooker writes the enquiry row
// inside /api/pen-check), so when the variable went missing the emails kept
// arriving and the Enquiries page silently stopped filling up. Only the secret
// is genuinely secret; the address can safely have a default.
const PEN_CHECK_URL = 'https://catbooker.netlify.app/api/pen-check';
const PEN_CHECK_WAIT_MS = 8500;

async function penCheck(input) {
  const url = process.env.CATBOOKER_API_URL || PEN_CHECK_URL;
  const secret = process.env.PEN_CHECK_SECRET || '';
  // Availability is never guessed — it used to answer "available for up to 4
  // cats, pen Meadow 2", a pen that doesn't exist, so a lost env var told staff
  // a full house had space. It only ever comes from CatBooker; if we cannot
  // reach it we say so. But we DO still try, using the default address.
  if (!secret) return { possible: null, error: true, why: 'PEN_CHECK_SECRET is not set on this deploy' };
  // Wait at most 8.5 s (owner, 30 Sep 2026). CatBooker now answers within 4 s of
  // starting (its own time budget), so the rest is headroom for cold starts and
  // the network: at 6 s a 2-move enquiry on 30 Sep 2026 ran out and the enquirer
  // saw "enquiry received" with no answer. This function has a 10 s limit and must
  // still send two emails (sent together, below, ~0.5 s), so do not raise this
  // further; the form's own mailto fallback is at 15 s.
  // A slow answer is treated as "unknown" (the enquiry is still recorded by
  // CatBooker, which carries on after we stop waiting) — never as unavailable.
  const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, PEN_CHECK_WAIT_MS) : null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + secret, 'X-Pen-Check-Secret': secret },
      body: JSON.stringify(input),
      signal: ctrl ? ctrl.signal : undefined
    });
    if (timer) clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // A 400 about the DATES is not a failure to record: CatBooker writes the
      // enquiry before validating the range, so the enquiry is on the Enquiries
      // page and only the availability answer is missing. Saying "NOT IN
      // CATBOOKER" here would send staff hunting for a record that exists.
      const msg = String((data && data.error) || '');
      if (res.status === 400 && /date|start|end|range/i.test(msg)) {
        return { possible: null, error: true, recorded: true, why: 'no usable dates were given, so availability could not be checked' };
      }
      // Carry the reason out. A 401 (wrong secret), a 500 and a dead host used
      // to collapse into one indistinguishable "error", which is precisely why
      // a silent breakage took days to pin down.
      return {
        possible: null,
        error: true,
        why: res.status === 401
          ? 'CatBooker rejected the shared secret (401) — PEN_CHECK_SECRET does not match'
          : 'CatBooker answered ' + res.status + ' at ' + url
      };
    }
    const possible = (data.possible != null) ? data.possible : data.available;
    // The deeper checker (Sep 2026) also says WHICH nearby dates would work and,
    // when full, WHY. Nearby dates go to the enquirer as well as to staff; the
    // reason, the pens and the moves are for the cattery's eyes only.
    return { possible: possible === true, options: data.options || [], moves: data.moves || [], alternatives: altLabels(data.alternatives), reason: data.reason || '', recorded: true };
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message)))) {
      return { possible: null, error: true, recorded: true, why: 'CatBooker took longer than ' + (PEN_CHECK_WAIT_MS / 1000) + ' s to answer, so no availability answer was shown; the enquiry is still recorded there' };
    }
    return { possible: null, error: true, why: 'could not reach ' + url + ' (' + (err && err.message ? err.message : 'network error') + ')' };
  }
}

// "15-22 Aug" / "28 Jul - 3 Aug" from YYYY-MM-DD dates, for staff and enquirer alike.
function dmy(iso) {
  var d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function altLabels(alts) {
  if (!Array.isArray(alts)) return [];
  return alts.slice(0, 3).map(function (a) {
    if (!a || !a.start || !a.end) return null;
    var s = dmy(a.start), e = dmy(a.end);
    var label = (s.split(' ')[1] === e.split(' ')[1]) ? s.split(' ')[0] + '-' + e : s + ' - ' + e;
    return { start: a.start, end: a.end, label: label, moves: Number(a.moves) || 0 };
  }).filter(Boolean);
}

function penCheckBlock(r) {
  if (!r) return '';
  var pensTxt = (r.options && r.options.length) ? r.options.map(function (o) { return esc(o.pen || o.name || ''); }).filter(Boolean).join(', ') : '';
  var movesTxt = (r.moves && r.moves.length) ? r.moves.map(function (m) { return esc((m.booking || m.cat || 'booking') + ': ' + (m.from || '?') + ' \u2192 ' + (m.to || '?') + (m.dates ? ' (' + m.dates + ')' : '')); }).join('; ') : '';
  var head, color, bg, border, detail;
  if (r.recorded && (r.error || r.possible == null)) {
    // Recorded, but no availability answer \u2014 normally because the enquirer gave
    // no dates. Not an alarm: the enquiry IS on the Enquiries page.
    // NB both halves matter: a SUCCESSFUL check also carries recorded:true, and
    // testing `recorded` alone put every successful enquiry in this branch and
    // captioned a perfectly good availability answer "not run".
    head = 'Pen Checker \u2014 not run'; color = '#6E6470'; bg = '#F4EFF2'; border = '#E4D5DE';
    detail = 'No availability check was possible' + (r.why ? ' \u2014 ' + esc(r.why) : '') +
      '. The enquiry has been recorded on the Enquiries page; please check the diary before replying.';
  } else if (r.error || r.possible == null) {
    // Loud on purpose. This same call is what writes the enquiry into CatBooker,
    // so when it fails the enquiry exists ONLY in this email \u2014 staff must know
    // to add it by hand, and someone must know to fix the cause.
    head = 'Pen Checker \u2014 could not run \u2014 THIS ENQUIRY IS NOT IN CATBOOKER';
    color = '#9A2C2C'; bg = '#FBEDED'; border = '#F0C9C9';
    detail = 'The availability check did not complete, so this enquiry has NOT been recorded on the Enquiries page \u2014 please check the diary and add it by hand.' +
      (r.why ? ' Cause: ' + esc(r.why) + '.' : '');
  } else if (r.possible) {
    head = 'Pen Checker \u2014 AVAILABLE'; color = '#2F6B45'; bg = '#EAF6EE'; border = '#BFE3CC';
    detail = (pensTxt ? 'Fits in: ' + pensTxt + '. ' : '') +
      (movesTxt ? 'Only with these pen moves \u2014 they must be made before the stay: ' + movesTxt + '.' : 'No moves needed.');
  } else {
    head = 'Pen Checker \u2014 NOT currently available'; color = '#8A6224'; bg = '#FBF1E7'; border = '#F0D8BE';
    detail = 'No combination of pens fits these dates, even after re-shuffling.' + (r.reason ? ' ' + esc(r.reason) : '');
  }
  var alts = (r.alternatives && r.alternatives.length) ? r.alternatives : [];
  if (alts.length && !(r.error || r.possible == null)) {
    detail += '<div style="margin-top:8px"><b>Nearby dates that would work:</b> ' + alts.map(function (a) {
      return esc(a.label) + (a.moves ? ' (' + a.moves + ' move' + (a.moves === 1 ? '' : 's') + ')' : ' (no moves)');
    }).join(' \u00b7 ') + (r.possible ? '' : '. The enquirer has been shown these dates (without the moves).') + '</div>';
  }
  if (!r.error && r.possible === false) {
    detail += '<div style="margin-top:8px;color:#8a7f86">For a deeper answer \u2014 including whether an existing booking could be split to make room \u2014 run these dates through CatBooker\u2019s Pen checker. That advice is for the cattery only.</div>';
  }
  return '<div style="margin-top:20px;background:' + bg + ';border:1px solid ' + border + ';border-radius:14px;padding:14px 16px">' +
    '<div style="font-family:' + HEAD_FONT + ';font-weight:700;font-size:13px;letter-spacing:.03em;text-transform:uppercase;color:' + color + ';margin-bottom:6px">' + head + '</div>' +
    '<div style="font-size:14px;line-height:1.6;color:#46474a">' + detail + '</div></div>';
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const KEY = process.env.RESEND_API_KEY;
  if (!KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Email service not configured' }) };
  }

  let f = {};
  try { f = JSON.parse(event.body || '{}'); } catch (_) { f = {}; }

  // Honeypot — bots fill hidden fields; humans never see them. Pretend success.
  if (f.company) return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };

  const email = String(f.email || '').trim();
  // The form asks first name + surname separately (the same pattern as
  // CatBooker: the display name is derived, never typed) and both are strictly
  // cased here, so a typed "rhys johns" is recorded — and greeted — as "Rhys
  // Johns". Visitors on a cached older bundle still send a single `name`;
  // split it so nothing bounces.
  let first = nameCase(f.firstName);
  let last = nameCase(f.lastName);
  if (!first && !last) {
    const words = nameCase(f.name).split(/\s+/).filter(Boolean);
    first = words[0] || '';
    last = words.slice(1).join(' ');
  }
  const name = (first + ' ' + last).trim();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { statusCode: 422, headers, body: JSON.stringify({ error: 'Missing or invalid fields' }) };
  }

  const cats = f.cats || f.guests || '';
  const rows = [
    ['Name', name],
    ['Email', email],
    ['Phone', f.phone || '(not given)'],
    ['Dates', (f.start || '(not specified)') + '  →  ' + (f.end || '(not specified)')],
    ['Cats', cats || '(not specified)']
  ];

  // Run the Pen Checker (via CatBooker) for the internal email + availability reply.
  // ALWAYS called, even when no dates were given: this same call is what RECORDS
  // the enquiry in CatBooker, so gating it on dates meant every dateless enquiry
  // was emailed and then lost — it never reached the Enquiries page at all, and
  // the date fields on the form are not required. CatBooker writes the enquiry
  // first and rejects an unusable date range second (its rejectButRecord path),
  // so calling it without dates still records the person.
  let pen = null;
  {
    // Pass the enquirer through so CatBooker RECORDS the enquiry, not just answers
    // it. Every enquiry used to live in an inbox and be re-keyed by hand, so there
    // was no conversion rate and no record of demand turned away at peak.
    try {
      pen = await penCheck({
        start: f.start, end: f.end, cats: cats,
        enquirer: {
          name: name, firstName: first || null, lastName: last || null,
          email: email, phone: f.phone || null, message: f.message || f.notes || null
        }
      });
    } catch (_) { pen = { error: true }; }
  }

  // 1) Internal enquiry to the cattery
  const internalBody =
    '<div style="font-family:' + HEAD_FONT + ';font-weight:600;font-size:20px;color:#9b4880;margin:0 0 4px">New booking enquiry</div>' +
    '<p style="margin:0 0 20px;color:#8a7f86;font-size:14px">Sent from the website by <span style="color:#9b4880;font-weight:700">' + esc(name) + '</span>.</p>' +
    detailsTable(rows) +
    messageBlock(f.message) +
    penCheckBlock(pen) +
    '<p style="margin:22px 0 6px;font-size:13.5px;color:#8a7f86">Reply to this email to respond to ' + esc(first) + ' directly.</p>';

  const internal = {
    from: FROM,
    to: [TO_OWNER],
    cc: [CC_OWNER],
    reply_to: email,
    subject: 'Booking enquiry — ' + name,
    html: shell('New enquiry from ' + name, internalBody),
    text: rows.map((r) => r[0] + ': ' + r[1]).join('\n') + '\n\nMessage:\n' + (f.message || '(none)')
  };

  // 2) Branded thank-you to the customer
  const custRows = [
    ['Dates', (f.start || '(not specified)') + '  →  ' + (f.end || '(not specified)')],
    ['Cats', cats || '(not specified)']
  ];
  const customerBody =
    '<div style="font-family:' + HEAD_FONT + ';font-weight:600;font-size:20px;color:#9b4880;margin:0 0 14px">Thank you for your enquiry</div>' +
    '<p style="margin:0 0 15px">Dear ' + esc(first) + ',</p>' +
    '<p style="margin:0 0 15px">Thank you so much for getting in touch with Apple Blossom Cattery. We\u2019ve received your enquiry and one of us will be in touch personally &mdash; usually within a day &mdash; to confirm availability and answer any questions you may have.</p>' +
    '<p style="margin:0 0 10px">Here\u2019s a copy of what you sent us:</p>' +
    detailsTable(custRows) +
    (f.message ? messageBlock(f.message) : '') +
    '<p style="margin:20px 0 15px">In the meantime, if you\u2019d like to talk anything through, you can call, text or WhatsApp us on <a href="tel:07855475851" style="color:#9b4880;text-decoration:none;font-weight:700">07855 475851</a>, or simply reply to this email.</p>' +
    '<p style="margin:0 0 4px">We can\u2019t wait to meet your cat' + (String(cats).trim() === '1' ? '' : 's') + '.</p>' +
    '<p style="margin:14px 0 2px;font-family:' + HEAD_FONT + ';color:#9b4880;font-weight:700;font-size:17px">With warm wishes,</p>' +
    '<p style="margin:0;color:#46474a">Laura and the team at Apple Blossom Cattery</p>';

  const customer = {
    from: FROM,
    to: [email],
    reply_to: TO_OWNER,
    subject: 'Thank you for your enquiry — Apple Blossom Cattery',
    html: shell('Thanks ' + first + ' — we\u2019ve received your enquiry and will be in touch shortly.', customerBody),
    text: 'Dear ' + first + ',\n\nThank you for getting in touch with Apple Blossom Cattery. We\u2019ve received your enquiry and will be in touch personally, usually within a day.\n\nDates: ' + (f.start || '(not specified)') + ' to ' + (f.end || '(not specified)') + '\nCats: ' + (cats || '(not specified)') + '\n\nCall, text or WhatsApp 07855 475851, or reply to this email.\n\nWith warm wishes,\nLaura and the team at Apple Blossom Cattery'
  };

  try {
    // Both emails go together rather than one after the other, so the enquirer's
    // answer is not held up by a second round trip to Resend. The internal email
    // is the one that must succeed; the customer acknowledgement is best-effort —
    // don't fail the request if it bounces.
    const [res1, ackOk] = await Promise.all([
      sendEmail(KEY, internal),
      sendEmail(KEY, customer).then(function (r) { return r.ok; }, function () { return false; })
    ]);
    if (!res1.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Send failed', detail: res1.data }) };
    }
    const available = (!pen || pen.error || pen.possible == null) ? 'unknown' : (pen.possible ? 'available' : 'unavailable');
    // Nearby dates reach the enquirer only when their own dates are full: dates
    // and nothing else \u2014 no pens, no moves, no reasons.
    const alternatives = (available === 'unavailable' && pen && pen.alternatives) ? pen.alternatives.map(function (a) { return { start: a.start, end: a.end, label: a.label }; }) : [];
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id: res1.data && res1.data.id, ack: ackOk, available: available, alternatives: alternatives }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Send error', detail: String(err) }) };
  }
};
