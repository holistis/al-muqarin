import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { bepaalStatus } from '../tools/status-lib.mjs';
import { ENTITIES, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

const TOOL = new URL('../tools/status.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const root = tmpRoot();
after(() => cleanup(root));
const K = keypair();
const NOW = new Date('2026-11-06T12:00:00Z');
let n = 0;
const fresh = (o = {}) => { const d = join(root, `case${n++}`); mkdirSync(join(d, 'hist', 'quarantine'), { recursive: true }); writeSnapshot(join(d, 'snap'), 'eu-fsf', ENTITIES, K.priv, o); return d; };
const st = (d, extra = {}) => bepaalStatus({ snapshotDir: join(d, 'snap'), historyDir: join(d, 'hist'), pubKeyPem: K.pub, now: NOW, ...extra });
const GOOD = { manifest: { fetchedAt: '2026-11-06T05:17:00Z', asOf: '2026-11-04' } };

describe('voedingsstatus', () => {
  it('a fresh signed snapshot with no quarantine is ok and reports its age', () => {
    const s = st(fresh(GOOD));
    assert.equal(s.ok, true, JSON.stringify(s));
    assert.deepEqual(s.redenen, []);
    assert.equal(s.leeftijd_uren, 6.7);
    assert.equal(s.lijst_asOf, '2026-11-04');
    assert.equal(s.entryCount, ENTITIES.length);
    assert.equal(s.quarantaine_sindsdien, 0);
  });
  it('no snapshot at all is red, never ok', () => {
    const d = join(root, 'leeg'); mkdirSync(join(d, 'snap'), { recursive: true }); mkdirSync(join(d, 'hist'), { recursive: true });
    const s = st(d);
    assert.equal(s.ok, false);
    assert.match(s.redenen[0], /^momentopname_/);
  });
  it('a snapshot older than the limit is red, and a looser limit makes it ok again', () => {
    const d = fresh({ manifest: { fetchedAt: '2026-11-04T05:17:00Z', asOf: '2026-11-04' } });
    assert.equal(st(d).ok, false);
    assert.match(st(d).redenen[0], /verouderd/);
    assert.equal(st(d, { maxFetchUren: 80 }).ok, true);
  });
  it('a list whose own date is too old is red even if it was fetched an hour ago', () => {
    const s = st(fresh({ manifest: { fetchedAt: '2026-11-06T11:00:00Z', asOf: '2026-09-01' } }));
    assert.equal(s.ok, false);
    assert.match(s.redenen[0], /lijst_verouderd/);
  });
  it('a snapshot with a wrong signature is red', () => {
    const s = st(fresh({ ...GOOD, key: keypair().priv }));
    assert.equal(s.ok, false);
    assert.match(s.redenen[0], /handtekening/);
  });
  it('a list whose names we mostly cannot read is red even if signed and fresh', () => {
    const blind = Array.from({ length: 20 }, (_, i) => ({ id: 'B' + i, names: ['Северный Металл ' + i] }));
    const d = join(root, 'blind'); mkdirSync(join(d, 'hist'), { recursive: true }); writeSnapshot(join(d, 'snap'), 'eu-fsf', blind, K.priv, GOOD);
    const s = st(d);
    assert.equal(s.ok, false);
    assert.ok(s.redenen.includes('dekking_te_laag'));
  });
  it('a quarantine after the last good run is red and counted; one before it is not', () => {
    const d = fresh(GOOD);
    mkdirSync(join(d, 'hist', 'quarantine', '2026-11-05T17-17-00-000Z'));
    assert.equal(st(d).ok, true, 'older than the good run');
    mkdirSync(join(d, 'hist', 'quarantine', '2026-11-06T11-17-00-000Z'));
    mkdirSync(join(d, 'hist', 'quarantine', '2026-11-06T11-18-00-000Z'));
    const s = st(d);
    assert.equal(s.ok, false);
    assert.equal(s.quarantaine_sindsdien, 2);
    assert.ok(s.redenen.includes('quarantaine_na_laatste_goede_run_2'));
  });
  it('a quarantine folder with an unreadable name counts as red, not as old', () => {
    const d = fresh(GOOD);
    mkdirSync(join(d, 'hist', 'quarantine', 'raar'));
    assert.equal(st(d).ok, false);
  });
  it('a quarantine with no good snapshot at all is counted too', () => {
    const d = join(root, 'q-zonder'); mkdirSync(join(d, 'snap'), { recursive: true }); mkdirSync(join(d, 'hist', 'quarantine', '2026-11-06T11-17-00-000Z'), { recursive: true });
    assert.equal(st(d).quarantaine_sindsdien, 1);
  });
});

describe('status-opdracht', () => {
  const pubFile = join(root, 'pub.pem'); writeFileSync(pubFile, K.pub);
  const run = (d, extra = []) => spawnSync('node', [TOOL, '--snapshots', join(d, 'snap'), '--history', join(d, 'hist'), '--pub', pubFile, '--now', NOW.toISOString(), ...extra], { encoding: 'utf8' });
  it('exits 0 and prints the object when ok; exits 1 when red', () => {
    const ok = run(fresh(GOOD));
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).ok, true);
    const bad = run(fresh({ manifest: { fetchedAt: '2026-11-01T05:17:00Z' } }));
    assert.equal(bad.status, 1);
    assert.equal(JSON.parse(bad.stdout).ok, false);
  });
  it('--out writes the same object atomically and leaves no temporary file', () => {
    const d = fresh(GOOD); const out = join(d, 'status.json');
    const r = run(d, ['--out', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).ok, true);
    assert.equal(readdirSync(d).filter((x) => x.includes('.tmp-')).length, 0);
  });
  it('unknown, repeated or valueless options and missing arguments exit 2', () => {
    const d = fresh(GOOD);
    assert.equal(run(d, ['--bogus', 'x']).status, 2);
    assert.equal(run(d, ['--now', '2026-11-06T12:00:00Z']).status, 2);
    assert.equal(run(d, ['--max-fetch-uren']).status, 2);
    assert.equal(spawnSync('node', [TOOL], { encoding: 'utf8' }).status, 2);
    assert.equal(run(d, ['--max-fetch-uren', '-5']).status, 2);
    const raw = spawnSync('node', [TOOL, '--snapshots', join(d, 'snap'), '--history', join(d, 'hist'), '--pub', pubFile, '--now', 'geen-datum'], { encoding: 'utf8' });
    assert.equal(raw.status, 2, raw.stderr);
  });
});
