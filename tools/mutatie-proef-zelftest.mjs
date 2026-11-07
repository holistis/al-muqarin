// Test the tester: the planted-fault tool must itself be able to say "no". It is given faults of known kinds and must react to each:
// a fault the tests catch (exit 0), one nothing notices, one whose target text is not there, one that only breaks the syntax (exit 1 each), and one that makes the tests loop for ever (exit 0, named apart).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mut-zelftest-'));
let fout = 0;
const proef = (naam, mutant, filter, verwachtStatus, verwachtTekst, extraEnv = {}) => {
  const bestand = join(dir, `${naam}.json`);
  writeFileSync(bestand, JSON.stringify([mutant]));
  const r = spawnSync('node', ['tools/mutatie-proef.mjs', filter, '0/1'], { env: { ...process.env, MUTANTEN_BESTAND: bestand, ...extraEnv }, encoding: 'utf8' });
  const ok = r.status === verwachtStatus && r.stdout.includes(verwachtTekst);
  console.log(ok ? 'OK    ' : 'FOUT  ', naam, `(exit ${r.status}, verwacht ${verwachtStatus}, tekst "${verwachtTekst}")`);
  if (!ok) { fout++; console.log(r.stdout.split('\n').slice(-6).join('\n')); }
};
proef('gevangen fout', ['src/check.mjs', 'export const MAX_CLAIMS = 200;', 'export const MAX_CLAIMS = 2;'], 'export const MAX_CLAIMS = 200;', 0, 'GEVANGEN');
proef('fout die niemand ziet', ['src/check.mjs', 'export const VERSION', 'export const  VERSION'], 'export const VERSION', 1, 'OVERLEEFD');
proef('tekst niet gevonden', ['src/check.mjs', 'deze tekst staat er niet', 'x'], 'deze tekst staat er niet', 1, 'NIET GEVONDEN');
proef('alleen een syntaxfout', ['src/check.mjs', 'export const VERSION', 'export cnst VERSION'], 'export const VERSION', 1, 'ONGELDIGE FOUT');
// A fault that makes the code loop for ever must not hang the proof: the run is stopped at the time limit and counts as caught, named apart.
proef('fout waardoor de tests vastlopen', ['src/adapters/eu-fsf.mjs', "if (sluit < 0) throw new Error('entiteit niet gesloten');", ''], "if (sluit < 0) throw new Error('entiteit niet gesloten');", 0, 'tests liepen vast', { MUTANT_TIJDSLIMIET_MS: '40000' });
rmSync(dir, { recursive: true, force: true });
process.exitCode = fout ? 1 : 0;
