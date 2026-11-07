// Name normalisation and similarity. Only Latin letters and digits are compared.
// Anything else (Arabic, Cyrillic, CJK...) sets `unsupported`, and the caller must answer ONMEETBAAR,
// never "no match": silently dropping characters would produce a false green.
const MAP = { 'ø': 'o', 'ł': 'l', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ı': 'i', 'þ': 'th', 'ð': 'd' };
const LEGAL = new Set(('ltd limited llc inc incorporated corp corporation co company gmbh ag bv nv sa sas srl spa plc ' +
  'pte pty oy oyj ab as asa aps kg ug jsc pjsc ojsc cjsc pao oao zao ao ooo llp lp fze fzc fzco sarl bvba cv ltda bhd sdn ' +
  'joint stock public open closed private liability').split(' '));

// Trade mark and similar signs belong to a name's packaging, not to the name.
const MARKS = /[™℠®©℗]/g;

// NFKD turns many symbols into several letters (a numero sign becomes "No", a telephone sign "TEL"). Glued onto the neighbouring
// word they would hide a listed name behind a made-up word. So a character that is not a letter and expands to more than one
// character becomes a word of its own. Letters (ligatures, accented letters) and one-to-one folds (circled and full-width letters)
// still fold in place.
function ontleed(input) {
  if (/^[\x00-\x7f]*$/.test(input)) return input;
  let out = '';
  for (const ch of input.replace(MARKS, '')) {
    const d = ch.normalize('NFKD');
    out += [...d].length > 1 && !/[\p{L}\p{M}]/u.test(ch) ? ` ${d} ` : d;
  }
  return out;
}

export function normalizeName(input) {
  // Invisible characters (soft hyphen, zero-width space / joiner, word joiner, BOM, bidi marks, variation selectors, Hangul fillers and
  // everything else Unicode marks as default-ignorable, plus the blank Braille cell) are never part of a name. They come along when text
  // is pasted from a PDF; turning them into a space would cut one word in two and give a silent miss.
  const s = ontleed(String(input)).toLowerCase()
    .replace(/[\p{Default_Ignorable_Code_Point}\u2800]/gu, '')
    .replace(/\p{M}/gu, '')
    .replace(/[øłßæœđıþð]/g, (c) => MAP[c]);
  let unsupported = false;
  for (const ch of s) {
    if (/[\p{L}\p{N}]/u.test(ch) && !/[a-z0-9]/.test(ch)) { unsupported = true; break; }
  }
  // Spelled-out initials ("P.K.K.", "P K K", "S.A.") are one token: a run of two or more single letters is glued together.
  const tokens = [];
  let run = [];
  const flush = () => { if (run.length) tokens.push(run.join('')); run = []; };
  for (const t of s.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)) {
    if (t.length === 1 && /[a-z]/.test(t)) run.push(t); else { flush(); tokens.push(t); }
  }
  flush();
  // Legal forms are stripped at both ends (Russian and CIS names put them first: "PJSC Alrosa").
  while (tokens.length > 1 && LEGAL.has(tokens[0])) tokens.shift();
  while (tokens.length > 1 && LEGAL.has(tokens[tokens.length - 1])) tokens.pop();
  return { tokens, unsupported };
}

export const tokenKey = (tokens) => [...tokens].sort().join(' ');

export function trigrams(s) {
  const p = ` ${s} `;
  const set = new Set();
  for (let i = 0; i <= p.length - 3; i++) set.add(p.slice(i, i + 3));
  return set;
}

export function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return (2 * n) / (a.size + b.size);
}

// Sound fold for transliteration variants (Vyacheslav / Vjatjeslav / Wjatscheslaw, Mohammed / Muhamad).
// Deliberately coarse: it is only ever used to propose a KANDIDAAT, never a TREFFER.
const FOLD_STEPS = [
  [/schtsch|shtch|shch/g, 's'], [/tsch|tch|tj|cz/g, 'c'], [/sch|sh|sj/g, 's'], [/zh|zj/g, 'z'],
  [/kh/g, 'h'], [/ch/g, 'c'], [/ph/g, 'f'], [/th/g, 't'], [/dh/g, 'd'], [/gh/g, 'g'], [/ck/g, 'k'],
  [/x/g, 'ks'], [/q/g, 'k'], [/w/g, 'v'], [/[yj]/g, 'i'], [/ou|oo/g, 'u'],
];
export function foldToken(t) {
  let s = t;
  for (const [re, to] of FOLD_STEPS) s = s.replace(re, to);
  return s.replace(/([a-z])\1+/g, '$1').replace(/f$/, 'v');
}
export const foldKey = (tokens) => [...tokens].map(foldToken).sort().join(' ');
// Edits allowed between two folded keys: none for short names, a few for long multi-word names.
export const foldTolerance = (len) => (len < 8 ? 0 : len < 16 ? 1 : len < 26 ? 2 : 3);
