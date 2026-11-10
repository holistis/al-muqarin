// Several lists side by side: the registry of lists, the choice of lists, the feeder per list, and the checker over more than one list.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { BRONNEN, downloadOpties } from '../feeder/bronnen.mjs';
import { DEFAULT_ENTITY_SOURCES, ENTITY_SOURCES, InvalidInput, REQUIRED, kiesBronnen, runCheck, signReport, verifyReport } from '../src/check.mjs';
import { loadSnapshot } from '../src/snapshot.mjs';
import { ENTITIES, NOW, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

const pad = (u) => new URL(u, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FEEDER = pad('../feeder/voeding.mjs');
const CLI = pad('../src/cli.mjs');
const root = tmpRoot();
after(() => cleanup(root));
const K = keypair();
const keyFile = join(root, 'priv.pem'); writeFileSync(keyFile, K.priv);
const pubFile = join(root, 'pub.pem'); writeFileSync(pubFile, K.pub);

describe('the lists we know', () => {
  it('the feeder knows exactly the lists the checker knows', () => assert.deepEqual(Object.keys(BRONNEN).sort(), [...ENTITY_SOURCES].sort()));
  it('the default set is four of them, the UN list is not in it, and the country list stays as it was', () => {
    assert.deepEqual(DEFAULT_ENTITY_SOURCES, ['eu-fsf', 'uk-sanctions', 'ofac-sdn', 'us-csl']);
    assert.ok(ENTITY_SOURCES.includes('un-sc') && !DEFAULT_ENTITY_SOURCES.includes('un-sc'));
    assert.deepEqual(REQUIRED, { entity: DEFAULT_ENTITY_SOURCES, country: ['cahras'] });
  });
  it('every list has a fixed https address, host names, a floor and terms that say where they come from', () => {
    for (const [id, b] of Object.entries(BRONNEN)) {
      assert.match(id, /^[a-z0-9][a-z0-9-]{0,40}$/);
      assert.match(b.url, /^https:\/\//, id);
      assert.ok(Array.isArray(b.hosts) && b.hosts.length >= 1 && b.hosts.every((h) => /^[a-z0-9.-]+$/.test(h)), id);
      assert.ok(Number.isInteger(b.floor) && b.floor >= 500, id);
      assert.equal(typeof b.parse, 'function', id);
      assert.ok(b.license.length > 100 && /read( on)? 20\d\d-\d\d-\d\d/.test(b.license), `${id}: the terms must say when they were read`);
      assert.ok(b.pathPrefix, );
      assert.ok(b.pathPrefix, `${id}: a download must end under a path we named`);
      if (b.pathPrefix !== undefined) assert.match(b.pathPrefix, /^(\/[A-Za-z0-9_-]+)+\/$/, id);
      // The address the download starts at lies under that prefix, so a normal run is never refused by its own rule.
      if (b.pathPrefix !== undefined && b.hosts.includes(new URL(b.url).host)) assert.ok(new URL(b.url).pathname.startsWith(b.pathPrefix), `${id}: ${new URL(b.url).pathname}`);
    }
  });
  it('the downloader gets, for each list, exactly its address, its hosts, its path prefix and its content type', () => {
    for (const [id, b] of Object.entries(BRONNEN)) {
      const o = downloadOpties(b);
      assert.equal(o.url, b.url, id);
      assert.deepEqual(o.allowedHost, b.hosts, id);
      assert.equal(o.allowedPathPrefix, b.pathPrefix, id);
      assert.equal(o.inhoud, b.inhoud, id);
    }
    assert.ok(BRONNEN['us-csl'].inhoud.test('application/json') && !BRONNEN['us-csl'].inhoud.test('text/xml') && !BRONNEN['us-csl'].inhoud.test('text/html'));
    for (const id of ['eu-fsf', 'uk-sanctions', 'ofac-sdn', 'un-sc']) assert.equal(BRONNEN[id].inhoud, undefined, `${id}: xml is the default`);
    // The feeder passes exactly that to the downloader, and nothing typed by hand next to it.
    const bron = readFileSync(FEEDER, 'utf8');
    assert.match(bron, /downloadLijst\(\{ \.\.\.downloadOpties\(B\), maxBytes: MAX_BYTES \}\)/);
    assert.doesNotMatch(bron, /allowedHost|allowedPathPrefix/);
  });
  it('the terms of each list say what they rest on: the EU decision, the Open Government Licence, no US copyright, the UN site terms', () => {
    assert.match(BRONNEN['eu-fsf'].license, /2011\/833\/EU/);
    assert.match(BRONNEN['uk-sanctions'].license, /Published under the Open Government Licence v3\.0/);
    assert.match(BRONNEN['uk-sanctions'].license, /Contains public sector information licensed under the Open Government Licence v3\.0/);
    assert.match(BRONNEN['ofac-sdn'].license, /17 U\.S\.C\. 105/);
    assert.match(BRONNEN['ofac-sdn'].license, /our reading, not a statement by OFAC/);
    assert.match(BRONNEN['us-csl'].license, /17 U\.S\.C\. 105/);
    assert.match(BRONNEN['us-csl'].license, /HTTP 403 and could not be read on 20\d\d-\d\d-\d\d, so no usage terms were read/);
    assert.match(BRONNEN['us-csl'].license, /SDN entries of the file are left out/);
    assert.match(BRONNEN['un-sc'].license, /granted by the United Nations Security Council Sanctions Lists Team on 2026-11-10/);
    assert.match(BRONNEN['un-sc'].license, /courtesy attribution/);
    assert.match(BRONNEN['un-sc'].license, /personal, non-commercial use/);
  });
});

describe('choosing the lists', () => {
  it('a comma list becomes the entity set, the country list stays', () => {
    assert.deepEqual(kiesBronnen('eu-fsf,un-sc'), { entity: ['eu-fsf', 'un-sc'], country: ['cahras'] });
    assert.deepEqual(kiesBronnen(' uk-sanctions , ofac-sdn ').entity, ['uk-sanctions', 'ofac-sdn']);
    assert.deepEqual(kiesBronnen('un-sc').entity, ['un-sc']);
  });
  it('an unknown name, an empty one, a repeat or the country list is refused', () => {
    for (const x of ['eu', 'eu-fsf,', '', ',', 'eu-fsf,eu-fsf', 'cahras', 'eu-fsf;uk-sanctions', 'EU-FSF']) assert.throws(() => kiesBronnen(x), InvalidInput, JSON.stringify(x));
  });
});

// A minimal valid file per list, in the real format, with n parties named "Name Number i".
const BESTANDEN = {
  'eu-fsf': (n) => `<?xml version="1.0"?><export generationDate="2026-11-05T10:00:00.000+01:00">${Array.from({ length: n }, (_, i) => `<sanctionEntity euReferenceNumber="EU.${i}" logicalId="${i}"><nameAlias wholeName="Name Number ${i} &amp; Co" logicalId="${i}"/></sanctionEntity>`).join('')}</export>`,
  'uk-sanctions': (n) => `<?xml version="1.0"?><Designations><DateGenerated>05/11/2026</DateGenerated>${Array.from({ length: n }, (_, i) => `<Designation><UniqueID>UK${i}</UniqueID><Names><Name><Name1>Name</Name1><Name2>Number</Name2><Name6>${i} Co</Name6><NameType>Primary Name</NameType></Name></Names><IndividualEntityShip>Entity</IndividualEntityShip></Designation>`).join('')}</Designations>`,
  'ofac-sdn': (n) => `<?xml version="1.0"?><sdnList><publshInformation><Publish_Date>11/05/2026</Publish_Date><Record_Count>${n}</Record_Count></publshInformation>${Array.from({ length: n }, (_, i) => `<sdnEntry><uid>${i + 1}</uid><lastName>Name Number ${i} Co</lastName><sdnType>Entity</sdnType></sdnEntry>`).join('')}</sdnList>`,
  'us-csl': (n) => JSON.stringify({ results: Array.from({ length: n }, (_, i) => ({ source: 'Entity List (EL) - Bureau of Industry and Security', id: `E${i}`, name: `Name Number ${i} Co`, alt_names: null, addresses: [{ country: 'HK' }] })), search_performed_at: '2026-11-05T10:00:00+00:00', sources_used: [{ source: 'Specially Designated Nationals (SDN) - Treasury Department', last_imported: '2026-11-05T10:00:00+00:00' }], offset: 0, total: n }),
  'un-sc': (n) => `<?xml version="1.0"?><CONSOLIDATED_LIST dateGenerated="2026-11-05T00:00:00.000Z"><ENTITIES>${Array.from({ length: n }, (_, i) => `<ENTITY><DATAID>${i}</DATAID><FIRST_NAME>Name Number ${i} Co</FIRST_NAME><REFERENCE_NUMBER>UN.${i}</REFERENCE_NUMBER></ENTITY>`).join('')}</ENTITIES></CONSOLIDATED_LIST>`,
};
const out = join(root, 'snaps'), hist = join(root, 'hist');
const NU = '2026-11-06T12:00:00Z';
let m = 0;
const bestand = (inhoud) => { const p = join(root, `f${m++}.xml`); writeFileSync(p, inhoud); return p; };
const voed = (bron, inhoud, extra = []) => spawnSync('node', [FEEDER, '--bron', bron, '--out', out, '--history', hist, '--key', keyFile, '--from-file', bestand(inhoud), '--floor', '5', '--now', NU, ...extra], { encoding: 'utf8' });

describe('the feeder per list', () => {
  for (const bron of Object.keys(BRONNEN)) {
    it(`${bron}: a file in its own format gives a signed list the checker accepts, with the terms of that list in the manifest`, () => {
      const r = voed(bron, BESTANDEN[bron](12));
      assert.equal(r.status, 0, r.stderr);
      const s = loadSnapshot({ dir: out, source: bron, pubKeyPem: K.pub, now: new Date(NU), maxAgeDays: 8 });
      assert.ok(s.ok, s.reason);
      assert.equal(s.entries.length, 12);
      assert.equal(s.manifest.source, bron);
      assert.equal(s.manifest.license, BRONNEN[bron].license);
      assert.equal(s.manifest.sourceUrl, BRONNEN[bron].url.split('?')[0]);
      assert.equal(s.manifest.volgnummer, 1, 'each list has its own chain of runs');
      assert.match(r.stderr, /OK: 12 partijen/);
    });
  }
  it('a file in the format of another list is refused and leaves the live list alone', () => {
    const voor = JSON.parse(readFileSync(join(out, 'uk-sanctions', 'manifest.json'), 'utf8')).sha256;
    assert.notEqual(voed('uk-sanctions', BESTANDEN['eu-fsf'](12)).status, 0);
    assert.equal(JSON.parse(readFileSync(join(out, 'uk-sanctions', 'manifest.json'), 'utf8')).sha256, voor);
  });
  it('the ledger holds each list under its own name and numbers each chain from 1', () => {
    const regels = readFileSync(join(hist, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    for (const bron of Object.keys(BRONNEN)) assert.deepEqual(regels.filter((r) => r.bron === bron).map((r) => r.volgnummer), [1], bron);
  });
  it('a second run of one list continues its own chain and does not touch the others', () => {
    assert.equal(voed('ofac-sdn', BESTANDEN['ofac-sdn'](13)).status, 0);
    const regels = readFileSync(join(hist, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(regels.filter((r) => r.bron === 'ofac-sdn').map((r) => r.volgnummer), [1, 2]);
    assert.deepEqual(regels.filter((r) => r.bron === 'eu-fsf').map((r) => r.volgnummer), [1]);
    const eu = loadSnapshot({ dir: out, source: 'eu-fsf', pubKeyPem: K.pub, now: new Date(NU), maxAgeDays: 8 });
    assert.equal(eu.manifest.volgnummer, 1);
  });
  it('a quarantine folder carries the name of its list, so the status can tell them apart', () => {
    assert.equal(voed('un-sc', BESTANDEN['un-sc'](3)).status, 3);
    const namen = readdirSync(join(hist, 'quarantine'));
    assert.ok(namen.some((n) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z--un-sc$/.test(n)), JSON.stringify(namen));
  });
  it('each list has its own floor (the default floor of the list is used when none is given)', () => {
    const zonder = spawnSync('node', [FEEDER, '--bron', 'ofac-sdn', '--out', join(root, 'x1'), '--history', join(root, 'x2'), '--key', keyFile, '--from-file', bestand(BESTANDEN['ofac-sdn'](12)), '--now', NU], { encoding: 'utf8' });
    assert.equal(zonder.status, 3);
    assert.match(zonder.stderr, /te weinig partijen: 12 < 10000/);
  });
  it('an unknown list, a missing list name or an address on the command line is refused', () => {
    assert.equal(voed('onzin', BESTANDEN['eu-fsf'](12)).status, 2);
    assert.match(voed('onzin', BESTANDEN['eu-fsf'](12)).stderr, /onbekende bron/);
    assert.equal(spawnSync('node', [FEEDER, '--out', out, '--history', hist, '--key', keyFile], { encoding: 'utf8' }).status, 2);
    assert.equal(voed('eu-fsf', BESTANDEN['eu-fsf'](12), ['--url', 'https://example.invalid/x.xml']).status, 2, 'there is no option for an address; it is fixed in code');
    assert.equal(voed('eu-fsf', BESTANDEN['eu-fsf'](12), ['--flor', '1']).status, 2, 'a typo in an option name is refused');
    assert.equal(voed('eu-fsf', BESTANDEN['eu-fsf'](12), ['--floor', '1', '--floor', '2']).status, 2, 'a repeated option is refused');
    assert.equal(spawnSync('node', [FEEDER, '--bron', 'eu-fsf', '--out'], { encoding: 'utf8' }).status, 2, 'a valueless option is refused');
    assert.equal(spawnSync('node', [FEEDER, 'losse', 'woorden'], { encoding: 'utf8' }).status, 2);
    assert.equal(voed('eu-fsf', BESTANDEN['eu-fsf'](12), ['--accepteer-verschil']).status, 2, 'a valueless option at the end is refused, also one that has a default');
    assert.equal(spawnSync('node', [FEEDER, 'bron', 'eu-fsf', '--out', out, '--history', hist, '--key', keyFile, '--from-file', bestand(BESTANDEN['eu-fsf'](12))], { encoding: 'utf8' }).status, 2, 'an option name needs its two dashes');
  });
});

describe('the checker over more than one list', () => {
  const dir = join(root, 'meer');
  const lijst = (id, namen) => namen.map((n, i) => ({ id: `${id}${i}`, names: [n] }));
  const filler = Array.from({ length: 12 }, (_, i) => `Filler Company Number ${i} Xq${i}z`);
  mkdirSync(dir, { recursive: true });
  writeSnapshot(dir, 'eu-fsf', lijst('E', ['Acme Trading Company', ...filler]), K.priv);
  writeSnapshot(dir, 'uk-sanctions', lijst('U', ['Zeta Mining Holdings', ...filler]), K.priv);
  const check = (value, bronnen, extra = {}) => runCheck({ claims: [{ id: 'a', type: 'entity', value }], snapshotDir: dir, pubKeyPem: K.pub, now: NOW, required: kiesBronnen(bronnen), ...extra });
  it('a hit in any one list is the answer, even when another list says nothing or is missing', () => {
    const r = check('Zeta Mining Holdings', 'eu-fsf,uk-sanctions,ofac-sdn');
    assert.equal(r.resultaten[0].uitkomst, 'TREFFER');
    assert.deepEqual(r.resultaten[0].per_bron.map((p) => [p.bron, p.uitkomst]), [['eu-fsf', 'GEEN_TREFFER_IN_LIJST'], ['uk-sanctions', 'TREFFER'], ['ofac-sdn', 'ONMEETBAAR']]);
  });
  it('clean in every list asked is GEEN_TREFFER_IN_LIJST; one list missing makes it ONMEETBAAR, never green', () => {
    assert.equal(check('Totally Other Firm', 'eu-fsf,uk-sanctions').resultaten[0].uitkomst, 'GEEN_TREFFER_IN_LIJST');
    const r = check('Totally Other Firm', 'eu-fsf,uk-sanctions,ofac-sdn');
    assert.equal(r.resultaten[0].uitkomst, 'ONMEETBAAR');
    assert.match(r.resultaten[0].toelichting, /bron_niet_aanwezig/);
  });
  it('the report names the lists that were asked, usable or not, and verifies', () => {
    const r = check('Totally Other Firm', 'eu-fsf,uk-sanctions,ofac-sdn');
    assert.deepEqual(r.bronnen.map((b) => [b.bron, b.bruikbaar]), [['eu-fsf', true], ['uk-sanctions', true], ['ofac-sdn', false]]);
  });
  it('a list that is present but not asked for is not read at all', () => {
    const r = check('Zeta Mining Holdings', 'eu-fsf');
    assert.equal(r.resultaten[0].uitkomst, 'GEEN_TREFFER_IN_LIJST');
    assert.deepEqual(r.bronnen.map((b) => b.bron), ['eu-fsf']);
  });
  it('the default set asks for four lists, never the UN list', () => {
    const r = runCheck({ claims: [{ id: 'a', type: 'entity', value: 'x firm' }], snapshotDir: dir, pubKeyPem: K.pub, now: NOW });
    assert.deepEqual(r.resultaten[0].per_bron.map((p) => p.bron), ['eu-fsf', 'uk-sanctions', 'ofac-sdn', 'us-csl']);
  });
  it('a minimum run number is only accepted for a list that is in the set asked for', () => {
    assert.throws(() => check('x firm', 'eu-fsf', { minVolgnummer: { 'un-sc': 1 } }), InvalidInput);
    assert.doesNotThrow(() => check('x firm', 'eu-fsf,un-sc', { minVolgnummer: { 'un-sc': 1 } }));
  });
});

describe('the command line over more than one list', () => {
  const dir = join(root, 'cli');
  mkdirSync(dir, { recursive: true });
  writeSnapshot(dir, 'eu-fsf', ENTITIES, K.priv);
  writeSnapshot(dir, 'un-sc', [...ENTITIES.map((e) => ({ ...e, id: `UN${e.id}` })), { id: 'UNX', names: ['Zeta Mining Holdings'] }], K.priv);
  const claims = join(root, 'claims.json'); writeFileSync(claims, JSON.stringify([{ id: 'a', type: 'entity', value: 'Zeta Mining Holdings' }, { id: 'b', type: 'entity', value: 'Unknown Firm' }]));
  const run = (...extra) => spawnSync('node', [CLI, 'check', '--claims', claims, '--snapshots', dir, '--pub', pubFile, '--key', keyFile, '--now', NOW.toISOString(), ...extra], { encoding: 'utf8' });
  it('--bronnen chooses the lists; the report holds exactly those, and a hit in the UN list shows when it is asked for', () => {
    const r = run('--bronnen', 'eu-fsf,un-sc');
    assert.equal(r.status, 22, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(j.report.bronnen.map((b) => b.bron), ['eu-fsf', 'un-sc']);
    assert.deepEqual(j.report.resultaten.map((x) => x.uitkomst), ['TREFFER', 'GEEN_TREFFER_IN_LIJST']);
    assert.equal(verifyReport(j, K.pub, { claims: JSON.parse(readFileSync(claims, 'utf8')) }).ok, true);
  });
  it('without --bronnen the default set is asked: the lists that are not there make every clean answer ONMEETBAAR (exit 20)', () => {
    const r = run();
    assert.equal(r.status, 20, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(j.report.bronnen.map((b) => b.bron), ['eu-fsf', 'uk-sanctions', 'ofac-sdn', 'us-csl']);
  });
  it('an unknown or repeated list name is invalid input (exit 2)', () => {
    for (const x of ['onzin', 'eu-fsf,eu-fsf', '']) assert.equal(run('--bronnen', x).status, 2, x);
  });
  it('--bronnen can be given once only', () => assert.equal(run('--bronnen', 'eu-fsf', '--bronnen', 'un-sc').status, 2));
  it('--min-volgnummer for a list outside the chosen set is invalid input', () => assert.equal(run('--bronnen', 'eu-fsf', '--min-volgnummer', 'un-sc=1').status, 2));
});

describe('the counter over more than one list', () => {
  it('answers with the lists it was started with (a real process, a real request)', async () => {
    const START = pad('../loket/start.mjs');
    const dir = join(root, 'loketdir'); mkdirSync(dir, { recursive: true });
    writeSnapshot(dir, 'eu-fsf', ENTITIES, K.priv);
    const vrijePoort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
    const vraag = async (metKeuze) => {
      const poort = await vrijePoort();
      const kind = spawn('node', [START, '--snapshots', dir, '--pub', pubFile, '--key', keyFile, '--port', String(poort), ...(metKeuze ? ['--bronnen', 'eu-fsf'] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
      try {
        await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('geen luistert-regel')), 15000); kind.stdout.on('data', (d) => { if (String(d).includes('luistert')) { clearTimeout(t); res(); } }); kind.on('exit', () => rej(new Error('loket stopte'))); });
        const r = await fetch(`http://127.0.0.1:${poort}/v1/vergelijk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ id: 'a', type: 'entity', value: 'Unknown Firm' }]) });
        return (await r.json()).report.bronnen.map((b) => b.bron);
      } finally { kind.kill(); }
    };
    assert.deepEqual(await vraag(true), ['eu-fsf']);
    assert.deepEqual(await vraag(false), ['eu-fsf', 'uk-sanctions', 'ofac-sdn', 'us-csl'], 'without the option the default set is asked');
  });
  it('takes the set of lists from its start command, and refuses an unknown one', () => {
    const START = pad('../loket/start.mjs');
    const r = spawnSync('node', [START, '--snapshots', root, '--pub', pubFile, '--key', keyFile, '--bronnen', 'onzin'], { encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /bronnen: kies uit/);
  });
});

describe('the self-measurement over more than one list', () => {
  it('takes a list by name, and refuses an unknown one before it reads anything', () => {
    const ZM = pad('../tools/zelfmeting.mjs');
    const r = spawnSync('node', [ZM, '--snapshots', join(root, 'bestaat-niet'), '--pub', pubFile, '--bron', 'onzin'], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /onbekende bron: onzin/);
    const zonder = spawnSync('node', [ZM, '--snapshots', join(root, 'bestaat-niet'), '--pub', pubFile], { encoding: 'utf8' });
    assert.notEqual(zonder.status, 0);
    assert.doesNotMatch(zonder.stderr, /onbekende bron/);
  });
});

describe('older lists and the lists a report rests on', () => {
  const dir = join(root, 'keten');
  const H = 'a'.repeat(64);
  const lijst = (id) => [...Array.from({ length: 12 }, (_, i) => ({ id: `${id}${i}`, names: [`Filler Company Number ${i} Xq${i}z`] })), { id: `${id}X`, names: ['Zeta Mining Holdings'] }];
  mkdirSync(dir, { recursive: true });
  writeSnapshot(dir, 'eu-fsf', lijst('E'), K.priv, { manifest: { volgnummer: 1, vorige_manifest_sha256: null } });
  writeSnapshot(dir, 'uk-sanctions', lijst('U'), K.priv, { manifest: { volgnummer: 5, vorige_manifest_sha256: H } });
  const ledger = join(root, 'keten-ledger.jsonl');
  writeFileSync(ledger, [{ bron: 'eu-fsf', volgnummer: 1 }, { bron: 'uk-sanctions', volgnummer: 5 }, { bron: 'uk-sanctions', volgnummer: 6 }, { bron: 'ofac-sdn', volgnummer: 9 }].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const claims = join(root, 'keten-claims.json'); writeFileSync(claims, JSON.stringify([{ id: 'a', type: 'entity', value: 'Totally Other Firm' }]));
  const run = (...extra) => spawnSync('node', [CLI, 'check', '--claims', claims, '--snapshots', dir, '--pub', pubFile, '--key', keyFile, '--now', NOW.toISOString(), ...(extra.includes('--bronnen') ? [] : ['--bronnen', 'eu-fsf,uk-sanctions']), ...extra], { encoding: 'utf8' });
  it('without a floor an older signed list is accepted (that is why there is one)', () => assert.equal(run().status, 0));
  it('--ledger raises the floor for EVERY list in the set: an older uk list is refused, the report says which floor applied', () => {
    const r = run('--ledger', ledger);
    assert.equal(r.status, 20, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(j.report.min_volgnummer, { 'eu-fsf': 1, 'uk-sanctions': 6 });
    assert.deepEqual(j.report.resultaten[0].per_bron.map((p) => [p.bron, p.uitkomst, p.reden]), [['eu-fsf', 'GEEN_TREFFER_IN_LIJST', undefined], ['uk-sanctions', 'ONMEETBAAR', 'volgnummer_terug']]);
  });
  it('the ledger only counts for the lists in the set, and a list without a line in it has no floor', () => {
    assert.equal(run('--ledger', ledger, '--bronnen', 'eu-fsf').status, 0);
  });
  it('several minimums can be given at once; each list once; the higher of hand and ledger counts', () => {
    assert.equal(run('--min-volgnummer', 'eu-fsf=1,uk-sanctions=5').status, 0);
    assert.equal(run('--min-volgnummer', 'eu-fsf=1,uk-sanctions=6').status, 20);
    assert.equal(run('--min-volgnummer', 'eu-fsf=1,eu-fsf=2').status, 2);
    assert.equal(run('--min-volgnummer', 'eu-fsf=1,').status, 2);
    assert.equal(run('--min-volgnummer', 'eu-fsf=0').status, 2);
    const j = JSON.parse(run('--ledger', ledger, '--min-volgnummer', 'eu-fsf=7').stdout);
    assert.equal(j.report.min_volgnummer['eu-fsf'], 7);
    const k = run('--ledger', ledger, '--min-volgnummer', 'uk-sanctions=5');
    assert.equal(k.status, 20, 'the ledger says 6, which is higher than the 5 given by hand');
    assert.equal(JSON.parse(k.stdout).report.min_volgnummer['uk-sanctions'], 6);
  });
  it('a ledger that is asked for but missing or unreadable is an error, never "no protection"', () => {
    assert.equal(run('--ledger', join(root, 'bestaat-niet.jsonl')).status, 2);
    const stuk = join(root, 'stuk.jsonl'); writeFileSync(stuk, '{"bron":"eu-fsf","volgnummer":1}\nniet json\n');
    assert.equal(run('--ledger', stuk).status, 2);
  });
  it('verify --expect-bronnen: the report must rest on exactly those lists', () => {
    const rapport = join(root, 'keten-rapport.json');
    assert.equal(run('--out', rapport).status, 0);
    const verify = (...extra) => spawnSync('node', [CLI, 'verify', '--report', rapport, '--pub', pubFile, '--claims', claims, ...extra], { encoding: 'utf8' });
    assert.equal(verify().status, 0);
    assert.equal(verify('--expect-bronnen', 'eu-fsf,uk-sanctions').status, 0);
    assert.equal(verify('--expect-bronnen', 'uk-sanctions,eu-fsf').status, 0, 'the order does not matter');
    const minder = verify('--expect-bronnen', 'eu-fsf,uk-sanctions,ofac-sdn');
    assert.equal(minder.status, 1);
    assert.match(minder.stderr, /bronnen_niet_zoals_verwacht/);
    assert.equal(verify('--expect-bronnen', 'eu-fsf').status, 1, 'a report that rests on more lists than demanded is not the report demanded');
    assert.equal(verify('--expect-bronnen', 'onzin').status, 2);
  });
  it('verifyReport: a refused claim and a country claim are not held to the set of lists', () => {
    const rep = runCheck({ claims: [{ id: 'a', type: 'entity', value: 'Totally Other Firm' }, { id: 'b', type: 'entity', value: 'x', birthYear: 'abc' }, { id: 'c', type: 'country', value: 'NL' }], snapshotDir: dir, pubKeyPem: K.pub, now: NOW, required: kiesBronnen('eu-fsf,uk-sanctions') });
    assert.equal(rep.resultaten[1].per_bron[0].bron, null);
    const ondertekend = signReport(rep, K.priv);
    assert.equal(verifyReport(ondertekend, K.pub, { bronnen: ['eu-fsf', 'uk-sanctions'] }).ok, true);
    assert.equal(verifyReport(ondertekend, K.pub, { bronnen: ['eu-fsf'] }).reden, 'bronnen_niet_zoals_verwacht');
    assert.equal(verifyReport(ondertekend, K.pub, {}).ok, true, 'without the option nothing is demanded');
  });
});
