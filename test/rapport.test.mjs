// The report must be consistent with itself. These are the lies found by the panel review (attacker, builder, jurist):
// reports that are correctly signed but say nonsense (empty results, a top outcome that contradicts its sources, a date in 2099).
import { createPrivateKey, sign } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { canonical } from '../src/canon.mjs';
import { keyId, runCheck, signReport, verifyReport } from '../src/check.mjs';
import { sha256Hex } from '../src/snapshot.mjs';
import { COUNTRIES, ENTITIES, NOW, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

const EU = { entity: ['eu-fsf'], country: ['cahras'] }; // the fixtures hold one entity list and the country list
const K = keypair(); const OTHER = keypair();
const root = tmpRoot();
after(() => cleanup(root));
writeSnapshot(root, 'eu-fsf', ENTITIES, K.priv);
writeSnapshot(root, 'cahras', COUNTRIES, K.priv, { manifest: { minEntries: 1 } });
const claims = [{ id: 'a', type: 'entity', value: 'Acme Trading' }, { id: 'b', type: 'entity', value: 'Completely Different Holdings' }, { id: 'c', type: 'country', value: 'NL' }, { id: 'd', type: 'entity', value: 'Acme Tradng' }];
const rep = runCheck({ claims, snapshotDir: root, pubKeyPem: K.pub, now: NOW, klok: 'opgegeven', required: EU });
const good = signReport(rep, K.priv);
// Signed correctly by our key, but the content is edited: the signature alone must not be enough.
const signRaw = (obj) => ({ report: obj, handtekening: sign(null, Buffer.from(canonical(obj)), createPrivateKey(K.priv)).toString('base64') });
const lie = (mutate) => { const r = structuredClone(good.report); mutate(r); return signRaw(r); };
const refuses = (name, mutate, reden) => it(`${name} -> ${reden}`, () => assert.deepEqual(verifyReport(lie(mutate), K.pub), { ok: false, reden }));

describe('report content', () => {
  it('has a summary with the worst outcome and the counts', () => {
    assert.deepEqual(good.report.samenvatting, { ergste: 'TREFFER', aantallen: { TREFFER: 1, KANDIDAAT: 1, ONMEETBAAR: 0, GEEN_TREFFER_IN_LIJST: 2 } });
  });
  it('every result carries the hash of its own claim, also an invalid one', () => {
    claims.forEach((c, i) => assert.equal(good.report.resultaten[i].claim_sha256, sha256Hex(Buffer.from(canonical(c)))));
    const bad = runCheck({ claims: [{ id: 'z' }], snapshotDir: root, pubKeyPem: K.pub, now: NOW, required: EU });
    assert.equal(bad.resultaten[0].claim_sha256, sha256Hex(Buffer.from(canonical({ id: 'z' }))));
  });
  it('records the clock as stated and the maximum age used; the machine clock is the default', () => {
    assert.equal(good.report.klok, 'opgegeven'); assert.equal(good.report.max_leeftijd_dagen, 8);
    assert.equal(runCheck({ claims, snapshotDir: root, pubKeyPem: K.pub, now: NOW, maxAgeDays: 5, required: EU }).max_leeftijd_dagen, 5);
    assert.equal(runCheck({ claims, snapshotDir: root, pubKeyPem: K.pub, now: NOW, required: EU }).klok, 'systeem');
  });
  it('has a plain sentence per outcome that names the list and date, and never says clean or safe', () => {
    const [treffer, geen, , kandidaat] = good.report.resultaten.map((r) => r.toelichting);
    assert.match(geen, /Niet gevonden in eu-fsf van 2026-11-05/); assert.match(geen, /eigenaren/);
    assert.match(treffer, /niet gecontroleerd/); assert.match(kandidaat, /Vergelijk zelf/);
    const onm = runCheck({ claims, snapshotDir: root, pubKeyPem: K.pub, now: new Date('2027-06-01T00:00:00Z'), required: EU }).resultaten[0].toelichting;
    assert.match(onm, /Niet gemeten/); assert.match(onm, /geen groen/);
    for (const t of [treffer, geen, kandidaat, onm]) assert.ok(!/schoon|veilig|clean|safe/i.test(t), t);
  });
  it('the report is signed with a key id that matches the public key', () => assert.equal(good.report.sleutel_id, keyId(K.pub)));
  it('the key id differs per key and is 32 hex characters', () => { assert.match(keyId(K.pub), /^[0-9a-f]{32}$/); assert.notEqual(keyId(K.pub), keyId(OTHER.pub)); });
});

describe('verify: a correct signature is not enough', () => {
  it('the honest report verifies and reports key, clock and that the claims were not checked', () => {
    assert.deepEqual(verifyReport(good, K.pub), { ok: true, sleutel_id: keyId(K.pub), klok: 'opgegeven', gemaakt: NOW.toISOString(), claims_gecontroleerd: false });
  });
  refuses('empty results', (r) => { r.resultaten = []; r.samenvatting = { ergste: 'GEEN_TREFFER_IN_LIJST', aantallen: { TREFFER: 0, KANDIDAAT: 0, ONMEETBAAR: 0, GEEN_TREFFER_IN_LIJST: 0 } }; }, 'resultaten_aantal');
  refuses('a top outcome that contradicts its source', (r) => { r.resultaten[0].uitkomst = 'GEEN_TREFFER_IN_LIJST'; }, 'uitkomst_strijdig_met_bron');
  refuses('a source outcome that is not one of the four', (r) => { r.resultaten[0].per_bron[0].uitkomst = 'SCHOON'; }, 'resultaat_vorm');
  refuses('a result without sources', (r) => { delete r.resultaten[0].per_bron; }, 'resultaat_vorm');
  refuses('a result without an id', (r) => { delete r.resultaten[0].id; }, 'resultaat_vorm');
  refuses('a GEEN_TREFFER result that names no source at all (green from nothing)', (r) => { r.resultaten[1].per_bron = []; }, 'resultaat_vorm');
  refuses('a summary that does not match the results', (r) => { r.samenvatting.ergste = 'GEEN_TREFFER_IN_LIJST'; }, 'samenvatting_klopt_niet');
  refuses('counts that do not match the results', (r) => { r.samenvatting.aantallen.TREFFER = 0; }, 'samenvatting_klopt_niet');
  refuses('no summary at all', (r) => { delete r.samenvatting; }, 'samenvatting_klopt_niet');
  refuses('a date in 2099', (r) => { r.gemaakt = '2099-01-01T00:00:00.000Z'; }, 'datum_buiten_bereik');
  refuses('a date that is not an ISO date', (r) => { r.gemaakt = 'gisteren'; }, 'datum');
  refuses('a date in a loose format', (r) => { r.gemaakt = '2026-11-06'; }, 'datum');
  refuses('a made-up schema number', (r) => { r.schema = 42; }, 'schema');
  refuses('a missing version', (r) => { delete r.versie; }, 'schema');
  refuses('an unknown clock', (r) => { r.klok = 'nu'; }, 'klok');
  refuses('a missing clock', (r) => { delete r.klok; }, 'klok');
  refuses('a maximum age of zero', (r) => { r.max_leeftijd_dagen = 0; }, 'bronnen');
  refuses('a maximum age above 60 days', (r) => { r.max_leeftijd_dagen = 61; }, 'bronnen');
  refuses('a maximum age as text', (r) => { r.max_leeftijd_dagen = '8'; }, 'bronnen');
  refuses('sources that are not a list', (r) => { r.bronnen = 'eu-fsf'; }, 'bronnen');
  refuses('a list fetched after the report was made', (r) => { r.bronnen[0].fetchedAt = '2026-12-01T00:00:00Z'; }, 'datum_buiten_bereik');
  refuses('a list fetched longer ago than the stated maximum age', (r) => { r.bronnen[0].fetchedAt = '2026-09-01T00:00:00Z'; }, 'datum_buiten_bereik');
  refuses('a list with an unreadable fetch date', (r) => { r.bronnen[0].fetchedAt = 'ooit'; }, 'datum_buiten_bereik');
  it('a wrong key id with a valid signature is refused', () => {
    const forged = structuredClone(good.report); forged.sleutel_id = '0'.repeat(32);
    assert.deepEqual(verifyReport(signRaw(forged), K.pub), { ok: false, reden: 'sleutel_id_klopt_niet' });
    delete forged.sleutel_id; assert.equal(verifyReport(signRaw(forged), K.pub).ok, false);
  });
  it('a report signed by another key is refused, also with its own public key shown as ours', () => {
    assert.equal(verifyReport(signReport(rep, OTHER.priv), K.pub).ok, false);
    assert.equal(verifyReport(signReport(rep, OTHER.priv), OTHER.pub).ok, true);   // the signature alone proves only which key was used: that is what the key id is for
  });
  it('an unusable source is allowed (the outcome is then ONMEETBAAR) and does not break the date check', () => {
    const r = runCheck({ claims, snapshotDir: root, pubKeyPem: K.pub, now: new Date('2027-06-01T00:00:00Z'), required: EU });
    assert.ok(r.bronnen.some((b) => !b.bruikbaar));
    assert.equal(verifyReport(signReport(r, K.priv), K.pub).ok, true);
  });
  it('--expect: the right id passes, another is refused', () => {
    assert.equal(verifyReport(good, K.pub, { expect: keyId(K.pub) }).ok, true);
    assert.deepEqual(verifyReport(good, K.pub, { expect: '0'.repeat(32) }), { ok: false, reden: 'sleutel_id_niet_verwacht' });
  });
});

describe('verify with the claims: the report is about exactly these claims', () => {
  const v = (cl) => verifyReport(good, K.pub, { claims: cl });
  it('the same claims pass and the answer says they were checked', () => assert.deepEqual(v(claims), { ok: true, sleutel_id: keyId(K.pub), klok: 'opgegeven', gemaakt: NOW.toISOString(), claims_gecontroleerd: true }));
  it('one changed value fails', () => assert.deepEqual(v(claims.map((c, i) => (i === 1 ? { ...c, value: 'Siemens' } : c))), { ok: false, reden: 'claims_komen_niet_overeen' }));
  it('a missing claim fails', () => assert.equal(v(claims.slice(1)).ok, false));
  it('an extra claim fails', () => assert.equal(v([...claims, { id: 'e', type: 'country', value: 'DE' }]).ok, false));
  it('the same claims in another order fail', () => assert.equal(v([claims[1], claims[0], claims[2], claims[3]]).ok, false));
  it('something that is not a list fails without throwing', () => { for (const x of [null, 5, {}, 'a']) assert.equal(v(x).ok, false); });
  it('a report whose own claim hash was edited fails', () => {
    const r = structuredClone(good.report); r.resultaten[1].claim_sha256 = '0'.repeat(64);
    assert.equal(verifyReport(signRaw(r), K.pub, { claims }).ok, false);
  });
  it('a report whose input hash was edited fails', () => {
    const r = structuredClone(good.report); r.invoer_sha256 = '0'.repeat(64);
    assert.equal(verifyReport(signRaw(r), K.pub, { claims }).ok, false);
  });
});
