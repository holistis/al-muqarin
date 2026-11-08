import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { keyId, verifyReport } from '../src/check.mjs';
import { clientSleutel, clientVan, luister, maakLimiet, maakLoket, maakSnapshotCache } from '../loket/loket.mjs';
import { ENTITIES, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

const root = tmpRoot();
const K = keypair();
const T0 = Date.parse('2026-11-06T12:00:00Z');
let nu = T0;
const klok = () => nu;
const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } cleanup(root); });
let n = 0;
const goodSnap = (o = {}) => { const d = join(root, `s${n++}`); writeSnapshot(d, 'eu-fsf', ENTITIES, K.priv, o); return d; };
// The fixtures hold one entity list (eu-fsf) and the country list; a test of the default set says so with required: undefined.
const EU = { entity: ['eu-fsf'], country: ['cahras'] };
const FRESH = { manifest: { fetchedAt: '2026-11-05T10:00:00Z', asOf: '2026-11-05' } };

async function start(o = {}) {
  const logs = [];
  const snapshotDir = o.snapshotDir ?? goodSnap(FRESH);
  const srv = maakLoket({ snapshotDir, pubKeyPem: K.pub, privKeyPem: K.priv, klok, log: (l) => logs.push(l), required: EU, ...o.opties, limieten: o.limieten });
  const a = await luister(srv, 0);
  servers.push(srv);
  return { srv, logs, snapshotDir, base: `http://127.0.0.1:${a.port}`, poort: a.port };
}
const post = (base, body, headers = {}) => fetch(`${base}/v1/vergelijk`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const claim = (value, id = 'a') => ({ id, type: 'entity', value });
const many = (k) => Array.from({ length: k }, (_, i) => claim(`Unknown Firm Number ${i}`, `c${i}`));
const reset = () => { nu = T0; };

describe('loket: antwoord', () => {
  it('answers a valid request with a signed report that verifies, and puts the worst outcome in a header', async () => {
    reset(); const { base } = await start();
    const claims = [claim('PJSC Alrosa'), claim('Unknown Firm', 'b')];
    const r = await post(base, claims);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.report.resultaten[0].uitkomst, 'TREFFER');
    assert.equal(r.headers.get('x-muqarin-ergste'), 'TREFFER');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-type'), /^application\/json/);
    const v = verifyReport(j, K.pub, { claims, expect: keyId(K.pub) });
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.equal(j.report.klok, 'systeem');
    assert.equal(j.report.max_leeftijd_dagen, 2);
  });
  it('serves the public key and its id, and a liveness answer', async () => {
    reset(); const { base } = await start();
    const s = await (await fetch(`${base}/v1/sleutel`)).json();
    assert.equal(s.sleutel_id, keyId(K.pub));
    assert.match(s.publieke_sleutel, /BEGIN PUBLIC KEY/);
    assert.ok(!JSON.stringify(s).includes('PRIVATE'));
    const g = await (await fetch(`${base}/v1/gezondheid`)).json();
    assert.equal(g.ok, true);
  });
  it('a missing list is a 200 with ONMEETBAAR, never an error that reads like silence', async () => {
    reset(); const dir = join(root, 'leeg'); mkdirSync(dir, { recursive: true });
    const { base } = await start({ snapshotDir: dir });
    const r = await post(base, [claim('PJSC Alrosa')]);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-muqarin-ergste'), 'ONMEETBAAR');
    assert.equal((await r.json()).report.resultaten[0].per_bron[0].reden, 'bron_niet_aanwezig');
  });
  it('a list older than the counter allows is ONMEETBAAR (2 days, not the CLI default of 8)', async () => {
    reset(); const dir = goodSnap({ manifest: { fetchedAt: '2026-11-03T10:00:00Z', asOf: '2026-11-03' } });
    const { base } = await start({ snapshotDir: dir });
    const j = await (await post(base, [claim('PJSC Alrosa')])).json();
    assert.equal(j.report.resultaten[0].uitkomst, 'ONMEETBAAR');
    assert.equal(j.report.resultaten[0].per_bron[0].reden, 'verouderd');
  });
});

