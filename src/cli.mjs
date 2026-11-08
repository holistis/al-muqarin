#!/usr/bin/env node
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { InvalidInput, REQUIRED, keyId, kiesBronnen, runCheck, signReport, verifyReport } from './check.mjs';
import { hoogsteVolgnummer } from './snapshot.mjs';
import { StrictJsonError, parseStrict } from './strict-json.mjs';

// A file that is not one clear JSON document. For `verify` that makes the report invalid (exit 1); everywhere else it is invalid input.
class OngeldigeJson extends InvalidInput {}

// Exit codes (a pipeline must not have to parse text): 0 only when EVERY claim is GEEN_TREFFER_IN_LIJST (still no "safe": see the report),
// 20 = at least one ONMEETBAAR (not measured) and nothing worse, 21 = at least one KANDIDAAT, 22 = at least one TREFFER.
// 1 = verify says the report is not valid, 2 = invalid input or usage, 3 = unexpected error.
const EXIT = { GEEN_TREFFER_IN_LIJST: 0, ONMEETBAAR: 20, KANDIDAAT: 21, TREFFER: 22 };
const ALLOWED = { keygen: ['dir'], check: ['claims', 'snapshots', 'pub', 'key', 'out', 'now', 'max-age-days', 'min-volgnummer', 'bronnen', 'ledger'], verify: ['report', 'pub', 'claims', 'expect', 'expect-bronnen'] };

const [cmd, ...rest] = process.argv.slice(2);
const opt = {};
// Unknown, repeated or valueless options are refused: a typo like --max-age-day must never be ignored silently.
for (let i = 0; i < rest.length; i += 2) {
  const name = rest[i]?.slice(2);
  if (!rest[i]?.startsWith('--') || rest[i + 1] === undefined || !Object.hasOwn(ALLOWED, cmd) || !ALLOWED[cmd].includes(name) || Object.hasOwn(opt, name)) usage();
  opt[name] = rest[i + 1];
}

