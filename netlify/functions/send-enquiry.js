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

// The "from" address MUST be on a domain VERIFIED in Resend. Wix blocked the
// MX transfer for appleblossomcattery.com, so appleblossomcatterybookings.com
// is the verified sending domain. Recipients (below) can be on any domain —
// only the sender's domain needs verifying. All three are env-overridable so
// you can change addresses without touching code.
const FROM = process.env.MAIL_FROM || 'Apple Blossom Cattery <enquiries@appleblossomcatterybookings.com>';
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

// Five-petal blossom mark (Apple Mail / iOS render it; Gmail drops <svg>
// cleanly with no broken-image icon, so it degrades safely).
const blossom = (size) =>
  '<svg width="' + size + '" height="' + size + '" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" role="presentation" style="display:block">' +
  '<g fill="#CE6D9E"><circle cx="24" cy="11" r="8.5"/><circle cx="37.4" cy="20.7" r="8.5"/><circle cx="32.3" cy="36.5" r="8.5"/><circle cx="15.7" cy="36.5" r="8.5"/><circle cx="10.6" cy="20.7" r="8.5"/></g>' +
  '<circle cx="24" cy="24" r="6.5" fill="#9B4880"/></svg>';

const HEAD_FONT = "Quicksand,'Trebuchet MS','Segoe UI',Arial,sans-serif";
const BODY_FONT = "'Nunito Sans','Helvetica Neue',Arial,sans-serif";

// Branded email shell (table-based, inline styles = email-safe).
function shell(preheader, bodyHtml) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>' +
    '<body style="margin:0;padding:0;background:#F5F1EC;-webkit-text-size-adjust:100%">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F5F1EC">' + esc(preheader) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EC;padding:30px 12px">' +
      '<tr><td align="center">' +
        '<table role="presentation" width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background:#ffffff;border:1px solid #ECE0E7;border-radius:22px;overflow:hidden">' +
          // header
          '<tr><td style="background:#FBEEF4;padding:24px 34px;border-bottom:1px solid #F0D8E4">' +
            '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
              '<td style="padding-right:13px;vertical-align:middle">' + blossom(36) + '</td>' +
              '<td style="vertical-align:middle">' +
                '<div style="font-family:' + HEAD_FONT + ';font-weight:700;font-size:23px;color:#9B4880;line-height:1">Apple Blossom</div>' +
                '<div style="font-family:' + HEAD_FONT + ';font-size:11px;font-weight:600;letter-spacing:.34em;color:#7C7D81;margin-top:4px">CATTERY</div>' +
              '</td>' +
            '</tr></table>' +
          '</td></tr>' +
          // body
          '<tr><td style="padding:34px 36px 10px;font-family:' + BODY_FONT + ';color:#46474A;font-size:15.5px;line-height:1.7">' + bodyHtml + '</td></tr>' +
          // footer
          '<tr><td style="padding:22px 36px 30px;border-top:1px solid #F0EAEF;font-family:' + BODY_FONT + ';color:#9a93a0;font-size:12.5px;line-height:1.7">' +
            '<span style="color:#7C7D81;font-weight:700">Apple Blossom Cattery</span><br>' +
            'Cowbridge Road, Talygarn, Pontyclun, CF72 9JU<br>' +
            '<a href="tel:07855475851" style="color:#9B4880;text-decoration:none">07855 475851</a> &nbsp;·&nbsp; ' +
            '<a href="mailto:laura@appleblossomcattery.com" style="color:#9B4880;text-decoration:none">laura@appleblossomcattery.com</a>' +
          '</td></tr>' +
        '</table>' +
        '<div style="font-family:' + BODY_FONT + ';color:#c0b8c4;font-size:11px;margin-top:14px;letter-spacing:.02em">Loved like our own.</div>' +
      '</td></tr>' +
    '</table></body></html>';
}

function detailsTable(rows) {
  const body = rows.map((r) =>
    '<tr><td style="padding:7px 18px 7px 0;color:#7C7D81;font-weight:700;white-space:nowrap;vertical-align:top;font-size:13px;letter-spacing:.02em">' +
    esc(r[0]) + '</td><td style="padding:7px 0;color:#46474A;font-size:15px">' + esc(r[1]) + '</td></tr>'
  ).join('');
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">' + body + '</table>';
}

function messageBlock(msg) {
  return '<div style="font-family:' + HEAD_FONT + ';font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7C7D81;margin:20px 0 7px">Message</div>' +
    '<div style="background:#FBEEF4;border:1px solid #F0D8E4;border-radius:14px;padding:15px 17px;font-size:15px;line-height:1.65;white-space:pre-wrap;color:#46474A">' +
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

async function penCheck(input) {
  const url = process.env.CATBOOKER_API_URL;
  const secret = process.env.PEN_CHECK_SECRET || '';
  if (!url) {
    // Not configured: report UNKNOWN, never a guess. This used to answer "available
    // for up to 4 cats, pen Meadow 2" — a pen that doesn't exist — so a lost env var
    // silently told staff a full house had space. Availability only ever comes from
    // CatBooker's Pen Checker; if we can't reach it, we say so.
    return { possible: null, error: true, unconfigured: true };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + secret, 'X-Pen-Check-Secret': secret },
      body: JSON.stringify(input)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { possible: null, error: true };
    const possible = (data.possible != null) ? data.possible : data.available;
    return { possible: possible === true, options: data.options || [], moves: data.moves || [] };
  } catch (_) {
    return { possible: null, error: true };
  }
}