describe('loket: invoer', () => {
  const kaal = (body) => (r) => r.text().then((t) => { assert.ok(!/node:|\.mjs|[A-Z]:\\|\/opt\/|\bat \w+/.test(t), t); return t; });
  it('wrong content type is 415, wrong method 405 with Allow, unknown address 404', async () => {
    reset(); const { base } = await start();
    assert.equal((await post(base, [claim('x')], { 'content-type': 'text/plain' })).status, 415);
    const g = await fetch(`${base}/v1/vergelijk`);
    assert.equal(g.status, 405); assert.equal(g.headers.get('allow'), 'POST');
    const p = await fetch(`${base}/v1/sleutel`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    assert.equal(p.status, 405); assert.equal(p.headers.get('allow'), 'GET');
    assert.equal((await fetch(`${base}/v1/niets`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 404);
  });
  it('bad JSON, a non-list, an empty list and too many claims are 400 with a plain message', async () => {
    reset(); const { base } = await start();
    for (const b of ['{kapot', '{"a":1}', '[]', JSON.stringify(many(26)), '"tekst"', 'null']) {
      const r = await post(base, b);
      assert.equal(r.status, 400, b.slice(0, 30));
      const t = await kaal()(r);
      assert.equal(JSON.parse(t).fout, 'ongeldige_invoer');
    }
  });
  it('exactly the maximum number of claims is accepted', async () => {
    reset(); const { base } = await start();
    assert.equal((await post(base, many(25))).status, 200);
  });
  it('a body over the limit is 413, by content-length and also when sent in chunks without one', async () => {
    reset(); const { base, poort } = await start();
    const big = JSON.stringify([claim('x'.repeat(64 * 1024 + 10))]);
    assert.equal((await post(base, big)).status, 413);
    const status = await new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: poort, path: '/v1/vergelijk', method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      for (let i = 0; i < 20; i++) req.write('a'.repeat(4096));
      req.end();
    });
    assert.equal(status, 413);
  });
  it('a body announced as too big is refused at once, without waiting for the body to arrive', async () => {
    reset(); const { poort } = await start();
    const status = await new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: poort, path: '/v1/vergelijk', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '10000000' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.flushHeaders();
      setTimeout(() => { req.destroy(); reject(new Error('geen antwoord zonder body')); }, 3000);
    });
    assert.equal(status, 413);
  });
  it('a request header over 8 KB is refused with 431', async () => {
    reset(); const { poort } = await start();
    const status = await new Promise((resolve) => {
      const req = request({ host: '127.0.0.1', port: poort, path: '/v1/gezondheid', method: 'GET', headers: { 'x-groot': 'a'.repeat(12000) } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => resolve('verbroken'));
      req.end();
    });
    assert.equal(status, 431);
  });
  it('a claim the checker refuses stays inside the report as ONMEETBAAR (not a failed request)', async () => {
    reset(); const { base } = await start();
    const r = await post(base, [{ id: 'a', type: 'planet', value: 'x' }]);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).report.resultaten[0].uitkomst, 'ONMEETBAAR');
  });
});

