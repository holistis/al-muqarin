// Shared by every list parser: walks an XML text and hands out the records that start with `<tag` and end with `</tag>`.
// No network, no filesystem. Every search moves forward only, so a hostile file with thousands of unclosed tags is refused at the
// first one instead of making the parser rescan the rest of the file for each of them.
// A record that is not closed, closed too late (the next one starts first) or empty (a self-closing tag) is an error, never skipped:
// silently skipping a record would leave a hole in the list that nobody sees.

// Index of the next opening tag `<tag` (not `<tagX` or `<tag_X`), or -1.
function volgendeOpen(xml, tag, vanaf) {
  const open = `<${tag}`;
  let i = vanaf;
  for (;;) {
    i = xml.indexOf(open, i);
    if (i < 0) return -1;
    if (!/[A-Za-z0-9_]/.test(xml[i + open.length] ?? '')) return i;
    i += 1;
  }
}

// Yields [attributes, inner] per record.
export function* records(xml, tag) {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let pos = 0;
  for (;;) {
    const begin = volgendeOpen(xml, tag, pos);
    if (begin < 0) return;
    const tagEinde = xml.indexOf('>', begin);
    if (tagEinde < 0) throw new Error('entiteit niet gesloten');
    if (xml[tagEinde - 1] === '/') throw new Error('lege entiteit (zelfsluitende tag)');
    const sluit = xml.indexOf(close, tagEinde + 1);
    if (sluit < 0) throw new Error('entiteit niet gesloten');
    const volgende = volgendeOpen(xml, tag, tagEinde + 1);
    if (volgende >= 0 && volgende < sluit) throw new Error('entiteit niet gesloten voor de volgende begint');
    yield [xml.slice(begin + open.length, tagEinde), xml.slice(tagEinde + 1, sluit)];
    pos = sluit + close.length;
  }
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// XML text to plain text: the five named entities and numeric references. Anything else (an unknown &name;) stays as written.
export const decode = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, g) => {
  if (g[0] !== '#') return NAMED[g];
  const cp = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
  // A reference to something that is not a character (above U+10FFFF) is an error in the file, not a name.
  if (!Number.isInteger(cp) || cp > 0x10ffff) throw new Error('ongeldige tekenverwijzing');
  return String.fromCodePoint(cp);
});

// The text of the first `<tag>…</tag>` in `xml`, decoded and trimmed, or undefined when it is missing or empty.
export function tekst(xml, tag) {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  const t = m ? decode(m[1]).trim() : '';
  return t || undefined;
}

// The texts of every `<tag>…</tag>` in `xml`, decoded and trimmed, empty ones dropped.
export function alleTeksten(xml, tag) {
  const uit = [];
  for (const m of xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))) {
    const t = decode(m[1]).trim();
    if (t) uit.push(t);
  }
  return uit;
}

// The inner text of every `<tag>…</tag>` inside one record, for small blocks that never nest in themselves (an alias, a date of birth).
// A self-closing `<tag/>` is an empty block and yields nothing. Forward-only like `records`: an opening tag that is never closed ends the
// search instead of making it rescan the rest for every later one.
export function* blokken(xml, tag) {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  let pos = 0;
  for (;;) {
    const begin = xml.indexOf(open, pos);
    if (begin < 0) return;
    const end = xml.indexOf(close, begin + open.length);
    if (end < 0) return;
    yield xml.slice(begin + open.length, end);
    pos = end + close.length;
  }
}

// The text without its `<tag>…</tag>` blocks (for each tag in the list), also forward-only. A block that is never closed stays as it is.
export function zonder(xml, tags) {
  let uit = xml;
  for (const tag of tags) {
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    let rest = '';
    let pos = 0;
    for (;;) {
      const begin = uit.indexOf(open, pos);
      if (begin < 0) break;
      const end = uit.indexOf(close, begin + open.length);
      if (end < 0) break;
      rest += uit.slice(pos, begin);
      pos = end + close.length;
    }
    uit = rest + uit.slice(pos);
  }
  return uit;
}

// A file cut off between two records still looks whole to a record reader. A real list ends on the closing tag of its root.
export function eindeControle(xml, sluitTag) {
  if (!xml.slice(-200).trimEnd().endsWith(sluitTag)) throw new Error(`bestand is afgekapt: het eindigt niet op ${sluitTag}`);
}
