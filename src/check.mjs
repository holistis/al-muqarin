import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { canonical } from './canon.mjs';
import { ISO_ALPHA2 } from './countries.mjs';
import { dice, foldKey, foldTolerance, normalizeName, tokenKey, trigrams } from './normalize.mjs';
import { loadSnapshot, sha256Hex } from './snapshot.mjs';

export const VERSION = '0.0.1';
export const MAX_CLAIMS = 200;
export const REQUIRED = { entity: ['eu-fsf'], country: ['cahras'] };
export const OUTCOMES = ['TREFFER', 'KANDIDAAT', 'ONMEETBAAR', 'GEEN_TREFFER_IN_LIJST'];
const RANK = { TREFFER: 4, KANDIDAAT: 3, ONMEETBAAR: 2, GEEN_TREFFER_IN_LIJST: 1 };

export const DISCLAIMER = 'Dit is een vergelijking met openbare lijsten. Het is geen audit, geen keurmerk en geen juridisch advies; de wettelijk vereiste controle door een erkende instantie blijft nodig.';
export const LIMITS = [
  'Alleen Latijnse letters en cijfers worden vergeleken; namen in andere schriften geven ONMEETBAAR.',
  'Een naam kan gesanctioneerd zijn zonder zelf op een lijst te staan, bijvoorbeeld via eigendom; dat wordt niet gecontroleerd.',
  'GEEN_TREFFER_IN_LIJST betekent alleen: geen overeenkomst in de genoemde lijstversie op de genoemde datum.',
  'Alleen de genoemde bronnen en versies zijn bekeken; andere lijsten niet.',
  'Een naam die slechts een deel van een lijstnaam is, wordt alleen gemarkeerd als ze minstens twee woorden delen, of als het enige woord zeldzaam is in de lijst.',
  'Een treffer of kandidaat is alleen een overeenkomst van namen en bewijst niet dat het dezelfde partij is.',
  'Een meegegeven geboortejaar of land wordt alleen als aanwijzing bij elke kandidaat getoond (komt_overeen, wijkt_af of onbekend); het verandert de uitkomst nooit.',
];
const RARE_MAX = 25;
export const MIN_DEKKING = 0.9;

export class InvalidInput extends Error {}

// Optimal string alignment distance: insert, delete, substitute and swap of two adjacent letters each cost 1.
// Returns max + 1 as soon as the distance is certainly above `max` (checks the last two rows, because a swap looks two rows back).
export function editDistance(a, b, max) {
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let prevMin = 0;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (Math.min(rowMin, prevMin) > max) return max + 1;
    prev2 = prev; prev = cur; prevMin = rowMin;
  }
  return prev[b.length];
}

// What a refused claim leaves in a signed report comes from a fixed set: its id only if it is a valid id, its type only if it is a known one.
// Nothing else the sender wrote is echoed.
const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
function validateClaim(c, index, seen) {
  const label = c && typeof c === 'object' && typeof c.id === 'string' && ID_RE.test(c.id) ? c.id : `#${index}`;
  const bad = (reden) => ({ ok: false, id: label, type: c && typeof c.type === 'string' && Object.hasOwn(REQUIRED, c.type) ? c.type : null, reden });
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return bad('claim_vorm');
  const ks = Object.keys(c);
  if (!['id', 'type', 'value'].every((k) => ks.includes(k)) || ks.some((k) => !['id', 'type', 'value', 'birthYear', 'country'].includes(k))) return bad('claim_velden');
  if (typeof c.id !== 'string' || !ID_RE.test(c.id)) return bad('claim_id');
  if (seen.has(c.id)) return bad('claim_id_dubbel');
  seen.add(c.id);
  if (!Object.hasOwn(REQUIRED, c.type)) return bad('claim_type');
  if (typeof c.value !== 'string' || c.value.length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(c.value) || !c.value.trim()) return bad('claim_waarde');
  if (c.type !== 'entity' && (ks.includes('birthYear') || ks.includes('country'))) return bad('claim_velden');
  if (ks.includes('birthYear') && !(Number.isInteger(c.birthYear) && c.birthYear >= 1850 && c.birthYear <= 2100)) return bad('claim_jaar');
  if (ks.includes('country') && !(typeof c.country === 'string' && ISO_ALPHA2.has(c.country.toUpperCase()))) return bad('claim_land');
  return { ok: true, id: c.id, type: c.type, value: c.value.trim(), birthYear: c.birthYear, country: c.country?.toUpperCase() };
}

