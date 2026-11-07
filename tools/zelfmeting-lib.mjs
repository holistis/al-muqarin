// Self-measurement of the matcher on a real snapshot. Deterministic (seeded). No network.
import { collectHits, entityIndex, onderscheid } from '../src/check.mjs';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const LET = [...'abcdefghijklmnopqrstuvwxyz'];
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const letterPos = (s) => { const p = []; for (let i = 1; i < s.length; i++) if (/[A-Za-z]/.test(s[i])) p.push(i); return p; };

const INVISIBLE = [0xad, 0x200b, 0x200d, 0x2060];   // soft hyphen, zero-width space, zero-width joiner, word joiner
const INVISIBLE_BREED = [0x2800, 0x3164, 0x115f, 0x1160, 0xffa0, 0xfe0f, 0x034f, 0x2060, 0x180e, 0xe0020];
const SYMBOLEN = [0x2122, 0x2120, 0x2116, 0x2121, 0x213b, 0x33c2];
export const MUTATIONS = {
  typo_vervang: (s, r) => { const p = letterPos(s); if (!p.length) return null; const i = pick(r, p); let c; do { c = pick(r, LET); } while (c === s[i].toLowerCase()); return s.slice(0, i) + c + s.slice(i + 1); },
  typo_weg: (s, r) => { const p = letterPos(s); if (!p.length) return null; const i = pick(r, p); return s.slice(0, i) + s.slice(i + 1); },
  typo_extra: (s, r) => { const p = letterPos(s); if (!p.length) return null; const i = pick(r, p); return s.slice(0, i) + pick(r, LET) + s.slice(i); },
  wissel: (s, r) => { const p = letterPos(s).filter((i) => i + 1 < s.length && /[A-Za-z]/.test(s[i + 1]) && s[i].toLowerCase() !== s[i + 1].toLowerCase()); if (!p.length) return null; const i = pick(r, p); return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2); },
  volgorde: (s) => { const w = s.split(/\s+/); return w.length >= 2 ? w.reverse().join(' ') : null; },
  woord_weg: (s, r) => { const w = s.split(/\s+/); if (w.length < 3) return null; w.splice(Math.floor(r() * w.length), 1); return w.join(' '); },
  woord_erbij: (s) => `${s} Trading`,
  schrijfwijze: (s) => s.toUpperCase().split(/\s+/).join(' , '),
  juridisch: (s) => `PJSC ${s} Ltd`,
  // Classes the panel review found we were blind to: text pasted with invisible characters, a word broken in two,
  // an initial in front of the name, an acronym written with dots.
  onzichtbaar: (s, r) => { const p = letterPos(s); if (!p.length) return null; const i = pick(r, p); return s.slice(0, i) + String.fromCharCode(pick(r, INVISIBLE)) + s.slice(i); },
  gesplitst: (s, r) => { const p = letterPos(s).filter((i) => /[A-Za-z]/.test(s[i - 1])); if (!p.length) return null; const i = pick(r, p); return `${s.slice(0, i)} ${s.slice(i)}`; },
  initiaal: (s) => `A. ${s}`,
  // Found by the outside review of 7 Nov: invisible characters beyond the format category (Braille blank, Hangul fillers, variation selectors),
  // and symbols that Unicode compatibility turns into letters (trade mark, numero, telephone), written behind or between the words.
  onzichtbaar_breed: (s, r) => { const p = letterPos(s); if (!p.length) return null; const i = pick(r, p); return s.slice(0, i) + String.fromCodePoint(pick(r, INVISIBLE_BREED)) + s.slice(i); },
  symbool: (s, r) => `${s}${String.fromCodePoint(pick(r, SYMBOLEN))}`,
  puntjes: (s) => (/^[A-Za-z]{2,6}$/.test(s) ? `${s.toUpperCase().split('').join('.')}.` : null),
};

