// Birth years out of the free text some lists use for a date: "10 Dec 1948", "1948", "1965-07-04", "circa 1951", "1951 to 1953".
// Shared by the parsers of lists that write dates as text. A year outside 1800 to 2200 is left out. Hints only: a year never changes an outcome.
export const jaarOk = (y) => Number.isInteger(y) && y >= 1800 && y <= 2200;

export function jaren(tekstDatum) {
  const ys = [...tekstDatum.matchAll(/\b(\d{4})\b/g)].map((m) => Number(m[1])).filter(jaarOk);
  const uit = new Set(ys);
  if (/\bto\b/i.test(tekstDatum) && ys.length === 2 && ys[1] >= ys[0] && ys[1] - ys[0] <= 10) for (let y = ys[0]; y <= ys[1]; y++) uit.add(y);
  return { uit, ongeveer: /\bcirca\b/i.test(tekstDatum) };
}