export function entityIndex(snap) {
  if (snap.index) return snap.index;
  const index = [];
  let skipped = 0;
  let readable = 0;
  for (const e of snap.entries) {
    let any = false;
    for (const n of e.names) {
      const { tokens, unsupported } = normalizeName(n);
      if (unsupported || !tokens.length) { skipped++; continue; }
      any = true;
      const k = tokenKey(tokens);
      index.push({ id: e.id, name: n, k, jk: tokens.join(''), fk: foldKey(tokens), tg: trigrams(k), set: new Set(tokens), soort: e.soort ?? 'onbekend' });
    }
    if (any) readable++;
  }
  const freq = new Map();
  for (const ent of index) for (const t of ent.set) freq.set(t, (freq.get(t) ?? 0) + 1);
  snap.freq = freq;
  snap.byId = new Map(snap.entries.map((e) => [e.id, e]));
  snap.index = index;
  snap.skipped = skipped;
  // Share of parties with at least one name we can compare. A list that is mostly unreadable would answer "no match" for everything.
  snap.dekking = snap.entries.length ? readable / snap.entries.length : 0;
  return index;
}

// All hits for one name, unsliced. Exported for the self-measurement tool; `exclude(ent)` allows leave-one-out tests.
export function collectHits(value, snap, threshold = 0.75, exclude = null) {
  const { tokens, unsupported } = normalizeName(value);
  if (unsupported) return { reden: 'schrift_niet_ondersteund', hits: [] };
  const k = tokenKey(tokens);
  if (k.replace(/ /g, '').length < 3) return { reden: 'naam_te_kort', hits: [] };
  const tg = trigrams(k);
  const set = new Set(tokens);
  const maxEdits = k.length < 5 ? 0 : k.length < 12 ? 1 : 2;
  const fk = foldKey(tokens);
  const fMax = fk.replace(/ /g, '').length < 6 ? -1 : foldTolerance(fk.length);
  const hits = [];
  const index = entityIndex(snap);
  // A single distinctive word ("Alrosa") is flagged when it is rare in the list; common words ("bank") are not.
  const rareWord = set.size === 1 && k.length >= 5 && (snap.freq.get(k) ?? 0) > 0 && snap.freq.get(k) <= RARE_MAX ? k : null;
  // The same letters with other word breaks ("Sber bank" / "Sberbank", "Al Hassan" / "Alhassan"): joined in reading order.
  const jk = tokens.join('');
  // Initials ("A. Luzyanin", "Sokolovski I"): single letters carry no weight, the remaining words are matched as if they stood alone.
  const core = tokens.filter((t) => t.length > 1);
  const coreSet = core.length > 0 && core.length < tokens.length ? new Set(core) : null;
  const rareCore = coreSet && coreSet.size === 1 && core[0].length >= 5 && (snap.freq.get(core[0]) ?? 0) > 0 && snap.freq.get(core[0]) <= RARE_MAX ? core[0] : null;
  for (const ent of index) {
    if (exclude && exclude(ent)) continue;
    if (ent.k === k) { hits.push({ id: ent.id, naam: ent.name, soort: ent.soort, score: 1, reden: 'exact' }); continue; }
    let reden = null;
    if (jk.length >= 6 && ent.jk === jk) reden = 'samenvoeging';
    else if (maxEdits && Math.abs(ent.k.length - k.length) <= maxEdits && editDistance(k, ent.k, maxEdits) <= maxEdits) reden = 'typefout';
    if (!reden && fMax >= 0 && Math.abs(ent.fk.length - fk.length) <= fMax && editDistance(fk, ent.fk, fMax) <= fMax) reden = 'transliteratie';
    if (!reden) {
      const [s, l] = set.size <= ent.set.size ? [set, ent.set] : [ent.set, set];
      if (s.size >= 2 && [...s].every((t) => l.has(t))) reden = 'deelnaam';
    }
    if (!reden && rareWord && ent.set.has(rareWord)) reden = 'enkel_woord';
    // The other way round: the listed name is one rare word and the claim contains it ("Alrosa Trading" vs "PJSC Alrosa").
    // Not for persons: single first names or surnames in the list would flag almost every person name.
    if (!reden && ent.soort !== 'persoon' && ent.set.size === 1 && ent.k.length >= 5 && set.has(ent.k) && (snap.freq.get(ent.k) ?? 0) <= RARE_MAX) reden = 'enkel_woord';
    if (!reden && coreSet) {
      const [s, l] = coreSet.size <= ent.set.size ? [coreSet, ent.set] : [ent.set, coreSet];
      if ((s.size >= 2 && [...s].every((t) => l.has(t))) || (rareCore && ent.set.has(rareCore))) reden = 'initiaal';
    }
    if (!reden && (2 * Math.min(tg.size, ent.tg.size)) / (tg.size + ent.tg.size) >= threshold && dice(tg, ent.tg) >= threshold) reden = 'gelijkenis';
    if (reden) hits.push({ id: ent.id, naam: ent.name, soort: ent.soort, score: Math.round(dice(tg, ent.tg) * 1000) / 1000, reden });
  }
  return { hits };
}

