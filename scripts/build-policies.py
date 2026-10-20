#!/usr/bin/env python3
"""Build policies-content.html, the body of /policies/, from the Word master.

documents/apple-blossom-policies.docx was made by converting the designed PDF
to Word, so it carries the PDF's page furniture: every text box twice (Word's
main copy and its fallback copy), the T&C clause numbers that sit in the PDF's
margin, page footers, labels and values as separate lines, and titles fused to
the text that follows them. A general converter (mammoth, used until 20 Oct 2026)
printed all of that as it came, and the web page read as a jumble. This reads
the document's own pattern instead:

  ---  SOP 01        a section marker, then its title and introduction
  ACTIVITY / value    the four facts at the top of each procedure
  Step 1 · ...        a step, followed by its numbered items
  text box            a call-out (title in bold, then its text); in RA 01, a
                      risk with its likelihood, impact and controls

and leaves out the clause references, which belong to the print layout: the web
page links to the Terms instead. The Veterinary Treatment Authorisation form
(FORM 01) stays in the PDF only.

Run after changing the docx:  python3 scripts/build-policies.py
The build (prerender.js) warns if the docx has changed since the last run.
"""
import hashlib, html, json, os, re, sys, zipfile
from xml.etree import ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCX = os.path.join(ROOT, 'documents', 'apple-blossom-policies.docx')
OUT = os.path.join(ROOT, 'policies-content.html')

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
MC = '{http://schemas.openxmlformats.org/markup-compatibility/2006}'
FACT_LABELS = ['ACTIVITY', 'FREQUENCY', 'WHO', 'RECORDED ON']

# Words the PDF-to-Word conversion ran together, or broke.
FIXES = {
    'thecustomer': 'the customer', 'theresponsible': 'the responsible', 'hasnot': 'has not', 'hasbeen': 'has been', 'befro': 'be fro', 'cross­ infection': 'cross-infection',
    'Manager•': 'Manager •', 'Cattery·': 'Cattery ·', '50°(': '50°C', 'cat. or cats': 'cat, or cats',
}
# Facts the conversion scrambled across two columns: (label line, value line) -> values.
FACT_FIXES = {
    ('WHO\tRECORDED ON', 'Proprietor or nominated last\tEnd of day checklist person to leave'):
        {'WHO': 'Proprietor or nominated last person to leave', 'RECORDED ON': 'End of day checklist'},
}
MARGIN_REF = re.compile(r'^(T&C\s*[\d.,\s]+|RA\s?0?\d|Website|SOP\s?\d+)$')
TRAILING_REF = re.compile(r'[\t ]+(T&C\s*[\d.,\s]+|RA\s?0?\d|Website)\s*$')
INLINE_TC = re.compile(r'\s*\((?:T&C|T&Cs?)\s*[^)]*\)')
FURNITURE = re.compile(r'(Licence BOE028\s*$|^\.t&v-ed|^---\s*$)')


def walk(n):
    """Every node, skipping Word's fallback copy of each text box."""
    if n.tag == MC + 'Fallback':
        return
    yield n
    for c in n:
        yield from walk(c)


def text_of(p, *, boxes=True):
    out = []
    for n in walk(p):
        if not boxes and n.tag == W + 'txbxContent':
            continue
        if n.tag == W + 't':
            out.append(n.text or '')
        elif n.tag == W + 'tab':
            out.append('\t')
    return ''.join(out)


def runs_bold(p):
    rs = [r for r in p.iter(W + 'r') if ''.join(t.text or '' for t in r.iter(W + 't')).strip()]
    return bool(rs) and all(r.find(W + 'rPr/' + W + 'b') is not None for r in rs)


def box_paras(p):
    """[(bold, text)] for the paragraphs inside a paragraph's text boxes (main copy only)."""
    out = []
    for n in walk(p):
        if n.tag == W + 'txbxContent':
            for q in n.findall(W + 'p'):
                t = clean(text_of(q))
                if t:
                    out.append((runs_bold(q), t))
    return out


def style(p):
    s = p.find(W + 'pPr/' + W + 'pStyle')
    return s.get(W + 'val') if s is not None else ''


def clean(t):
    t = TRAILING_REF.sub('', t)
    t = INLINE_TC.sub('', t)
    for a, b in FIXES.items():
        t = t.replace(a, b)
    t = t.replace('\t', ' ')
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r'\s+([.,;:])', r'\1', t)
    t = re.sub(r' -(?=\S)', ' - ', t)
    t = re.sub(r'\s*[•·]\s*', ' · ', t)
    return t


def esc(t):
    t = html.escape(t, quote=False)
    # Internal cross-references become links within the page.
    t = re.sub(r'\b(SOP) (\d{2})\b', lambda m: f'<a href="#sop-{m.group(2)}">{m.group(1)}&nbsp;{m.group(2)}</a>', t)
    t = re.sub(r'\bRA 01\b', '<a href="#ra-01">RA&nbsp;01</a>', t)
    return t


