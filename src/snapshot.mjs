// Loads one signed list snapshot. Every failure returns { ok:false, reason }: the caller must treat that
// as ONMEETBAAR. Order matters: signature first, then hash, then count, then freshness, then content.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { canonical } from './canon.mjs';
import { parseStrict } from './strict-json.mjs';

const MAX_LIST_BYTES = 100 * 1024 * 1024;
const MAX_SMALL_BYTES = 16 * 1024;
const MANIFEST_KEYS = ['schema', 'source', 'sourceUrl', 'license', 'asOf', 'fetchedAt', 'sha256', 'entryCount', 'minEntries'];
// A chain of runs: every signed manifest may carry its own number and the hash of the one before it (both or neither).
const KETEN_KEYS = ['volgnummer', 'vorige_manifest_sha256'];
const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');
const fail = (reason) => ({ ok: false, reason });

function readBounded(path, max) {
  const st = statSync(path);
  if (!st.isFile() || st.size > max) throw new Error('size');
  return readFileSync(path);
}

// The highest run number the feeder has written for a source, read from its ledger (undefined when there is no ledger or no numbered line).
// A line that cannot be read throws: the caller must treat that as a failure, not as "no floor".
export function hoogsteVolgnummer(pad, source) {
  if (!existsSync(pad)) return undefined;
  let hoogste;
  for (const regel of readFileSync(pad, 'utf8').split(String.fromCharCode(10)).filter(Boolean)) {
    const r = JSON.parse(regel);
    if (r.bron === source && Number.isInteger(r.volgnummer)) hoogste = Math.max(hoogste ?? 0, r.volgnummer);
  }
  return hoogste;
}

export function loadSnapshot({ dir, source, pubKeyPem, now, maxAgeDays, maxListAgeDays = 30, minVolgnummer }) {
  if (!SOURCE_ID.test(source)) return fail('bron_id_ongeldig');
  let manifestBuf, sigBuf, listBuf;
  const base = join(dir, source);
  try {
    manifestBuf = readBounded(join(base, 'manifest.json'), MAX_SMALL_BYTES);
    sigBuf = readBounded(join(base, 'manifest.sig'), MAX_SMALL_BYTES);
    listBuf = readBounded(join(base, 'list.json'), MAX_LIST_BYTES);
  } catch {
    // A source that is not shipped at all (no folder) is a different story than a broken or oversized file.
    return fail(existsSync(base) ? 'bestand_ontbreekt_of_te_groot' : 'bron_niet_aanwezig');
  }

  let manifest;
  try { manifest = parseStrict(manifestBuf.toString('utf8')); } catch (e) { return fail(/dubbele/.test(e.message) ? 'manifest_dubbele_sleutel' : 'manifest_geen_json'); }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return fail('manifest_vorm');
  const keys = Object.keys(manifest).filter((k) => !KETEN_KEYS.includes(k)).sort();
  if (keys.join() !== [...MANIFEST_KEYS].sort().join()) return fail('manifest_velden');
  const heeftKeten = KETEN_KEYS.filter((k) => Object.hasOwn(manifest, k)).length;
  if (heeftKeten === 1) return fail('manifest_velden');

  let pub;
  try {
    pub = createPublicKey(pubKeyPem);
    if (pub.asymmetricKeyType !== 'ed25519') return fail('sleutel_geen_ed25519');
  } catch { return fail('sleutel_onleesbaar'); }
  let sigOk = false;
  try { sigOk = verify(null, Buffer.from(canonical(manifest)), pub, Buffer.from(sigBuf.toString('utf8').trim(), 'base64')); } catch { sigOk = false; }
  if (!sigOk) return fail('handtekening_ongeldig');

  const m = manifest;
  if (m.schema !== 1 || m.source !== source) return fail('bron_komt_niet_overeen');
  if (typeof m.sourceUrl !== 'string' || typeof m.license !== 'string' || !/^[0-9a-f]{64}$/.test(m.sha256)) return fail('manifest_waarden');
  if (!Number.isInteger(m.entryCount) || !Number.isInteger(m.minEntries) || m.minEntries < 1) return fail('manifest_aantallen');
  if (heeftKeten) {
    if (!Number.isInteger(m.volgnummer) || m.volgnummer < 1 || m.volgnummer > 1e9) return fail('volgnummer_ongeldig');
    if (m.volgnummer === 1 ? m.vorige_manifest_sha256 !== null : !/^[0-9a-f]{64}$/.test(m.vorige_manifest_sha256)) return fail('volgnummer_ongeldig');
  }
  // A reader that knows the highest number it has seen refuses an older list, and a list that dropped its number.
  if (minVolgnummer !== undefined) {
    if (!heeftKeten) return fail('volgnummer_ontbreekt');
    if (m.volgnummer < minVolgnummer) return fail('volgnummer_terug');
  }
  if (!ISO_DAY.test(m.asOf) || !ISO_TS.test(m.fetchedAt) || Number.isNaN(Date.parse(m.fetchedAt)) || Number.isNaN(Date.parse(m.asOf))) return fail('datum_ongeldig');

  if (sha256Hex(listBuf) !== m.sha256) return fail('hash_klopt_niet');

  let list;
  try { list = JSON.parse(listBuf.toString('utf8')); } catch { return fail('lijst_geen_json'); }
  if (list === null || typeof list !== 'object' || !Array.isArray(list.entries) || Object.keys(list).join() !== 'entries') return fail('lijst_vorm');
  const entries = list.entries;
  if (entries.length !== m.entryCount) return fail('aantal_klopt_niet');
  if (entries.length < m.minEntries) return fail('te_weinig_regels');
  const ids = new Set();
  for (const e of entries) {
    if (e === null || typeof e !== 'object' || typeof e.id !== 'string' || !Array.isArray(e.names) || e.names.some((n) => typeof n !== 'string')) return fail('regel_vorm');
    // The same id twice would let two different people be told apart wrongly by their years and countries.
    if (ids.has(e.id)) return fail('regel_dubbel');
    ids.add(e.id);
    if (e.code !== undefined && typeof e.code !== 'string') return fail('regel_vorm');
    if (e.soort !== undefined && !['persoon', 'onderneming', 'voertuig', 'onbekend'].includes(e.soort)) return fail('regel_vorm');
    if (e.jaren !== undefined && (!Array.isArray(e.jaren) || e.jaren.length > 50 || e.jaren.some((y) => !Number.isInteger(y) || y < 1800 || y > 2200))) return fail('regel_vorm');
    if (e.landen !== undefined && (!Array.isArray(e.landen) || e.landen.length > 100 || e.landen.some((c) => typeof c !== 'string' || !/^[A-Z]{2}$/.test(c)))) return fail('regel_vorm');
    if (e.ongeveer !== undefined && typeof e.ongeveer !== 'boolean') return fail('regel_vorm');
  }

  const fetched = Date.parse(m.fetchedAt);
  const nowMs = now.getTime();
  if (fetched > nowMs + 5 * 60 * 1000) return fail('datum_in_de_toekomst');
  if (Date.parse(m.asOf) > fetched + 24 * 3600 * 1000) return fail('datum_in_de_toekomst');
  if (nowMs - fetched > maxAgeDays * 24 * 3600 * 1000) return fail('verouderd');
  // The list's own date counts too: a mirror that is re-fetched daily may still serve an old file.
  if (nowMs - Date.parse(m.asOf) > maxListAgeDays * 24 * 3600 * 1000) return fail('lijst_verouderd');

  return { ok: true, manifest: m, entries, listSha256: m.sha256, manifestSha256: sha256Hex(Buffer.from(canonical(m))) };
}
