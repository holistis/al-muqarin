// Transliteration fold: spelling variants of the same name become a KANDIDAAT (never a TREFFER), short or unrelated names do not.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { runCheck } from '../src/check.mjs';
import { foldKey, foldToken, foldTolerance } from '../src/normalize.mjs';
import { ENTITIES, NOW, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

const K = keypair();
const roots = [];
after(() => roots.forEach(cleanup));

describe('foldToken: each rule folds its variants together', () => {
  const same = [
    ['tschernenko', 'chernenko'], ['czerny', 'cerny'], ['khrushchev', 'khrushtchev'], ['khrushchev', 'khrusev'], ['schtschukin', 'shchukin'],
    ['schmidt', 'shmidt'], ['sjostrom', 'sostrom'], ['zhukov', 'zjukov'], ['khalid', 'halid'], ['chernenko', 'cernenko'],
    ['joseph', 'josef'], ['thomas', 'tomas'], ['abdhul', 'abdul'], ['ghani', 'gani'], ['nick', 'nik'], ['alexander', 'aleksander'],
    ['qasim', 'kasim'], ['wladimir', 'vladimir'], ['yuri', 'iuri'], ['nikolay', 'nikolaj'], ['mouhamed', 'muhamed'], ['moohamed', 'muhamed'],
    ['mohammed', 'mohamed'], ['borissoff', 'borisov'], ['borisow', 'borisov'], ['vyacheslav', 'vjatjeslav'], ['vyacheslav', 'wjatscheslaw'],
  ];
  for (const [a, b] of same) it(`${a} = ${b}`, () => assert.equal(foldToken(a), foldToken(b)));
  const different = [['hasan', 'husan'], ['ivan', 'ivanov'], ['peter', 'pedro'], ['ali', 'omar'], ['karim', 'kerim']];
  for (const [a, b] of different) it(`${a} != ${b}`, () => assert.notEqual(foldToken(a), foldToken(b)));
  it('foldKey sorts the words, so word order does not matter', () => assert.equal(foldKey(['ivan', 'wladimir']), foldKey(['vladimir', 'ivan'])));
  it('tolerance grows with the length of the name and is 0 for short names', () => {
    assert.deepEqual([7, 8, 15, 16, 25, 26].map(foldTolerance), [0, 1, 1, 2, 2, 3]);
  });
});

describe('matching through the fold', () => {
  const r = tmpRoot(); roots.push(r);
  writeSnapshot(r, 'eu-fsf', [...ENTITIES,
    { id: 'R1', names: ['Vyacheslav Mikhailovich MARKHAYEV'], soort: 'persoon' },
    { id: 'R2', names: ['Tschabdul'], soort: 'onderneming' },
    { id: 'R3', names: ['Qu Ki'], soort: 'onderneming' }], K.priv);
  const ask = (value) => {
    const rep = runCheck({ claims: [{ id: 'c1', type: 'entity', value }], snapshotDir: r, pubKeyPem: K.pub, now: NOW, required: { entity: ['eu-fsf'], country: [] } });
    return rep.resultaten[0].per_bron[0];
  };
  it('German and Dutch spellings of a listed name give KANDIDAAT with reason transliteratie', () => {
    for (const v of ['Wjatscheslaw Michailowitsch Markajew', 'Vjatjeslav Michajlovitj Marchajev']) {
      const x = ask(v);
      assert.equal(x.uitkomst, 'KANDIDAAT', v);
      assert.equal(x.kandidaten[0].reden, 'transliteratie', v);
      assert.equal(x.kandidaten[0].id, 'R1', v);
    }
  });
  it('a plain typo keeps the reason typefout (the fold must not take over its label)', () => {
    const x = ask('Acme Tradng');
    assert.equal(x.uitkomst, 'KANDIDAAT');
    assert.equal(x.kandidaten[0].reden, 'typefout');
  });
  it('the exact listed spelling stays a TREFFER, never downgraded by the fold', () => {
    assert.equal(ask('Vyacheslav Mikhailovich MARKHAYEV').uitkomst, 'TREFFER');
  });
  it('a different person with the same patronymic and surname-ish words is no fold hit', () => {
    const x = ask('Mikhail Mikhailovich Markhayev');
    assert.ok(!(x.kandidaten ?? []).some((k) => k.reden === 'transliteratie'));
  });
  it('a folded key under 6 letters is never proposed', () => assert.equal(ask('Ku Ky').uitkomst, 'GEEN_TREFFER_IN_LIJST'));
  it('a one-letter fold difference in a short name (under 8) is not proposed', () => assert.equal(ask('Kabdul').uitkomst, 'GEEN_TREFFER_IN_LIJST'));
  it('a very different name is still no hit', () => assert.equal(ask('Completely Different Holdings').uitkomst, 'GEEN_TREFFER_IN_LIJST'));
});
