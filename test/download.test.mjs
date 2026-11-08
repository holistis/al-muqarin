import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { downloadXml } from '../feeder/download.mjs';

let server, base;
before(async () => {
  server = createServer((req, res) => {
    if (req.url.split('?')[0] === '/ok') { res.writeHead(200, { 'content-type': 'application/xml' }); res.end('<a/>'); }
    else if (req.url === '/html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<a/>'); }
    else if (req.url === '/big') { res.writeHead(200, { 'content-type': 'application/xml' }); res.end('x'.repeat(5000)); }
    else if (req.url === '/redirect') { res.writeHead(302, { location: 'http://localhost:' + server.address().port + '/ok' }); res.end(); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// The test server speaks plain http on loopback; the real downloader refuses that unless told otherwise.
const dl = (path, over = {}) => downloadXml({ url: base + path, allowedHost: new URL(base).host, toestaanHttp: true, ...over });

describe('download limits', () => {
  it('accepts a small xml from the allowed host', async () => assert.equal((await dl('/ok')).toString(), '<a/>'));
  it('rejects another host', async () => await assert.rejects(dl('/ok', { allowedHost: 'webgate.ec.europa.eu' }), /andere host/));
  it('rejects a redirect to another host', async () => await assert.rejects(dl('/redirect'), /andere host/));
  it('rejects non-xml', async () => await assert.rejects(dl('/html'), /geen xml/));
  it('rejects http errors', async () => await assert.rejects(dl('/nope'), /http 404/));
  it('rejects a body over the size cap', async () => await assert.rejects(dl('/big', { maxBytes: 1000 }), /te groot/));
  it('times out', async () => await assert.rejects(dl('/ok', { timeoutMs: 1, fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('timeout')))) }), /timeout/));
});

describe('download: several hosts and a path prefix', () => {
  it('accepts any host of a list, and a path under the prefix', async () => {
    assert.equal((await dl('/ok', { allowedHost: ['webgate.ec.europa.eu', new URL(base).host], allowedPathPrefix: '/' })).toString(), '<a/>');
  });
  it('rejects a host that is in no list entry', async () => await assert.rejects(dl('/ok', { allowedHost: ['a.example', 'b.example'] }), /andere host/));
  it('rejects an empty list of hosts', async () => await assert.rejects(dl('/ok', { allowedHost: [] }), /andere host/));
  it('rejects an address outside the path prefix, also after a redirect', async () => {
    await assert.rejects(dl('/ok', { allowedPathPrefix: '/publiclegacyxmlfiles/' }), /ander pad/);
    await assert.rejects(dl('/redirect', { allowedHost: [new URL(base).host, 'localhost:' + server.address().port], allowedPathPrefix: '/nope/' }), /ander pad/);
  });
  it('a prefix is a prefix of the path, not a piece of the query', async () => {
    await assert.rejects(dl('/ok?x=/ok', { allowedPathPrefix: '/ok/' }), /ander pad/);
  });
});

describe('download: https only', () => {
  it('refuses a download that ends on plain http, also when host and path are right', async () => {
    await assert.rejects(dl('/ok', { toestaanHttp: false }), /onbeveiligde verbinding/);
    await assert.rejects(dl('/ok', { toestaanHttp: undefined }), /onbeveiligde verbinding/);
  });
  it('accepts https (a fake fetch that ends on an https address)', async () => {
    const fetchImpl = async () => ({ ok: true, url: 'https://lijst.example/docs/x.xml', headers: new Map([['content-type', 'text/xml']]), body: (async function* () { yield Buffer.from('<a/>'); })() });
    assert.equal((await downloadXml({ url: 'https://lijst.example/docs/x.xml', allowedHost: 'lijst.example', allowedPathPrefix: '/docs/', fetchImpl })).toString(), '<a/>');
  });
  it('refuses a redirect from https to http on the same host', async () => {
    const fetchImpl = async () => ({ ok: true, url: 'http://lijst.example/docs/x.xml', headers: new Map([['content-type', 'text/xml']]), body: (async function* () { yield Buffer.from('<a/>'); })() });
    await assert.rejects(downloadXml({ url: 'https://lijst.example/docs/x.xml', allowedHost: 'lijst.example', fetchImpl }), /onbeveiligde verbinding/);
  });
});
