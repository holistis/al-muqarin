// More of what the simulated outsider found (2026-11-07): the counter's proxy mode, timeouts, Host header and rollback floor.
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { connect } from 'node:net';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { luister, maakLoket } from '../loket/loket.mjs';
import { hoogsteVolgnummer } from '../src/snapshot.mjs';
import { ENTITIES, NOW, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

const root = tmpRoot();
const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } cleanup(root); });
const K = keypair();
const FRESH = { fetchedAt: '2026-11-05T10:00:00Z', asOf: '2026-11-05' };
const H64 = 'a'.repeat(64);
const CRLF = String.fromCharCode(13, 10);
let n = 0;
const snap = (manifest = FRESH) => { const d = join(root, `s${n++}`); writeSnapshot(d, 'eu-fsf', ENTITIES, K.priv, { manifest: { ...FRESH, ...manifest } }); return d; };
let nu = NOW.getTime();
async function start(o = {}) {
  const srv = maakLoket({ snapshotDir: o.dir ?? snap(), pubKeyPem: K.pub, privKeyPem: K.priv, klok: () => nu, limieten: o.limieten, vertrouwProxy: o.proxy, ledgerPad: o.ledger });
  const a = await luister(srv, 0); servers.push(srv);
  return { port: a.port, base: `http://127.0.0.1:${a.port}`, srv };
}
const get = (port, pad, headers = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path: pad, method: 'GET', headers }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
  req.on('error', reject); req.end();
});
const ask = async (base) => (await (await fetch(`${base}/v1/vergelijk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ id: 'a', type: 'entity', value: 'PJSC Alrosa' }]) })).json()).report.resultaten[0];

describe('F10: in proxymodus delen verzonnen adressen één emmer', () => {
  it('rotating made-up forwarded-for values does not give a fresh budget', async () => {
    nu = NOW.getTime(); const { port } = await start({ proxy: true });
    let geweigerd = 0;
    for (let i = 0; i < 100; i++) if ((await get(port, '/v1/gezondheid', { 'x-forwarded-for': `verzonnen-${i}` })).status === 429) geweigerd++;
    assert.equal(geweigerd, 80, 'the 20 requests of one bucket pass, the other 80 are refused');
  });
  it('a long made-up value is not stored as a key', async () => {
    nu = NOW.getTime(); const { port } = await start({ proxy: true });
    for (let i = 0; i < 30; i++) await get(port, '/v1/gezondheid', { 'x-forwarded-for': 'x'.repeat(7000) + i });
    assert.equal((await get(port, '/v1/gezondheid', { 'x-forwarded-for': '203.0.113.9' })).status, 200, 'a real address still has its own budget');
  });
});

describe('F11: de tijdslimieten werken binnen enkele seconden', () => {
  const sluit = (port, schrijf) => new Promise((resolve) => {
    const t0 = Date.now();
    const s = connect(port, '127.0.0.1', () => schrijf(s));
    let data = '';
    s.on('data', (d) => { data += d; });
    s.on('close', () => resolve({ ms: Date.now() - t0, data }));
    setTimeout(() => { s.destroy(); }, 8000);
  });
  it('a request whose headers never finish is closed by the headers timeout', async () => {
    const { port } = await start({ limieten: { headersTimeoutMs: 1000, requestTimeoutMs: 2000 } });
    const r = await sluit(port, (s) => s.write(`GET /v1/gezondheid HTTP/1.1${CRLF}Host: 127.0.0.1${CRLF}`));
    assert.ok(r.ms < 5000, `closed after ${r.ms} ms`);
  });
  it('a body that trickles in is closed by the request timeout', async () => {
    const { port } = await start({ limieten: { headersTimeoutMs: 1000, requestTimeoutMs: 2000 } });
    const r = await sluit(port, (s) => { s.write(`POST /v1/vergelijk HTTP/1.1${CRLF}Host: 127.0.0.1${CRLF}content-type: application/json${CRLF}content-length: 100${CRLF}${CRLF}[`); });
    assert.ok(r.ms < 5000, `closed after ${r.ms} ms`);
  });
});

describe('Host-kop: een naam die naar 127.0.0.1 wijst, is niet het loket', () => {
  it('only the local names are served without a trusted proxy; anything else is 421', async () => {
    nu = NOW.getTime(); const { port } = await start();
    assert.equal((await get(port, '/v1/gezondheid')).status, 200);
    assert.equal((await get(port, '/v1/gezondheid', { host: 'localhost:8744' })).status, 200);
    assert.equal((await get(port, '/v1/gezondheid', { host: '[::1]:8744' })).status, 200);
    assert.equal((await get(port, '/v1/gezondheid', { host: 'evil.example.com' })).status, 421);
    assert.equal((await get(port, '/v1/gezondheid', { host: '127.0.0.1.evil.example.com' })).status, 421);
    assert.equal((await get(port, '/v1/gezondheid', { host: 'localhost.evil.example.com:80' })).status, 421);
  });
  it('behind a trusted proxy the public name is fine', async () => {
    nu = NOW.getTime(); const { port } = await start({ proxy: true });
    assert.equal((await get(port, '/v1/gezondheid', { host: 'loket.example.org' })).status, 200);
  });
});

describe('ledger als ondergrens: een herstart vergeet een nieuwere lijst niet', () => {
  const ledger = (regels) => { const p = join(root, `ledger${n++}.jsonl`); writeFileSync(p, regels.map((r) => JSON.stringify(r)).join(String.fromCharCode(10)) + String.fromCharCode(10)); return p; };
  it('hoogsteVolgnummer reads the highest number of one source and ignores the rest', () => {
    const p = ledger([{ bron: 'eu-fsf', volgnummer: 2 }, { bron: 'eu-fsf', volgnummer: 7 }, { bron: 'cahras', volgnummer: 99 }, { bron: 'eu-fsf' }]);
    assert.equal(hoogsteVolgnummer(p, 'eu-fsf'), 7);
    assert.equal(hoogsteVolgnummer(ledger([{ bron: 'eu-fsf', volgnummer: 7 }, { bron: 'eu-fsf', volgnummer: 2 }]), 'eu-fsf'), 7, 'the highest number, not the last line');
    assert.equal(hoogsteVolgnummer(p, 'cahras'), 99);
    assert.equal(hoogsteVolgnummer(p, 'nieuw'), undefined);
    assert.equal(hoogsteVolgnummer(join(root, 'bestaat-niet.jsonl'), 'eu-fsf'), undefined);
    appendFileSync(p, 'kapot' + String.fromCharCode(10));
    assert.throws(() => hoogsteVolgnummer(p, 'eu-fsf'));
  });
  it('a list older than the ledger says is refused on the very first request after a start', async () => {
    nu = NOW.getTime();
    const { base } = await start({ dir: snap({ volgnummer: 5, vorige_manifest_sha256: H64 }), ledger: ledger([{ bron: 'eu-fsf', volgnummer: 7 }]) });
    const r = await ask(base);
    assert.equal(r.uitkomst, 'ONMEETBAAR'); assert.equal(r.per_bron[0].reden, 'volgnummer_terug');
  });
  it('a list at the ledger number is served; one without any number is refused', async () => {
    nu = NOW.getTime();
    const goed = await start({ dir: snap({ volgnummer: 7, vorige_manifest_sha256: H64 }), ledger: ledger([{ bron: 'eu-fsf', volgnummer: 7 }]) });
    assert.equal((await ask(goed.base)).uitkomst, 'TREFFER');
    const zonder = await start({ dir: snap(FRESH), ledger: ledger([{ bron: 'eu-fsf', volgnummer: 7 }]) });
    assert.equal((await ask(zonder.base)).per_bron[0].reden, 'volgnummer_ontbreekt');
  });
  it('an unreadable ledger refuses the list instead of dropping the floor; a missing ledger file means no floor yet', async () => {
    nu = NOW.getTime();
    const kapot = join(root, 'kapot.jsonl'); writeFileSync(kapot, 'geen json');
    const a = await start({ dir: snap({ volgnummer: 5, vorige_manifest_sha256: H64 }), ledger: kapot });
    assert.equal((await ask(a.base)).per_bron[0].reden, 'ledger_onleesbaar');
    const b = await start({ dir: snap({ volgnummer: 5, vorige_manifest_sha256: H64 }), ledger: join(root, 'nog-niet.jsonl') });
    assert.equal((await ask(b.base)).uitkomst, 'TREFFER');
  });
});

describe('F18: gaten in de matrix van geplante fouten, nu gedicht', () => {
  it('keygen writes the private key readable by its owner only (where the system has file modes)', async (t) => {
    if (process.platform === 'win32') return t.skip('Windows has no file modes');
    const { spawnSync } = await import('node:child_process');
    const { statSync } = await import('node:fs');
    const cli = new URL('../src/cli.mjs', import.meta.url).pathname;
    const d = join(root, 'keygen-modus');
    const r = spawnSync('node', [cli, 'keygen', '--dir', d], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(statSync(join(d, 'muqarin-private.pem')).mode & 0o777, 0o600);
  });
  it('a manifest or signature bigger than 16 KB is refused unread', async () => {
    const { runCheck } = await import('../src/check.mjs');
    const d = join(root, 'groot-manifest');
    writeSnapshot(d, 'eu-fsf', ENTITIES, K.priv, { manifest: FRESH, after: (dir) => appendFileSync(join(dir, 'manifest.json'), ' '.repeat(17 * 1024)) });
    const rep = runCheck({ claims: [{ id: 'a', type: 'entity', value: 'PJSC Alrosa' }], snapshotDir: d, pubKeyPem: K.pub, now: NOW });
    assert.equal(rep.resultaten[0].uitkomst, 'ONMEETBAAR');
    assert.equal(rep.resultaten[0].per_bron[0].reden, 'bestand_ontbreekt_of_te_groot');
  });
});
