// The counter: a small HTTP front for the checker. Zero dependencies. It listens on loopback ONLY (see `luister`); anything that
// should reach it from outside (payment, identity, TLS) belongs in the proxy in front of it. Fail-closed like the CLI: a missing,
// stale or refused list gives a 200 with ONMEETBAAR in the report, never an error that could be mistaken for "nothing found".
import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { InvalidInput, VERSION, keyId, runCheck, signReport } from '../src/check.mjs';
import { hoogsteVolgnummer, loadSnapshot } from '../src/snapshot.mjs';
import { StrictJsonError, parseStrict } from '../src/strict-json.mjs';

export const STANDAARD = {
  maxBodyBytes: 64 * 1024,
  maxClaims: 25,
  perClientAanvragenPerMinuut: 20,
  perClientClaimsPerMinuut: 100,
  globaalClaimsPerMinuut: 600,
  maxClients: 10000,
  maxAgeDagen: 2,
  snapshotTtlMs: 60 * 1000,
  snapshotFoutTtlMs: 5 * 1000,
  headersTimeoutMs: 10000,
  requestTimeoutMs: 15000,
};

// Token bucket. `kosten` is what one call spends (one request, or the number of claims). Idle buckets are forgotten, and when the
// table is full the least recently used one goes, so a flood of different callers cannot grow memory without bound.
export function maakLimiet({ capaciteit, perMinuut, klok, maxSleutels = STANDAARD.maxClients }) {
  const perMs = perMinuut / 60000;
  const emmers = new Map();
  return {
    probeer(sleutel, kosten = 1) {
      const nu = klok();
      let b = emmers.get(sleutel);
      if (b) { b.tokens = Math.min(capaciteit, b.tokens + (nu - b.t) * perMs); b.t = nu; emmers.delete(sleutel); } else {
        if (emmers.size >= maxSleutels) emmers.delete(emmers.keys().next().value);
        b = { tokens: capaciteit, t: nu };
      }
      emmers.set(sleutel, b);
      if (kosten <= b.tokens) { b.tokens -= kosten; return { ok: true }; }
      return { ok: false, wachtSeconden: kosten > capaciteit ? 3600 : Math.max(1, Math.ceil((kosten - b.tokens) / perMs / 1000)) };
    },
    grootte: () => emmers.size,
  };
}

// A verified list is kept in memory for a short while, so a request does not re-read, re-hash and re-index the whole list.
// The freshness limit is judged when the list is (re)loaded, so it can be at most one TTL late.
export function maakSnapshotCache({ klok, ttlMs, foutTtlMs, laad = loadSnapshot, ondergrens = () => undefined }) {
  const cache = new Map();
  // The highest run number this counter has served per source. A validly signed OLDER list (a rollback) is refused from then on,
  // as is a list that lost its number. This memory lives as long as the process; the status tool checks the ledger on disk.
  const hoogste = new Map();
  return (args) => {
    const sleutel = JSON.stringify([args.dir, args.source]);
    const nu = klok();
    const hit = cache.get(sleutel);
    if (hit && nu - hit.t < (hit.snap.ok ? ttlMs : foutTtlMs)) return hit.snap;
    let snap = laad({ ...args, now: new Date(nu) });
    if (snap.ok) {
      const v = snap.manifest?.volgnummer;
      // The floor is the highest number seen by this process and the highest in the feeder's ledger on disk (which survives a restart).
      let schijf;
      try { schijf = ondergrens(args.source); } catch { schijf = null; }
      const h = schijf === null ? undefined : (Math.max(hoogste.get(sleutel) ?? 0, schijf ?? 0) || undefined);
      if (schijf === null) snap = { ok: false, reason: 'ledger_onleesbaar' };
      else if (h !== undefined && (v === undefined || v < h)) snap = { ok: false, reason: v === undefined ? 'volgnummer_ontbreekt' : 'volgnummer_terug' };
      else if (v !== undefined) hoogste.set(sleutel, v);
    }
    cache.set(sleutel, { t: nu, snap });
    return snap;
  };
}