const RANK = ['exact', 'samenvoeging', 'typefout', 'transliteratie', 'deelnaam', 'enkel_woord', 'initiaal', 'gelijkenis'];
const bestReden = (hits) => hits.map((h) => h.reden).sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0];
const byId = (snap) => { const m = new Map(); for (const e of entityIndex(snap)) (m.get(e.id) ?? m.set(e.id, []).get(e.id)).push(e); return m; };
const sample = (arr, n, r) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
const bucket = (len) => (len < 5 ? 'zeer_kort(<5)' : len < 7 ? 'kort(5-6)' : len < 12 ? 'middel(7-11)' : 'lang(12+)');
const rate = (x, n) => (n ? Math.round((x / n) * 1000) / 10 : null);

export function measureMutations({ snap, seed = 1, n = 300, collect = collectHits }) {
  const r = rng(seed);
  const groups = [...byId(snap).values()];
  const chosen = sample(groups, n, r);
  const out = {};
  for (const [name, fn] of Object.entries(MUTATIONS)) {
    const stat = { geprobeerd: 0, gevonden: 0, exact: 0, onmeetbaar: 0, gemist_voorbeelden: [], per_lengte: {} };
    for (const items of chosen) {
      const orig = pick(r, items);
      const m = fn(orig.name, r);
      if (m === null || m === orig.name) continue;
      const res = collect(m, snapOf(snap));
      stat.geprobeerd++;
      const b = (stat.per_lengte[bucket(orig.k.length)] ??= { geprobeerd: 0, gevonden: 0 });
      b.geprobeerd++;
      if (res.reden) { stat.onmeetbaar++; continue; }
      const mine = res.hits.filter((h) => h.id === orig.id);
      if (mine.length) { stat.gevonden++; b.gevonden++; if (mine.some((h) => h.reden === 'exact')) stat.exact++; }
      else if (stat.gemist_voorbeelden.length < 8) stat.gemist_voorbeelden.push({ van: orig.name, naar: m });
    }
    stat.gevonden_pct = rate(stat.gevonden, stat.geprobeerd);
    stat.exact_pct = rate(stat.exact, stat.geprobeerd);
    for (const b of Object.values(stat.per_lengte)) b.gevonden_pct = rate(b.gevonden, b.geprobeerd);
    out[name] = stat;
  }
  return out;
}
const snapOf = (s) => s;

// Leave-one-out: drop the query name (and any alias with the same normalised key) from the index and ask
// whether the entity is still found through its OTHER aliases (transliteration variants).
export function measureLeaveOneOut({ snap, seed = 1, n = 800, collect = collectHits }) {
  const r = rng(seed);
  const eligible = [...byId(snap).entries()].filter(([, items]) => new Set(items.map((i) => i.k)).size >= 2);
  const stat = { entiteiten_met_meerdere_schrijfwijzen: eligible.length, geprobeerd: 0, gevonden: 0, per_reden: {}, gemist_voorbeelden: [] };
  for (const [id, items] of sample(eligible, n, r)) {
    const q = pick(r, items);
    const res = collect(q.name, snap, 0.75, (ent) => ent.id === id && ent.k === q.k);
    stat.geprobeerd++;
    const mine = res.hits.filter((h) => h.id === id);
    if (mine.length) { stat.gevonden++; const b = bestReden(mine); stat.per_reden[b] = (stat.per_reden[b] ?? 0) + 1; }
    else if (stat.gemist_voorbeelden.length < 12) stat.gemist_voorbeelden.push({ vraag: q.name, andere_namen: [...new Set(items.filter((i) => i.k !== q.k).map((i) => i.name))].slice(0, 3) });
  }
  stat.gevonden_pct = rate(stat.gevonden, stat.geprobeerd);
  return stat;
}

