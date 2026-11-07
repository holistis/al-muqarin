// The chain of runs: every good run of the feeder gets the next number and the hash of the manifest before it.
// A reader that knows the highest number it has seen can refuse an older (still validly signed) list: that is the rollback.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { luister, maakLoket } from '../loket/loket.mjs';
import { runCheck } from '../src/check.mjs';
import { loadSnapshot } from '../src/snapshot.mjs';
import { bepaalStatus } from '../tools/status-lib.mjs';
import { ENTITIES, NOW, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

const root = tmpRoot();
const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } cleanup(root); });
const K = keypair();
const H64 = 'a'.repeat(64);
let n = 0;
const snapDir = (manifest = {}) => { const d = join(root, `s${n++}`); writeSnapshot(d, 'eu-fsf', ENTITIES, K.priv, { manifest }); return d; };
const load = (dir, extra = {}) => loadSnapshot({ dir, source: 'eu-fsf', pubKeyPem: K.pub, now: NOW, maxAgeDays: 8, ...extra });
const FRESH = { fetchedAt: '2026-11-05T10:00:00Z', asOf: '2026-11-05' };

describe('volgnummer in het manifest', () => {
  it('run 1 has no predecessor, later runs name the hash of the one before', () => {
    assert.equal(load(snapDir({ ...FRESH, volgnummer: 1, vorige_manifest_sha256: null })).ok, true);
    const s = load(snapDir({ ...FRESH, volgnummer: 7, vorige_manifest_sha256: H64 }));
    assert.equal(s.ok, true);
    assert.equal(s.manifest.volgnummer, 7);
  });
  it('a manifest without the chain is still accepted when nobody asked for a minimum', () => assert.equal(load(snapDir(FRESH)).ok, true));
  it('only one of the two chain fields is refused', () => {
    assert.equal(load(snapDir({ ...FRESH, volgnummer: 2 })).reason, 'manifest_velden');
    assert.equal(load(snapDir({ ...FRESH, vorige_manifest_sha256: H64 })).reason, 'manifest_velden');
  });
  it('a number that is not a whole number from 1, or a predecessor that does not fit, is refused', () => {
    for (const volgnummer of [0, -1, 1.5, '2', 1e10, null]) assert.equal(load(snapDir({ ...FRESH, volgnummer, vorige_manifest_sha256: H64 })).reason, 'volgnummer_ongeldig', String(volgnummer));
    assert.equal(load(snapDir({ ...FRESH, volgnummer: 1, vorige_manifest_sha256: H64 })).reason, 'volgnummer_ongeldig', 'run 1 cannot have a predecessor');
    assert.equal(load(snapDir({ ...FRESH, volgnummer: 2, vorige_manifest_sha256: null })).reason, 'volgnummer_ongeldig', 'a later run needs one');
    assert.equal(load(snapDir({ ...FRESH, volgnummer: 2, vorige_manifest_sha256: 'xyz' })).reason, 'volgnummer_ongeldig');
    assert.equal(load(snapDir({ ...FRESH, volgnummer: 2, vorige_manifest_sha256: H64.toUpperCase() })).reason, 'volgnummer_ongeldig');
    assert.equal(load(snapDir({ ...FRESH, volgnummer: 2, vorige_manifest_sha256: H64.slice(1) })).reason, 'volgnummer_ongeldig', 'one character short');
    assert.equal(load(snapDir({ ...FRESH, volgnummer: 2, vorige_manifest_sha256: H64 + 'a' })).reason, 'volgnummer_ongeldig', 'one character long');
  });
  it('a minimum refuses an older run, a run without a number, and accepts the same or a newer one', () => {
    const d = snapDir({ ...FRESH, volgnummer: 3, vorige_manifest_sha256: H64 });
    assert.equal(load(d, { minVolgnummer: 4 }).reason, 'volgnummer_terug');
    assert.equal(load(d, { minVolgnummer: 3 }).ok, true);
    assert.equal(load(d, { minVolgnummer: 2 }).ok, true);
    assert.equal(load(snapDir(FRESH), { minVolgnummer: 1 }).reason, 'volgnummer_ontbreekt');
  });
});

