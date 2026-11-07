import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { after, describe, it } from 'node:test';
import { runCheck } from '../src/check.mjs';
import { loadSnapshot } from '../src/snapshot.mjs';
import { cleanup, keypair, tmpRoot } from './fixture.mjs';

const FEEDER = new URL('../feeder/fetch-eu-fsf.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const root = tmpRoot();
after(() => cleanup(root));
const K = keypair();
const keyFile = join(root, 'priv.pem'); writeFileSync(keyFile, K.priv);
const out = join(root, 'snaps'), hist = join(root, 'hist');
const NOW = '2026-11-06T12:00:00Z';
const xml = (n, gen = '2026-11-05') => `<?xml version="1.0"?><export generationDate="${gen}T10:00:00.000+01:00">` +
  Array.from({ length: n }, (_, i) => `<sanctionEntity euReferenceNumber="EU.${i}" logicalId="${i}"><nameAlias wholeName="Name Number ${i} &amp; Co" logicalId="${i}"/></sanctionEntity>`).join('') + '</export>';
const feed = (file, extra = []) => spawnSync('node', [FEEDER, '--out', out, '--history', hist, '--key', keyFile, '--from-file', file, '--floor', '5', '--now', NOW, ...extra], { encoding: 'utf8' });
const file = (name, content) => { const p = join(root, name); writeFileSync(p, content); return p; };
const liveCount = () => JSON.parse(readFileSync(join(out, 'eu-fsf', 'manifest.json'), 'utf8')).entryCount;

describe('feeder', () => {
  it('first run writes a snapshot the checker accepts, a ledger line and a raw copy', () => {
    const r = feed(file('a.xml', xml(20)));
    assert.equal(r.status, 0, r.stderr);
    const s = loadSnapshot({ dir: out, source: 'eu-fsf', pubKeyPem: K.pub, now: new Date(NOW), maxAgeDays: 8 });
    assert.ok(s.ok, s.reason);
    assert.equal(readFileSync(join(hist, 'ledger.jsonl'), 'utf8').trim().split('\n').length, 1);
    assert.ok(readdirSync(join(hist, 'eu-fsf')).length === 1);
  });
  it('the snapshot works end to end through the checker', () => {
    const rep = runCheck({ claims: [{ id: 'a', type: 'entity', value: 'name number 3 and co' }, { id: 'b', type: 'entity', value: 'Name Number 3 & Co' }], snapshotDir: out, pubKeyPem: K.pub, now: new Date(NOW), required: { entity: ['eu-fsf'], country: ['cahras'] } });
    assert.equal(rep.resultaten[1].uitkomst, 'TREFFER');
  });
  it('a list that shrinks more than 10% is quarantined and the live snapshot stays', () => {
    const r = feed(file('b.xml', xml(10)));
    assert.equal(r.status, 3);
    assert.equal(liveCount(), 20);
    assert.ok(existsSync(join(hist, 'quarantine')));
  });
  const lastReason = () => { const q = join(hist, 'quarantine'); const d = readdirSync(q).sort().pop(); return readFileSync(join(q, d, 'reden.txt'), 'utf8'); };
  it('a list below the floor is quarantined for that reason', () => { assert.equal(feed(file('c.xml', xml(3))).status, 3); assert.match(lastReason(), /te weinig partijen/); });
  it('an empty export is quarantined for that reason', () => { assert.equal(feed(file('d.xml', xml(0))).status, 3); assert.match(lastReason(), /te weinig partijen/); });
  it('a shrink is quarantined for that reason', () => { assert.equal(feed(file('d2.xml', xml(10))).status, 3); assert.match(lastReason(), /kromp/); });
  it('garbage input exits 2 and leaves the live snapshot alone', () => {
    assert.equal(feed(file('e.xml', 'not xml at all')).status, 2);
    assert.equal(liveCount(), 20);
  });
  it('a slightly smaller list (within 10%) is accepted', () => {
    assert.equal(feed(file('f.xml', xml(19))).status, 0);
    assert.equal(liveCount(), 19);
  });
  it('a list whose own date is over 60 days old fails the self-check and is quarantined', () => {
    assert.equal(feed(file('g.xml', xml(19, '2026-08-01'))).status, 3);
    assert.equal(liveCount(), 19);
  });
  it('the signed manifest names the reuse decision and says the Official Journal is the only authentic text', () => {
    const m = JSON.parse(readFileSync(join(out, 'eu-fsf', 'manifest.json'), 'utf8'));
    assert.match(m.license, /2011\/833\/EU/);
    assert.match(m.license, /Only the Official Journal is authentic/);
    assert.doesNotMatch(m.license, /NOT yet verified/);
  });
  it('missing required argument exits 2', () => assert.equal(spawnSync('node', [FEEDER], { encoding: 'utf8' }).status, 2));
  // The attacker's list: it has plenty of parties and a valid shape, but we can read no name in it. It must never be signed.
  const blind = (name) => `<?xml version="1.0"?><export generationDate="2026-11-05T10:00:00.000+01:00">` +
    Array.from({ length: 19 }, (_, i) => `<sanctionEntity euReferenceNumber="EU.${i}" logicalId="${i}"><nameAlias wholeName="${name(i)}" logicalId="${i}"/></sanctionEntity>`).join('') + '</export>';
  it('a list whose names are all in another script is quarantined and the live snapshot stays', () => {
    const before = liveCount();
    assert.equal(feed(file('h.xml', blind((i) => `Северный Металл ${i}`)), ['--accepteer-verschil', 'alleen de dekkingspoort toetsen']).status, 3);
    assert.match(lastReason(), /onleesbare namen/);
    assert.equal(liveCount(), before);
  });
  it('a list with no readable name at all (empty names) is quarantined too', () => {
    const before = liveCount();
    assert.equal(feed(file('i.xml', blind(() => '')), ['--accepteer-verschil', 'alleen de dekkingspoort toetsen']).status, 3);
    assert.match(lastReason(), /onleesbare namen|bruikbaar|ongeldig/);
    assert.equal(liveCount(), before);
  });
  it('a list where one party in twenty has no readable name is accepted', () => {
    const x = xml(20).replace('wholeName="Name Number 7 &amp; Co"', 'wholeName="Северный Металл"');
    assert.equal(feed(file('j.xml', x)).status, 0);
  });
});

describe('feeder history keeps big files once', () => {
  const out2 = join(root, 'snaps2'), hist2 = join(root, 'hist2');
  const feed2 = (f, now = NOW) => spawnSync('node', [FEEDER, '--out', out2, '--history', hist2, '--key', keyFile, '--from-file', f, '--floor', '5', '--now', now], { encoding: 'utf8' });
  const store = () => join(hist2, '_inhoud');
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const runs = () => readdirSync(join(hist2, 'eu-fsf'));
  const A = xml(20);
  it('the first run stores the raw download and the list under their own hash, and the run folder holds only the signed manifest', () => {
    const f = file('k1.xml', A);
    assert.equal(feed2(f).status, 0);
    const [run] = runs();
    assert.deepEqual(readdirSync(join(hist2, 'eu-fsf', run)).sort(), ['manifest.json', 'manifest.sig']);
    const manifest = JSON.parse(readFileSync(join(hist2, 'eu-fsf', run, 'manifest.json'), 'utf8'));
    const list = readFileSync(join(store(), `lijst-${manifest.sha256}.json`));
    assert.equal(sha(list), manifest.sha256);
    const ledger = JSON.parse(readFileSync(join(hist2, 'ledger.jsonl'), 'utf8').trim().split('\n').pop());
    assert.equal(ledger.list_sha256, manifest.sha256);
    assert.equal(gunzipSync(readFileSync(join(store(), `ruw-${ledger.raw_sha256}.xml.gz`))).toString('utf8'), A);
  });
  it('the same download again adds a dated manifest and a ledger line but no second copy of the big files, and leaves the stored copy alone', () => {
    const before = readdirSync(store()).sort();
    const listFile = join(store(), before.find((n) => n.startsWith('lijst-')));
    writeFileSync(listFile, 'MARKER');
    assert.equal(feed2(file('k2.xml', A), '2026-11-06T13:00:00Z').status, 0);
    assert.equal(runs().length, 2);
    assert.deepEqual(readdirSync(store()).sort(), before);
    assert.equal(readFileSync(listFile, 'utf8'), 'MARKER');
    assert.equal(readFileSync(join(hist2, 'ledger.jsonl'), 'utf8').trim().split('\n').length, 2);
  });
  it('a changed download is stored as a new pair of files next to the old ones', () => {
    const before = readdirSync(store()).length;
    assert.equal(feed2(file('k3.xml', xml(21)), '2026-11-06T14:00:00Z').status, 0);
    assert.equal(readdirSync(store()).length, before + 2);
  });
  it('no temporary files are left behind', () => assert.equal(readdirSync(store()).filter((n) => n.includes('.tmp-')).length, 0));
});