// False-alarm proxy on names that should NOT be on the list. Not representative of any customer; a rough gauge only.
export function measureFalseAlarms({ snap, names, collect = collectHits }) {
  const stat = { geprobeerd: 0, treffer: 0, kandidaat: 0, geen: 0, onmeetbaar: 0, voorbeelden: [] };
  for (const name of names) {
    const res = collect(name, snap);
    stat.geprobeerd++;
    if (res.reden) { stat.onmeetbaar++; continue; }
    if (!res.hits.length) { stat.geen++; continue; }
    const exact = res.hits.some((h) => h.reden === 'exact');
    if (exact) stat.treffer++; else stat.kandidaat++;
    if (stat.voorbeelden.length < 15) { const top = [...res.hits].sort((a, b) => b.score - a.score)[0]; stat.voorbeelden.push({ vraag: name, uitkomst: exact ? 'TREFFER' : 'KANDIDAAT', lijstnaam: top.naam, reden: top.reden, soort: top.soort }); }
  }
  stat.alarm_pct = rate(stat.treffer + stat.kandidaat, stat.geprobeerd);
  return stat;
}

// Safety of the birth-year / country hint on real data: for listed persons, ask with their TRUE year and country.
// The hint must never say wijkt_af for them (that would talk a real match down). Also reports how strict the year is:
// a claim that is one year off is marked wijkt_af for persons whose list date is exact.
export function measureOnderscheid({ snap, seed = 1, n = 300, collect = collectHits, hint = onderscheid }) {
  const r = rng(seed);
  entityIndex(snap);
  const people = snap.entries.filter((e) => e.soort === 'persoon' && e.jaren?.length);
  const stat = { personen_met_jaar_in_lijst: people.length, geprobeerd: 0, jaar_afwijkend_terwijl_goed: 0, land_afwijkend_terwijl_goed: 0, een_jaar_ernaast_geprobeerd: 0, een_jaar_ernaast_wijkt_af: 0 };
  for (const e of sample(people, n, r)) {
    const name = pick(r, e.names);
    const res = collect(name, snap);
    if (res.reden || !res.hits.some((h) => h.id === e.id)) continue;
    const jaar = pick(r, e.jaren);
    const land = e.landen?.length ? pick(r, e.landen) : undefined;
    stat.geprobeerd++;
    const d = hint(e, { birthYear: jaar, country: land });
    if (d.jaar === 'wijkt_af') stat.jaar_afwijkend_terwijl_goed++;
    if (d.land === 'wijkt_af') stat.land_afwijkend_terwijl_goed++;
    if (!e.ongeveer && e.jaren.length === 1) {
      stat.een_jaar_ernaast_geprobeerd++;
      if (hint(e, { birthYear: jaar + 1 }).jaar === 'wijkt_af') stat.een_jaar_ernaast_wijkt_af++;
    }
  }
  stat.een_jaar_ernaast_wijkt_af_pct = rate(stat.een_jaar_ernaast_wijkt_af, stat.een_jaar_ernaast_geprobeerd);
  return stat;
}

// How many false alarms could a reader strike off at a glance? Counts alarms where EVERY hit says wijkt_af for the given year.
// yearFor(name, r) supplies the claimed year; the default is a random year between 1955 and 1995.
export function measureTriage({ snap, names, seed = 1, collect = collectHits, hint = onderscheid, yearFor = (_, r) => 1955 + Math.floor(r() * 41) }) {
  const r = rng(seed);
  entityIndex(snap);
  const stat = { geprobeerd: 0, alarmen: 0, alle_hits_wijken_af: 0, minstens_een_niet_af: 0 };
  for (const name of names) {
    stat.geprobeerd++;
    const res = collect(name, snap);
    const year = yearFor(name, r);
    if (res.reden || !res.hits.length) continue;
    stat.alarmen++;
    if (res.hits.every((h) => hint(snap.byId.get(h.id), { birthYear: year }).jaar === 'wijkt_af')) stat.alle_hits_wijken_af++;
    else stat.minstens_een_niet_af++;
  }
  stat.direct_weg_te_strepen_pct = rate(stat.alle_hits_wijken_af, stat.alarmen);
  return stat;
}
