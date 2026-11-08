#!/usr/bin/env node
// node tools/status.mjs --snapshots D --history D --pub P [--out F] [--now ISO] [--max-fetch-uren N] [--max-lijst-dagen N] [--bronnen a,b]
// Prints one JSON object. Exit 0 = ok, 1 = red (the reasons are in the object), 2 = bad usage. --out writes it atomically.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { DEFAULT_ENTITY_SOURCES, InvalidInput, kiesBronnen } from '../src/check.mjs';
import { bepaalStatus } from './status-lib.mjs';

const ALLOWED = new Set(['snapshots', 'history', 'pub', 'out', 'now', 'max-fetch-uren', 'max-lijst-dagen', 'bronnen']);
const USAGE = 'gebruik: --snapshots D --history D --pub P [--out F] [--now ISO] [--max-fetch-uren N] [--max-lijst-dagen N] [--bronnen eu-fsf,uk-sanctions,ofac-sdn,us-csl,un-sc] (standaard: de eerste vier)';
const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const k = argv[i]?.replace(/^--/, '');
  if (!ALLOWED.has(k) || argv[i + 1] === undefined || k in opt) { console.error(USAGE); process.exit(2); }
  opt[k] = argv[i + 1];
}
if (!opt.snapshots || !opt.history || !opt.pub) { console.error(USAGE); process.exit(2); }
const num = (v, d) => (v === undefined ? d : Number(v));
const now = opt.now ? new Date(opt.now) : new Date();
const maxFetchUren = num(opt['max-fetch-uren'], 30), maxListDagen = num(opt['max-lijst-dagen'], 25);
if (Number.isNaN(now.getTime()) || !(maxFetchUren > 0) || !(maxListDagen > 0)) { console.error('ongeldige waarde'); process.exit(2); }
let bronnen = DEFAULT_ENTITY_SOURCES;
try { if (opt.bronnen !== undefined) bronnen = kiesBronnen(opt.bronnen).entity; } catch (e) { if (!(e instanceof InvalidInput)) throw e; console.error(e.message); process.exit(2); }
const status = bepaalStatus({ bronnen, snapshotDir: opt.snapshots, historyDir: opt.history, pubKeyPem: readFileSync(opt.pub, 'utf8'), now, maxFetchUren, maxListDagen });
const text = JSON.stringify(status, null, 2);
if (opt.out) { const tmp = `${opt.out}.tmp-${process.pid}`; writeFileSync(tmp, text + '\n'); renameSync(tmp, opt.out); } else process.stdout.write(text + '\n');
process.exitCode = status.ok ? 0 : 1;
