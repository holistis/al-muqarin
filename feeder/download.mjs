// Network download with hard limits. Lives in feeder/, never in src/ (the checker has no network).
// `allowedHost` (one host or a list), the optional `allowedPathPrefix` and the protocol (https only) are checked on the address the
// download ENDS at, after any redirects: a list service may hand out a short-lived link on its own storage, but never on a host or path
// we did not name, and never over plain http. `toestaanHttp` is for the tests with a local server only.
export async function downloadXml({ url, allowedHost, allowedPathPrefix, toestaanHttp = false, maxBytes = 100 * 1024 * 1024, timeoutMs = 120000, fetchImpl = fetch }) {
  const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'al-muqarin-research' } });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const eind = new URL(res.url);
  if (eind.protocol !== 'https:' && !toestaanHttp) throw new Error('omleiding naar een onbeveiligde verbinding geweigerd');
  if (![allowedHost].flat().includes(eind.host)) throw new Error('omleiding naar andere host geweigerd');
  if (allowedPathPrefix !== undefined && !eind.pathname.startsWith(allowedPathPrefix)) throw new Error('omleiding naar ander pad geweigerd');
  if (!/xml/.test(res.headers.get('content-type') ?? '')) throw new Error('geen xml');
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw new Error('te groot');
  const chunks = []; let total = 0;
  for await (const c of res.body) { total += c.length; if (total > maxBytes) throw new Error('te groot'); chunks.push(c); }
  return Buffer.concat(chunks);
}