// Hint only: how a claimed birth year / country compares with what the list says about this party. Never changes an outcome,
// because a list can be incomplete and a claim can be off by a year; a real match must never be talked down by it.
export function onderscheid(entry, { birthYear, country } = {}) {
  const out = {};
  if (birthYear !== undefined) {
    const ys = entry?.jaren ?? [];
    const tol = entry?.ongeveer ? 2 : 0;
    out.jaar = !ys.length ? 'onbekend' : ys.some((y) => Math.abs(y - birthYear) <= tol) ? 'komt_overeen' : 'wijkt_af';
  }
  if (country !== undefined) {
    const cs = entry?.landen ?? [];
    out.land = !cs.length ? 'onbekend' : cs.includes(country) ? 'komt_overeen' : 'wijkt_af';
  }
  return out;
}

function matchEntity(value, snap, threshold, extra = {}) {
  entityIndex(snap);
  if (snap.dekking < MIN_DEKKING) return { uitkomst: 'ONMEETBAAR', reden: 'bron_te_veel_onleesbare_namen' };
  const { reden, hits } = collectHits(value, snap, threshold);
  if (reden) return { uitkomst: 'ONMEETBAAR', reden };
  if (!hits.length) return { uitkomst: 'GEEN_TREFFER_IN_LIJST' };
  const given = extra.birthYear !== undefined || extra.country !== undefined;
  const agree = (h) => (given ? Object.values(onderscheid(snap.byId.get(h.id), extra)).filter((v) => v === 'komt_overeen').length : 0);
  hits.sort((a, b) => (b.reden === 'exact') - (a.reden === 'exact') || agree(b) - agree(a) || b.score - a.score);
  const kandidaten = hits.slice(0, 3).map((h) => (given ? { ...h, onderscheid: onderscheid(snap.byId.get(h.id), extra) } : h));
  return { uitkomst: hits.some((h) => h.reden === 'exact') ? 'TREFFER' : 'KANDIDAAT', kandidaten };
}

