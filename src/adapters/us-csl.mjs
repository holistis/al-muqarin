// Pure parser for the US Consolidated Screening List (consolidated.json, trade.gov): the export-control and sanctions lists of the
// Commerce, State and Treasury departments in one file. No network, no filesystem.
// The Treasury SDN entries are left out: the OFAC list is its own source here (feeder/bronnen.mjs 'ofac-sdn') and would only double every hit.
// Self-checks: the file must name the SDN source (if the label ever changes, the parser stops instead of letting 19,000 doubles in), the
// number of results must equal the total the file states about itself, and the file must carry the dates of its own import.
import { ISO_ALPHA2 } from '../countries.mjs';
import { jaarOk, jaren } from './jaren.mjs';
import { landCode } from './landnamen.mjs';

const SDN = 'Specially Designated Nationals (SDN) - Treasury Department';
const SOORT = { Individual: 'persoon', Entity: 'onderneming', Vessel: 'voertuig', Aircraft: 'voertuig' };
const tekstOf = (v) => (typeof v === 'string' ? v.trim() : '');
const land = (c) => (typeof c === 'string' && /^[A-Za-z]{2}$/.test(c) && ISO_ALPHA2.has(c.toUpperCase()) ? c.toUpperCase() : landCode(c));

export function parseUsCsl(tekst) {
  let j;
  try { j = JSON.parse(tekst); } catch { throw new Error('geen geldige JSON'); }
  if (j === null || typeof j !== 'object' || !Array.isArray(j.results) || !Array.isArray(j.sources_used)) throw new Error('vorm van het bestand klopt niet');
  if (j.total !== j.results.length) throw new Error(`aantal klopt niet met de kop van het bestand: ${j.results.length} gelezen, ${j.total} genoemd`);
  if (!j.sources_used.some((s) => s !== null && typeof s === 'object' && s.source === SDN)) throw new Error('de SDN-bron staat niet onder de verwachte naam in het bestand');
  // The date of the file is the day it was put together (the lists inside it are renewed hourly and carry their own update dates).
  const dagen = j.sources_used.map((s) => String(s?.last_imported ?? '').slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))).sort();
  if (!dagen.length) throw new Error('de datum van het bestand ontbreekt');

  const entries = [];
  const gezien = new Map();
  for (const r of j.results) {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) throw new Error('regel zonder vorm');
    if (r.source === SDN) continue;
    const basis = tekstOf(r.id);
    if (!basis) throw new Error('entiteit zonder id');
    const naam = tekstOf(r.name);
    if (!naam) throw new Error('entiteit zonder naam');
    // The same id on two different records happens (3 times in the file of 8 Nov 2026): the second one gets a suffix so ids stay unique.
    const n = (gezien.get(basis) ?? 0) + 1;
    gezien.set(basis, n);
    const names = new Set([naam]);
    for (const a of Array.isArray(r.alt_names) ? r.alt_names : []) { const t = tekstOf(a); if (t) names.add(t); }

    const years = new Set(), countries = new Set();
    let approx = false;
    for (const d of Array.isArray(r.dates_of_birth) ? r.dates_of_birth : []) {
      const t = jaren(String(d));
      for (const y of t.uit) if (jaarOk(y)) years.add(y);
      if (t.ongeveer && t.uit.size) approx = true;
    }
    for (const lijst of [r.nationalities, r.citizenships]) for (const c of Array.isArray(lijst) ? lijst : []) { const k = land(c); if (k) countries.add(k); }
    // For anything that is not a named person, the country of its address is the best hint there is.
    if (r.type !== 'Individual') {
      for (const a of Array.isArray(r.addresses) ? r.addresses : []) { const k = land(a?.country); if (k) countries.add(k); }
      const k = land(r.country);
      if (k) countries.add(k);
    }
    entries.push({
      id: n === 1 ? basis : `${basis}#${n}`, names: [...names], soort: SOORT[r.type] ?? 'onbekend',
      ...(years.size ? { jaren: [...years].sort((x, y) => x - y).slice(0, 50) } : {}),
      ...(approx ? { ongeveer: true } : {}),
      ...(countries.size ? { landen: [...countries].sort().slice(0, 100) } : {}),
    });
  }
  return { asOf: dagen[dagen.length - 1], entries };
}
