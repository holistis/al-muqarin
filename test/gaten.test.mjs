// Gaps the planted-fault run found in our own tests (2026-11-07): each test below kills a fault that used to survive.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { luister, maakLoket } from '../loket/loket.mjs';
import { parseEuFsf } from '../src/adapters/eu-fsf.mjs';
import { runCheck } from '../src/check.mjs';
import { StrictJsonError, parseStrict } from '../src/strict-json.mjs';
import { ENTITIES, NOW, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

const root = tmpRoot();
const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } cleanup(root); });
const K = keypair();
writeSnapshot(root, 'eu-fsf', ENTITIES, K.priv, { manifest: { fetchedAt: '2026-11-05T10:00:00Z', asOf: '2026-11-05' } });
const CLI = new URL('../src/cli.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const cli = (args) => spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
const pubFile = join(root, 'pub.pem'), privFile = join(root, 'priv.pem'), claimsFile = join(root, 'claims.json');
writeFileSync(pubFile, K.pub); writeFileSync(privFile, K.priv); writeFileSync(claimsFile, JSON.stringify([{ id: 'a', type: 'entity', value: 'PJSC Alrosa' }]));
const stdArgs = (claims = claimsFile) => ['--claims', claims, '--snapshots', root, '--pub', pubFile, '--key', privFile, '--now', NOW.toISOString()];

describe('een minimum volgnummer moet een geheel getal vanaf 1 zijn, in de bibliotheek en op de opdrachtregel', () => {
  const claims = [{ id: 'a', type: 'entity', value: 'x' }];
  it('the library refuses 0, a negative number and a fraction', () => {
    for (const nr of [0, -1, 1.5]) assert.throws(() => runCheck({ claims, snapshotDir: root, pubKeyPem: K.pub, now: NOW, minVolgnummer: { 'eu-fsf': nr } }), /ongeldig nummer/, String(nr));
  });
  it('the command line says why: the number must start at 1', () => {
    const r = cli(['check', ...stdArgs(), '--min-volgnummer', 'eu-fsf=0']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /vanaf 1/);
  });
});

describe('de lijstlezer zegt wat er mis is, niet alleen dat er iets mis is', () => {
  const kop = '<export generationDate="2026-11-05T10:00:00.000+01:00">';
  const goed = '<sanctionEntity euReferenceNumber="1"><nameAlias wholeName="Alpha Corp"/></sanctionEntity>';
  it('a tag that never ends is "niet gesloten", not a complaint about the next entity', () => {
    assert.throws(() => parseEuFsf(`${kop}${goed}<sanctionEntity euReferenceNumber="2"`), (e) => e.message === 'entiteit niet gesloten');
  });
  it('an entity written as a self-closing tag is refused as empty', () => {
    assert.throws(() => parseEuFsf(`${kop}<sanctionEntity euReferenceNumber="1"/></export>`), /lege entiteit/);
  });
});

describe('strikte JSON leest ontsnapte tekens en sluit lijsten goed af', () => {
  it('an escaped quote inside a string does not end the string, so it cannot hide or invent a key', () => {
    const tekst = String.raw`{"k":"v\",\"k\":2"}`;
    assert.deepEqual(parseStrict(tekst), JSON.parse(tekst));
    assert.deepEqual(parseStrict(String.raw`{"a\"b":1}`), { 'a"b': 1 });
  });
  it('a duplicate key after a closed array is still a duplicate', () => {
    assert.throws(() => parseStrict('{"a":[1],"a":2}'), StrictJsonError);
    assert.throws(() => parseStrict('{"a":[[1,2],[3]],"b":[],"a":2}'), StrictJsonError);
  });
});

describe('de opdrachtregel weigert een te groot bestand met die reden', () => {
  it('a claims file over one megabyte is "te groot", not read', () => {
    const p = join(root, 'groot.json');
    writeFileSync(p, `[${' '.repeat(1100000)}]`);
    const r = cli(['check', ...stdArgs(p)]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /te groot/);
  });
});

describe('het loket noemt de lengte van elk antwoord en zegt welke sleutel dubbel stond', () => {
  const FRESH = { fetchedAt: '2026-11-05T10:00:00Z', asOf: '2026-11-05' };
  async function start() {
    const d = join(root, 'loket-snap');
    writeSnapshot(d, 'eu-fsf', ENTITIES, K.priv, { manifest: FRESH });
    const srv = maakLoket({ snapshotDir: d, pubKeyPem: K.pub, privKeyPem: K.priv, klok: () => NOW.getTime() });
    const a = await luister(srv, 0); servers.push(srv);
    return `http://127.0.0.1:${a.port}`;
  }
  it('every answer carries a content-length equal to its body, also for non-ASCII text', async () => {
    const base = await start();
    for (const r of [await fetch(`${base}/v1/gezondheid`), await fetch(`${base}/v1/sleutel`), await fetch(`${base}/v1/vergelijk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ id: 'a', type: 'entity', value: 'Søren Łukasz' }]) })]) {
      const tekst = await r.text();
      assert.equal(r.headers.get('content-length'), String(Buffer.byteLength(tekst)));
    }
  });
  it('a request body with a repeated key is refused with the reason, not a vague "invalid JSON"', async () => {
    const base = await start();
    const r = await fetch(`${base}/v1/vergelijk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[{"id":"a","type":"entity","value":"x","value":"y"}]' });
    assert.equal(r.status, 400);
    assert.match(await r.text(), /dubbele sleutel/);
  });
});