function matchCountry(value, snap) {
  const code = value.toUpperCase();
  if (!ISO_ALPHA2.has(code)) return { uitkomst: 'ONMEETBAAR', reden: 'landcode_onbekend' };
  const hit = snap.entries.find((e) => e.code === code);
  return hit ? { uitkomst: 'TREFFER', kandidaten: [{ id: hit.id, naam: hit.names[0] ?? code, score: 1 }] } : { uitkomst: 'GEEN_TREFFER_IN_LIJST' };
}

const worstOf = (outcomes) => outcomes.reduce((w, o) => (RANK[o] > RANK[w] ? o : w), 'GEEN_TREFFER_IN_LIJST');
const claimHash = (raw) => { try { return sha256Hex(Buffer.from(canonical(raw))); } catch { return null; } };
// Short fingerprint of a public key (accepts a PEM or a key object), so a reader can see which key signed without trusting a file name.
export const keyId = (key) => sha256Hex(createPublicKey(key).export({ type: 'spki', format: 'der' })).slice(0, 32);
const tally = (uitkomsten) => Object.fromEntries(OUTCOMES.map((o) => [o, uitkomsten.filter((x) => x === o).length]));

// Plain-language line per claim, so a reader who skips the details cannot read a green into an outcome that is not one.
function toelichting(uitkomst, per_bron, snaps) {
  const bronnen = per_bron.filter((p) => p.bron && snaps.get(p.bron)?.ok).map((p) => `${p.bron} van ${snaps.get(p.bron).manifest.asOf} (${snaps.get(p.bron).manifest.entryCount} regels)`).join(' en ');
  if (uitkomst === 'TREFFER') return `Dezelfde naam staat in ${bronnen}. Of het dezelfde partij is, is niet gecontroleerd: vergelijk land, geboortejaar en andere gegevens.`;
  if (uitkomst === 'KANDIDAAT') return `Een bijna gelijke naam staat in ${bronnen}. Vergelijk zelf of het dezelfde partij is.`;
  if (uitkomst === 'ONMEETBAAR') return `Niet gemeten (${per_bron.find((p) => p.uitkomst === 'ONMEETBAAR')?.reden ?? 'onbekend'}). Dit is geen groen: er is niets vergeleken of niet alles.`;
  return `Niet gevonden in ${bronnen}. Dit zegt niets over eigenaren, dochterbedrijven of andere lijsten.`;
}