function usage() {
  console.error('usage:\n  keygen --dir D\n  check --claims F --snapshots D --pub P --key K [--out F] [--now ISO] [--max-age-days N] [--min-volgnummer BRON=N,BRON=N] [--ledger history/ledger.jsonl] [--bronnen eu-fsf,uk-sanctions,ofac-sdn,us-csl,un-sc]\n  verify --report F --pub P [--claims F] [--expect KEY_ID] [--expect-bronnen eu-fsf,uk-sanctions,ofac-sdn,us-csl]\nexit: 0 alle claims GEEN_TREFFER_IN_LIJST, 20 ONMEETBAAR, 21 KANDIDAAT, 22 TREFFER, 1 ongeldig rapport, 2 ongeldige invoer, 3 onverwachte fout');
  process.exit(2);
}
// "eu-fsf=3,uk-sanctions=2" to { 'eu-fsf': 3, 'uk-sanctions': 2 }. Each list once, N from 1.
function leesMinimums(tekst) {
  const uit = {};
  for (const deel of String(tekst).split(',')) {
    const m = /^([a-z0-9][a-z0-9-]{0,40})=([0-9]{1,9})$/.exec(deel.trim());
    if (!m || Number(m[2]) < 1 || Object.hasOwn(uit, m[1])) throw new InvalidInput('--min-volgnummer verwacht BRON=N met N vanaf 1, meerdere gescheiden door een komma, elke bron hooguit een keer');
    uit[m[1]] = Number(m[2]);
  }
  return uit;
}
function readText(path, max = 1024 * 1024) {
  let ok = false;
  try { ok = Boolean(path) && statSync(path).isFile() && statSync(path).size <= max; } catch { ok = false; }
  if (!ok) throw new InvalidInput(`bestand ontbreekt, is geen bestand of is te groot: ${path}`);
  // A byte order mark (Windows tools add one) is not part of the text.
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
}
function readJson(path) {
  const tekst = readText(path);
  try { return parseStrict(tekst); } catch (e) {
    if (e instanceof StrictJsonError) throw new OngeldigeJson(`${e.message}: ${path}`);
    throw e;
  }
}
// Write next to the target and rename, so a reader (or a second run) never sees half a report.
function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}`;
  try { writeFileSync(tmp, text, { flag: 'wx' }); renameSync(tmp, path); } catch (e) { try { unlinkSync(tmp); } catch { /* nothing to clean */ } throw e; }
}

try {
  if (cmd === 'keygen') {
    if (!opt.dir) usage();
    const pubPath = join(opt.dir, 'muqarin-public.pem');
    const privPath = join(opt.dir, 'muqarin-private.pem');
    if (existsSync(pubPath) || existsSync(privPath)) throw new InvalidInput('sleutels bestaan al, ik overschrijf niets');
    mkdirSync(opt.dir, { recursive: true });
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
    writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx' });
    console.error(`sleutels geschreven in ${opt.dir}. Houd de private sleutel buiten git. (Op Windows beperkt de bestandsmodus de toegang niet: zet zelf de rechten.)`);
  } else if (cmd === 'check') {
    const now = opt.now ? new Date(opt.now) : new Date();
    if (Number.isNaN(now.getTime())) throw new InvalidInput('--now ongeldig');
    const maxAgeDays = opt['max-age-days'] === undefined ? 8 : Number(opt['max-age-days']);
    if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0 || maxAgeDays > 60) throw new InvalidInput('--max-age-days moet tussen 0 en 60 liggen');
    // The highest run number you have seen per list: an older (still validly signed) list is then refused. Given by hand and/or read from
    // the feeder's ledger for every list in the set; the higher of the two counts. A ledger that is asked for but not there is an error,
    // never "no protection".
    const required = opt.bronnen === undefined ? undefined : kiesBronnen(opt.bronnen);
    const minVolgnummer = opt['min-volgnummer'] === undefined ? {} : leesMinimums(opt['min-volgnummer']);
    if (opt.ledger !== undefined) {
      readText(opt.ledger, 64 * 1024 * 1024);
      for (const bron of new Set(Object.values(required ?? REQUIRED).flat())) {
        let n;
        try { n = hoogsteVolgnummer(opt.ledger, bron); } catch { throw new InvalidInput('ledger onleesbaar'); }
        if (n !== undefined) minVolgnummer[bron] = Math.max(n, minVolgnummer[bron] ?? 0);
      }
    }
    const pubKeyPem = readText(opt.pub), privKeyPem = readText(opt.key);
    // Reports are signed with --key but read with --pub: a pair that does not match would sign reports nobody can verify.
    let paar = false;
    try { paar = keyId(pubKeyPem) === keyId(privKeyPem); } catch { throw new InvalidInput('sleutel onleesbaar'); }
    if (!paar) throw new InvalidInput('privésleutel en publieke sleutel horen niet bij elkaar');
    const report = runCheck({ claims: readJson(opt.claims), snapshotDir: opt.snapshots, pubKeyPem, now, klok: opt.now ? 'opgegeven' : 'systeem', maxAgeDays, minVolgnummer, required });
    const out = JSON.stringify(signReport(report, privKeyPem), null, 2);
    if (opt.out) writeAtomic(opt.out, out); else process.stdout.write(out + '\n');
    console.error('uitkomsten:', JSON.stringify(report.samenvatting.aantallen));
    console.error('ergste:', report.samenvatting.ergste);
    process.exitCode = EXIT[report.samenvatting.ergste];
  } else if (cmd === 'verify') {
    let rapport;
    try { rapport = readJson(opt.report); } catch (e) {
      if (e instanceof OngeldigeJson) { console.error(`ONGELDIG: ${e.message}`); process.exit(1); }
      throw e;
    }
    const v = verifyReport(rapport, readText(opt.pub), { claims: opt.claims ? readJson(opt.claims) : undefined, expect: opt.expect, bronnen: opt['expect-bronnen'] === undefined ? undefined : kiesBronnen(opt['expect-bronnen']).entity });
    console.error(v.ok
      ? `GELDIG: handtekening en samenhang kloppen. Sleutel ${v.sleutel_id}. Tijd ${v.gemaakt} (klok: ${v.klok}; door de ondertekenaar opgegeven, geen onafhankelijke tijdstempel). Claims: ${v.claims_gecontroleerd ? 'nagelopen tegen --claims' : 'NIET nagelopen, geef --claims mee'}`
      : `ONGELDIG: ${v.reden}`);
    process.exit(v.ok ? 0 : 1);
  } else usage();
} catch (e) {
  const invoer = e instanceof InvalidInput;
  console.error(JSON.stringify({ fout: invoer ? 'ongeldige_invoer' : 'onverwacht', bericht: invoer ? e.message : 'onverwachte fout' }));
  process.exit(invoer ? 2 : 3);
}
