// Random and metamorphic tests. The planted-fault matrix only finds holes the tests already know about; these look for new ones.
// Everything is seeded, so a failure repeats and can be reduced to a test of its own.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { OUTCOMES, runCheck, signReport, verifyReport } from '../src/check.mjs';
import { ENTITIES, NOW, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

const root = tmpRoot();
after(() => cleanup(root));
const K = keypair();
writeSnapshot(root, 'eu-fsf', ENTITIES, K.priv);
const check = (claims) => runCheck({ claims, snapshotDir: root, pubKeyPem: K.pub, now: NOW });

function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SEGMENTS = [
  [0x20, 0x7e, 8], [0xa0, 0x24f, 3], [0x400, 0x4ff, 2], [0x600, 0x6ff, 2], [0x4e00, 0x4fff, 1], [0x300, 0x36f, 1],
  [0x1f300, 0x1f5ff, 1], [0x00, 0x1f, 1], [0xd800, 0xdfff, 1], [0x200b, 0x200f, 1], [0xfeff, 0xfeff, 1], [0xad, 0xad, 1],
];
function randomString(rnd) {
  const total = SEGMENTS.reduce((s, x) => s + x[2], 0);
  const len = Math.floor(rnd() * rnd() * 260);
  let out = '';
  for (let i = 0; i < len; i++) {
    let pick = rnd() * total, seg = SEGMENTS[0];
    for (const s of SEGMENTS) { pick -= s[2]; if (pick <= 0) { seg = s; break; } }
    const cp = seg[0] + Math.floor(rnd() * (seg[1] - seg[0] + 1));
    out += cp > 0xffff ? String.fromCodePoint(cp) : String.fromCharCode(cp);
  }
  return out;
}

describe('willekeurige invoer', () => {
  it('2400 random strings (all scripts, control, invisible and broken surrogate characters, up to 260 long) never crash and always give one of the four outcomes', () => {
    const rnd = prng(20261107);
    for (let batch = 0; batch < 12; batch++) {
      const claims = Array.from({ length: 200 }, (_, i) => ({ id: `r${batch}-${i}`, type: 'entity', value: randomString(rnd) }));
      const rep = check(claims);
      assert.equal(rep.resultaten.length, 200);
      for (const r of rep.resultaten) assert.ok(OUTCOMES.includes(r.uitkomst), r.uitkomst);
      const signed = signReport(rep, K.priv);
      assert.equal(verifyReport(JSON.parse(JSON.stringify(signed)), K.pub, { claims }).ok, true, 'a report about random text still verifies');
    }
  });
  it('random JSON that is not a claim is refused per claim as ONMEETBAAR, never thrown', () => {
    const rnd = prng(7);
    const pool = [null, 1, 'x', [], {}, { id: 1 }, { id: 'a' }, { id: 'a', type: 'entity' }, { id: 'a', type: 'entity', value: 5 }, { id: 'a', type: 'entity', value: 'x', extra: 1 }, { id: '', type: 'entity', value: 'x' }, { id: 'a b', type: 'entity', value: 'x' }, { id: 'a', type: 'entity', value: 'x', birthYear: '1980' }, { id: 'a', type: 'country', value: 'XX' }, { id: 'a', type: 'entity', value: 'x'.repeat(201) }, { id: '__proto__', type: 'entity', value: 'x' }];
    for (let round = 0; round < 40; round++) {
      const claims = Array.from({ length: 1 + Math.floor(rnd() * 10) }, () => pool[Math.floor(rnd() * pool.length)]);
      const rep = check(claims);
      assert.equal(rep.resultaten.length, claims.length);
      for (const r of rep.resultaten) assert.ok(OUTCOMES.includes(r.uitkomst));
    }
  });
  it('the same claims give the same answers twice, and in any order', () => {
    const rnd = prng(99);
    const claims = Array.from({ length: 60 }, (_, i) => ({ id: `d${i}`, type: 'entity', value: i % 3 ? randomString(rnd) : ENTITIES[i % ENTITIES.length].names[0] }));
    const a = check(claims), b = check(claims);
    const kern = (rep) => rep.resultaten.map((r) => [r.id, r.uitkomst, r.claim_sha256]);
    assert.deepEqual(kern(a), kern(b));
    const omgekeerd = check([...claims].reverse());
    const per = (rep) => Object.fromEntries(rep.resultaten.map((r) => [r.id, r.uitkomst]));
    assert.deepEqual(per(omgekeerd), per(a));
  });
  it('unrelated random words are never an exact hit', () => {
    const rnd = prng(31);
    const woord = () => Array.from({ length: 5 + Math.floor(rnd() * 8) }, () => String.fromCharCode(97 + Math.floor(rnd() * 26))).join('');
    const claims = Array.from({ length: 200 }, (_, i) => ({ id: `w${i}`, type: 'entity', value: `${woord()} ${woord()} ${woord()}` }));
    const rep = check(claims);
    assert.equal(rep.resultaten.filter((r) => r.uitkomst === 'TREFFER').length, 0);
  });
});

describe('metamorfe proef: dezelfde naam anders opgeschreven moet gevonden blijven', () => {
  const namen = ENTITIES.flatMap((e) => e.names).filter((n) => /^[\x20-\x7e]+$/.test(n) && n.length >= 8);
  const ZW = ['​', '‌', '‍', '⁠', '﻿', '­'];
  const variants = (n, rnd) => {
    const pos = 1 + Math.floor(rnd() * (n.length - 2));
    const zw = ZW[Math.floor(rnd() * ZW.length)];
    return {
      hoofdletters: n.toUpperCase(), kleine_letters: n.toLowerCase(),
      onzichtbaar_midden: n.slice(0, pos) + zw + n.slice(pos),
      onzichtbaar_begin_en_eind: zw + n + zw,
      dubbele_spaties: n.replace(/ /g, '   '),
      accenten: n.replace(/e/g, 'é').replace(/a/g, 'á').replace(/u/g, 'ü'),
      komma_en_punt: n.replace(/ /g, ', ') + '.',
    };
  };
  it('upper and lower case, invisible characters, extra spaces, accents and punctuation never turn a listed name into a miss', () => {
    assert.ok(namen.length >= 30, `only ${namen.length} test names`);
    const rnd = prng(424242);
    const fouten = [];
    for (const n of namen) {
      for (const [soort, v] of Object.entries(variants(n, rnd))) {
        const r = check([{ id: 'm', type: 'entity', value: v }]).resultaten[0];
        if (r.uitkomst !== 'TREFFER' && r.uitkomst !== 'KANDIDAAT') fouten.push(`${soort}: ${JSON.stringify(v)} (${n}) gaf ${r.uitkomst}`);
      }
    }
    assert.deepEqual(fouten, []);
  });
  it('the same name with one letter dropped (at least 8 letters long) is still a candidate', () => {
    const rnd = prng(5);
    const fouten = [];
    for (const n of namen) {
      const i = 1 + Math.floor(rnd() * (n.length - 2));
      const v = n.slice(0, i) + n.slice(i + 1);
      const r = check([{ id: 'm', type: 'entity', value: v }]).resultaten[0];
      if (r.uitkomst === 'GEEN_TREFFER_IN_LIJST' || r.uitkomst === 'ONMEETBAAR') fouten.push(`${JSON.stringify(v)} (${n}) gaf ${r.uitkomst}`);
    }
    assert.deepEqual(fouten, []);
  });
});
