// Regression tests for what a simulated outsider found on 2026-11-07 (see docs/DESIGN.md, "Outsider round").
// Each section carries the finding number. They were written first and failed; the fixes came after.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { luister, maakLoket } from '../loket/loket.mjs';
import { OUTCOMES, REQUIRED, runCheck, signReport, verifyReport } from '../src/check.mjs';
import { ENTITIES, NOW, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

const root = tmpRoot();
const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } cleanup(root); });
const K = keypair();
writeSnapshot(root, 'eu-fsf', ENTITIES, K.priv);
// The fixtures of these tests hold one entity list (eu-fsf) and the country list; the set of lists is a plain argument.
const EU = { entity: ['eu-fsf'], country: ['cahras'] };
const check = (claims, extra = {}) => runCheck({ claims, snapshotDir: root, pubKeyPem: K.pub, now: NOW, required: EU, ...extra });
const uitkomst = (value) => check([{ id: 'a', type: 'entity', value }]).resultaten[0].uitkomst;
const gevonden = (value) => ['TREFFER', 'KANDIDAAT'].includes(uitkomst(value));
const nietStil = (value) => uitkomst(value) !== 'GEEN_TREFFER_IN_LIJST';

describe('F1: symbolen die NFKD tot letters maakt plakken niet aan de naam', () => {
  it('a trademark-like symbol behind a listed name never makes it a miss', () => {
    for (const sym of ['™', '℠', '№', '℡', '℻', '㏂', '㎏', '㍿', '⅓']) {
      assert.ok(nietStil(`Zvezda Strela Holding${sym}`), `Zvezda Strela Holding${sym}`);
      assert.ok(nietStil(`Alrosa${sym}`), `Alrosa${sym}`);
    }
    for (const merk of ['™', '℠', '®', '©', '℗']) assert.equal(uitkomst(`Alrosa${merk}`), 'TREFFER', `a trade mark sign is dropped: ${merk}`);
    assert.ok(gevonden('Alrosa™'));
    assert.ok(gevonden('Alrosa ™'));
    assert.ok(gevonden('™Alrosa'));
  });
  it('every code point whose compatibility form is longer than one character, put behind a short listed name, is never a silent miss', () => {
    const fouten = [];
    let geprobeerd = 0;
    const claims = [];
    for (let cp = 0x80; cp <= 0x1ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      if ([...ch.normalize('NFKD')].length < 2 || /[\p{L}\p{M}]/u.test(ch)) continue; // a letter glued on is simply another name
      claims.push({ id: `c${cp}`, type: 'entity', value: `Alrosa${ch}` });
    }
    for (let i = 0; i < claims.length; i += 200) {
      const rep = check(claims.slice(i, i + 200));
      for (const r of rep.resultaten) { geprobeerd++; if (r.uitkomst === 'GEEN_TREFFER_IN_LIJST') fouten.push(r.id); }
    }
    assert.ok(geprobeerd > 500, `only ${geprobeerd} code points tried`);
    assert.deepEqual(fouten.slice(0, 10), []);
  });
  it('ligatures and circled letters are still read as the letters they stand for', () => {
    assert.equal(uitkomst('ﬁller Company Number 3 Xq3z'), 'TREFFER', 'ligature');
    assert.equal(uitkomst('Ⓐlrosa'), 'TREFFER', 'circled letter');
    assert.equal(uitkomst('ＡＬＲＯＳＡ'), 'TREFFER', 'full-width letters');
  });
});

describe('F2: onzichtbare tekens buiten de categorie Cf splitsen een woord niet', () => {
  const kort = join(root, 'kort');
  writeSnapshot(kort, 'eu-fsf', [{ id: 'S1', names: ['Sibur'] }, ...Array.from({ length: 30 }, (_, i) => ({ id: `F${i}`, names: [`Filler Company Number ${i} Xq${i}z`] }))], K.priv);
  it('every default-ignorable code point, the blank Braille cell and the next-line control, put inside a five-letter name, is never a silent miss', () => {
    const tekens = [];
    for (let cp = 0x80; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      if (/\p{Default_Ignorable_Code_Point}/u.test(ch) || cp === 0x2800 || cp === 0x85) tekens.push(ch);
    }
    assert.ok(tekens.length > 300, `only ${tekens.length} characters`);
    const claims = [];
    for (const ch of tekens) for (let p = 1; p < 5; p++) claims.push({ id: `u${ch.codePointAt(0).toString(16)}-${p}`, type: 'entity', value: 'Sibur'.slice(0, p) + ch + 'Sibur'.slice(p) });
    const fouten = [];
    for (let i = 0; i < claims.length; i += 200) {
      const rep = runCheck({ claims: claims.slice(i, i + 200), snapshotDir: kort, pubKeyPem: K.pub, now: NOW, required: EU });
      for (const r of rep.resultaten) if (r.uitkomst === 'GEEN_TREFFER_IN_LIJST') fouten.push(r.id);
    }
    assert.deepEqual(fouten.slice(0, 10), []);
  });
});