describe('loket: limieten', () => {
  it('the 21st quick request is 429 with a Retry-After, and the counter reopens as time passes', async () => {
    reset(); const { base } = await start();
    for (let i = 0; i < 20; i++) assert.equal((await fetch(`${base}/v1/gezondheid`)).status, 200, `request ${i}`);
    const r = await fetch(`${base}/v1/gezondheid`);
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) >= 1);
    assert.equal((await r.json()).fout, 'te_veel_aanvragen');
    nu += 61000;
    assert.equal((await fetch(`${base}/v1/gezondheid`)).status, 200);
  });
  it('claims are paid for per claim: four full requests pass, the fifth is 429', async () => {
    reset(); const { base } = await start();
    for (let i = 0; i < 4; i++) assert.equal((await post(base, many(25))).status, 200, `request ${i}`);
    const r = await post(base, many(25));
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) >= 1);
    nu += 16000;
    assert.equal((await post(base, many(25))).status, 200, 'after the refill');
  });
  it('one caller using up the whole budget does not block a different caller (proxy mode)', async () => {
    reset(); const { base } = await start({ opties: { vertrouwProxy: true } });
    for (let i = 0; i < 4; i++) await post(base, many(25), { 'x-forwarded-for': '203.0.113.1' });
    assert.equal((await post(base, many(25), { 'x-forwarded-for': '203.0.113.1' })).status, 429);
    assert.equal((await post(base, many(25), { 'x-forwarded-for': '203.0.113.2' })).status, 200);
  });
  it('the shared budget stops everybody together, however many callers there are', async () => {
    reset(); const { base } = await start({ opties: { vertrouwProxy: true }, limieten: { globaalClaimsPerMinuut: 30 } });
    assert.equal((await post(base, many(25), { 'x-forwarded-for': '203.0.113.1' })).status, 200);
    assert.equal((await post(base, many(25), { 'x-forwarded-for': '203.0.113.2' })).status, 429);
  });
  it('the shared budget has a default: six callers may spend 100 claims each, the seventh is stopped', async () => {
    reset(); const { base } = await start({ opties: { vertrouwProxy: true } });
    for (let c = 1; c <= 6; c++) for (let i = 0; i < 4; i++) assert.equal((await post(base, many(25), { 'x-forwarded-for': '203.0.113.' + c })).status, 200, 'caller ' + c);
    assert.equal((await post(base, many(25), { 'x-forwarded-for': '203.0.113.7' })).status, 429);
  });
  it('without proxy mode a made-up x-forwarded-for gives no fresh budget', async () => {
    reset(); const { base } = await start();
    for (let i = 0; i < 20; i++) await fetch(`${base}/v1/gezondheid`, { headers: { 'x-forwarded-for': `198.51.100.${i}` } });
    assert.equal((await fetch(`${base}/v1/gezondheid`, { headers: { 'x-forwarded-for': '198.51.100.250' } })).status, 429);
  });
  it('in proxy mode only the last x-forwarded-for entry counts, so prefixing made-up ones does not help', async () => {
    reset(); const { base } = await start({ opties: { vertrouwProxy: true } });
    for (let i = 0; i < 20; i++) await fetch(`${base}/v1/gezondheid`, { headers: { 'x-forwarded-for': `10.9.9.${i}, 203.0.113.9` } });
    assert.equal((await fetch(`${base}/v1/gezondheid`, { headers: { 'x-forwarded-for': '10.1.1.1, 203.0.113.9' } })).status, 429);
  });
  it('every address in one IPv6 /64 is one caller, written however the address is spelled', () => {
    const a = clientSleutel('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    assert.equal(a, '2001:0db8:0001:0002::/64');
    for (const v of ['2001:db8:1:2::1', '2001:0db8:0001:0002:0000:0000:0000:0001', '2001:DB8:1:2::', '2001:db8:1:2:ffff:ffff:ffff:ffff']) assert.equal(clientSleutel(v), a, v);
    assert.notEqual(clientSleutel('2001:db8:1:3::1'), a, 'the next /64 is another caller');
    assert.notEqual(clientSleutel('2001:db9:1:2::1'), a);
    assert.equal(clientSleutel('fe80::1%eth0'), 'fe80:0000:0000:0000::/64', 'a zone id is ignored');
    assert.equal(clientSleutel('::1'), '0000:0000:0000:0000::/64');
    assert.equal(clientSleutel('::1.2.3.4'), 'ipv6-onleesbaar', 'an embedded IPv4 tail is not read, it goes into one shared bucket');
    assert.equal(clientSleutel('1:2:3:4:5:6:1.2.3.4'), 'ipv6-onleesbaar');
  });
  it('an IPv4 address stays itself, an IPv4-mapped IPv6 address is that IPv4 address, and unreadable text is not trusted to be many callers', () => {
    assert.equal(clientSleutel('203.0.113.7'), '203.0.113.7');
    assert.equal(clientSleutel('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(clientSleutel('onbekend'), 'onbekend');
    assert.equal(clientSleutel('1:2:3:4:5:6:7:8:9'), 'ongeldig-adres', 'not an address at all: one shared bucket');
    assert.equal(clientSleutel('2001:db8::1:2:3:4:5:6:7'), 'ongeldig-adres', 'not a valid address either');
    assert.equal(clientSleutel('x'.repeat(5000)), 'ongeldig-adres', 'a long made-up value never becomes a table key');
  });
  it('the caller of a direct IPv6 connection is its /64, and a proxy header is ignored unless the proxy is trusted and local', () => {
    const req = (adres, xff) => ({ socket: { remoteAddress: adres }, headers: xff ? { 'x-forwarded-for': xff } : {} });
    assert.equal(clientVan(req('2001:db8:1:2::9'), false), '2001:0db8:0001:0002::/64');
    assert.equal(clientVan(req('2001:db8:1:2::9', '198.51.100.1'), false), '2001:0db8:0001:0002::/64', 'no proxy mode: header ignored');
    assert.equal(clientVan(req('127.0.0.1', '198.51.100.1, 203.0.113.5'), true), '203.0.113.5');
    assert.equal(clientVan(req('203.0.113.9', '198.51.100.1'), true), '203.0.113.9', 'a header from a non-local peer is never believed');
    assert.equal(clientVan({ socket: {}, headers: {} }, false), 'onbekend');
  });
  it('in proxy mode two IPv6 addresses of one /64 share one budget', async () => {
    reset(); const { base } = await start({ opties: { vertrouwProxy: true } });
    for (let i = 0; i < 20; i++) await fetch(base + '/v1/gezondheid', { headers: { 'x-forwarded-for': '2001:db8:aa:bb::' + (i + 1).toString(16) } });
    assert.equal((await fetch(base + '/v1/gezondheid', { headers: { 'x-forwarded-for': '2001:db8:aa:bb:1:2:3:4' } })).status, 429);
    assert.equal((await fetch(base + '/v1/gezondheid', { headers: { 'x-forwarded-for': '2001:db8:aa:cc::1' } })).status, 200, 'another /64 has its own budget');
  });
  it('the limiter forgets its least recently used caller when the table is full, and never grows past it', () => {
    let t = 0; const l = maakLimiet({ capaciteit: 2, perMinuut: 2, klok: () => t, maxSleutels: 3 });
    for (const k of ['a', 'b', 'c', 'd', 'e']) l.probeer(k);
    assert.equal(l.grootte(), 3);
    assert.equal(l.probeer('x', 3).ok, false, 'a cost above the capacity can never pass');
  });
  it('a caller that keeps coming back is the last to be forgotten', () => {
    const l = maakLimiet({ capaciteit: 1, perMinuut: 0.0001, klok: () => 0, maxSleutels: 3 });
    l.probeer('a'); l.probeer('b'); l.probeer('c');
    assert.equal(l.probeer('a').ok, false);
    l.probeer('d');
    assert.equal(l.probeer('a').ok, false, 'a was used most recently, so b was forgotten and a still has an empty bucket');
  });
  it('the limiter refills at the stated rate and never above the capacity', () => {
    let t = 0; const l = maakLimiet({ capaciteit: 10, perMinuut: 60, klok: () => t });
    assert.equal(l.probeer('a', 10).ok, true);
    assert.equal(l.probeer('a', 1).ok, false);
    t = 3000; assert.equal(l.probeer('a', 3).ok, true);
    assert.equal(l.probeer('a', 1).ok, false);
    t = 1e9; assert.equal(l.probeer('a', 10).ok, true);
    assert.equal(l.probeer('a', 1).ok, false, 'capacity is a ceiling');
  });
});

describe('loket: veiligheid', () => {
  it('listens on loopback only and sets its protective timeouts', async () => {
    reset(); const { srv } = await start();
    assert.equal(srv.address().address, '127.0.0.1');
    assert.equal(srv.headersTimeout, 10000); assert.equal(srv.requestTimeout, 15000); assert.equal(srv.keepAliveTimeout, 5000);
    assert.equal(srv.maxHeadersCount, 50); assert.equal(srv.maxConnections, 200);
  });
  it('a key pair that does not belong together stops the start', () => {
    const andere = keypair();
    assert.throws(() => maakLoket({ snapshotDir: root, pubKeyPem: andere.pub, privKeyPem: K.priv }), /horen niet bij elkaar/);
    assert.throws(() => maakLoket({ snapshotDir: root, pubKeyPem: K.pub, privKeyPem: 'geen sleutel' }));
  });
  it('a request the checker itself refuses (more claims than it ever takes) is a plain 400', async () => {
    reset(); const { base } = await start({ limieten: { maxClaims: 500, perClientClaimsPerMinuut: 1000, globaalClaimsPerMinuut: 1000 } });
    const r = await post(base, many(201));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).fout, 'ongeldige_invoer');
  });
  it('the counter imports only http, net (for isIP) and crypto from node and has no eval or process access', () => {
    const src = readFileSync(new URL('../loket/loket.mjs', import.meta.url), 'utf8');
    assert.deepEqual([...src.matchAll(/from 'node:([a-z:]+)'/g)].map((m) => m[1]).sort(), ['crypto', 'http', 'net']);
    assert.doesNotMatch(src, /\beval\s*\(|new Function|\brequire\s*\(|child_process|worker_threads|process\.env/);
  });
  it('an internal failure is a plain 500 with no message, no stack and no path', async () => {
    reset(); const { base, logs } = await start({ opties: { laad: () => { throw new Error('geheim /pad/naar/sleutel.pem'); } } });
    const r = await post(base, [claim('x')]);
    assert.equal(r.status, 500);
    const t = await r.text();
    assert.deepEqual(JSON.parse(t), { fout: 'intern' });
    assert.ok(!JSON.stringify(logs).includes('geheim'), 'the message is not logged either');
  });
  it('logs say what happened without claim text or the caller address', async () => {
    reset(); const { base, logs } = await start();
    await post(base, [claim('Zeer Geheime Leverancier BV')]);
    const regel = logs.find((l) => l.pad === '/v1/vergelijk');
    assert.equal(regel.status, 200); assert.equal(regel.claims, 1); assert.equal(regel.methode, 'POST');
    assert.match(regel.wie, /^[0-9a-f]{8}$/);
    const alles = JSON.stringify(logs);
    assert.ok(!alles.includes('Geheime'), 'no claim text');
    assert.ok(!alles.includes('127.0.0.1'), 'no address');
  });
  it('the caller id in the logs is different after every start, so it cannot be followed over time', async () => {
    reset(); const a = await start(); const b = await start();
    await fetch(a.base + '/v1/gezondheid'); await fetch(b.base + '/v1/gezondheid');
    assert.notEqual(a.logs[0].wie, b.logs[0].wie);
  });
  it('the signing key never appears in any answer', async () => {
    reset(); const { base } = await start();
    const bodies = [await (await post(base, [claim('x')])).text(), await (await fetch(`${base}/v1/sleutel`)).text(), await (await fetch(`${base}/nope`)).text()];
    for (const b of bodies) assert.ok(!b.includes('PRIVATE KEY'));
  });
});

describe('loket: lijst in geheugen', () => {
  it('a verified list is reused for one TTL, then loaded again (so a broken list is noticed within a minute)', async () => {
    reset(); const dir = goodSnap(FRESH);
    const { base } = await start({ snapshotDir: dir });
    assert.equal((await (await post(base, [claim('PJSC Alrosa')])).json()).report.resultaten[0].uitkomst, 'TREFFER');
    writeFileSync(join(dir, 'eu-fsf', 'list.json'), 'kapot');
    nu += 30000;
    assert.equal((await (await post(base, [claim('PJSC Alrosa', 'b')])).json()).report.resultaten[0].uitkomst, 'TREFFER', 'still inside the TTL');
    nu += 31000;
    const j = await (await post(base, [claim('PJSC Alrosa', 'c')])).json();
    assert.equal(j.report.resultaten[0].uitkomst, 'ONMEETBAAR');
    assert.equal(j.report.resultaten[0].per_bron[0].reden, 'hash_klopt_niet');
  });
  it('a failed load is remembered only briefly, so a list that appears is picked up', async () => {
    reset(); const dir = join(root, 'komt'); mkdirSync(dir, { recursive: true });
    const { base } = await start({ snapshotDir: dir });
    assert.equal((await (await post(base, [claim('PJSC Alrosa')])).json()).report.resultaten[0].uitkomst, 'ONMEETBAAR');
    writeSnapshot(dir, 'eu-fsf', ENTITIES, K.priv, FRESH);
    nu += 2000;
    assert.equal((await (await post(base, [claim('PJSC Alrosa', 'b')])).json()).report.resultaten[0].uitkomst, 'ONMEETBAAR', 'inside the short TTL');
    nu += 4000;
    assert.equal((await (await post(base, [claim('PJSC Alrosa', 'c')])).json()).report.resultaten[0].uitkomst, 'TREFFER');
  });
  it('the cache keeps separate lists apart', () => {
    let calls = 0; const c = maakSnapshotCache({ klok, ttlMs: 1000, foutTtlMs: 1000, laad: (a) => { calls++; return { ok: true, id: a.dir + a.source }; } });
    reset();
    assert.equal(c({ dir: 'A', source: 'x' }).id, 'Ax'); assert.equal(c({ dir: 'B', source: 'x' }).id, 'Bx'); assert.equal(c({ dir: 'A', source: 'y' }).id, 'Ay'); assert.equal(c({ dir: 'A', source: 'x' }).id, 'Ax');
    assert.equal(calls, 3);
  });
});

describe('loket: opstarten', () => {
  const START = new URL('../loket/start.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  it('refuses unknown, repeated or valueless options, a low port and a missing file', async () => {
    const { spawnSync } = await import('node:child_process');
    const d = goodSnap(FRESH); const pub = join(root, 'p.pem'), priv = join(root, 'k.pem'); writeFileSync(pub, K.pub); writeFileSync(priv, K.priv);
    const ok = ['--snapshots', d, '--pub', pub, '--key', priv];
    for (const extra of [['--bogus', '1'], ['--port', '80'], ['--port', 'abc'], ['--port'], ['--port', '9000', '--port', '9001'], ['--vertrouw-proxy', 'misschien']]) {
      assert.equal(spawnSync('node', [START, ...ok, ...extra], { encoding: 'utf8', timeout: 5000 }).status, 2, extra.join(' '));
    }
    assert.equal(spawnSync('node', [START, '--snapshots', d], { encoding: 'utf8', timeout: 5000 }).status, 2);
  });
  it('starts on loopback, answers, and stops cleanly on SIGTERM', async () => {
    const { spawn } = await import('node:child_process');
    const d = goodSnap({ manifest: { fetchedAt: new Date(Date.now() - 3600000).toISOString(), asOf: new Date().toISOString().slice(0, 10) } });
    const pub = join(root, 'p2.pem'), priv = join(root, 'k2.pem'); writeFileSync(pub, K.pub); writeFileSync(priv, K.priv);
    const vrij = await new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
    const child = spawn('node', [START, '--snapshots', d, '--pub', pub, '--key', priv, '--port', String(vrij)], { stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      const eerste = await new Promise((resolve, reject) => { child.stdout.once('data', (b) => resolve(String(b))); child.once('error', reject); setTimeout(() => reject(new Error('geen start')), 5000); });
      assert.deepEqual({ ...JSON.parse(eerste), gebeurtenis: 'luistert' }, { gebeurtenis: 'luistert', adres: '127.0.0.1', poort: vrij });
      const j = await (await post('http://127.0.0.1:' + vrij, [claim('PJSC Alrosa')])).json();
      assert.equal(j.report.resultaten[0].uitkomst, 'TREFFER');
    } finally {
      const klaar = new Promise((resolve) => child.once('exit', (code, sig) => resolve({ code, sig })));
      child.kill('SIGTERM');
      const e = await klaar;
      assert.ok(process.platform === 'win32' ? (e.code === 0 || e.sig === 'SIGTERM') : e.code === 0, JSON.stringify(e));
    }
  });
});

describe('loket: de lijsten waarmee vergeleken wordt', () => {
  it('compares with the lists it was started with: a clean name is GEEN_TREFFER_IN_LIJST when only the list that is there is asked', async () => {
    reset(); const { base } = await start();
    const j = await (await post(base, [claim('Unknown Firm')])).json();
    assert.equal(j.report.resultaten[0].uitkomst, 'GEEN_TREFFER_IN_LIJST');
    assert.deepEqual(j.report.bronnen.map((b) => b.bron), ['eu-fsf']);
  });
  it('without a choice it asks for the default set, so a clean name is ONMEETBAAR while a list is missing', async () => {
    reset(); const { base } = await start({ opties: { required: undefined } });
    const j = await (await post(base, [claim('Unknown Firm')])).json();
    assert.equal(j.report.resultaten[0].uitkomst, 'ONMEETBAAR');
    assert.deepEqual(j.report.bronnen.map((b) => b.bron), ['eu-fsf', 'uk-sanctions', 'ofac-sdn']);
  });
});
