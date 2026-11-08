// Is the feeding bot doing its job? Reads only local files, never the network. "No news" is not green:
// no snapshot, a snapshot the checker would refuse, a stale one, or a quarantine after the last good run all make it red.
// Every list the operator feeds is judged on its own, and the whole is green only when every one of them is.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_ENTITY_SOURCES, MIN_DEKKING, entityIndex } from '../src/check.mjs';
import { loadSnapshot } from '../src/snapshot.mjs';

// Quarantine folders are named with the ISO time where ':' and '.' became '-', followed by "--" and the list they belong to.
// A folder without the list name (older runs) counts for every list.
const quarantine = (name) => {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:--([a-z0-9-]+))?$/.exec(name);
  return m ? { tijd: Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`), bron: m[6] } : { tijd: NaN, bron: undefined };
};

function bronStatus({ source, snapshotDir, historyDir, pubKeyPem, now, maxFetchUren, maxListDagen }) {
  const redenen = [];
  const snap = loadSnapshot({ dir: snapshotDir, source, pubKeyPem, now, maxAgeDays: maxFetchUren / 24, maxListAgeDays: maxListDagen });
  let fetchedAt = null, asOf = null, entryCount = null, leeftijdUren = null, dekking = null;
  if (!snap.ok) redenen.push(`momentopname_${snap.reason}`);
  else {
    fetchedAt = snap.manifest.fetchedAt; asOf = snap.manifest.asOf; entryCount = snap.manifest.entryCount;
    leeftijdUren = Math.round(((now.getTime() - Date.parse(fetchedAt)) / 3600000) * 10) / 10;
    entityIndex(snap);
    dekking = Math.round(snap.dekking * 10000) / 10000;
    if (!(snap.dekking >= MIN_DEKKING)) redenen.push('dekking_te_laag');
  }
  // The ledger is the chain of good runs. The live list must be the last one in it: older means rolled back, anything else means the
  // folder was swapped or the ledger lost lines.
  const ledgerPad = join(historyDir, 'ledger.jsonl');
  if (snap.ok) {
    let regels = null;
    if (existsSync(ledgerPad)) {
      try { regels = readFileSync(ledgerPad, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.bron === source); } catch { redenen.push('ledger_onleesbaar'); }
    }
    const v = snap.manifest.volgnummer;
    if (regels && regels.length) {
      const laatste = regels[regels.length - 1];
      if (v === undefined) redenen.push('volgnummer_ontbreekt');
      else if (v < laatste.volgnummer) redenen.push('volgnummer_terug');
      else if (v !== laatste.volgnummer || snap.manifestSha256 !== laatste.manifest_sha256) redenen.push('ledger_wijkt_af');
    } else if (v !== undefined && v > 1) redenen.push('ledger_ontbreekt');
  }
  let sindsdien = 0;
  const qDir = join(historyDir, 'quarantine');
  if (existsSync(qDir)) {
    const last = fetchedAt ? Date.parse(fetchedAt) : -Infinity;
    for (const name of readdirSync(qDir)) { const q = quarantine(name); if ((q.bron === undefined || q.bron === source) && !(q.tijd <= last)) sindsdien++; }
  }
  if (sindsdien > 0) redenen.push(`quarantaine_na_laatste_goede_run_${sindsdien}`);
  return { ok: redenen.length === 0, redenen, fetchedAt, leeftijd_uren: leeftijdUren, lijst_asOf: asOf, entryCount, dekking, quarantaine_sindsdien: sindsdien };
}

export function bepaalStatus({ snapshotDir, historyDir, pubKeyPem, now = new Date(), maxFetchUren = 30, maxListDagen = 25, bronnen = DEFAULT_ENTITY_SOURCES }) {
  const per = {};
  for (const source of bronnen) per[source] = bronStatus({ source, snapshotDir, historyDir, pubKeyPem, now, maxFetchUren, maxListDagen });
  // The reasons carry the name of the list, so a reader of the whole sees which one is red.
  const redenen = Object.entries(per).flatMap(([source, s]) => s.redenen.map((r) => `${source}:${r}`));
  if (!bronnen.length) redenen.push('geen_bronnen');
  return { gemeten: now.toISOString(), ok: redenen.length === 0, redenen, bronnen: per, grenzen: { max_fetch_uren: maxFetchUren, max_lijst_dagen: maxListDagen } };
}
