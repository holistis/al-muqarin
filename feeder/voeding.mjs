#!/usr/bin/env node
// The ONLY part of Al-Muqarin that touches the network. The checker itself never does.
// Fetches one sanctions list (--bron, see feeder/bronnen.mjs) from its one fixed host, parses it, runs sanity gates, signs a snapshot,
// verifies it with the same loader the checker uses, keeps a gzipped raw copy and a ledger line, then swaps atomically.
// Anything suspicious goes to quarantine and exits 3; the live snapshot is left untouched.
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { canonical } from '../src/canon.mjs';
import { MIN_DEKKING, entityIndex } from '../src/check.mjs';
import { loadSnapshot, sha256Hex } from '../src/snapshot.mjs';
import { BRONNEN } from './bronnen.mjs';
import { downloadXml } from './download.mjs';

const MAX_BYTES = 100 * 1024 * 1024;

// Unknown, repeated or valueless options are refused: a typo like --flor must never be ignored silently, and there is no option for an address.
const TOEGESTAAN = ['bron', 'out', 'history', 'key', 'from-file', 'floor', 'accepteer-verschil', 'now'];
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, '');
  if (!process.argv[i].startsWith('--') || !TOEGESTAAN.includes(k) || process.argv[i + 1] === undefined || Object.hasOwn(args, k)) {
    console.error(`gebruik: --bron ${Object.keys(BRONNEN).join('|')} --out D --history D --key K [--from-file F] [--floor N] [--accepteer-verschil REDEN] [--now ISO]`);
    process.exit(2);
  }
  args[k] = process.argv[i + 1];
}
const need = (k) => { if (!args[k]) { console.error(`ontbreekt: --${k}`); process.exit(2); } return args[k]; };
const SOURCE = need('bron');
if (!Object.hasOwn(BRONNEN, SOURCE)) { console.error(`onbekende bron: ${SOURCE} (kies uit ${Object.keys(BRONNEN).join(', ')})`); process.exit(2); }
const B = BRONNEN[SOURCE];
const outDir = need('out'), historyDir = need('history');
const privPem = readFileSync(need('key'), 'utf8');
const floor = args.floor ? Number(args.floor) : B.floor;
// A deliberate, written-down exception for a run whose list changed a lot on purpose (for instance the EU renumbers its entries).
const toegestaan = args['accepteer-verschil'] ? String(args['accepteer-verschil']).slice(0, 200) : null;
const now = args.now ? new Date(args.now) : new Date();

// Write next to the target and rename, so a crash never leaves a half file under the final (hash) name.
function putOnce(path, bytes) {
  if (existsSync(path)) return;
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, bytes());
  renameSync(tmp, path);
}

// The chain of good runs for this source, read from the ledger. An unreadable ledger stops the run: a broken chain must not restart quietly at 1.
function vorigeRuns(historyDir) {
  const pad = join(historyDir, 'ledger.jsonl');
  if (!existsSync(pad)) return [];
  return readFileSync(pad, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.bron === SOURCE);
}

function quarantine(reason, raw) {
  const q = join(historyDir, 'quarantine', `${now.toISOString().replace(/[:.]/g, '-')}--${SOURCE}`);
  mkdirSync(q, { recursive: true });
  writeFileSync(join(q, 'reden.txt'), reason);
  if (raw) writeFileSync(join(q, 'raw.xml.gz'), gzipSync(raw));
  console.error(`QUARANTAINE: ${reason}. Live snapshot ongewijzigd.`);
  process.exit(3);
}