def slug(ref):
    return re.sub(r'[^a-z0-9]+', '-', ref.lower()).strip('-')


def parse():
    body = ET.fromstring(zipfile.ZipFile(DOCX).read('word/document.xml')).find(W + 'body')
    els = [e for e in body if e.tag == W + 'p' or e.tag == W + 'tbl']
    doc = {'meta': {}, 'cover': [], 'contents': [], 'howto': None, 'sections': []}
    sec = None
    step = None
    pending_label = None
    stage = 'cover'
    for el in els:
        if el.tag == W + 'tbl':
            if stage == 'contents':
                for tr in el.findall(W + 'tr'):
                    cells = [clean(' '.join(text_of(q) for q in tc.iter(W + 'p'))) for tc in tr.findall(W + 'tc')]
                    if cells and cells[0] != 'REF' and not cells[0].upper().startswith('FORM'):
                        doc['contents'].append(cells[:3])
            continue
        raw = text_of(el)
        own = clean(text_of(el, boxes=False))
        boxes = box_paras(el)
        t = clean(raw)
        if not t:
            continue
        m = re.match(r'^-{2,}\s*(CONTENTS|SOP \d+|RA \d+|LEGAL|FORM \d+)\b', raw.replace('\t', ' ').strip())
        if m:
            ref = m.group(1)
            if ref.startswith('FORM'):
                break
            if ref == 'CONTENTS':
                stage = 'contents'
                continue
            stage = 'section'
            sec = {'ref': 'Privacy' if ref == 'LEGAL' else ref, 'title': None, 'intro': [], 'facts': {}, 'blocks': [], 'risks': []}
            doc['sections'].append(sec)
            step = None
            continue
        if stage == 'cover':
            if boxes and any(b[1] == 'ISSUED' for b in boxes):
                vals = [b[1] for b in boxes]
                for k in ('ISSUED', 'VERSION', 'LICENCE', 'NEXT REVIEW'):
                    if k in vals and vals.index(k) + 1 < len(vals):
                        doc['meta'][k] = vals[vals.index(k) + 1]
            elif style(el) in ('', 'BodyText') and len(t) > 80 and not doc['meta']:
                doc['cover'].append(t)
            continue
        if stage == 'contents':
            if boxes and boxes[0][1].startswith('How to read'):
                doc['howto'] = [b[1] for b in boxes[1:]]
            continue
        # ---- inside a section ----
        if FURNITURE.search(t) or MARGIN_REF.match(t):
            continue
        if sec['title'] is None:
            sec['title'] = t
            continue
        label = t.upper()
        if pending_label:
            key = (pending_label, raw.strip())
            if key in FACT_FIXES:
                sec['facts'].update(FACT_FIXES[key])
            else:
                sec['facts'][pending_label] = t
            pending_label = None
            continue
        if label in FACT_LABELS or label.replace('\t', ' ') in FACT_LABELS or raw.strip() in [k[0] for k in FACT_FIXES]:
            pending_label = raw.strip() if raw.strip() in [k[0] for k in FACT_FIXES] else label
            continue
        if re.match(r'^Step\s*\d', t) or (style(el) == 'Heading4' and sec['ref'] != 'Privacy'):
            step = {'type': 'step' if t.startswith('Step') else 'h', 'title': re.sub(r'\s*[·•]\s*', ' · ', t, count=1), 'items': []}
            sec['blocks'].append(step)
            continue
        if sec['ref'].startswith('RA') and boxes:
            cur = None
            for bold, bt in boxes:
                lk = re.match(r'^LIKELIHOOD\s+(\w)\s+IMPACT\s+(\w)$', bt)
                if lk and cur:
                    cur['likelihood'], cur['impact'] = lk.groups()
                elif bold and len(bt) < 40 and not bt.endswith('.'):
                    cur = {'title': bt, 'likelihood': '', 'impact': '', 'controls': []}
                    sec['risks'].append(cur)
                elif cur:
                    cur['controls'].append(bt)
            continue
        if boxes and boxes[0][0] and len(boxes) >= 2:
            # A call-out: bold title, then its text (a "- ..." line continues the one before).
            parts = []
            for _, bt in boxes[1:]:
                if parts and bt.startswith('- '):
                    parts[-1] += ' ' + bt
                else:
                    parts.append(bt)
            sec['blocks'].append({'type': 'note', 'title': boxes[0][1], 'paras': parts})
            step = None
            continue
        if sec['ref'] == 'Privacy':
            if style(el) == 'Heading4':
                sec['blocks'].append({'type': 'h', 'title': t, 'items': []})
            else:
                sec['blocks'].append({'type': 'para', 'text': t})
            continue
        if step is None and not sec['blocks']:
            sec['intro'].append(t)
            continue
        if step is not None and step['type'] == 'step':
            if t.startswith('- ') and step['items']:
                step['items'][-1] += ' ' + t
            else:
                step['items'].append(t)
            continue
        # Prose under a plain sub-heading (e.g. "Why the label governs").
        sec['blocks'].append({'type': 'para', 'text': t})
    # De-duplicate risks (the docx also holds the fallback layout of RA 01 as text).
    for s in doc['sections']:
        seen, uniq = set(), []
        for r in s['risks']:
            if r['title'] not in seen:
                seen.add(r['title']); uniq.append(r)
        s['risks'] = uniq
    return doc