describe('volgnummer in de controle en in het rapport', () => {
  const run = (dir, minVolgnummer) => runCheck({ claims: [{ id: 'a', type: 'entity', value: 'PJSC Alrosa' }], snapshotDir: dir, pubKeyPem: K.pub, now: NOW, minVolgnummer });
  it('the report names the run number and predecessor of each source it used', () => {
    const rep = run(snapDir({ ...FRESH, volgnummer: 4, vorige_manifest_sha256: H64 }));
    assert.equal(rep.bronnen[0].volgnummer, 4);
    assert.equal(rep.bronnen[0].vorige_manifest_sha256, H64);
    assert.equal(rep.resultaten[0].uitkomst, 'TREFFER');
    assert.equal('volgnummer' in run(snapDir(FRESH)).bronnen[0], false, 'no field for a list that has no chain');
  });
  it('a minimum for a source makes an older list ONMEETBAAR with the reason, and a minimum for another source changes nothing', () => {
    const d = snapDir({ ...FRESH, volgnummer: 2, vorige_manifest_sha256: H64 });
    const rep = run(d, { 'eu-fsf': 3 });
    assert.equal(rep.resultaten[0].uitkomst, 'ONMEETBAAR');
    assert.equal(rep.resultaten[0].per_bron[0].reden, 'volgnummer_terug');
    assert.equal(run(d, { cahras: 99 }).resultaten[0].uitkomst, 'TREFFER');
    assert.equal(run(d, { 'eu-fsf': 2 }).resultaten[0].uitkomst, 'TREFFER');
  });
});

