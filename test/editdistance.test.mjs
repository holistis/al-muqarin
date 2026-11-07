import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { editDistance } from '../src/check.mjs';
import { rng } from '../tools/zelfmeting-lib.mjs';

// Reference: full optimal-string-alignment matrix, no early exit.
function ref(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

describe('editDistance', () => {
  it('counts an adjacent swap as one edit, also late in the string', () => {
    assert.equal(editDistance('ab', 'ba', 1), 1);
    assert.equal(editDistance('kovalenko', 'kovalenok', 1), 1);
    assert.equal(editDistance('abcdefgh', 'abcdefhg', 1), 1);
  });
  it('is above max for clearly different strings', () => {
    assert.ok(editDistance('abc', 'xyz', 1) > 1);
    assert.ok(editDistance('abcdef', 'ghijkl', 2) > 2);
  });
  it('agrees with the full reference on 3000 random pairs for max 0, 1 and 2', () => {
    const r = rng(42);
    const word = () => Array.from({ length: 1 + Math.floor(r() * 9) }, () => 'abc'[Math.floor(r() * 3)]).join('');
    for (let i = 0; i < 3000; i++) {
      const a = word(), b = word();
      for (const max of [0, 1, 2]) assert.equal(Math.min(editDistance(a, b, max), max + 1), Math.min(ref(a, b), max + 1), `${a} ${b} ${max}`);
    }
  });
});
