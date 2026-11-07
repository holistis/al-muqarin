// Birth year and country: shown as a hint per candidate, validated strictly, and NEVER able to change an outcome.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { parseEuFsf } from '../src/adapters/eu-fsf.mjs';
import { LIMITS, onderscheid, runCheck, signReport, verifyReport } from '../src/check.mjs';
import { loadSnapshot } from '../src/snapshot.mjs';
import { ENTITIES, NOW, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

const K = keypair();
const roots = [];
const root = () => { const r = tmpRoot(); roots.push(r); return r; };
after(() => roots.forEach(cleanup));

const wrap = (body) => `<?xml version="1.0"?><export generationDate="2026-10-23T17:05:43.888+02:00">${body}</export>`;
const person = (inner) => `<sanctionEntity logicalId="1"><nameAlias wholeName="Test Persoon"/><subjectType code="person" classificationCode="P"/>${inner}</sanctionEntity>`;
const bd = (attrs) => `<birthdate circa="false" calendarType="GREGORIAN" ${attrs}/>`;

describe('adapter: birth years and countries', () => {
  it('collects sorted unique years, birth and citizenship countries, drops the unknown country 00', () => {
    const r = parseEuFsf(wrap(person(
      bd('year="1966" countryIso2Code="IQ"') + bd('year="1965" countryIso2Code="00"') + bd('year="1966" countryIso2Code="IQ"') +
      '<citizenship countryIso2Code="SY"/><citizenship countryIso2Code="00"/>')));
    assert.deepEqual(r.entries[0].jaren, [1965, 1966]);
    assert.deepEqual(r.entries[0].landen, ['IQ', 'SY']);
    assert.equal(r.entries[0].ongeveer, undefined);
  });
  it('marks an approximate date (circa) as ongeveer', () => {
    const r = parseEuFsf(wrap(person('<birthdate circa="true" calendarType="GREGORIAN" year="1950" countryIso2Code="IQ"/>')));
    assert.equal(r.entries[0].ongeveer, true);
  });
  it('a non-Gregorian year is never taken as is: the Gregorian date next to it is used, else no year', () => {
    const withDate = parseEuFsf(wrap(person('<birthdate circa="false" calendarType="ISLAMIC" birthdate="1982-04-19" year="1402" countryIso2Code="SA"/>')));
    assert.deepEqual(withDate.entries[0].jaren, [1982]);
    const without = parseEuFsf(wrap(person('<birthdate circa="false" calendarType="ISLAMIC" year="1343" countryIso2Code="IR"/>')));
    assert.equal(without.entries[0].jaren, undefined);
    assert.deepEqual(without.entries[0].landen, ['IR']);
    const noCalendar = parseEuFsf(wrap(person('<birthdate circa="false" year="1964"/>')));
    assert.equal(noCalendar.entries[0].jaren, undefined);
  });
  it('a birthdate without a usable year adds no year', () => {
    const r = parseEuFsf(wrap(person('<birthdate circa="false" year="" countryIso2Code="IQ"/><birthdate circa="false" countryIso2Code="IQ"/>')));
    assert.equal(r.entries[0].jaren, undefined);
    assert.deepEqual(r.entries[0].landen, ['IQ']);
  });
  it('an entity with no dates or countries gets no extra fields', () => {
    assert.deepEqual(Object.keys(parseEuFsf(wrap(person(''))).entries[0]).sort(), ['id', 'names', 'soort']);
  });
});

describe('snapshot validation of the new fields', () => {
  const load = (extra) => {
    const r = root(); writeSnapshot(r, 'eu-fsf', [...ENTITIES, { id: 'X1', names: ['Xx Yy Zz'], ...extra }], K.priv);
    return loadSnapshot({ dir: r, source: 'eu-fsf', pubKeyPem: K.pub, now: NOW, maxAgeDays: 8 });
  };
  it('accepts valid years, countries and ongeveer', () => assert.ok(load({ jaren: [1950, 1951], landen: ['IQ'], ongeveer: true }).ok));
  const bad = [
    ['years not an array', { jaren: 1950 }], ['year as text', { jaren: ['1950'] }], ['year not an integer', { jaren: [1950.5] }],
    ['year too early', { jaren: [1799] }], ['year too late', { jaren: [2201] }], ['too many years', { jaren: Array.from({ length: 51 }, (_, i) => 1900 + i) }],
    ['countries not an array', { landen: 'IQ' }], ['country lowercase', { landen: ['iq'] }], ['country too long', { landen: ['IRQ'] }],
    ['country not text', { landen: [5] }], ['too many countries', { landen: Array.from({ length: 101 }, () => 'IQ') }],
    ['country as nested array', { landen: [['IQ']] }], ['ongeveer not boolean', { ongeveer: 'ja' }],
  ];
  for (const [name, extra] of bad) it(`rejects: ${name}`, () => assert.equal(load(extra).reason, 'regel_vorm'));
});

describe('onderscheid(): the hint itself', () => {
  const e = { jaren: [1960, 1985], landen: ['RU', 'UA'] };
  it('year: matches any listed year, differs otherwise, unknown when the list has none', () => {
    assert.equal(onderscheid(e, { birthYear: 1985 }).jaar, 'komt_overeen');
    assert.equal(onderscheid(e, { birthYear: 1970 }).jaar, 'wijkt_af');
    assert.equal(onderscheid({}, { birthYear: 1970 }).jaar, 'onbekend');
    assert.equal(onderscheid(undefined, { birthYear: 1970 }).jaar, 'onbekend');
  });
  it('approximate dates tolerate two years either way, no more', () => {
    const c = { jaren: [1950], ongeveer: true };
    for (const y of [1948, 1950, 1952]) assert.equal(onderscheid(c, { birthYear: y }).jaar, 'komt_overeen', String(y));
    for (const y of [1947, 1953]) assert.equal(onderscheid(c, { birthYear: y }).jaar, 'wijkt_af', String(y));
    assert.equal(onderscheid({ jaren: [1950] }, { birthYear: 1951 }).jaar, 'wijkt_af');
  });
  it('country: same logic', () => {
    assert.equal(onderscheid(e, { country: 'UA' }).land, 'komt_overeen');
    assert.equal(onderscheid(e, { country: 'NL' }).land, 'wijkt_af');
    assert.equal(onderscheid({}, { country: 'NL' }).land, 'onbekend');
  });
  it('says nothing about what was not given', () => assert.deepEqual(onderscheid(e, {}), {}));
});

describe('checker: the hint never changes the outcome', () => {
  const r = root();
  const twins = [
    { id: 'A', names: ['Ivan Petrov'], soort: 'persoon', jaren: [1960], landen: ['RU'] },
    { id: 'B', names: ['Ivan Petrov'], soort: 'persoon', jaren: [1985], landen: ['UA'] },
    { id: 'C', names: ['Ivan Petrov'], soort: 'persoon', jaren: [1971], landen: ['BY'] },
    { id: 'D', names: ['Ivan Petrov'], soort: 'persoon', jaren: [1990], landen: ['KZ'] },
    { id: 'T', names: ['Ivan Petrof Trading'], soort: 'onderneming' },
    { id: 'F', names: ['Ivan Petrow'], soort: 'persoon', jaren: [2000], landen: ['NL'] },
  ];
  writeSnapshot(r, 'eu-fsf', [...ENTITIES, ...twins], K.priv);
  const ask = (claim) => runCheck({ claims: [{ id: 'c1', type: 'entity', value: 'Ivan Petrov', ...claim }], snapshotDir: r, pubKeyPem: K.pub, now: NOW, required: { entity: ['eu-fsf'], country: [] } }).resultaten[0];
  it('without extras there is no onderscheid field at all', () => {
    const x = ask({});
    assert.equal(x.uitkomst, 'TREFFER');
    assert.ok(x.per_bron[0].kandidaten.every((k) => k.onderscheid === undefined));
  });
  it('a matching year and country keep TREFFER and put the matching namesake first', () => {
    const x = ask({ birthYear: 1990, country: 'KZ' });
    assert.equal(x.uitkomst, 'TREFFER');
    const k = x.per_bron[0].kandidaten;
    assert.equal(k[0].id, 'D');
    assert.deepEqual(k[0].onderscheid, { jaar: 'komt_overeen', land: 'komt_overeen' });
    assert.ok(k.slice(1).every((c) => c.onderscheid.jaar === 'wijkt_af' && c.onderscheid.land === 'wijkt_af'));
  });
  it('without extras the fourth namesake is cut off; with extras it is found', () => {
    assert.ok(!ask({}).per_bron[0].kandidaten.some((k) => k.id === 'D'));
    assert.ok(ask({ birthYear: 1990 }).per_bron[0].kandidaten.some((k) => k.id === 'D'));
  });
  it('an exact name stays in front even when a fuzzy candidate agrees on the year', () => {
    const k = ask({ birthYear: 2000 }).per_bron[0].kandidaten;
    assert.equal(k[0].reden, 'exact');
    assert.ok(k[0].onderscheid.jaar === 'wijkt_af');
  });
  it('a year that matches nobody still gives TREFFER, with every candidate marked wijkt_af', () => {
    const x = ask({ birthYear: 1930 });
    assert.equal(x.uitkomst, 'TREFFER');
    assert.ok(x.per_bron[0].kandidaten.every((k) => k.onderscheid.jaar === 'wijkt_af'));
  });
  it('a KANDIDAAT stays a KANDIDAAT when the year differs', () => {
    const x = runCheck({ claims: [{ id: 'c1', type: 'entity', value: 'Ivan Petrof', birthYear: 1930 }], snapshotDir: r, pubKeyPem: K.pub, now: NOW, required: { entity: ['eu-fsf'], country: [] } }).resultaten[0];
    assert.equal(x.uitkomst, 'KANDIDAAT');
  });
  it('a company (no years in the list) is marked onbekend, not wijkt_af', () => {
    const x = runCheck({ claims: [{ id: 'c1', type: 'entity', value: 'Ivan Petrof Trading', birthYear: 1930, country: 'NL' }], snapshotDir: r, pubKeyPem: K.pub, now: NOW, required: { entity: ['eu-fsf'], country: [] } }).resultaten[0];
    assert.deepEqual(x.per_bron[0].kandidaten[0].onderscheid, { jaar: 'onbekend', land: 'onbekend' });
  });
  it('the report states in its limits that the hint never changes the outcome', () => {
    assert.ok(LIMITS.some((l) => l.includes('verandert de uitkomst nooit')));
    const rep = runCheck({ claims: [{ id: 'c1', type: 'entity', value: 'Ivan Petrov', birthYear: 1985 }], snapshotDir: r, pubKeyPem: K.pub, now: NOW, required: { entity: ['eu-fsf'], country: [] } });
    assert.ok(rep.beperkingen.some((l) => l.includes('verandert de uitkomst nooit')));
  });
  it('country given in lower case is accepted', () => assert.equal(ask({ country: 'ua' }).per_bron[0].kandidaten[0].id, 'B'));
  it('a signed report with hints still verifies, and altering a hint breaks the signature', () => {
    const rep = runCheck({ claims: [{ id: 'c1', type: 'entity', value: 'Ivan Petrov', birthYear: 1985 }], snapshotDir: r, pubKeyPem: K.pub, now: NOW, required: { entity: ['eu-fsf'], country: [] } });
    const signed = signReport(rep, K.priv);
    assert.ok(verifyReport(signed, K.pub).ok);
    const forged = JSON.parse(JSON.stringify(signed));
    forged.report.resultaten[0].per_bron[0].kandidaten[0].onderscheid.jaar = 'wijkt_af';
    assert.equal(verifyReport(forged, K.pub).reden, 'handtekening_ongeldig');
  });
});

describe('claims: strict validation of the optional fields', () => {
  const r = root(); writeSnapshot(r, 'eu-fsf', ENTITIES, K.priv);
  const ask = (claim) => runCheck({ claims: [{ id: 'c1', type: 'entity', value: 'Acme Trading', ...claim }], snapshotDir: r, pubKeyPem: K.pub, now: NOW, required: { entity: ['eu-fsf'], country: [] } }).resultaten[0];
  const why = (x) => x.per_bron[0].reden;
  for (const [name, claim, reden] of [
    ['year as text', { birthYear: '1960' }, 'claim_jaar'], ['year with decimals', { birthYear: 1960.5 }, 'claim_jaar'],
    ['year too early', { birthYear: 1849 }, 'claim_jaar'], ['year too late', { birthYear: 2101 }, 'claim_jaar'], ['year null', { birthYear: null }, 'claim_jaar'],
    ['unknown country', { country: 'XX' }, 'claim_land'], ['country as number', { country: 5 }, 'claim_land'], ['country null', { country: null }, 'claim_land'],
    ['unknown extra field', { extra: 1 }, 'claim_velden'],
  ]) it(`${name} -> ONMEETBAAR ${reden}`, () => { const x = ask(claim); assert.equal(x.uitkomst, 'ONMEETBAAR'); assert.equal(why(x), reden); });
  it('extras on a country claim are refused', () => {
    const x = runCheck({ claims: [{ id: 'c1', type: 'country', value: 'IQ', birthYear: 1960 }], snapshotDir: r, pubKeyPem: K.pub, now: NOW }).resultaten[0];
    assert.equal(why(x), 'claim_velden');
  });
  it('a missing required field is still refused', () => {
    const x = runCheck({ claims: [{ id: 'c1', type: 'entity', birthYear: 1960 }], snapshotDir: r, pubKeyPem: K.pub, now: NOW }).resultaten[0];
    assert.equal(why(x), 'claim_velden');
  });
  it('valid extras are accepted and the claim is checked as normal', () => assert.equal(ask({ birthYear: 1960, country: 'NL' }).uitkomst, 'TREFFER'));
});