export function runCheck({ claims, snapshotDir, pubKeyPem, now = new Date(), klok = 'systeem', maxAgeDays = 8, maxListAgeDays = 30, threshold = 0.75, required = REQUIRED, loadSnap = loadSnapshot, minVolgnummer = {} }) {
  if (!Array.isArray(claims) || claims.length < 1 || claims.length > MAX_CLAIMS) throw new InvalidInput(`claims: 1 tot ${MAX_CLAIMS} stuks verwacht`);
  // A minimum for a source we do not know would silently protect nothing (a typo in the source id), so it is an error.
  const bekend = new Set(Object.values(required).flat());
  for (const [bron, nr] of Object.entries(minVolgnummer)) {
    if (!bekend.has(bron) || !Number.isInteger(nr) || nr < 1) throw new InvalidInput('minimum volgnummer: onbekende bron of ongeldig nummer');
  }
  const snaps = new Map();
  const getSnap = (source) => {
    if (!snaps.has(source)) snaps.set(source, loadSnap({ dir: snapshotDir, source, pubKeyPem, now, maxAgeDays, maxListAgeDays, minVolgnummer: minVolgnummer[source] }));
    return snaps.get(source);
  };
  const seen = new Set();
  const resultaten = claims.map((raw, i) => {
    const c = validateClaim(raw, i, seen);
    const claim_sha256 = claimHash(raw);
    if (!c.ok) { const per_bron = [{ bron: null, uitkomst: 'ONMEETBAAR', reden: c.reden }]; return { id: c.id, type: typeof c.type === 'string' ? c.type : null, claim_sha256, uitkomst: 'ONMEETBAAR', toelichting: toelichting('ONMEETBAAR', per_bron, snaps), per_bron }; }
    const per_bron = required[c.type].map((source) => {
      const snap = getSnap(source);
      if (!snap.ok) return { bron: source, uitkomst: 'ONMEETBAAR', reden: snap.reason };
      const r = c.type === 'entity' ? matchEntity(c.value, snap, threshold, { birthYear: c.birthYear, country: c.country }) : matchCountry(c.value, snap);
      return { bron: source, ...r };
    });
    const uitkomst = worstOf(per_bron.map((p) => p.uitkomst));
    return { id: c.id, type: c.type, claim_sha256, uitkomst, toelichting: toelichting(uitkomst, per_bron, snaps), per_bron };
  });
  const bronnen = [...snaps.entries()].map(([bron, s]) => s.ok
    ? { bron, bruikbaar: true, asOf: s.manifest.asOf, fetchedAt: s.manifest.fetchedAt, entryCount: s.manifest.entryCount, ...(s.manifest.volgnummer === undefined ? {} : { volgnummer: s.manifest.volgnummer, vorige_manifest_sha256: s.manifest.vorige_manifest_sha256 }), list_sha256: s.listSha256, manifest_sha256: s.manifestSha256, sourceUrl: s.manifest.sourceUrl, license: s.manifest.license, niet_vergelijkbare_namen: s.skipped ?? 0 }
    : { bron, bruikbaar: false, reden: s.reason });
  return {
    tool: 'al-muqarin', versie: VERSION, schema: 1,
    // `gemaakt` is the clock of whoever ran the check, as that person stated it ('opgegeven' = --now) or as the machine had it ('systeem').
    // It is not an independent timestamp.
    gemaakt: now.toISOString(), klok, max_leeftijd_dagen: maxAgeDays,
    // The lowest run number the reader demanded per source (empty when none): a reader can see which rollback protection applied.
    min_volgnummer: minVolgnummer,
    invoer_sha256: sha256Hex(Buffer.from(canonical(claims))),
    samenvatting: { ergste: worstOf(resultaten.map((r) => r.uitkomst)), aantallen: tally(resultaten.map((r) => r.uitkomst)) },
    bronnen, resultaten, beperkingen: LIMITS, disclaimer: DISCLAIMER,
  };
}

// The key id goes into the signed report, so a reader can tell WHICH key signed, not only that some key did.
export const signReport = (report, privKeyPem) => {
  const full = { ...report, sleutel_id: keyId(createPrivateKey(privKeyPem)) };
  return { report: full, handtekening: sign(null, Buffer.from(canonical(full)), createPrivateKey(privKeyPem)).toString('base64') };
};

