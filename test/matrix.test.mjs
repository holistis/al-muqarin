// Test de tester: planted faults must never produce a green answer.
// Mutation matrix applied to the list snapshot: change, remove, add, duplicate, swap, empty, truncate, variant.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { canonical } from '../src/canon.mjs';
import { InvalidInput, REQUIRED, runCheck, signReport, verifyReport } from '../src/check.mjs';
import { ISO_ALPHA2 } from '../src/countries.mjs';
import { sha256Hex } from '../src/snapshot.mjs';
import { COUNTRIES, ENTITIES, NOW, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

const K = keypair();
const OTHER = keypair();
const roots = [];
const root = () => { const r = tmpRoot(); roots.push(r); return r; };
after(() => roots.forEach(cleanup));

const ent = (value, id = 'c1') => ({ id, type: 'entity', value });
// The fixtures of these tests hold one entity list (eu-fsf) and the country list; the set of lists is a plain argument.
const EU = { entity: ['eu-fsf'], country: ['cahras'] };
const run = (r, claims, extra = {}) => runCheck({ claims, snapshotDir: r, pubKeyPem: K.pub, now: NOW, required: EU, ...extra });
const first = (rep) => rep.resultaten[0];
const healthy = () => { const r = root(); writeSnapshot(r, 'eu-fsf', ENTITIES, K.priv); writeSnapshot(r, 'cahras', COUNTRIES, K.priv, { manifest: { minEntries: 1 } }); return r; };

describe('matching on a healthy snapshot', () => {
  const r = healthy();
  const cases = [
    ['Acme Trading Company Ltd', 'TREFFER'],
    ['acme trading', 'TREFFER'],                       // legal suffix variant
    ['Trading ACME', 'TREFFER'],                       // token order
    ['  ÁCMÉ,  Trading!! ', 'TREFFER'],                // diacritics, punctuation, case
    ['Soren Lukasz Metals', 'TREFFER'],                // ø and ł map
    ['Mohammed Al Hassan Refining', 'TREFFER'],
    ['Mohamed Al-Hassan Refining', 'KANDIDAAT'],       // one letter off
    ['Acme Tradng', 'KANDIDAAT'],                      // typo, shorter than the listed name
    ['Acem Trading', 'KANDIDAAT'],                     // transposition
    ['Acme Trading Group', 'KANDIDAAT'],               // claim has an extra word
    ['Acme Trading Group Holdings Ltd', 'KANDIDAAT'],
    ['Acme', 'GEEN_TREFFER_IN_LIJST'],                 // documented limit: a short single word (under 5 letters) is not flagged
    ['Alrosa', 'TREFFER'],                             // real case: the list says "PJSC Alrosa" (legal form in front)
    ['JSC Alrosa Ltd', 'TREFFER'],
    ['Alrosa Trading', 'KANDIDAAT'],                   // the listed name is one rare word, the claim adds a word
    ['Zvezda', 'KANDIDAAT'],
    ['Mahmoud Trading', 'GEEN_TREFFER_IN_LIJST'],      // a single listed PERSON word must not flag claims that merely contain it                         // single rare word inside a longer listed name
    ['Company', 'GEEN_TREFFER_IN_LIJST'],              // single common word (30 entries) is not flagged
    ['Filler', 'GEEN_TREFFER_IN_LIJST'],
    ['Mohamed Al-Hasan Refinng', 'KANDIDAAT'],         // two typos in a long name
    ['Northern Metal Works', 'TREFFER'],
    ['Completely Different Holdings', 'GEEN_TREFFER_IN_LIJST'],
  ];
  for (const [v, want] of cases) it(`${v} -> ${want}`, () => assert.equal(first(run(r, [ent(v)])).uitkomst, want));
  it('countries: code on list is a hit, other code is no hit, case-insensitive', () => {
    const rep = run(r, [{ id: 'a', type: 'country', value: 'IQ' }, { id: 'b', type: 'country', value: 'nl' }, { id: 'c', type: 'country', value: 'cd' }]);
    assert.deepEqual(rep.resultaten.map((x) => x.uitkomst), ['TREFFER', 'GEEN_TREFFER_IN_LIJST', 'TREFFER']);
  });
  it('a no-hit names list, version and date', () => {
    const rep = run(r, [ent('Completely Different Holdings')]);
    const b = rep.bronnen.find((x) => x.bron === 'eu-fsf');
    assert.ok(b.bruikbaar && b.asOf && b.list_sha256 && b.entryCount === ENTITIES.length);
  });
  it('duplicate ids in the list make it unusable (ONMEETBAAR), never a quiet pick of one of them', () => {
    const rr = root(); writeSnapshot(rr, 'eu-fsf', [...ENTITIES, ...ENTITIES], K.priv);
    const r = first(run(rr, [ent('Acme Trading')]));
    assert.equal(r.uitkomst, 'ONMEETBAAR');
    assert.equal(r.per_bron[0].reden, 'regel_dubbel');
  });
});

describe('fail-closed: a broken list never gives GEEN_TREFFER (claim is NOT on the list)', () => {
  const claim = [ent('Completely Different Holdings')];
  const bad = (name, o, prep) => it(name, () => {
    const rr = root();
    writeSnapshot(rr, 'eu-fsf', ENTITIES, K.priv, o);
    if (prep) prep(join(rr, 'eu-fsf'));
    const res = first(run(rr, claim));
    assert.equal(res.uitkomst, 'ONMEETBAAR', JSON.stringify(res));
  });
  bad('one line removed after signing (hash)', { after: (d) => { const l = JSON.parse(readFileSync(join(d, 'list.json'))); l.entries.pop(); writeFileSync(join(d, 'list.json'), JSON.stringify(l)); } });
  bad('list truncated', { after: (d) => truncateSync(join(d, 'list.json'), 40) });
  bad('one name changed after signing, same count (hash)', { after: (d) => { const l = JSON.parse(readFileSync(join(d, 'list.json'))); l.entries[0].names[0] = 'Evil Name'; writeFileSync(join(d, 'list.json'), JSON.stringify(l)); } });
  bad('two entries swapped after signing (hash)', { after: (d) => { const l = JSON.parse(readFileSync(join(d, 'list.json'))); [l.entries[0], l.entries[1]] = [l.entries[1], l.entries[0]]; writeFileSync(join(d, 'list.json'), JSON.stringify(l)); } });
  bad('one entry added after signing (hash)', { after: (d) => { const l = JSON.parse(readFileSync(join(d, 'list.json'))); l.entries.push({ id: 'X', names: ['Extra Name Here'] }); writeFileSync(join(d, 'list.json'), JSON.stringify(l)); } });
  bad('another source files copied into this directory', {}, (d) => { const o = join(d, '..', 'other'); writeSnapshot(join(d, '..'), 'other', COUNTRIES, K.priv, { manifest: { minEntries: 1 } }); for (const f of ['manifest.json', 'manifest.sig', 'list.json']) writeFileSync(join(d, f), readFileSync(join(o, f))); });
  bad('list emptied', { listBytes: Buffer.from('{"entries":[]}') });
  bad('list replaced and manifest re-hashed but not re-signed', { after: (d) => { const l = Buffer.from(JSON.stringify({ entries: ENTITIES.slice(0, 10) })); writeFileSync(join(d, 'list.json'), l); const m = JSON.parse(readFileSync(join(d, 'manifest.json'))); m.sha256 = sha256Hex(l); m.entryCount = 10; writeFileSync(join(d, 'manifest.json'), JSON.stringify(m)); } });
  bad('signed by another key', { key: OTHER.priv });
  bad('signed entryCount lies', { manifest: { entryCount: ENTITIES.length + 1 } });
  bad('minEntries above real count (signed)', { manifest: { minEntries: 1000 } });
  bad('empty list signed with entryCount 0', { listBytes: Buffer.from('{"entries":[]}'), manifest: { entryCount: 0, minEntries: 1, sha256: sha256Hex(Buffer.from('{"entries":[]}')) } });
  bad('stale (30 days)', { manifest: { fetchedAt: '2026-10-07T10:00:00Z', asOf: '2026-10-07' } });
  bad('fetched 12 days ago while the list date is recent (only the fetch age differs)', { manifest: { fetchedAt: '2026-10-25T10:00:00Z', asOf: '2026-10-25' } });
  bad('list itself is old although fetched fresh (asOf 66 days ago)', { manifest: { asOf: '2026-09-01' } });
  bad('fetched in the future', { manifest: { fetchedAt: '2026-11-08T10:00:00Z' } });
  bad('asOf far after fetchedAt', { manifest: { asOf: '2026-11-20' } });
  bad('manifest missing', { skip: 'manifest.json' });
  bad('signature missing', { skip: 'manifest.sig' });
  bad('list missing', { skip: 'list.json' });
  bad('manifest names another source', { manifest: { source: 'cahras' } });
  bad('extra unknown manifest field (signed)', { manifest: { extra: 1 } });
  bad('manifest is garbage', {}, (d) => writeFileSync(join(d, 'manifest.json'), '{nope'));
  bad('list is garbage', { after: (d) => writeFileSync(join(d, 'list.json'), 'garbage') });
  bad('signature is garbage', {}, (d) => writeFileSync(join(d, 'manifest.sig'), '!!!'));
  bad('bad sha256 shape (signed)', { manifest: { sha256: 'zz' } });
  bad('entry with wrong shape (signed and hashed)', { listBytes: Buffer.from(JSON.stringify({ entries: Array(6).fill({ id: 1, names: 'x' }) })), manifest: { entryCount: 6, sha256: sha256Hex(Buffer.from(JSON.stringify({ entries: Array(6).fill({ id: 1, names: 'x' }) }))) } });
  bad('entry with an unknown soort (signed and hashed)', { listBytes: Buffer.from(JSON.stringify({ entries: Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, names: ['Name Here'], soort: 'bogus' })) })), manifest: { entryCount: 6, sha256: sha256Hex(Buffer.from(JSON.stringify({ entries: Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, names: ['Name Here'], soort: 'bogus' })) }))) } });
  it('whole source directory missing', () => assert.equal(first(run(root(), [ent('Completely Different Holdings')])).uitkomst, 'ONMEETBAAR'));
  it('wrong public key', () => assert.equal(first(runCheck({ claims: [ent('x y z')], snapshotDir: healthy(), pubKeyPem: OTHER.pub, now: NOW })).uitkomst, 'ONMEETBAAR'));
  it('public key is not ed25519 / garbage', () => assert.equal(first(runCheck({ claims: [ent('x y z')], snapshotDir: healthy(), pubKeyPem: 'garbage', now: NOW })).uitkomst, 'ONMEETBAAR'));
  it('a broken list still reveals a real hit elsewhere (worst outcome wins)', () => {
    const rr = root(); writeSnapshot(rr, 'eu-fsf', ENTITIES, K.priv); writeSnapshot(rr, 'un-test', ENTITIES, K.priv, { skip: 'list.json' });
    const rep = run(rr, [ent('Acme Trading')], { required: { entity: ['eu-fsf', 'un-test'], country: ['cahras'] } });
    assert.equal(first(rep).uitkomst, 'TREFFER');
    const rep2 = run(rr, [ent('Completely Different Holdings')], { required: { entity: ['eu-fsf', 'un-test'], country: ['cahras'] } });
    assert.equal(first(rep2).uitkomst, 'ONMEETBAAR');
  });
});