describe('F7: id en type in een ondertekend rapport komen uit een vaste tekenset', () => {
  it('a refused claim reports its position and no type instead of echoing what the sender wrote', () => {
    const rep = check([{ id: '\u001b[2J ALL CLEAR ‮', type: 'x'.repeat(30000), value: 'a' }, { id: 'goed-1', type: 'planeet', value: 'a' }, { id: 'a'.repeat(65), type: 'entity', value: 'Alrosa' }]);
    assert.deepEqual(rep.resultaten.map((r) => [r.id, r.type, r.uitkomst]), [['#0', null, 'ONMEETBAAR'], ['goed-1', null, 'ONMEETBAAR'], ['#2', 'entity', 'ONMEETBAAR']]);
    assert.ok(JSON.stringify(rep).length < 20000);
    for (const r of rep.resultaten) assert.match(r.id, /^[A-Za-z0-9._:#-]{1,64}$/);
  });
});

describe('F8: verify weigert een rapport dat zichzelf tegenspreekt over zijn bronnen', () => {
  const basis = () => JSON.parse(JSON.stringify(check([{ id: 'a', type: 'entity', value: 'Onbekende Firma' }])));
  const ok = (r) => verifyReport(signReport(r, K.priv), K.pub);
  it('an honest report verifies', () => assert.equal(ok(basis()).ok, true));
  it('a result that rests on a source the report says it could not use is refused', () => {
    const r = basis(); r.bronnen[0] = { bron: 'eu-fsf', bruikbaar: false, reden: 'verouderd' };
    assert.equal(ok(r).reden, 'bron_onbruikbaar');
  });
  it('a result that names a source the report does not list is refused', () => {
    const r = basis(); r.resultaten[0].per_bron[0].bron = 'cahras';
    assert.equal(ok(r).reden, 'bron_onbekend');
  });
  it('a no-match result built on an entry without a source is refused', () => {
    const r = basis(); r.resultaten[0].per_bron[0].bron = null;
    assert.equal(ok(r).reden, 'bron_ontbreekt');
  });
  it('a no-match result with an extra entry that is itself unmeasured is refused (the worst one decides)', () => {
    const r = basis(); r.resultaten[0].per_bron.push({ bron: 'eu-fsf', uitkomst: 'ONMEETBAAR', reden: 'x' });
    assert.equal(ok(r).ok, false);
  });
});

describe('F9: een minimum voor een onbekende bron is een fout, en het rapport zegt welk minimum gold', () => {
  it('the report records the minimum that was applied (or an empty object)', () => {
    assert.deepEqual(check([{ id: 'a', type: 'entity', value: 'Alrosa' }]).min_volgnummer, {});
    const d = join(root, 'keten2');
    writeSnapshot(d, 'eu-fsf', ENTITIES, K.priv, { manifest: { volgnummer: 5, vorige_manifest_sha256: 'a'.repeat(64) } });
    const rep = runCheck({ claims: [{ id: 'a', type: 'entity', value: 'Alrosa' }], snapshotDir: d, pubKeyPem: K.pub, now: NOW, minVolgnummer: { 'eu-fsf': 5 }, required: EU });
    assert.deepEqual(rep.min_volgnummer, { 'eu-fsf': 5 });
  });
  it('an unknown source in the minimum is refused by the library and by the command line', () => {
    assert.throws(() => check([{ id: 'a', type: 'entity', value: 'x' }], { minVolgnummer: { eufsf: 99 } }), /bron/);
    assert.equal(cli(['check', ...stdArgs(), '--min-volgnummer', 'eufsf=99']).status, 2);
    assert.equal(cli(['check', ...stdArgs(), '--min-volgnummer', 'cahras=1']).status, 22, 'a known source this claim does not use changes nothing');
  });
});

const CLI = new URL('../src/cli.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const cli = (args, opts = {}) => spawnSync('node', [CLI, ...args], { encoding: 'utf8', ...opts });
const pubFile = join(root, 'pub.pem'), privFile = join(root, 'priv.pem'), claimsFile = join(root, 'claims.json');
writeFileSync(pubFile, K.pub); writeFileSync(privFile, K.priv); writeFileSync(claimsFile, JSON.stringify([{ id: 'a', type: 'entity', value: 'PJSC Alrosa' }]));
const stdArgs = (o = {}) => ['--claims', o.claims ?? claimsFile, '--snapshots', root, '--pub', o.pub ?? pubFile, '--key', o.key ?? privFile, '--now', NOW.toISOString()];

describe('F12 en F13: de opdrachtregel houdt zich aan zijn eigen afsprakenlijst', () => {
  it('an unknown or inherited command name is a usage error (exit 2), never a crash', () => {
    for (const cmd of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'bogus']) {
      const r = cli([cmd, '--x', 'y']);
      assert.equal(r.status, 2, cmd);
      assert.ok(!/TypeError|at Object|node:internal/.test(r.stderr), cmd);
    }
  });
  it('a missing or unreadable file is invalid input (exit 2) with a message that says which kind of file', () => {
    const r = cli(['check', ...stdArgs({ pub: join(root, 'nergens.pem') })]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /bestand/);
    const c = cli(['check', ...stdArgs({ claims: join(root, 'nergens.json') })]);
    assert.equal(c.status, 2);
    assert.match(c.stderr, /bestand/);
    assert.ok(!/geen geldige JSON/.test(c.stderr), 'a missing file is not a JSON problem');
  });
  it('a claims file with a byte order mark is read', () => {
    const p = join(root, 'bom.json'); writeFileSync(p, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(claimsFile)]));
    assert.equal(cli(['check', ...stdArgs({ claims: p })]).status, 22);
  });
  it('a signing key that does not belong to the public key is refused before anything is signed', () => {
    const p = join(root, 'ander.pem'); writeFileSync(p, keypair().priv);
    const r = cli(['check', ...stdArgs({ key: p })]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /horen niet bij elkaar/);
  });
  it('a claims file over 1 MB is refused (exit 2)', () => {
    const p = join(root, 'groot.json'); writeFileSync(p, '[' + '{"id":"a","type":"entity","value":"x"},'.repeat(40000) + '{"id":"b","type":"entity","value":"x"}]');
    assert.equal(cli(['check', ...stdArgs({ claims: p })]).status, 2);
  });
});