// Beyond the signature this re-checks that the report is consistent with itself, and (with `claims`) that it is about exactly these claims.
// What it cannot prove: that the signer's clock was right, or that the signer ran the real code. Those need an outside timestamp / witness.
export function verifyReport(obj, pubKeyPem, { claims, expect } = {}) {
  try {
    if (obj === null || typeof obj !== 'object' || Object.keys(obj).sort().join() !== 'handtekening,report') return { ok: false, reden: 'vorm' };
    const pub = createPublicKey(pubKeyPem);
    if (pub.asymmetricKeyType !== 'ed25519') return { ok: false, reden: 'sleutel' };
    if (!verify(null, Buffer.from(canonical(obj.report)), pub, Buffer.from(obj.handtekening, 'base64'))) return { ok: false, reden: 'handtekening_ongeldig' };
    const r = obj.report;
    if (r.tool !== 'al-muqarin' || r.disclaimer !== DISCLAIMER || canonical(r.beperkingen) !== canonical(LIMITS)) return { ok: false, reden: 'verplichte_tekst_ontbreekt' };
    if (!Array.isArray(r.resultaten) || r.resultaten.some((x) => !OUTCOMES.includes(x.uitkomst))) return { ok: false, reden: 'uitkomst_onbekend' };
    if (r.schema !== 1 || typeof r.versie !== 'string') return { ok: false, reden: 'schema' };
    if (r.sleutel_id !== keyId(pubKeyPem)) return { ok: false, reden: 'sleutel_id_klopt_niet' };
    if (expect !== undefined && expect !== r.sleutel_id) return { ok: false, reden: 'sleutel_id_niet_verwacht' };
    if (r.klok !== 'systeem' && r.klok !== 'opgegeven') return { ok: false, reden: 'klok' };
    const gemaakt = Date.parse(r.gemaakt);
    if (typeof r.gemaakt !== 'string' || Number.isNaN(gemaakt) || new Date(gemaakt).toISOString() !== r.gemaakt) return { ok: false, reden: 'datum' };
    if (r.resultaten.length < 1 || r.resultaten.length > MAX_CLAIMS) return { ok: false, reden: 'resultaten_aantal' };
    for (const x of r.resultaten) {
      if (typeof x.id !== 'string' || !Array.isArray(x.per_bron) || !x.per_bron.length || x.per_bron.some((p) => !OUTCOMES.includes(p.uitkomst))) return { ok: false, reden: 'resultaat_vorm' };
      if (x.uitkomst !== worstOf(x.per_bron.map((p) => p.uitkomst))) return { ok: false, reden: 'uitkomst_strijdig_met_bron' };
    }
    const sam = { ergste: worstOf(r.resultaten.map((x) => x.uitkomst)), aantallen: tally(r.resultaten.map((x) => x.uitkomst)) };
    if (r.samenvatting === null || typeof r.samenvatting !== 'object' || canonical(r.samenvatting) !== canonical(sam)) return { ok: false, reden: 'samenvatting_klopt_niet' };
    if (!Number.isFinite(r.max_leeftijd_dagen) || r.max_leeftijd_dagen <= 0 || r.max_leeftijd_dagen > 60 || !Array.isArray(r.bronnen)) return { ok: false, reden: 'bronnen' };
    for (const b of r.bronnen.filter((x) => x.bruikbaar)) {
      const fetched = Date.parse(b.fetchedAt);
      if (Number.isNaN(fetched) || fetched > gemaakt + 5 * 60 * 1000 || gemaakt - fetched > r.max_leeftijd_dagen * 24 * 3600 * 1000) return { ok: false, reden: 'datum_buiten_bereik' };
    }
    // Every result must rest on sources this report itself lists; one that found or cleared something needs a usable source.
    const bronMap = new Map(r.bronnen.map((b) => [b.bron, b]));
    for (const x of r.resultaten) {
      for (const p of x.per_bron) {
        if (p.bron === null || p.bron === undefined) { if (x.uitkomst !== 'ONMEETBAAR') return { ok: false, reden: 'bron_ontbreekt' }; continue; }
        const b = typeof p.bron === 'string' ? bronMap.get(p.bron) : undefined;
        if (!b) return { ok: false, reden: 'bron_onbekend' };
        if (p.uitkomst !== 'ONMEETBAAR' && !b.bruikbaar) return { ok: false, reden: 'bron_onbruikbaar' };
      }
    }
    if (claims !== undefined) {
      if (!Array.isArray(claims) || claims.length !== r.resultaten.length || sha256Hex(Buffer.from(canonical(claims))) !== r.invoer_sha256
        || r.resultaten.some((x, i) => x.claim_sha256 !== claimHash(claims[i]))) return { ok: false, reden: 'claims_komen_niet_overeen' };
    }
    return { ok: true, sleutel_id: r.sleutel_id, klok: r.klok, gemaakt: r.gemaakt, claims_gecontroleerd: claims !== undefined };
  } catch {
    return { ok: false, reden: 'onleesbaar' };
  }
}