describe('claims: weird input is ONMEETBAAR, never a green', () => {
  const r = healthy();
  const weird = [
    ['empty', ent('')], ['whitespace', ent('   ')], ['control char', ent('Acme\u0000Trading')], ['201 chars', ent('a'.repeat(201))],
    ['too short', ent('ab')], ['arabic', ent('شركة الشمال للمعادن')], ['cyrillic', ent('Северный Металл')], ['mixed script', ent('Acme Trading شركة')],
    ['fullwidth digits only odd', ent('１２')], ['unknown type', { id: 'x', type: 'person', value: 'Acme' }], ['extra key', { id: 'x', type: 'entity', value: 'Acme Trading', note: 1 }],
    ['non-string value', { id: 'x', type: 'entity', value: 5 }], ['bad id', { id: 'a b', type: 'entity', value: 'Acme Trading' }], ['null claim', null],
    ['country name instead of code', { id: 'x', type: 'country', value: 'Iraq' }], ['unknown code', { id: 'x', type: 'country', value: 'ZZ' }],
  ];
  for (const [n, c] of weird) it(n, () => assert.equal(first(run(r, [c])).uitkomst, 'ONMEETBAAR'));
  it('duplicate id: second is ONMEETBAAR', () => assert.equal(run(r, [ent('Acme Trading', 'd'), ent('Acme Trading', 'd')]).resultaten[1].uitkomst, 'ONMEETBAAR'));
  it('not an array / empty / too many throws', () => {
    for (const bad of [null, {}, [], Array(201).fill(ent('Acme Trading'))]) assert.throws(() => run(r, bad), InvalidInput);
  });
  it('prototype-pollution shaped input does not leak', () => {
    const evil = JSON.parse('{"id":"p","type":"entity","value":"Acme Trading","__proto__":{"x":1}}');
    run(r, [evil]); assert.equal({}.x, undefined);
  });
});

