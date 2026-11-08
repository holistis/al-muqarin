#!/usr/bin/env node
// node loket/start.mjs --snapshots D --pub P --key K [--port N] [--vertrouw-proxy ja]
// Starts the counter on 127.0.0.1 only. One JSON line per request goes to stdout (no claim text, no address).
import { readFileSync } from 'node:fs';
import { InvalidInput, kiesBronnen } from '../src/check.mjs';
import { luister, maakLoket } from './loket.mjs';

const ALLOWED = new Set(['snapshots', 'pub', 'key', 'port', 'vertrouw-proxy', 'ledger', 'bronnen']);
const USAGE = 'gebruik: --snapshots D --pub P --key K [--port N] [--vertrouw-proxy ja] [--ledger history/ledger.jsonl] [--bronnen eu-fsf,uk-sanctions,ofac-sdn,un-sc]';
const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const k = argv[i]?.replace(/^--/, '');
  if (!argv[i]?.startsWith('--') || !ALLOWED.has(k) || argv[i + 1] === undefined || Object.hasOwn(opt, k)) { console.error(USAGE); process.exit(2); }
  opt[k] = argv[i + 1];
}
const port = opt.port === undefined ? 8744 : Number(opt.port);
if (!opt.snapshots || !opt.pub || !opt.key || !Number.isInteger(port) || port < 1024 || port > 65535 || (opt['vertrouw-proxy'] !== undefined && opt['vertrouw-proxy'] !== 'ja')) { console.error(USAGE); process.exit(2); }

let required;
try { if (opt.bronnen !== undefined) required = kiesBronnen(opt.bronnen); } catch (e) { if (!(e instanceof InvalidInput)) throw e; console.error(e.message); process.exit(2); }

const server = maakLoket({
  snapshotDir: opt.snapshots, pubKeyPem: readFileSync(opt.pub, 'utf8'), privKeyPem: readFileSync(opt.key, 'utf8'),
  vertrouwProxy: opt['vertrouw-proxy'] === 'ja', ledgerPad: opt.ledger ?? null, required, log: (regel) => console.log(JSON.stringify(regel)),
});
const adres = await luister(server, port);
console.log(JSON.stringify({ gebeurtenis: 'luistert', adres: adres.address, poort: adres.port }));
const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
