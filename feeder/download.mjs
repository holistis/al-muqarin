// Network download with hard limits. Lives in feeder/, never in src/ (the checker has no network).
export async function downloadXml({ url, allowedHost, maxBytes = 100 * 1024 * 1024, timeoutMs = 120000, fetchImpl = fetch }) {
  const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'al-muqarin-research' } });
  if (!res.ok) throw new Error(`http ${res.status}`);
  if (new URL(res.url).host !== allowedHost) throw new Error('omleiding naar andere host geweigerd');
  if (!/xml/.test(res.headers.get('content-type') ?? '')) throw new Error('geen xml');
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw new Error('te groot');
  const chunks = []; let total = 0;
  for await (const c of res.body) { total += c.length; if (total > maxBytes) throw new Error('te groot'); chunks.push(c); }
  return Buffer.concat(chunks);
}
