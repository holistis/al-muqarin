// Pure parser for the EU Financial Sanctions Files XML (v1.1). No network, no filesystem.
// Self-check: the number of parsed entities must equal the number of opening tags, or we throw.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, g) => {
  if (g[0] !== '#') return NAMED[g];
  return String.fromCodePoint(g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
});

const OPEN = '<sanctionEntity';
const CLOSE = '</sanctionEntity>';

// Index of the next opening tag `<sanctionEntity` (not `<sanctionEntityX`), or -1.
function volgendeOpen(xml, vanaf) {
  let i = vanaf;
  for (;;) {
    i = xml.indexOf(OPEN, i);
    if (i < 0) return -1;
    if (!/[A-Za-z0-9_]/.test(xml[i + OPEN.length] ?? '')) return i;
    i += 1;
  }
}

// Reads the entities one after another. Every search moves forward only, so a hostile file with thousands of unclosed tags is
// refused at the first one instead of making the parser rescan the rest of the file for each of them.
function* entiteiten(xml) {
  let pos = 0;
  for (;;) {
    const open = volgendeOpen(xml, pos);
    if (open < 0) return;
    const tagEinde = xml.indexOf('>', open);
    if (tagEinde < 0) throw new Error('entiteit niet gesloten');
    if (xml[tagEinde - 1] === '/') throw new Error('lege entiteit (zelfsluitende tag)');
    const sluit = xml.indexOf(CLOSE, tagEinde + 1);
    if (sluit < 0) throw new Error('entiteit niet gesloten');
    const volgende = volgendeOpen(xml, tagEinde + 1);
    if (volgende >= 0 && volgende < sluit) throw new Error('entiteit niet gesloten voor de volgende begint');
    yield [xml.slice(open + OPEN.length, tagEinde), xml.slice(tagEinde + 1, sluit)];
    pos = sluit + CLOSE.length;
  }
}

export function parseEuFsf(xml) {
  const gen = /<export\b[^>]*\bgenerationDate="(\d{4}-\d{2}-\d{2})T/.exec(xml);
  if (!gen) throw new Error('generationDate ontbreekt');
  const entries = [];
  for (const m of entiteiten(xml)) {
    const id = /\beuReferenceNumber="([^"]+)"/.exec(m[0])?.[1] || /\blogicalId="([^"]+)"/.exec(m[0])?.[1];
    if (!id) throw new Error('entiteit zonder id');
    const names = new Set();
    for (const a of m[1].matchAll(/<nameAlias\b[^>]*?\bwholeName="([^"]*)"/g)) {
      const n = decode(a[1]).trim();
      if (n) names.add(n);
    }
    const code = /<subjectType\b[^>]*\bclassificationCode="([A-Za-z]+)"/.exec(m[1])?.[1];
    // Birth years and countries (citizenship, birth country) help a human tell namesakes apart (the unknown-country code 00 never matches the pattern); they never change an outcome.
    const years = new Set(), countries = new Set();
    let approx = false;
    for (const b of m[1].matchAll(/<birthdate\b([^>]*)>/g)) {
      // The year attribute is in the calendar of the date. Only a Gregorian year is used as is; for any other calendar (the list has
      // Islamic dates, where 1402 is 1982) we take the year of the Gregorian date the list gives next to it, or no year at all.
      const cal = /\bcalendarType="([A-Z_]+)"/.exec(b[1])?.[1];
      const y = cal === 'GREGORIAN' ? /\byear="(\d{4})"/.exec(b[1])?.[1] : /\bbirthdate="(\d{4})-/.exec(b[1])?.[1];
      if (y) { years.add(Number(y)); if (/\bcirca="true"/.test(b[1])) approx = true; }
      const c = /\bcountryIso2Code="([A-Z]{2})"/.exec(b[1])?.[1];
      if (c) countries.add(c);
    }
    for (const c of m[1].matchAll(/<citizenship\b[^>]*?\bcountryIso2Code="([A-Z]{2})"/g)) countries.add(c[1]);
    entries.push({
      id, names: [...names], soort: code === 'P' ? 'persoon' : code === 'E' ? 'onderneming' : 'onbekend',
      ...(years.size ? { jaren: [...years].sort((x, y) => x - y) } : {}),
      ...(approx ? { ongeveer: true } : {}),
      ...(countries.size ? { landen: [...countries].sort() } : {}),
    });
  }
  return { asOf: gen[1], entries };
}
