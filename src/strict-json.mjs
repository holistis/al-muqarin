// JSON that cannot say two things at once. JSON.parse keeps the LAST of a repeated key; another reader may keep the first, and then
// two programs read different claims or reports from the same bytes. So a repeated key (in any object, however it is spelled with
// escapes) is an error, and so is nesting deeper than any file of ours needs, which would otherwise overflow the stack.
export class StrictJsonError extends Error {}

export const MAX_DEPTH = 32;

export function parseStrict(tekst) {
  if (typeof tekst !== 'string') throw new StrictJsonError('geen tekst');
  // 1. Depth and repeated keys, read straight from the text. The text may still be invalid: JSON.parse below has the last word.
  const stack = [];
  let i = 0;
  const n = tekst.length;
  while (i < n) {
    const c = tekst[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && tekst[j] !== '"') j += tekst[j] === String.fromCharCode(92) ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top && top.object && top.verwachtSleutel) {
        let sleutel;
        try { sleutel = JSON.parse(tekst.slice(i, j + 1)); } catch { throw new StrictJsonError('ongeldige JSON'); }
        if (top.sleutels.has(sleutel)) throw new StrictJsonError(`dubbele sleutel in JSON: ${JSON.stringify(String(sleutel).slice(0, 40))}`);
        top.sleutels.add(sleutel);
        top.verwachtSleutel = false;
      }
      i = j + 1;
      continue;
    }
    if (c === '{' || c === '[') {
      if (stack.length >= MAX_DEPTH) throw new StrictJsonError(`te diep genest (meer dan ${MAX_DEPTH} niveaus)`);
      stack.push(c === '{' ? { object: true, sleutels: new Set(), verwachtSleutel: true } : { object: false });
    } else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') { const top = stack[stack.length - 1]; if (top && top.object) top.verwachtSleutel = true; }
    i++;
  }
  // 2. The real parse: anything that is not valid JSON stops here.
  try { return JSON.parse(tekst); } catch { throw new StrictJsonError('ongeldige JSON'); }
}