LEVEL = {'L': 'Low', 'M': 'Medium', 'H': 'High'}


def render(doc):
    o = []
    meta = doc['meta']
    if meta:
        cells = ''.join(f'<div><span>{html.escape(k)}</span>{html.escape(v)}</div>' for k, v in
                        [('Issued', meta.get('ISSUED', '')), ('Version', meta.get('VERSION', '')), ('Licence', meta.get('LICENCE', '')), ('Next review', meta.get('NEXT REVIEW', ''))] if v)
        o.append(f'<div class="facts cover">{cells}</div>')
    o.append('<h2 id="contents">What is in this manual</h2>')
    o.append('<ol class="toc">' + ''.join(
        f'<li><a href="#{slug("privacy" if r == "Legal" else r)}"><span class="ref">{html.escape(r)}</span>{html.escape(t)}</a><small>{html.escape(f)}</small></li>'
        for r, t, f in doc['contents']) + '</ol>')
    if doc['howto']:
        keep = [re.sub(r'Where a step reflects something in our Terms & Conditions of Boarding, the clause number is printed beside it\. You will find those Terms on our website\. ?', '', p) for p in doc['howto']]
        keep = [p for p in keep if p]
        o.append('<div class="note"><h3>How to read this manual</h3>' + ''.join(f'<p>{esc(p)}</p>' for p in keep)
                 + '<p>Our <a href="/terms/">Terms &amp; Conditions of Boarding</a> are on this website.</p></div>')
    for s in doc['sections']:
        sid = slug(s['ref'])
        label = 'Legal' if s['ref'] == 'Privacy' else s['ref']
        o.append(f'<section class="sop" id="{sid}"><div class="eyebrow">{html.escape(label)}</div><h2>{html.escape(s["title"] or "")}</h2>')
        o += [f'<p class="lead">{esc(p)}</p>' for p in s['intro']]
        if s['facts']:
            o.append('<div class="facts">' + ''.join(f'<div><span>{html.escape(k.capitalize())}</span>{esc(v)}</div>' for k, v in s['facts'].items()) + '</div>')
        n = 0
        for b in s['blocks']:
            if b['type'] == 'step':
                n += 1
                o.append(f'<h3>{html.escape(b["title"])}</h3><ol class="steps">' + ''.join(f'<li><span class="n">{n}.{k}</span>{esc(i)}</li>' for k, i in enumerate(b['items'], 1)) + '</ol>')
            elif b['type'] == 'h':
                o.append(f'<h3>{html.escape(b["title"])}</h3>')
            elif b['type'] == 'para':
                o.append(f'<p>{esc(b["text"])}</p>')
            elif b['type'] == 'note':
                o.append(f'<div class="note"><h4>{html.escape(b["title"])}</h4>' + ''.join(f'<p>{esc(p)}</p>' for p in b['paras']) + '</div>')
        for r in s['risks']:
            ctrl = ''.join(f'<li>{esc(c)}</li>' for c in r['controls'])
            o.append(f'<div class="risk"><h3>{html.escape(r["title"])}</h3><p class="rating">Likelihood <b>{LEVEL.get(r["likelihood"], r["likelihood"])}</b> · Impact <b>{LEVEL.get(r["impact"], r["impact"])}</b></p><ul>{ctrl}</ul></div>')
        o.append('</section>')
    return '\n'.join(o)


def main():
    doc = parse()
    sha = hashlib.sha256(open(DOCX, 'rb').read()).hexdigest()
    body = render(doc)
    cover = json.dumps(doc['cover'], ensure_ascii=False)
    open(OUT, 'w').write(f'<!-- GENERATED by scripts/build-policies.py from documents/apple-blossom-policies.docx. Do not edit by hand. docx-sha256: {sha} -->\n<!-- cover: {html.escape(cover, quote=False)} -->\n{body}\n')
    n_items = sum(len(b.get('items', [])) for s in doc['sections'] for b in s['blocks'])
    print(f"{len(doc['sections'])} sections, {n_items} steps' items, {sum(len(s['risks']) for s in doc['sections'])} risks, {len(body)} chars -> {os.path.relpath(OUT, ROOT)}")
    for s in doc['sections']:
        print(f"  {s['ref']:8} {s['title']!s:42} facts={len(s['facts'])} blocks={len(s['blocks'])} risks={len(s['risks'])}")


if __name__ == '__main__':
    sys.exit(main())
