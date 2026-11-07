import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEuFsf } from '../src/adapters/eu-fsf.mjs';

const wrap = (body, gen = '<export generationDate="2026-10-23T17:05:43.888+02:00">') => `<?xml version="1.0"?>${gen}${body}</export>`;
const ent = (attrs, names) => `<sanctionEntity ${attrs}>${names.map((n) => `<nameAlias firstName="" wholeName="${n}" logicalId="1"/>`).join('')}</sanctionEntity>`;

describe('eu-fsf adapter', () => {
  it('parses ids, names, date', () => {
    const r = parseEuFsf(wrap(ent('euReferenceNumber="EU.1.1" logicalId="9"', ['Alpha Corp', 'Alfa Korp']) + ent('euReferenceNumber="" logicalId="77"', ['Beta'])));
    assert.equal(r.asOf, '2026-10-23');
    assert.deepEqual(r.entries, [{ id: 'EU.1.1', names: ['Alpha Corp', 'Alfa Korp'], soort: 'onbekend' }, { id: '77', names: ['Beta'], soort: 'onbekend' }]);
  });
  it('reads the subject type: person, enterprise, unknown', () => {
    const e = (c) => `<sanctionEntity logicalId="${c}"><nameAlias wholeName="N${c}"/><subjectType code="x" classificationCode="${c}"/></sanctionEntity>`;
    assert.deepEqual(parseEuFsf(wrap(e('P') + e('E') + e('Q'))).entries.map((x) => x.soort), ['persoon', 'onderneming', 'onbekend']);
  });
  it('decodes xml entities and numeric references', () => {
    const r = parseEuFsf(wrap(ent('logicalId="1"', ['A &amp; B &lt;X&gt; &#233; &#x41;'])));
    assert.equal(r.entries[0].names[0], 'A & B <X> é A');
  });
  it('drops empty and duplicate names', () => {
    const r = parseEuFsf(wrap(ent('logicalId="1"', ['Same', 'Same', '  ', ''])));
    assert.deepEqual(r.entries[0].names, ['Same']);
  });
  it('throws when generationDate is missing', () => assert.throws(() => parseEuFsf(wrap(ent('logicalId="1"', ['A']), '<export>'))));
  it('throws when an entity has no id', () => assert.throws(() => parseEuFsf(wrap(ent('euReferenceNumber=""', ['A'])))));
  it('throws when an entity is cut off (opening tag without closing)', () => {
    assert.throws(() => parseEuFsf(wrap(ent('logicalId="1"', ['A']) + '<sanctionEntity logicalId="2"><nameAlias wholeName="B"/>')), /niet gesloten/);
  });
  it('an empty export yields zero entries (the feeder must reject that by its floor)', () => assert.equal(parseEuFsf(wrap('')).entries.length, 0));
});
