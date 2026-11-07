// Silent misses found by the panel review (jurist, data scientist, attacker): invisible characters, spelled-out initials,
// split words, initials next to a surname, and a list that is mostly unreadable. Each one must be a hit or an honest ONMEETBAAR, never a green.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { MIN_DEKKING, runCheck } from '../src/check.mjs';
import { normalizeName } from '../src/normalize.mjs';
import { ENTITIES, NOW, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

const K = keypair();
const roots = [];
after(() => roots.forEach(cleanup));
const C = (code) => String.fromCharCode(code);
const ask = (root, value, type = 'entity') => runCheck({ claims: [{ id: 'c1', type, value }], snapshotDir: root, pubKeyPem: K.pub, now: NOW, required: { entity: ['eu-fsf'], country: ['cahras'] } }).resultaten[0].per_bron[0];

describe('normalizeName: invisible characters and spelled-out initials', () => {
  const tok = (s) => normalizeName(s).tokens;
  it('every invisible format character inside a word is dropped, not turned into a space', () => {
    for (const code of [0xad, 0x200b, 0x200c, 0x200d, 0x200e, 0x2060, 0xfeff]) assert.deepEqual(tok('Sber' + C(code) + 'bank'), ['sberbank'], code.toString(16));
  });
  it('runs of single letters are glued, with or without dots and spaces', () => {
    assert.deepEqual(tok('P.K.K.'), ['pkk']); assert.deepEqual(tok('P K K'), ['pkk']); assert.deepEqual(tok('J. R. R. Tolkien'), ['jrr', 'tolkien']);
  });
  it('a single initial stays alone and two-letter words are not glued', () => {
    assert.deepEqual(tok('A. Luzyanin'), ['a', 'luzyanin']); assert.deepEqual(tok('Li Wei'), ['li', 'wei']);
    assert.deepEqual(tok('Li Wu Chen'), ['li', 'wu', 'chen']);   // two-letter words side by side are real words (Chinese names), not initials
  });
  it('digits are not glued as initials', () => assert.deepEqual(tok('3 M 4'), ['3', 'm', '4']));
  it('"S.A." is the legal form SA after gluing and is stripped like the others', () => assert.deepEqual(tok('Foo S.A.'), ['foo']));
});

describe('matching: the panel cases on a healthy list', () => {
  const r = tmpRoot(); roots.push(r);
  writeSnapshot(r, 'eu-fsf', [...ENTITIES,
    { id: 'S1', names: ['Sberbank'], soort: 'onderneming' },
    { id: 'S3', names: ['PKK'], soort: 'onderneming' },
    { id: 'S4', names: ['Alexander LUZYANIN'], soort: 'persoon' },
    { id: 'S5', names: ['Ivan Ivanovich Petrovsky'], soort: 'persoon' },
    { id: 'S6', names: ['Wang Trading Holdings'], soort: 'onderneming' },
    { id: 'S7', names: ['Abcde'], soort: 'onderneming' },
    ...Array.from({ length: 26 }, (_, i) => ({ id: `J${i}`, names: [`Johnson Zq${i}x Partners`], soort: 'persoon' })),
  ], K.priv);
  it('the plain listed name is a TREFFER (baseline)', () => assert.equal(ask(r, 'Sberbank').uitkomst, 'TREFFER'));
  it('an invisible character in the middle of the name still gives a TREFFER', () => {
    for (const code of [0xad, 0x200b, 0x200d, 0x2060]) assert.equal(ask(r, 'Sber' + C(code) + 'bank').uitkomst, 'TREFFER', code.toString(16));
    assert.equal(ask(r, C(0xfeff) + 'Sberbank' + C(0x200b)).uitkomst, 'TREFFER');
  });
  it('a visible split ("Sber bank", "Sber.bank") is a KANDIDAAT with reason samenvoeging, never a TREFFER', () => {
    for (const v of ['Sber bank', 'Sber.bank', 'Sber-bank']) { const x = ask(r, v); assert.equal(x.uitkomst, 'KANDIDAAT', v); assert.equal(x.kandidaten[0].reden, 'samenvoeging', v); assert.equal(x.kandidaten[0].id, 'S1', v); }
  });
  it('a split that leaves fewer than 6 letters is not given the samenvoeging reason', () => {
    const x = ask(r, 'Abc de');   // joined: "abcde", five letters, the same as the listed "Abcde"
    assert.ok(!(x.kandidaten ?? []).some((k) => k.reden === 'samenvoeging'));
    assert.ok(x.kandidaten.some((k) => k.id === 'S7'));   // still found, by the typo rule, with another label
  });
  it('spelled-out initials match the acronym: "P.K.K." and "P K K" are a TREFFER', () => {
    for (const v of ['P.K.K.', 'P K K', 'p.k.k']) assert.equal(ask(r, v).uitkomst, 'TREFFER', v);
  });
  it('an initial next to a rare surname is a KANDIDAAT with reason initiaal', () => {
    for (const v of ['A. Luzyanin', 'A Luzyanin', 'Luzyanin A']) { const x = ask(r, v); assert.equal(x.uitkomst, 'KANDIDAAT', v); assert.equal(x.kandidaten[0].reden, 'initiaal', v); assert.equal(x.kandidaten[0].id, 'S4', v); }
  });
  it('an initial between two real words still matches the longer listed name', () => {
    const x = ask(r, 'Ivan P Petrovsky');
    assert.equal(x.uitkomst, 'KANDIDAAT'); assert.equal(x.kandidaten[0].reden, 'initiaal'); assert.equal(x.kandidaten[0].id, 'S5');
  });
  it('an initial next to a COMMON surname (more than 25 listed) is not flagged', () => assert.equal(ask(r, 'J. Johnson').uitkomst, 'GEEN_TREFFER_IN_LIJST'));
  it('an initial next to a very short word (under 5 letters) is not flagged', () => assert.equal(ask(r, 'J. Wang').uitkomst, 'GEEN_TREFFER_IN_LIJST'));
  it('an unrelated name with an initial stays clear', () => assert.equal(ask(r, 'J. Completely Different').uitkomst, 'GEEN_TREFFER_IN_LIJST'));
});

describe('coverage gate: a list we can mostly not read never answers "no match"', () => {
  const list = (readable, total = 20) => Array.from({ length: total }, (_, i) => ({ id: `Z${i}`, names: [i < readable ? `Readable Company Number ${i} Xq${i}z` : `Северный Металл ${i}`] }));
  const probe = (readable) => { const rr = tmpRoot(); roots.push(rr); writeSnapshot(rr, 'eu-fsf', list(readable), K.priv); return ask(rr, 'Completely Different Holdings'); };
  it('the minimum is 90 percent', () => assert.equal(MIN_DEKKING, 0.9));
  it('no readable names at all: ONMEETBAAR with the reason', () => { const x = probe(0); assert.equal(x.uitkomst, 'ONMEETBAAR'); assert.equal(x.reden, 'bron_te_veel_onleesbare_namen'); });
  it('85 percent readable: ONMEETBAAR', () => assert.equal(probe(17).uitkomst, 'ONMEETBAAR'));
  it('exactly 90 percent readable: allowed', () => assert.equal(probe(18).uitkomst, 'GEEN_TREFFER_IN_LIJST'));
  it('95 percent readable: allowed', () => assert.equal(probe(19).uitkomst, 'GEEN_TREFFER_IN_LIJST'));
  it('a party counts once however many of its names are unreadable', () => {
    const rr = tmpRoot(); roots.push(rr);
    writeSnapshot(rr, 'eu-fsf', Array.from({ length: 20 }, (_, i) => ({ id: `Y${i}`, names: [`Readable Company ${i} Xq${i}z`, 'Северный', 'Металл', 'Завод'] })), K.priv);
    assert.equal(ask(rr, 'Completely Different Holdings').uitkomst, 'GEEN_TREFFER_IN_LIJST');
  });
  it('a source that is not shipped at all says so, not "file missing or too large"', () => {
    const rr = tmpRoot(); roots.push(rr); writeSnapshot(rr, 'eu-fsf', ENTITIES, K.priv);
    assert.equal(ask(rr, 'IQ', 'country').reden, 'bron_niet_aanwezig');
  });
});
