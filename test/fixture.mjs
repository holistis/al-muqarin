import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical } from '../src/canon.mjs';
import { sha256Hex } from '../src/snapshot.mjs';

export const NOW = new Date('2026-11-06T12:00:00Z');
export const keypair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
};
export const tmpRoot = () => mkdtempSync(join(tmpdir(), 'muq-'));
export const cleanup = (d) => rmSync(d, { recursive: true, force: true });

export const ENTITIES = [
  { id: 'E1', names: ['Acme Trading Company Ltd', 'ACME Handels GmbH'] },
  { id: 'E2', names: ['Mohammed Al-Hassan Refining'] },
  { id: 'E3', names: ['Søren Łukasz Metals'] },
  { id: 'E4', names: ['Северный Металл', 'Northern Metal Works'] },
  { id: 'E5', names: ['PJSC Alrosa'] },
  { id: 'E6', names: ['Zvezda Strela Holding'] },
  { id: 'P1', names: ['Mahmoud'], soort: 'persoon' },
  ...Array.from({ length: 30 }, (_, i) => ({ id: `F${i}`, names: [`Filler Company Number ${i} Xq${i}z`] })),
];
export const COUNTRIES = [{ id: 'C1', code: 'IQ', names: ['Iraq'] }, { id: 'C2', code: 'CD', names: ['Congo, Democratic Republic of the'] }];

// o: manifest (merged before signing), after: (dir)=>void applied after signing, skip: file to leave out, key: signing key
export function writeSnapshot(root, source, entries, priv, o = {}) {
  const dir = join(root, source);
  mkdirSync(dir, { recursive: true });
  const listBuf = Buffer.from(JSON.stringify({ entries }));
  const manifest = {
    schema: 1, source, sourceUrl: 'https://example.invalid/list', license: 'test', asOf: '2026-11-05',
    fetchedAt: '2026-11-05T10:00:00Z', sha256: sha256Hex(listBuf), entryCount: entries.length, minEntries: 5, ...(o.manifest ?? {}),
  };
  const sig = sign(null, Buffer.from(canonical(manifest)), o.key ?? priv).toString('base64');
  if (o.skip !== 'manifest.json') writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  if (o.skip !== 'manifest.sig') writeFileSync(join(dir, 'manifest.sig'), sig);
  if (o.skip !== 'list.json') writeFileSync(join(dir, 'list.json'), o.listBytes ?? listBuf);
  if (o.after) o.after(dir);
  return dir;
}
