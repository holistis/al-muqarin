// Pure parser for the UK Sanctions List (UK-Sanctions-List.xml, FCDO). No network, no filesystem.
// Source: sanctionslist.fcdo.gov.uk. Self-check: a record that is not closed, closed too late or empty makes the parser throw
// (see records.mjs), and so does a designation without an id.
import { jaarOk } from './jaren.mjs';
import { landCode } from './landnamen.mjs';
import { alleTeksten, blokken, eindeControle, records, tekst } from './records.mjs';

const SOORT = { Individual: 'persoon', Entity: 'onderneming', Ship: 'voertuig' };
// A full name is written in parts: Name1 to Name5 are given and other names, Name6 is the family name (or the whole name of an entity or ship).
const DELEN = ['Name1', 'Name2', 'Name3', 'Name4', 'Name5', 'Name6'];

export function parseUkSanctions(xml) {
  const gen = /<DateGenerated>(\d{2})\/(\d{2})\/(\d{4})<\/DateGenerated>/.exec(xml);
  if (!gen) throw new Error('DateGenerated ontbreekt');
  const [dag, maand] = [Number(gen[1]), Number(gen[2])];
  if (maand < 1 || maand > 12 || dag < 1 || dag > 31) throw new Error('DateGenerated ongeldig');
  const entries = [];
  for (const [, inner] of records(xml, 'Designation')) {
    const id = tekst(inner, 'UniqueID');
    if (!id) throw new Error('entiteit zonder id');
    const names = new Set();
    // Some name blocks carry only a type (no letters at all): they add nothing.
    for (const blok of blokken(inner, 'Name')) {
      const naam = DELEN.map((d) => tekst(blok, d)).filter(Boolean).join(' ');
      if (naam) names.add(naam);
    }
    for (const n of alleTeksten(inner, 'NameNonLatinScript')) names.add(n);

    const years = new Set(), countries = new Set();
    for (const t of alleTeksten(inner, 'DOB')) for (const m of t.matchAll(/\b(\d{4})\b/g)) { const y = Number(m[1]); if (jaarOk(y)) years.add(y); }
    for (const tag of ['Nationality', 'CountryOfBirth']) for (const v of alleTeksten(inner, tag)) { const c = landCode(v); if (c) countries.add(c); }
    entries.push({
      id, names: [...names], soort: SOORT[tekst(inner, 'IndividualEntityShip')] ?? 'onbekend',
      ...(years.size ? { jaren: [...years].sort((x, y) => x - y) } : {}),
      ...(countries.size ? { landen: [...countries].sort() } : {}),
    });
  }
  eindeControle(xml, '</Designations>');
  return { asOf: `${gen[3]}-${gen[2]}-${gen[1]}`, entries };
}
