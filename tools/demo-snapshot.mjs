#!/usr/bin/env node
// node tools/demo-snapshot.mjs --dir demo
// Makes a tiny, signed DEMO list of FICTIONAL names with its own throw-away keys, so you can try the whole flow in a minute without
// the network. It is not the EU list and says nothing about real companies; the manifest says so in its license field.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical } from '../src/canon.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--dir' || !args[1]) { console.error('gebruik: node tools/demo-snapshot.mjs --dir MAP'); process.exit(2); }
const dir = args[1];
if (existsSync(dir)) { console.error(JSON.stringify({ fout: 'ongeldige_invoer', bericht: `map bestaat al, ik overschrijf niets: ${dir}` })); process.exit(2); }

const namen = [
  'Example Demo Holdings', 'Northwind Fictional Metals', 'Contoso Imaginary Refining', 'Fabrikam Sample Trading',
  'Demo Cobalt Mining Corporation', 'Imaginary Lithium Works', 'Sample Graphite Company', 'Fictional Nickel Partners',
];
const entries = namen.map((n, i) => ({ id: `DEMO.${i + 1}`, names: [n], soort: 'onderneming' }));
const listBuf = Buffer.from(JSON.stringify({ entries }));
const nu = new Date();
const manifest = {
  schema: 1, source: 'eu-fsf', sourceUrl: 'https://example.invalid/demo-only',
  license: 'DEMO DATA: fictional names made up for trying the tool. This is not the EU list and says nothing about real companies.',
  asOf: nu.toISOString().slice(0, 10), fetchedAt: nu.toISOString(),
  sha256: createHash('sha256').update(listBuf).digest('hex'), entryCount: entries.length, minEntries: 5,
};
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
mkdirSync(join(dir, 'keys'), { recursive: true });
mkdirSync(join(dir, 'snapshots', 'eu-fsf'), { recursive: true });
writeFileSync(join(dir, 'keys', 'muqarin-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
writeFileSync(join(dir, 'keys', 'muqarin-public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
writeFileSync(join(dir, 'snapshots', 'eu-fsf', 'manifest.json'), JSON.stringify(manifest));
writeFileSync(join(dir, 'snapshots', 'eu-fsf', 'manifest.sig'), sign(null, Buffer.from(canonical(manifest)), privateKey).toString('base64'));
writeFileSync(join(dir, 'snapshots', 'eu-fsf', 'list.json'), listBuf);
console.error(`demo gemaakt in ${dir}: ${entries.length} verzonnen namen, eigen wegwerpsleutels, ondertekend. Dit is NIET de EU-lijst.`);