describe('opdrachtregel: --min-volgnummer', () => {
  const CLI = new URL('../src/cli.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const dir = snapDir({ ...FRESH, volgnummer: 2, vorige_manifest_sha256: H64 });
  const claims = join(root, 'c.json'); writeFileSync(claims, JSON.stringify([{ id: 'a', type: 'entity', value: 'PJSC Alrosa' }]));
  const pub = join(root, 'pub.pem'), priv = join(root, 'priv.pem'); writeFileSync(pub, K.pub); writeFileSync(priv, K.priv);
  const cli = (extra) => spawnSync('node', [CLI, 'check', '--claims', claims, '--snapshots', dir, '--pub', pub, '--key', priv, '--now', NOW.toISOString(), ...extra], { encoding: 'utf8' });
  it('an older list than the minimum gives exit 20 (ONMEETBAAR), the same or newer gives the real answer (exit 22)', () => {
    assert.equal(cli(['--min-volgnummer', 'eu-fsf=3']).status, 20);
    assert.equal(cli(['--min-volgnummer', 'eu-fsf=2']).status, 22);
    assert.equal(cli([]).status, 22);
  });
  it('a malformed minimum is invalid input (exit 2), never ignored', () => {
    for (const v of ['3', 'eu-fsf=', 'eu-fsf=0', 'eu-fsf=abc', '=3', 'EU FSF=3', 'eu-fsf=1234567890']) assert.equal(cli(['--min-volgnummer', v]).status, 2, v);
  });
});

describe('voeding: de keten in het logboek', () => {
  const FEEDER = new URL('../feeder/fetch-eu-fsf.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const out = join(root, 'f-snaps'), hist = join(root, 'f-hist'), keyFile = join(root, 'f-priv.pem');
  writeFileSync(keyFile, K.priv);
  const xml = (k, gen = '2026-11-05') => `<?xml version="1.0"?><export generationDate="${gen}T10:00:00.000+01:00">` + Array.from({ length: k }, (_, i) => `<sanctionEntity euReferenceNumber="EU.${i}" logicalId="${i}"><nameAlias wholeName="Name Number ${i} &amp; Co" logicalId="${i}"/></sanctionEntity>`).join('') + '</export>';
  const feed = (name, content, now) => { const p = join(root, name); writeFileSync(p, content); return spawnSync('node', [FEEDER, '--out', out, '--history', hist, '--key', keyFile, '--from-file', p, '--floor', '5', '--now', now], { encoding: 'utf8' }); };
  const manifest = () => JSON.parse(readFileSync(join(out, 'eu-fsf', 'manifest.json'), 'utf8'));
  const ledger = () => readFileSync(join(hist, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  it('the first run is number 1 with no predecessor; the next names the hash of the first manifest', () => {
    assert.equal(feed('a.xml', xml(20), '2026-11-06T05:00:00Z').status, 0);
    assert.equal(manifest().volgnummer, 1); assert.equal(manifest().vorige_manifest_sha256, null);
    assert.equal(feed('b.xml', xml(20), '2026-11-06T17:00:00Z').status, 0);
    assert.equal(manifest().volgnummer, 2);
    assert.equal(manifest().vorige_manifest_sha256, ledger()[0].manifest_sha256);
    assert.deepEqual(ledger().map((l) => l.volgnummer), [1, 2]);
    assert.equal(ledger()[1].vorige_manifest_sha256, ledger()[0].manifest_sha256);
  });
  it('the live manifest hash is the one the ledger holds for that number', () => {
    const s = loadSnapshot({ dir: out, source: 'eu-fsf', pubKeyPem: K.pub, now: new Date('2026-11-06T18:00:00Z'), maxAgeDays: 8 });
    assert.equal(s.manifestSha256, ledger()[1].manifest_sha256);
  });
  it('a quarantined run does not use a number', () => {
    assert.equal(feed('c.xml', xml(3), '2026-11-07T05:00:00Z').status, 3);
    assert.equal(feed('d.xml', xml(20), '2026-11-07T17:00:00Z').status, 0);
    assert.equal(manifest().volgnummer, 3);
    assert.equal(manifest().vorige_manifest_sha256, ledger()[1].manifest_sha256, 'it names the run before it, not the first');
  });
  it('ledger lines of another source do not count towards the number', () => {
    appendFileSync(join(hist, 'ledger.jsonl'), JSON.stringify({ bron: 'cahras', volgnummer: 1, manifest_sha256: 'c'.repeat(64) }) + '\n');
    assert.equal(feed('d2.xml', xml(20), '2026-11-07T20:00:00Z').status, 0);
    assert.equal(manifest().volgnummer, 4);
  });
  it('an unreadable ledger stops the run instead of restarting the chain at 1', () => {
    appendFileSync(join(hist, 'ledger.jsonl'), 'dit is geen json\n');
    const before = manifest().volgnummer;
    const r = feed('e.xml', xml(20), '2026-11-08T05:00:00Z');
    assert.equal(r.status, 2);
    assert.equal(manifest().volgnummer, before);
  });
});

describe('loket: weigert een oudere lijst nadat hij een nieuwere heeft gezien', () => {
  let nu = NOW.getTime();
  const start = async (dir) => {
    const srv = maakLoket({ snapshotDir: dir, pubKeyPem: K.pub, privKeyPem: K.priv, klok: () => nu });
    const a = await luister(srv, 0); servers.push(srv);
    return `http://127.0.0.1:${a.port}`;
  };
  const ask = async (base) => (await (await fetch(`${base}/v1/vergelijk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ id: 'a', type: 'entity', value: 'PJSC Alrosa' }]) })).json()).report.resultaten[0];
  const put = (dir, manifest) => writeSnapshot(dir, 'eu-fsf', ENTITIES, K.priv, { manifest });
  it('number 5 is served; a validly signed number 4 is then refused; number 6 is accepted again; losing the number is refused', async () => {
    const dir = join(root, 'loket-keten'); mkdirSync(dir, { recursive: true });
    put(dir, { ...FRESH, volgnummer: 5, vorige_manifest_sha256: H64 });
    const base = await start(dir);
    assert.equal((await ask(base)).uitkomst, 'TREFFER');
    nu += 61000;
    assert.equal((await ask(base)).uitkomst, 'TREFFER', 'the same number again after the TTL is not a rollback');
    put(dir, { ...FRESH, volgnummer: 4, vorige_manifest_sha256: H64 });
    nu += 61000;
    const terug = await ask(base);
    assert.equal(terug.uitkomst, 'ONMEETBAAR'); assert.equal(terug.per_bron[0].reden, 'volgnummer_terug');
    put(dir, FRESH);
    nu += 6000;
    assert.equal((await ask(base)).per_bron[0].reden, 'volgnummer_ontbreekt');
    put(dir, { ...FRESH, volgnummer: 6, vorige_manifest_sha256: H64 });
    nu += 6000;
    assert.equal((await ask(base)).uitkomst, 'TREFFER');
    put(dir, { ...FRESH, volgnummer: 5, vorige_manifest_sha256: H64 });
    nu += 61000;
    assert.equal((await ask(base)).per_bron[0].reden, 'volgnummer_terug', 'the highest number stays 6');
  });
});

describe('alarm: de live lijst moet de laatste uit het logboek zijn', () => {
  const NU2 = new Date('2026-11-06T12:00:00Z');
  const GOOD = { fetchedAt: '2026-11-06T05:17:00Z', asOf: '2026-11-04' };
  const status = (d) => bepaalStatus({ snapshotDir: join(d, 'snap'), historyDir: join(d, 'hist'), pubKeyPem: K.pub, now: NU2 });
  const maak = (manifest, ledgerRegels) => {
    const d = join(root, `st${n++}`); mkdirSync(join(d, 'hist'), { recursive: true });
    writeSnapshot(join(d, 'snap'), 'eu-fsf', ENTITIES, K.priv, { manifest: { ...GOOD, ...manifest } });
    const sha = loadSnapshot({ dir: join(d, 'snap'), source: 'eu-fsf', pubKeyPem: K.pub, now: NU2, maxAgeDays: 8 }).manifestSha256;
    if (ledgerRegels) writeFileSync(join(d, 'hist', 'ledger.jsonl'), ledgerRegels(sha).map((r) => JSON.stringify({ bron: 'eu-fsf', ...r })).join('\n') + '\n');
    return d;
  };
  it('the live list is the last run in the ledger: ok', () => {
    const s = status(maak({ volgnummer: 2, vorige_manifest_sha256: H64 }, (sha) => [{ volgnummer: 1, manifest_sha256: H64 }, { volgnummer: 2, manifest_sha256: sha }]));
    assert.equal(s.ok, true, JSON.stringify(s));
  });
  it('a live list older than the ledger says is a rollback', () => {
    const s = status(maak({ volgnummer: 1, vorige_manifest_sha256: null }, (sha) => [{ volgnummer: 1, manifest_sha256: sha }, { volgnummer: 2, manifest_sha256: H64 }]));
    assert.deepEqual(s.redenen, ['volgnummer_terug']);
  });
  it('the same number with another manifest, or a number ahead of the ledger, does not match', () => {
    assert.deepEqual(status(maak({ volgnummer: 2, vorige_manifest_sha256: H64 }, () => [{ volgnummer: 1, manifest_sha256: H64 }, { volgnummer: 2, manifest_sha256: 'b'.repeat(64) }])).redenen, ['ledger_wijkt_af']);
    assert.deepEqual(status(maak({ volgnummer: 5, vorige_manifest_sha256: H64 }, (sha) => [{ volgnummer: 1, manifest_sha256: H64 }, { volgnummer: 2, manifest_sha256: sha }])).redenen, ['ledger_wijkt_af']);
  });
  it('a live list that lost its number while the ledger has numbers is red', () => {
    assert.deepEqual(status(maak({}, () => [{ volgnummer: 1, manifest_sha256: H64 }])).redenen, ['volgnummer_ontbreekt']);
  });
  it('a numbered list beyond 1 with no ledger, or an empty one, is red; run 1 with no ledger is fine', () => {
    assert.deepEqual(status(maak({ volgnummer: 2, vorige_manifest_sha256: H64 }, null)).redenen, ['ledger_ontbreekt']);
    assert.deepEqual(status(maak({ volgnummer: 2, vorige_manifest_sha256: H64 }, () => [])).redenen, ['ledger_ontbreekt']);
    assert.equal(status(maak({ volgnummer: 1, vorige_manifest_sha256: null }, null)).ok, true);
  });
  it('an unreadable ledger is red', () => {
    const d = maak({ volgnummer: 1, vorige_manifest_sha256: null }, null);
    writeFileSync(join(d, 'hist', 'ledger.jsonl'), 'kapot\n');
    assert.ok(status(d).redenen.includes('ledger_onleesbaar'));
  });
  it('lines of another source in the ledger do not count', () => {
    const d = maak({ volgnummer: 1, vorige_manifest_sha256: null }, (sha) => [{ volgnummer: 1, manifest_sha256: sha }]);
    appendFileSync(join(d, 'hist', 'ledger.jsonl'), JSON.stringify({ bron: 'cahras', volgnummer: 9, manifest_sha256: H64 }) + '\n');
    assert.equal(status(d).ok, true);
  });
});
