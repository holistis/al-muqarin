// Test de tester voor de meter zelf: een blinde matcher moet 0% scoren, een zichtbaar goede matcher hoog.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { collectHits, entityIndex } from '../src/check.mjs';
import { loadSnapshot } from '../src/snapshot.mjs';
import { measureFalseAlarms, measureLeaveOneOut, measureMutations, measureOnderscheid, measureTriage, rng } from '../tools/zelfmeting-lib.mjs';
import { ENTITIES, NOW, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

const K = keypair();
const root = tmpRoot();
after(() => cleanup(root));
const fx = [...ENTITIES, { id: 'M1', names: ['Alpha Beta Gamma', 'Alfa Beta Gamma Group'] }, { id: 'M2', names: ['Delta Omega Works', 'Delta Omega Werke'] }, { id: 'M3', names: ['PKK'] }];
writeSnapshot(root, 'eu-fsf', fx, K.priv);
const snap = loadSnapshot({ dir: root, source: 'eu-fsf', pubKeyPem: K.pub, now: NOW, maxAgeDays: 8 });
entityIndex(snap);
const blind = () => ({ hits: [] });

describe('self-measurement tool', () => {
  it('snapshot loads', () => assert.ok(snap.ok, snap.reason));
  it('a blind matcher scores 0% on every mutation', () => {
    const m = measureMutations({ snap, n: 30, collect: blind });
    for (const [name, s] of Object.entries(m)) assert.equal(s.gevonden, 0, name);
  });
  it('the real matcher finds spelling and legal-form variants 100% as exact', () => {
    const m = measureMutations({ snap, n: 30 });
    for (const k of ['schrijfwijze', 'juridisch']) { assert.equal(m[k].gevonden_pct, 100, k); assert.equal(m[k].exact_pct, 100, k); }
  });
  it('is deterministic for a seed and differs between seeds', () => {
    const a = JSON.stringify(measureMutations({ snap, n: 20, seed: 5 }));
    assert.equal(a, JSON.stringify(measureMutations({ snap, n: 20, seed: 5 })));
    const seq = (s) => { const r = rng(s); return [r(), r(), r()].join(); };
    assert.notEqual(seq(5), seq(6));   // the stats saturate at 100% on this tiny fixture, so compare the generator itself
  });
  it('leave-one-out: blind scores 0, real matcher finds the multi-alias entities', () => {
    assert.equal(measureLeaveOneOut({ snap, n: 10, collect: blind }).gevonden, 0);
    const real = measureLeaveOneOut({ snap, n: 10 });
    assert.ok(real.geprobeerd > 0 && real.gevonden_pct > 0);
  });
  it('false alarms: names from the list alarm, unrelated names do not', () => {
    assert.equal(measureFalseAlarms({ snap, names: ['Alpha Beta Gamma'] }).alarm_pct, 100);
    assert.equal(measureFalseAlarms({ snap, names: ['Completely Unrelated Bakery'] }).alarm_pct, 0);
    assert.equal(measureFalseAlarms({ snap, names: ['Alpha Beta Gamma'], collect: blind }).alarm_pct, 0);
  });
  it('a mutation that leaves the name unchanged is not counted', () => {
    const r2 = tmpRoot(); const up = Array.from({ length: 6 }, (_, i) => ({ id: 'U' + i, names: ['ABCDEFGH' + 'IJKLMN'[i]] }));
    writeSnapshot(r2, 'eu-fsf', up, K.priv);
    const s2 = loadSnapshot({ dir: r2, source: 'eu-fsf', pubKeyPem: K.pub, now: NOW, maxAgeDays: 8 }); entityIndex(s2);
    assert.equal(measureMutations({ snap: s2, n: 6 }).schrijfwijze.geprobeerd, 0);
    cleanup(r2);
  });
  it('rng is stable', () => { const r = rng(1); assert.equal(r(), rng(1)()); });

  // The classes the panel review found we were blind to. The meter must be able to see them, and to notice a matcher that regresses on them.
  const INV = new RegExp(`[${[0xad, 0x200b, 0x200d, 0x2060].map((c) => String.fromCharCode(c)).join('')}]`, 'g');
  it('the new classes are measured and the real matcher finds every one of them', () => {
    const m = measureMutations({ snap, n: 60 });
    for (const k of ['onzichtbaar', 'onzichtbaar_breed', 'initiaal', 'puntjes']) { assert.ok(m[k].geprobeerd >= 1, k); assert.equal(m[k].gevonden_pct, 100, k); }
    // Known honest limit: a symbol behind a very short name becomes an extra word, found like any added word but not always for names of a few letters.
    assert.ok(m.symbool.geprobeerd >= 30 && m.symbool.gevonden_pct >= 90, `symbool ${m.symbool.gevonden_pct}`);
    assert.ok(m.symbool.gemist_voorbeelden.every((x) => x.van.replace(/[^A-Za-z]/g, '').length <= 6), JSON.stringify(m.symbool.gemist_voorbeelden));
    // Known honest limit: a split that leaves fewer than 6 letters ("PK K") or ends in a legal form ("Alro sa") is not recognised.
    assert.ok(m.gesplitst.geprobeerd >= 30 && m.gesplitst.gevonden_pct >= 90, `gesplitst ${m.gesplitst.gevonden_pct}`);
    assert.ok(m.gesplitst.gemist_voorbeelden.every((x) => x.van === 'PKK' || x.van === 'PJSC Alrosa'), JSON.stringify(m.gesplitst.gemist_voorbeelden));
    assert.equal(m.onzichtbaar.exact_pct, 100);   // an invisible character is not part of the name: the answer is a TREFFER
    assert.equal(m.puntjes.exact_pct, 100);
  });
  it('a matcher that turns invisible characters into spaces (the old behaviour) is noticed by the meter', () => {
    const old = (v, s) => collectHits(v.replace(INV, ' '), s);
    assert.ok(measureMutations({ snap, n: 60, collect: old }).onzichtbaar.exact_pct < 100);
  });
  it('a matcher that turns the broader invisible characters and symbols into letters or spaces is noticed by the meter', () => {
    const BS = String.fromCharCode(92);
    const oud = (v, s) => collectHits(v.replace(new RegExp(BS + 'u2800|' + BS + 'u3164|' + BS + 'ufe0f', 'g'), ' ').replace(/[™℠№℡]/g, (c) => c.normalize('NFKD')), s);
    const m = measureMutations({ snap, n: 60, collect: oud });
    assert.ok(m.onzichtbaar_breed.exact_pct < 100 || m.onzichtbaar_breed.gevonden_pct < 100, 'broad invisible');
    assert.ok(m.symbool.gevonden_pct < 100, `symbool ${m.symbool.gevonden_pct}`);
  });
  it('a matcher that ignores splits and initials is noticed by the meter', () => {
    const deaf = (v, s) => { const r = collectHits(v, s); return { ...r, hits: r.hits.filter((h) => h.reden !== 'samenvoeging' && h.reden !== 'initiaal') }; };
    const m = measureMutations({ snap, n: 60, collect: deaf });
    assert.ok(m.gesplitst.gevonden_pct < 90 && m.initiaal.gevonden_pct < 100, `${m.gesplitst.gevonden_pct} ${m.initiaal.gevonden_pct}`);
  });
});

describe('self-measurement of the birth-year / country hint', () => {
  const r3 = tmpRoot();
  const people = [
    { id: 'Q1', names: ['Dmitri Volkov Orlov'], soort: 'persoon', jaren: [1960], landen: ['RU'] },
    { id: 'Q2', names: ['Karim Nasser Haddad'], soort: 'persoon', jaren: [1971, 1972], ongeveer: true, landen: ['SY'] },
    { id: 'Q3', names: ['Omar Yusuf Barakat'], soort: 'persoon', jaren: [1980] },
  ];
  // A company with a year must not be counted as a person in the safety measurement.
  writeSnapshot(r3, 'eu-fsf', [...ENTITIES, ...people, { id: 'Q9', names: ['Zeta Holdings Worldwide'], soort: 'onderneming', jaren: [1999] }], K.priv);
  const s3 = loadSnapshot({ dir: r3, source: 'eu-fsf', pubKeyPem: K.pub, now: NOW, maxAgeDays: 8 });
  entityIndex(s3);
  after(() => cleanup(r3));
  const liar = () => ({ jaar: 'wijkt_af', land: 'wijkt_af' });

  it('safety: with the true year and country no listed person is marked wijkt_af; a year one off is', () => {
    const m = measureOnderscheid({ snap: s3, n: 10 });
    assert.equal(m.personen_met_jaar_in_lijst, 3);
    assert.equal(m.geprobeerd, 3);
    assert.equal(m.jaar_afwijkend_terwijl_goed, 0);
    assert.equal(m.land_afwijkend_terwijl_goed, 0);
    assert.equal(m.een_jaar_ernaast_geprobeerd, 2);   // Q2 has an approximate date and two years: excluded
    assert.equal(m.een_jaar_ernaast_wijkt_af_pct, 100);
  });
  it('the meter notices a hint that talks real matches down (planted fault)', () => {
    const m = measureOnderscheid({ snap: s3, n: 10, hint: liar });
    assert.equal(m.jaar_afwijkend_terwijl_goed, 3);
    assert.equal(m.land_afwijkend_terwijl_goed, 3);
  });
  it('a blind matcher gives zero attempts, not a false pass', () => assert.equal(measureOnderscheid({ snap: s3, n: 10, collect: blind }).geprobeerd, 0));
  it('triage: a year nobody has strikes the alarm off, the right year does not, an unknown year never does', () => {
    const names = ['Dmitri Volkov Orlov', 'Completely Unrelated Bakery'];
    const off = measureTriage({ snap: s3, names, yearFor: () => 1930 });
    assert.deepEqual([off.alarmen, off.alle_hits_wijken_af, off.direct_weg_te_strepen_pct], [1, 1, 100]);
    const right = measureTriage({ snap: s3, names, yearFor: () => 1960 });
    assert.deepEqual([right.alarmen, right.alle_hits_wijken_af, right.minstens_een_niet_af], [1, 0, 1]);
    const company = measureTriage({ snap: s3, names: ['Acme Trading Company Ltd'], yearFor: () => 1930 });
    assert.deepEqual([company.alarmen, company.alle_hits_wijken_af], [1, 0]);
  });
  it('triage: the planted liar strikes off everything, a blind matcher has no alarms', () => {
    assert.equal(measureTriage({ snap: s3, names: ['Acme Trading Company Ltd'], hint: liar }).alle_hits_wijken_af, 1);
    assert.equal(measureTriage({ snap: s3, names: ['Dmitri Volkov Orlov'], collect: blind }).alarmen, 0);
  });
  it('triage: an alarm is struck off only when EVERY hit disagrees, not when one does', () => {
    const r4 = tmpRoot();
    writeSnapshot(r4, 'eu-fsf', [...ENTITIES,
      { id: 'W1', names: ['Ivan Zakharov'], soort: 'persoon', jaren: [1950] }, { id: 'W2', names: ['Ivan Zakharov'], soort: 'persoon', jaren: [1990] }], K.priv);
    const s4 = loadSnapshot({ dir: r4, source: 'eu-fsf', pubKeyPem: K.pub, now: NOW, maxAgeDays: 8 }); entityIndex(s4);
    const one = measureTriage({ snap: s4, names: ['Ivan Zakharov'], yearFor: () => 1990 });
    assert.deepEqual([one.alarmen, one.alle_hits_wijken_af, one.minstens_een_niet_af], [1, 0, 1]);
    const none = measureTriage({ snap: s4, names: ['Ivan Zakharov'], yearFor: () => 1930 });
    assert.deepEqual([none.alarmen, none.alle_hits_wijken_af], [1, 1]);
    cleanup(r4);
  });
  it('triage is deterministic for a seed', () => {
    const a = JSON.stringify(measureTriage({ snap: s3, names: ['Dmitri Volkov Orlov', 'Omar Yusuf Barakat'], seed: 3 }));
    assert.equal(a, JSON.stringify(measureTriage({ snap: s3, names: ['Dmitri Volkov Orlov', 'Omar Yusuf Barakat'], seed: 3 })));
  });
});
