// Pure parser for the UN Security Council consolidated list (XML). No network, no filesystem.
// Source: scsanctions.un.org, the "consolidated.xml" file (individuals and entities). Self-check: a record that is not closed, closed
// too late or empty makes the parser throw (see records.mjs).
import { jaarOk } from './jaren.mjs';
import { landCode } from './landnamen.mjs';
import { alleTeksten, blokken, eindeControle, records, tekst } from './records.mjs';

const NAAM_DELEN = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME'];
// The list writes "na" where a name part does not exist.
const LEEG = /^n\/?a$/i;
const JAAR = /^(\d{4})/;

function lees(inner, soort) {
  const id = tekst(inner, 'REFERENCE_NUMBER') ?? tekst(inner, 'DATAID');
  if (!id) throw new Error('entiteit zonder id');
  const names = new Set();
  // The name as the list shows it: the parts in order (given names first, family name last), separated by a space.
  const delen = NAAM_DELEN.map((t) => tekst(inner, t)).filter((d) => d && !LEEG.test(d));
  if (delen.length) names.add(delen.join(' '));
  // One alias field may hold several names separated by a semicolon.
  for (const a of alleTeksten(inner, 'ALIAS_NAME')) for (const n of a.split(';')) { const t = n.trim(); if (t && !LEEG.test(t)) names.add(t); }
  for (const n of alleTeksten(inner, 'NAME_ORIGINAL_SCRIPT')) names.add(n);

  const years = new Set(), countries = new Set();
  let approx = false;
  for (const blok of blokken(inner, 'INDIVIDUAL_DATE_OF_BIRTH')) {
    const type = tekst(blok, 'TYPE_OF_DATE');
    const van = Number(tekst(blok, 'FROM_YEAR')), tot = Number(tekst(blok, 'TO_YEAR'));
    if (type === 'BETWEEN' && jaarOk(van) && jaarOk(tot) && tot >= van && tot - van <= 10) { for (let y = van; y <= tot; y++) years.add(y); continue; }
    const y = Number(JAAR.exec(tekst(blok, 'YEAR') ?? tekst(blok, 'DATE') ?? '')?.[1]);
    if (jaarOk(y)) { years.add(y); if (type === 'APPROXIMATELY') approx = true; }
  }
  for (const blok of blokken(inner, 'NATIONALITY')) for (const v of alleTeksten(blok, 'VALUE')) { const c = landCode(v); if (c) countries.add(c); }
  for (const blok of blokken(inner, 'INDIVIDUAL_PLACE_OF_BIRTH')) { const c = landCode(tekst(blok, 'COUNTRY')); if (c) countries.add(c); }
  return {
    id, names: [...names], soort,
    ...(years.size ? { jaren: [...years].sort((x, y) => x - y) } : {}),
    ...(approx ? { ongeveer: true } : {}),
    ...(countries.size ? { landen: [...countries].sort() } : {}),
  };
}

export function parseUnSc(xml) {
  const gen = /<CONSOLIDATED_LIST\b[^>]*\bdateGenerated="(\d{4}-\d{2}-\d{2})T/.exec(xml);
  if (!gen) throw new Error('dateGenerated ontbreekt');
  const entries = [];
  for (const [, inner] of records(xml, 'INDIVIDUAL')) entries.push(lees(inner, 'persoon'));
  for (const [, inner] of records(xml, 'ENTITY')) entries.push(lees(inner, 'onderneming'));
  eindeControle(xml, '</CONSOLIDATED_LIST>');
  return { asOf: gen[1], entries };
}