function penCheckBlock(r) {
  if (!r) return '';
  var pensTxt = (r.options && r.options.length) ? r.options.map(function (o) { return esc(o.pen || o.name || ''); }).filter(Boolean).join(', ') : '';
  var movesTxt = (r.moves && r.moves.length) ? r.moves.map(function (m) { return esc((m.booking || m.cat || 'booking') + ': ' + (m.from || '?') + ' \u2192 ' + (m.to || '?') + (m.dates ? ' (' + m.dates + ')' : '')); }).join('; ') : '';
  var head, color, bg, border, detail;
  if (r.error || r.possible == null) {
    head = 'Pen Checker \u2014 could not run'; color = '#6E6470'; bg = '#F4EFF2'; border = '#E4D5DE';
    detail = r.unconfigured
      ? 'The availability check is not configured on this deploy (CATBOOKER_API_URL) \u2014 please check the diary.'
      : 'The automatic availability check did not complete \u2014 please check the diary.';
  } else if (r.possible) {
    head = 'Pen Checker \u2014 AVAILABLE'; color = '#2F6B45'; bg = '#EAF6EE'; border = '#BFE3CC';
    detail = (pensTxt ? 'Fits in: ' + pensTxt + '. ' : '') +
      (movesTxt ? 'Only with these pen moves \u2014 they must be made before the stay: ' + movesTxt + '.' : 'No moves needed.');
  } else {
    head = 'Pen Checker \u2014 NOT currently available'; color = '#8A6224'; bg = '#FBF1E7'; border = '#F0D8BE';
    detail = 'No combination of pens fits these dates, even after re-shuffling.';
  }
  return '<div style="margin-top:20px;background:' + bg + ';border:1px solid ' + border + ';border-radius:14px;padding:14px 16px">' +
    '<div style="font-family:' + HEAD_FONT + ';font-weight:700;font-size:13px;letter-spacing:.03em;text-transform:uppercase;color:' + color + ';margin-bottom:6px">' + head + '</div>' +
    '<div style="font-size:14px;line-height:1.6;color:#46474A">' + detail + '</div></div>';
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
  let pen = null;
  if (f.start && f.end) {
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
    '<div style="font-family:' + HEAD_FONT + ';font-weight:700;font-size:21px;color:#46474A;margin:0 0 4px">New booking enquiry</div>' +
    '<p style="margin:0 0 20px;color:#7C7D81;font-size:14px">Sent from the website by <span style="color:#9B4880;font-weight:700">' + esc(name) + '</span>.</p>' +
    detailsTable(rows) +
    messageBlock(f.message) +
    penCheckBlock(pen) +
    '<p style="margin:22px 0 6px;font-size:13.5px;color:#9a93a0">Reply to this email to respond to ' + esc(first) + ' directly.</p>';

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
    '<div style="font-family:' + HEAD_FONT + ';font-weight:700;font-size:22px;color:#46474A;margin:0 0 14px">Thank you for your enquiry</div>' +
    '<p style="margin:0 0 15px">Dear ' + esc(first) + ',</p>' +
    '<p style="margin:0 0 15px">Thank you so much for getting in touch with Apple Blossom Cattery. We\u2019ve received your enquiry and one of us will be in touch personally &mdash; usually within a day &mdash; to confirm availability and answer any questions you may have.</p>' +
    '<p style="margin:0 0 10px">Here\u2019s a copy of what you sent us:</p>' +
    detailsTable(custRows) +
    (f.message ? messageBlock(f.message) : '') +
    '<p style="margin:20px 0 15px">In the meantime, if you\u2019d like to talk anything through, you can call, text or WhatsApp us on <a href="tel:07855475851" style="color:#9B4880;text-decoration:none;font-weight:700">07855 475851</a>, or simply reply to this email.</p>' +
    '<p style="margin:0 0 4px">We can\u2019t wait to meet your cat' + (String(cats).trim() === '1' ? '' : 's') + '.</p>' +
    '<p style="margin:14px 0 2px;font-family:' + HEAD_FONT + ';color:#9B4880;font-weight:700;font-size:17px">With warm wishes,</p>' +
    '<p style="margin:0;color:#46474A">Laura and the team at Apple Blossom Cattery</p>';

  const customer = {
    from: FROM,
    to: [email],
    reply_to: TO_OWNER,
    subject: 'Thank you for your enquiry — Apple Blossom Cattery',
    html: shell('Thanks ' + first + ' — we\u2019ve received your enquiry and will be in touch shortly.', customerBody),
    text: 'Dear ' + first + ',\n\nThank you for getting in touch with Apple Blossom Cattery. We\u2019ve received your enquiry and will be in touch personally, usually within a day.\n\nDates: ' + (f.start || '(not specified)') + ' to ' + (f.end || '(not specified)') + '\nCats: ' + (cats || '(not specified)') + '\n\nCall, text or WhatsApp 07855 475851, or reply to this email.\n\nWith warm wishes,\nLaura and the team at Apple Blossom Cattery'
  };

  try {
    // The internal email is the one that must succeed.
    const res1 = await sendEmail(KEY, internal);
    if (!res1.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Send failed', detail: res1.data }) };
    }
    // Customer acknowledgement is best-effort — don't fail the request if it bounces.
    let ackOk = false;
    try { const res2 = await sendEmail(KEY, customer); ackOk = res2.ok; } catch (_) { ackOk = false; }
    const available = (!pen || pen.error || pen.possible == null) ? 'unknown' : (pen.possible ? 'available' : 'unavailable');
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id: res1.data && res1.data.id, ack: ackOk, available: available }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Send error', detail: String(err) }) };
  }
};
