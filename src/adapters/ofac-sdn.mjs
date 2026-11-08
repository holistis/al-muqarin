// Pure parser for the US Treasury OFAC "SDN" list (sdn.xml). No network, no filesystem.
// Source: ofac.treasury.gov / sanctionslistservice.ofac.treas.gov. Self-checks: a record that is not closed, closed too late or empty
// throws (see records.mjs), and the number of records must equal the Record_Count the file states about itself.
import { jaarOk, jaren } from './jaren.mjs';
import { landCode } from './landnamen.mjs';
import { alleTeksten, blokken, eindeControle, records, tekst, zonder } from './records.mjs';

// Containers whose children carry their own <uid>, <lastName> and so on. Removed before the record's own fields are read.
const CONTAINERS = ['programList', 'akaList', 'addressList', 'idList', 'dateOfBirthList', 'placeOfBirthList', 'nationalityList', 'citizenshipList', 'vesselInfo'];
const SOORT = { Individual: 'persoon', Entity: 'onderneming', Vessel: 'voertuig', Aircraft: 'voertuig' };

const volleNaam = (blok) => [tekst(blok, 'firstName'), tekst(blok, 'lastName')].filter(Boolean).join(' ');

export function parseOfacSdn(xml) {
  const kop = /<Publish_Date>(\d{2})\/(\d{2})\/(\d{4})<\/Publish_Date>/.exec(xml);
  if (!kop) throw new Error('Publish_Date ontbreekt');
  const [maand, dag] = [Number(kop[1]), Number(kop[2])];
  if (maand < 1 || maand > 12 || dag < 1 || dag > 31) throw new Error('Publish_Date ongeldig');
  const verwacht = /<Record_Count>(\d+)<\/Record_Count>/.exec(xml)?.[1];
  if (verwacht === undefined) throw new Error('Record_Count ontbreekt');
  const entries = [];
  for (const [, inner] of records(xml, 'sdnEntry')) {
    const eigen = zonder(inner, CONTAINERS);
    const id = tekst(eigen, 'uid');
    if (!id) throw new Error('entiteit zonder id');
    const names = new Set();
    const eigenNaam = volleNaam(eigen);
    if (eigenNaam) names.add(eigenNaam);
    for (const aka of blokken(inner, 'aka')) { const n = volleNaam(aka); if (n) names.add(n); }

    const years = new Set(), countries = new Set();
    let approx = false;
    for (const t of alleTeksten(inner, 'dateOfBirth')) { const j = jaren(t); for (const y of j.uit) years.add(y); if (j.ongeveer && j.uit.size) approx = true; }
    for (const tag of ['nationality', 'citizenship']) for (const blok of blokken(inner, tag)) { const c = landCode(tekst(blok, 'country')); if (c) countries.add(c); }
    for (const p of alleTeksten(inner, 'placeOfBirth')) { const c = landCode(p.split(',').pop()); if (c) countries.add(c); }
    entries.push({
      id, names: [...names], soort: SOORT[tekst(eigen, 'sdnType')] ?? 'onbekend',
      ...(years.size ? { jaren: [...years].sort((x, y) => x - y) } : {}),
      ...(approx ? { ongeveer: true } : {}),
      ...(countries.size ? { landen: [...countries].sort() } : {}),
    });
  }
  eindeControle(xml, '</sdnList>');
  if (entries.length !== Number(verwacht)) throw new Error(`aantal klopt niet met de kop van het bestand: ${entries.length} gelezen, ${verwacht} genoemd`);
  return { asOf: `${kop[3]}-${kop[1]}-${kop[2]}`, entries };
}