describe('F6 en F14: strikte JSON', () => {
  const schrijf = (naam, tekst) => { const p = join(root, naam); writeFileSync(p, tekst); return p; };
  it('a claim with the same key twice is refused, whichever spelling the key has', () => {
    for (const tekst of ['[{"id":"a","type":"entity","value":"Wagner Group","value":"Siemens"}]', '[{"id":"a","type":"entity","value":"x","va' + 'lue":"y"}]', String.raw`[{"id":"a","type":"entity","value":"x","value":"y"}]`, '[{"id":"a","id":"b","type":"entity","value":"x"}]']) {
      const r = cli(['check', ...stdArgs({ claims: schrijf('dubbel.json', tekst) })]);
      assert.equal(r.status, 2, tekst);
      assert.match(r.stderr, /dubbel/);
    }
  });
  it('the same key in two different objects is fine', () => {
    const r = cli(['check', ...stdArgs({ claims: schrijf('twee.json', '[{"id":"a","type":"entity","value":"PJSC Alrosa"},{"id":"b","type":"entity","value":"PJSC Alrosa"}]') })]);
    assert.equal(r.status, 22);
  });
  it('a signed report with a repeated key does not verify', () => {
    const rep = signReport(check([{ id: 'a', type: 'entity', value: 'Onbekende Firma' }]), K.priv);
    const tekst = JSON.stringify(rep).replace('"ergste":"GEEN_TREFFER_IN_LIJST"', '"ergste":"TREFFER","ergste":"GEEN_TREFFER_IN_LIJST"');
    assert.notEqual(tekst, JSON.stringify(rep));
    const r = cli(['verify', '--report', schrijf('dubbel-rapport.json', tekst), '--pub', pubFile]);
    assert.equal(r.status, 1);
  });
  it('nesting deeper than a claim file ever needs is refused as input, not as a crash', () => {
    const p = schrijf('diep.json', '['.repeat(5000) + ']'.repeat(5000));
    const r = cli(['check', ...stdArgs({ claims: p })]);
    assert.equal(r.status, 2);
    assert.ok(!/RangeError|Maximum call/.test(r.stderr));
  });
  it('the counter answers 400 for duplicate keys and for deep nesting, never 500', async () => {
    const srv = maakLoket({ snapshotDir: root, pubKeyPem: K.pub, privKeyPem: K.priv, klok: () => NOW.getTime() });
    const a = await luister(srv, 0); servers.push(srv);
    const post = (body) => fetch(`http://127.0.0.1:${a.port}/v1/vergelijk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal((await post('[{"id":"a","type":"entity","value":"x","value":"y"}]')).status, 400);
    assert.equal((await post('['.repeat(5000) + ']'.repeat(5000))).status, 400);
    assert.equal((await post('[{"id":"a","type":"entity","value":"PJSC Alrosa"}]')).status, 200);
  });
  it('a manifest with a repeated key is refused as a list', () => {
    const d = join(root, 'dubbelmanifest'); writeSnapshot(d, 'eu-fsf', ENTITIES, K.priv);
    const p = join(d, 'eu-fsf', 'manifest.json');
    writeFileSync(p, readFileSync(p, 'utf8').replace('"schema":1', '"schema":1,"schema":1'));
    const rep = runCheck({ claims: [{ id: 'a', type: 'entity', value: 'PJSC Alrosa' }], snapshotDir: d, pubKeyPem: K.pub, now: NOW, required: EU });
    assert.equal(rep.resultaten[0].uitkomst, 'ONMEETBAAR');
  });
});

describe('uitkomsten blijven één van de vier', () => {
  it('sanity: the outcome list is unchanged and the known sources are the ones the design names (the UN list is known but not in the default set)', () => {
    assert.deepEqual(OUTCOMES, ['TREFFER', 'KANDIDAAT', 'ONMEETBAAR', 'GEEN_TREFFER_IN_LIJST']);
    assert.deepEqual([...new Set(Object.values(REQUIRED).flat())].sort(), ['cahras', 'eu-fsf', 'ofac-sdn', 'uk-sanctions', 'us-csl']);
    assert.ok(!Object.values(REQUIRED).flat().includes('un-sc'), 'the UN list is opt-in: it adds almost nothing over the default four (measured)');
  });
});

describe('F5: de voeding toetst inhoud, niet alleen aantal', () => {
  const FEEDER = new URL('../feeder/voeding.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const sleutel = join(root, 'f5-priv.pem'); writeFileSync(sleutel, K.priv);
  const nieuw = () => { const d = join(root, `f5-${Math.random().toString(36).slice(2, 8)}`); mkdirSync(d); return { out: join(d, 's'), hist: join(d, 'h'), d }; };
  const xml = (ids, naam = (i) => `Name Number ${i} and Co`) => `<?xml version="1.0"?><export generationDate="2026-11-05T10:00:00.000+01:00">` + ids.map((i) => `<sanctionEntity euReferenceNumber="EU.${i}" logicalId="${i}"><nameAlias wholeName="${naam(i)}" logicalId="${i}"/></sanctionEntity>`).join('') + '</export>';
  const reeks = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  let teller = 0;
  const feed = (w, inhoud, extra = []) => {
    const p = join(w.d, `in${teller}.xml`); writeFileSync(p, inhoud);
    const now = new Date(Date.parse('2026-11-06T05:00:00Z') + (teller++) * 3600000).toISOString();
    return spawnSync('node', [FEEDER, '--bron', 'eu-fsf', '--out', w.out, '--history', w.hist, '--key', sleutel, '--from-file', p, '--floor', '5', '--now', now, ...extra], { encoding: 'utf8' });
  };
  const reden = (w) => { const q = join(w.hist, 'quarantine'); const m = readdirSync(q).sort().pop(); return readFileSync(join(q, m, 'reden.txt'), 'utf8'); };
  const manifestTelling = (w) => JSON.parse(readFileSync(join(w.out, 'eu-fsf', 'manifest.json'), 'utf8')).entryCount;

  it('the same number of parties with every name replaced is quarantined, and the live list stays', () => {
    const w = nieuw();
    assert.equal(feed(w, xml(reeks(0, 100))).status, 0);
    const r = feed(w, xml(reeks(0, 100), (i) => `Junk ${i}`));
    assert.equal(r.status, 3);
    assert.match(reden(w), /namen/);
    assert.equal(manifestTelling(w), 100);
  });
  it('the same number of parties with every id replaced is quarantined', () => {
    const w = nieuw();
    assert.equal(feed(w, xml(reeks(0, 100))).status, 0);
    assert.equal(feed(w, xml(reeks(1000, 1100))).status, 3);
    assert.match(reden(w), /verdwenen/);
  });
  it('ordinary churn passes: five renamed, three added', () => {
    const w = nieuw();
    assert.equal(feed(w, xml(reeks(0, 100))).status, 0);
    assert.equal(feed(w, xml(reeks(0, 103), (i) => (i < 5 ? `Renamed ${i}` : `Name Number ${i} and Co`))).status, 0);
    assert.equal(manifestTelling(w), 103);
  });
  it('shrinking by nine percent at a time is stopped once the list is a fifth smaller than the largest ever signed', () => {
    const w = nieuw();
    const uitslag = [100, 91, 83, 75].map((n) => feed(w, xml(reeks(0, n))).status);
    assert.deepEqual(uitslag, [0, 0, 0, 3]);
    assert.match(reden(w), /20%/);
    assert.equal(manifestTelling(w), 83);
  });
  it('an explicit written reason lets a big change through, and the ledger says so', () => {
    const w = nieuw();
    assert.equal(feed(w, xml(reeks(0, 100))).status, 0);
    assert.equal(feed(w, xml(reeks(0, 100), (i) => `Junk ${i}`), ['--accepteer-verschil', 'EU renamed everything on purpose']).status, 0);
    const regels = readFileSync(join(w.hist, 'ledger.jsonl'), 'utf8').trim().split(String.fromCharCode(10)).map((l) => JSON.parse(l));
    assert.equal(regels[1].verschil_geaccepteerd, 'EU renamed everything on purpose');
    assert.equal(regels[0].verschil_geaccepteerd, undefined);
  });
  it('the first run has nothing to compare with and is judged on the floor and the readable names only', () => {
    const w = nieuw();
    assert.equal(feed(w, xml(reeks(0, 6), (i) => `Alpha ${i}`)).status, 0);
  });
});

describe('F15 en F17: de lijstlezer', () => {
  const kop = '<export generationDate="2026-11-05T10:00:00+01:00">';
  it('thousands of unclosed tags are refused at once, not after rescanning the file for each of them', async () => {
    const { parseEuFsf } = await import('../src/adapters/eu-fsf.mjs');
    const vijandig = kop + '<sanctionEntity logicalId="1">'.repeat(32000) + '</export>';
    const t = Date.now();
    assert.throws(() => parseEuFsf(vijandig), /niet gesloten/);
    assert.ok(Date.now() - t < 1500, `took ${Date.now() - t} ms`);
  });
  it('an entity inside another, a self-closing entity and a look-alike tag name are handled the way the format allows', async () => {
    const { parseEuFsf } = await import('../src/adapters/eu-fsf.mjs');
    assert.throws(() => parseEuFsf(kop + '<sanctionEntity logicalId="1"><sanctionEntity logicalId="2"></sanctionEntity></sanctionEntity></export>'), /niet gesloten/);
    assert.throws(() => parseEuFsf(kop + '<sanctionEntity logicalId="1"/></export>'), /zelfsluitend|niet gesloten/);
    const r = parseEuFsf(kop + '<sanctionEntityExtra logicalId="9"></sanctionEntityExtra><sanctionEntity logicalId="1"><nameAlias wholeName="A"/></sanctionEntity></export>');
    assert.deepEqual(r.entries.map((e) => e.id), ['1']);
  });
});
