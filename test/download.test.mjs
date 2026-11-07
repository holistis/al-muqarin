import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { downloadXml } from '../feeder/download.mjs';

let server, base;
before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/ok') { res.writeHead(200, { 'content-type': 'application/xml' }); res.end('<a/>'); }
    else if (req.url === '/html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<a/>'); }
    else if (req.url === '/big') { res.writeHead(200, { 'content-type': 'application/xml' }); res.end('x'.repeat(5000)); }
    else if (req.url === '/redirect') { res.writeHead(302, { location: 'http://localhost:' + server.address().port + '/ok' }); res.end(); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const dl = (path, over = {}) => downloadXml({ url: base + path, allowedHost: new URL(base).host, ...over });

describe('download limits', () => {
  it('accepts a small xml from the allowed host', async () => assert.equal((await dl('/ok')).toString(), '<a/>'));
  it('rejects another host', async () => await assert.rejects(dl('/ok', { allowedHost: 'webgate.ec.europa.eu' }), /andere host/));
  it('rejects a redirect to another host', async () => await assert.rejects(dl('/redirect'), /andere host/));
  it('rejects non-xml', async () => await assert.rejects(dl('/html'), /geen xml/));
  it('rejects http errors', async () => await assert.rejects(dl('/nope'), /http 404/));
  it('rejects a body over the size cap', async () => await assert.rejects(dl('/big', { maxBytes: 1000 }), /te groot/));
  it('times out', async () => await assert.rejects(dl('/ok', { timeoutMs: 1, fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('timeout')))) }), /timeout/));
});