// One caller must not get a fresh budget by changing address. An IPv6 customer normally owns a whole /64, so all addresses in one /64 are
// one caller. An IPv4-mapped IPv6 address counts as its IPv4 address. An IPv6 address we cannot read goes into one shared bucket.
export function clientSleutel(adres) {
  const a = String(adres).split('%')[0].toLowerCase();
  const mapped = /^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/.exec(a);
  if (mapped) return mapped[1];
  if (a === 'onbekend') return a;
  const soort = isIP(a);
  if (soort === 4) return a;
  // Anything that is not an address (a made-up header value) shares one bucket, so it can neither be rotated nor grow the table.
  if (soort !== 6) return 'ongeldig-adres';
  let delen;
  if (a.includes('::')) {
    const [l, r] = a.split('::');
    const L = l ? l.split(':') : [], R = r ? r.split(':') : [];
    delen = [...L, ...Array(Math.max(0, 8 - L.length - R.length)).fill('0'), ...R];
  } else delen = a.split(':');
  if (delen.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return 'ipv6-onleesbaar';
  return delen.slice(0, 4).map((h) => h.padStart(4, '0')).join(':') + '::/64';
}

const KOPPEN = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const FOUTEN = { 421: 'verkeerde_host', 400: 'ongeldige_invoer', 404: 'onbekend_adres', 405: 'methode_niet_toegestaan', 413: 'te_groot', 415: 'alleen_json', 429: 'te_veel_aanvragen', 500: 'intern' };

// Behind our own proxy the socket address is the proxy; the proxy appends the real caller as the LAST entry of x-forwarded-for.
// Entries before it come from the caller and are never trusted.
export function clientVan(req, vertrouwProxy) {
  const adres = req.socket.remoteAddress ?? 'onbekend';
  if (vertrouwProxy && (adres === '127.0.0.1' || adres === '::1' || adres === '::ffff:127.0.0.1')) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') { const last = xff.split(',').pop().trim(); if (last) return clientSleutel(last); }
  }
  return clientSleutel(adres);
}

// The Host names under which a program on this machine reaches the counter. Without a trusted proxy anything else is refused.
export function isLokaleHost(host) {
  const naam = String(host ?? '').toLowerCase().replace(/:[0-9]{1,5}$/, '');
  return naam === '127.0.0.1' || naam === 'localhost' || naam === '[::1]';
}

