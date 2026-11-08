// Pure parser for the EU Financial Sanctions Files XML (v1.1). No network, no filesystem.
// Self-check: a record that is not closed, closed too late or empty makes the parser throw (see records.mjs).
import { decode, eindeControle, records } from './records.mjs';

export function parseEuFsf(xml) {
  const gen = /<export\b[^>]*\bgenerationDate="(\d{4}-\d{2}-\d{2})T/.exec(xml);
  if (!gen) throw new Error('generationDate ontbreekt');
  const entries = [];
  for (const m of records(xml, 'sanctionEntity')) {
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
  eindeControle(xml, '</export>');
  return { asOf: gen[1], entries };
}