try {
  const raw = args['from-file'] ? readFileSync(args['from-file']) : await downloadXml({ url: B.url, allowedHost: B.hosts, allowedPathPrefix: B.pathPrefix, maxBytes: MAX_BYTES });
  const { asOf, entries } = B.parse(raw.toString('utf8'));
  if (entries.length < floor) quarantine(`te weinig partijen: ${entries.length} < ${floor}`, raw);
  const livePath = join(outDir, SOURCE, 'manifest.json');
  if (existsSync(livePath)) {
    const prev = JSON.parse(readFileSync(livePath, 'utf8')).entryCount;
    if (Number.isInteger(prev) && entries.length < prev * 0.9) quarantine(`lijst kromp van ${prev} naar ${entries.length} (meer dan 10%)`, raw);
  }
  const eerder = vorigeRuns(historyDir);
  if (!toegestaan) {
    // A count alone is not enough: a list can keep its size and lose its content, or shrink a little at a time. So also compare with the
    // list we signed last time (which parties are still there, and do they still carry their names) and with the largest we ever signed.
    let vorige = null;
    try { vorige = JSON.parse(readFileSync(join(outDir, SOURCE, 'list.json'), 'utf8')).entries; } catch { vorige = null; }
    if (Array.isArray(vorige) && vorige.length) {
      const nu = new Map(entries.map((e) => [e.id, new Set(e.names)]));
      const gebleven = vorige.filter((e) => nu.has(e.id));
      if (gebleven.length < vorige.length * 0.9) quarantine(`te veel partijen verdwenen: ${gebleven.length} van ${vorige.length} nog aanwezig (minimum 90%)`, raw);
      const metNaam = gebleven.filter((e) => e.names.some((n) => nu.get(e.id).has(n)));
      if (metNaam.length < gebleven.length * 0.9) quarantine(`de namen van te veel partijen zijn veranderd: ${metNaam.length} van ${gebleven.length} houden minstens een naam (minimum 90%)`, raw);
    }
    const grootste = Math.max(0, ...eerder.map((r) => Number(r.entryCount) || 0));
    if (eerder.length && entries.length < grootste * 0.8) quarantine(`lijst is meer dan 20% kleiner dan de grootste ooit getekende (${grootste} naar ${entries.length})`, raw);
  }

  const listBuf = Buffer.from(JSON.stringify({ entries }));
  const manifest = {
    schema: 1, source: SOURCE, sourceUrl: B.url.split('?')[0], license: B.license, asOf, fetchedAt: now.toISOString(),
    sha256: sha256Hex(listBuf), entryCount: entries.length, minEntries: floor,
    volgnummer: eerder.length + 1, vorige_manifest_sha256: eerder.length ? eerder[eerder.length - 1].manifest_sha256 : null,
  };
  const signature = sign(null, Buffer.from(canonical(manifest)), createPrivateKey(privPem)).toString('base64');

  const stage = join(outDir, `.stage-${process.pid}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, SOURCE), { recursive: true });
  writeFileSync(join(stage, SOURCE, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(stage, SOURCE, 'manifest.sig'), signature);
  writeFileSync(join(stage, SOURCE, 'list.json'), listBuf);

  const check = loadSnapshot({ dir: stage, source: SOURCE, pubKeyPem: createPublicKey(createPrivateKey(privPem)).export({ type: 'spki', format: 'pem' }), now, maxAgeDays: 1, maxListAgeDays: 60 });
  if (!check.ok) { rmSync(stage, { recursive: true, force: true }); quarantine(`eigen snapshot bleek ongeldig: ${check.reason}`, raw); }
  // A list whose names we mostly cannot read (empty, another script, an XML change) would answer "no match" for everything. Never sign it.
  entityIndex(check);
  if (check.dekking < MIN_DEKKING) { rmSync(stage, { recursive: true, force: true }); quarantine(`te veel onleesbare namen: ${Math.round(check.dekking * 100)}% van de partijen heeft een bruikbare naam, minimum ${MIN_DEKKING * 100}%`, raw); }

  const hist = join(historyDir, SOURCE, now.toISOString().replace(/[:.]/g, '-'));
  mkdirSync(hist, { recursive: true });
  // Every run keeps its own small dated, signed manifest (that is the receipt trail). The big files are kept once per distinct
  // content, under their own hash: the manifest's sha256 names the list, the ledger's raw_sha256 names the raw download.
  for (const f of ['manifest.json', 'manifest.sig']) writeFileSync(join(hist, f), readFileSync(join(stage, SOURCE, f)));
  const store = join(historyDir, '_inhoud');
  mkdirSync(store, { recursive: true });
  putOnce(join(store, `ruw-${sha256Hex(raw)}.xml.gz`), () => gzipSync(raw));
  putOnce(join(store, `lijst-${manifest.sha256}.json`), () => listBuf);
  appendFileSync(join(historyDir, 'ledger.jsonl'), JSON.stringify({ tijd: now.toISOString(), bron: SOURCE, asOf, entryCount: entries.length, volgnummer: manifest.volgnummer, vorige_manifest_sha256: manifest.vorige_manifest_sha256, ...(toegestaan ? { verschil_geaccepteerd: toegestaan } : {}), raw_sha256: sha256Hex(raw), list_sha256: manifest.sha256, manifest_sha256: check.manifestSha256 }) + '\n');

  const live = join(outDir, SOURCE), prevDir = join(outDir, `${SOURCE}.prev-${process.pid}`);
  mkdirSync(outDir, { recursive: true });
  if (existsSync(live)) renameSync(live, prevDir);
  try { renameSync(join(stage, SOURCE), live); } catch (e) { if (existsSync(prevDir)) renameSync(prevDir, live); throw e; }
  rmSync(prevDir, { recursive: true, force: true });
  rmSync(stage, { recursive: true, force: true });
  console.error(`OK: ${entries.length} partijen, lijst van ${asOf}, opgehaald ${manifest.fetchedAt}`);
} catch (e) {
  console.error(`fout: ${e.message}`);
  process.exit(2);
}