export function maakLoket({ snapshotDir, pubKeyPem, privKeyPem, limieten = {}, klok = () => Date.now(), log = () => {}, vertrouwProxy = false, laad = loadSnapshot, ledgerPad = null, required = undefined }) {
  const L = { ...STANDAARD, ...limieten };
  const pub = createPublicKey(pubKeyPem);
  const sleutelId = keyId(pubKeyPem);
  // Reports are signed with the private key but the public key is what readers fetch: a pair that does not match would sign
  // reports that nobody can verify against the key we advertise.
  if (keyId(privKeyPem) !== sleutelId) throw new Error('privésleutel en publieke sleutel horen niet bij elkaar');
  const pubPem = pub.export({ type: 'spki', format: 'pem' });
  // The id in logs is a salted hash that changes with every start: enough to see "one caller did this", not to know who it was.
  const zout = randomBytes(8);
  const wie = (ip) => createHash('sha256').update(zout).update(ip).digest('hex').slice(0, 8);
  const perAanvraag = maakLimiet({ capaciteit: L.perClientAanvragenPerMinuut, perMinuut: L.perClientAanvragenPerMinuut, klok, maxSleutels: L.maxClients });
  const perClaims = maakLimiet({ capaciteit: L.perClientClaimsPerMinuut, perMinuut: L.perClientClaimsPerMinuut, klok, maxSleutels: L.maxClients });
  const globaal = maakLimiet({ capaciteit: L.globaalClaimsPerMinuut, perMinuut: L.globaalClaimsPerMinuut, klok, maxSleutels: 1 });
  const loadSnap = maakSnapshotCache({ klok, ttlMs: L.snapshotTtlMs, foutTtlMs: L.snapshotFoutTtlMs, laad, ondergrens: ledgerPad ? (bron) => hoogsteVolgnummer(ledgerPad, bron) : undefined });


  function stuur(res, status, body, extra = {}) {
    const tekst = JSON.stringify(body);
    res.writeHead(status, { ...KOPPEN, 'content-length': Buffer.byteLength(tekst), ...extra });
    res.end(tekst);
    return status;
  }
  const fout = (res, status, bericht, extra) => stuur(res, status, { fout: FOUTEN[status], ...(bericht ? { bericht } : {}) }, extra);

  // Reads at most `max` bytes; the caller never sees more. Resolves null when the body is too big.
  const leesBody = (req, max) => new Promise((resolve, reject) => {
    let totaal = 0; const delen = [];
    req.on('data', (d) => {
      totaal += d.length;
      if (totaal > max) { resolve(null); req.removeAllListeners('data'); req.resume(); return; }
      delen.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(delen)));
    req.on('error', reject);
  });

  async function vergelijk(req, res, wieIs) {
    const ct = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (ct !== 'application/json') return { status: fout(res, 415) };
    const cl = req.headers['content-length'];
    if (cl !== undefined && Number(cl) > L.maxBodyBytes) return { status: fout(res, 413, null, { connection: 'close' }) };
    const buf = await leesBody(req, L.maxBodyBytes);
    if (buf === null) return { status: fout(res, 413, null, { connection: 'close' }) };
    let claims;
    try { claims = parseStrict(buf.toString('utf8')); } catch (e) { return { status: fout(res, 400, e instanceof StrictJsonError ? e.message : 'geen geldige JSON') }; }
    if (!Array.isArray(claims) || claims.length < 1 || claims.length > L.maxClaims) return { status: fout(res, 400, `een lijst van 1 tot ${L.maxClaims} claims verwacht`) };
    const a = perClaims.probeer(wieIs, claims.length);
    const g = a.ok ? globaal.probeer('globaal', claims.length) : a;
    if (!g.ok) return { status: fout(res, 429, null, { 'retry-after': String(g.wachtSeconden) }), claims: claims.length };
    let rapport;
    try {
      rapport = signReport(runCheck({ claims, snapshotDir, pubKeyPem, now: new Date(klok()), klok: 'systeem', maxAgeDays: L.maxAgeDagen, loadSnap, required }), privKeyPem);
    } catch (e) {
      if (e instanceof InvalidInput) return { status: fout(res, 400, String(e.message).slice(0, 200)), claims: claims.length };
      throw e;
    }
    stuur(res, 200, rapport, { 'x-muqarin-ergste': rapport.report.samenvatting.ergste });
    return { status: 200, claims: claims.length };
  }

  const server = createServer({ maxHeaderSize: 8192, connectionsCheckingInterval: 1000 }, async (req, res) => {
    const t0 = klok();
    const wieIs = clientVan(req, vertrouwProxy);
    let pad = '?', status = 500, claims = 0;
    try {
      try { pad = new URL(req.url, 'http://loket.invalid').pathname; } catch { fout(res, 400, 'ongeldig adres'); status = 400; return; }
      // Without a trusted proxy the counter is for the local machine only. A page in a browser that was tricked into asking a name that
      // points at 127.0.0.1 (DNS rebinding) carries another Host header, and is refused.
      if (!vertrouwProxy && !isLokaleHost(req.headers.host)) { status = 421; fout(res, 421, null, { connection: 'close' }); req.resume(); return; }
      const a = perAanvraag.probeer(wieIs);
      if (!a.ok) { status = 429; fout(res, 429, null, { 'retry-after': String(a.wachtSeconden), connection: 'close' }); req.resume(); return; }
      if (pad === '/v1/vergelijk') {
        if (req.method !== 'POST') { status = 405; fout(res, 405, null, { allow: 'POST' }); return; }
        const r = await vergelijk(req, res, wieIs);
        status = r.status; claims = r.claims ?? 0;
      } else if (pad === '/v1/sleutel' || pad === '/v1/gezondheid') {
        if (req.method !== 'GET') { status = 405; fout(res, 405, null, { allow: 'GET' }); return; }
        status = 200;
        stuur(res, 200, pad === '/v1/sleutel' ? { sleutel_id: sleutelId, publieke_sleutel: pubPem } : { ok: true, tool: 'al-muqarin', versie: VERSION });
      } else { status = 404; fout(res, 404); }
    } catch (e) {
      status = 500;
      log({ gebeurtenis: 'fout', soort: e?.name ?? 'Error' });
      if (!res.headersSent) fout(res, 500);
    } finally {
      log({ tijd: new Date(t0).toISOString(), wie: wie(wieIs), methode: req.method, pad: pad.slice(0, 40), status, claims, ms: klok() - t0 });
    }
  });
  server.headersTimeout = L.headersTimeoutMs;
  server.requestTimeout = L.requestTimeoutMs;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  server.maxConnections = 200;
  return server;
}

// The only way the counter is ever started: on the loopback interface. Reaching it from outside is the proxy's job.
export const luister = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => resolve(server.address()));
});