describe('report: signature, mandatory text, wording', () => {
  const r = healthy();
  const rep = run(r, [ent('Acme Trading'), ent('Completely Different Holdings', 'c2')]);
  const signed = signReport(rep, K.priv);
  it('round trip verifies', () => assert.equal(verifyReport(signed, K.pub).ok, true));
  it('changed verdict fails', () => { const t = structuredClone(signed); t.report.resultaten[0].uitkomst = 'GEEN_TREFFER_IN_LIJST'; assert.equal(verifyReport(t, K.pub).ok, false); });
  it('removed disclaimer fails', () => { const t = structuredClone(signed); delete t.report.disclaimer; assert.equal(verifyReport(t, K.pub).ok, false); });
  it('removed limit fails', () => { const t = structuredClone(signed); t.report.beperkingen.pop(); assert.equal(verifyReport(t, K.pub).ok, false); });
  it('signed by us but with another disclaimer fails', () => { const bad = structuredClone(rep); bad.disclaimer = 'Alles in orde.'; assert.equal(verifyReport(signReport(bad, K.priv), K.pub).ok, false); });
  it('signed by us but with another limits list fails', () => { const bad = structuredClone(rep); bad.beperkingen = []; assert.equal(verifyReport(signReport(bad, K.priv), K.pub).ok, false); });
  it('wrong key fails', () => assert.equal(verifyReport(signed, OTHER.pub).ok, false));
  it('signed but with an unknown outcome fails', () => { const bad = structuredClone(rep); bad.resultaten[0].uitkomst = 'SCHOON'; assert.equal(verifyReport(signReport(bad, K.priv), K.pub).ok, false); });
  it('garbage fails without throwing', () => { for (const g of [null, 5, {}, { report: 1, handtekening: 2 }]) assert.equal(verifyReport(g, K.pub).ok, false); });
  it('no assurance words anywhere in the report', () => assert.doesNotMatch(canonical(rep), /\b(schoon|clean|approved|goedgekeurd|gecertificeerd|certified|veilig|safe|verified)\b/i));
  it('input hash changes when a claim changes', () => assert.notEqual(rep.invoer_sha256, run(r, [ent('Acme Trading X')]).invoer_sha256));
});

describe('structure', () => {
  it('249 ISO codes', () => assert.equal(ISO_ALPHA2.size, 249));
  it('canonical ignores key order, rejects undefined and NaN', () => {
    assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
    assert.throws(() => canonical({ a: undefined })); assert.throws(() => canonical({ a: NaN }));
  });
  it('the checker has no network, process or eval access', () => {
    const dir = new URL('../src/', import.meta.url);
    for (const f of readdirSync(dir, { recursive: true }).filter((x) => x.endsWith('.mjs'))) {
      const src = readFileSync(new URL(f.replaceAll('\\', '/'), dir), 'utf8');
      assert.doesNotMatch(src, /node:(http|https|http2|net|tls|dns|dgram|child_process|worker_threads|vm)|\beval\s*\(|new Function|\bfetch\s*\(|\brequire\s*\(/, f);
    }
  });
  it('every required source id is a safe path segment', () => { for (const l of Object.values(REQUIRED).flat()) assert.match(l, /^[a-z0-9][a-z0-9-]{0,40}$/); });
});
