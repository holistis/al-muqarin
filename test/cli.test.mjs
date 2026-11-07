import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { COUNTRIES, ENTITIES, NOW, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

const CLI = new URL('../src/cli.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const root = tmpRoot();
after(() => cleanup(root));
const cli = (...a) => spawnSync('node', [CLI, ...a], { encoding: 'utf8' });

describe('cli', () => {
  const K = keypair();
  const snaps = join(root, 'snaps');
  writeSnapshot(snaps, 'eu-fsf', ENTITIES, K.priv);
  writeSnapshot(snaps, 'cahras', COUNTRIES, K.priv, { manifest: { minEntries: 1 } });
  const pub = join(root, 'pub.pem'); const priv = join(root, 'priv.pem'); const claims = join(root, 'claims.json'); const out = join(root, 'out.json');
  writeFileSync(pub, K.pub); writeFileSync(priv, K.priv);
  writeFileSync(claims, JSON.stringify([{ id: 'a', type: 'entity', value: 'Acme Trading' }, { id: 'b', type: 'country', value: 'NL' }]));

  it('check then verify round trip', () => {
    const c = cli('check', '--claims', claims, '--snapshots', snaps, '--pub', pub, '--key', priv, '--out', out, '--now', NOW.toISOString());
    assert.equal(c.status, 22, c.stderr);   // Acme Trading is a TREFFER: the worst outcome decides the exit code
    assert.equal(cli('verify', '--report', out, '--pub', pub).status, 0);
  });
  it('a changed byte makes verify fail with exit 1', () => {
    const t = JSON.parse(readFileSync(out, 'utf8')); t.report.resultaten[0].uitkomst = 'GEEN_TREFFER_IN_LIJST';
    const bad = join(root, 'bad.json'); writeFileSync(bad, JSON.stringify(t));
    assert.equal(cli('verify', '--report', bad, '--pub', pub).status, 1);
  });
  it('invalid claims file, missing args and unknown flags exit 2', () => {
    const notJson = join(root, 'x.json'); writeFileSync(notJson, '{nope');
    assert.equal(cli('check', '--claims', notJson, '--snapshots', snaps, '--pub', pub, '--key', priv).status, 2);
    assert.equal(cli('check').status, 2);
    assert.equal(cli('bogus').status, 2);
    assert.equal(cli('check', '--claims', claims, '--snapshots', snaps, '--pub', pub, '--key', priv, '--max-age-days', '9999').status, 2);
  });
  it('keygen writes keys once and never overwrites', () => {
    const d = join(root, 'keys');
    assert.equal(cli('keygen', '--dir', d).status, 0);
    assert.equal(cli('keygen', '--dir', d).status, 2);
  });
  it('stale snapshot through the cli is ONMEETBAAR, not green', () => {
    const c = cli('check', '--claims', claims, '--snapshots', snaps, '--pub', pub, '--key', priv, '--out', out, '--now', '2027-06-01T00:00:00Z');
    assert.equal(c.status, 20, c.stderr);   // ONMEETBAAR is never exit 0
    const rep = JSON.parse(readFileSync(out, 'utf8')).report;
    assert.ok(rep.resultaten.every((r) => r.uitkomst === 'ONMEETBAAR'));
  });

  const run = (value, type = 'entity', extra = []) => {
    const f = join(root, `one-${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify([{ id: 'a', type, value }]));
    return cli('check', '--claims', f, '--snapshots', snaps, '--pub', pub, '--key', priv, '--now', NOW.toISOString(), '--out', join(root, 'tmp-out.json'), ...extra);
  };
  it('exit code: 0 only when every claim is GEEN_TREFFER_IN_LIJST, 21 for a KANDIDAAT, 22 for a TREFFER', () => {
    assert.equal(run('Completely Different Holdings').status, 0);
    assert.equal(run('NL', 'country').status, 0);
    assert.equal(run('Acme Tradng').status, 21);
    assert.equal(run('Acme Trading').status, 22);
  });
  it('an invalid claim is ONMEETBAAR (exit 20), not an error', () => assert.equal(run('x'.repeat(300)).status, 20));
  it('the summary on stderr names the worst outcome', () => assert.match(run('Acme Trading').stderr, /ergste: TREFFER/));
  it('unknown, repeated, valueless and foreign options are refused (exit 2), never ignored', () => {
    const base = ['check', '--claims', claims, '--snapshots', snaps, '--pub', pub, '--key', priv];
    assert.equal(cli(...base, '--max-age-day', '60').status, 2);          // typo
    assert.equal(cli(...base, '--now', NOW.toISOString(), '--now', '2020-01-01T00:00:00Z').status, 2);   // repeated
    assert.equal(cli(...base, '--out').status, 2);                         // no value
    assert.equal(cli('verify', '--report', out, '--pub', pub, '--key', priv).status, 2);   // option of another command
    assert.equal(cli('check', 'losse', 'woorden').status, 2);
  });
  it('errors are one machine-readable JSON line: invalid input is exit 2, an unexpected failure is exit 3', () => {
    const e2 = cli('check', '--claims', join(root, 'bestaat-niet.json'), '--snapshots', snaps, '--pub', pub, '--key', priv);
    assert.equal(e2.status, 2); assert.equal(JSON.parse(e2.stderr.trim().split('\n').pop()).fout, 'ongeldige_invoer');
    const junk = join(root, 'junk.pem'); writeFileSync(junk, 'not a key');
    const e3 = cli('check', '--claims', claims, '--snapshots', snaps, '--pub', pub, '--key', junk);
    assert.equal(e3.status, 2, 'an unreadable key is invalid input'); assert.equal(JSON.parse(e3.stderr.trim().split('\n').pop()).fout, 'ongeldige_invoer');
    // A write that fails is not the sender's fault: exit 3.
    const e4 = cli('check', '--claims', claims, '--snapshots', snaps, '--pub', pub, '--key', priv, '--out', join(root, 'bestaat-niet', 'r.json'));
    assert.equal(e4.status, 3); assert.equal(JSON.parse(e4.stderr.trim().split('\n').pop()).fout, 'onverwacht');
  });
  it('the report is written whole or not at all: no temp file is left behind, a failing write leaves nothing', () => {
    const d = join(root, 'atomic'); mkdirSync(d);
    const target = join(d, 'r.json');
    assert.equal(cli('check', '--claims', claims, '--snapshots', snaps, '--pub', pub, '--key', priv, '--out', target, '--now', NOW.toISOString()).status, 22);
    assert.deepEqual(readdirSync(d), ['r.json']);
    const bad = cli('check', '--claims', claims, '--snapshots', snaps, '--pub', pub, '--key', priv, '--out', join(d, 'nope', 'r.json'));
    assert.equal(bad.status, 3); assert.deepEqual(readdirSync(d), ['r.json']);
    // The write succeeds but the final rename cannot (the target is a non-empty folder): the temp file must be removed again.
    const folder = join(d, 'map'); mkdirSync(folder); writeFileSync(join(folder, 'x'), 'x');
    assert.equal(cli('check', '--claims', claims, '--snapshots', snaps, '--pub', pub, '--key', priv, '--out', folder).status, 3);
    assert.deepEqual(readdirSync(d).sort(), ['map', 'r.json']);
  });
  it('--now is recorded as klok "opgegeven", the machine clock as "systeem"', () => {
    run('Acme Trading'); assert.equal(JSON.parse(readFileSync(join(root, 'tmp-out.json'), 'utf8')).report.klok, 'opgegeven');
    const f = join(root, 'sys-claims.json'); writeFileSync(f, JSON.stringify([{ id: 'a', type: 'country', value: 'NL' }]));
    const o2 = join(root, 'sys-out.json');
    const c = cli('check', '--claims', f, '--snapshots', snaps, '--pub', pub, '--key', priv, '--out', o2);
    assert.equal(JSON.parse(readFileSync(o2, 'utf8')).report.klok, 'systeem'); assert.ok([0, 20].includes(c.status));
  });
  it('verify --claims proves the report is about exactly these claims; other claims, an extra claim or another order fail', () => {
    assert.equal(cli('check', '--claims', claims, '--snapshots', snaps, '--pub', pub, '--key', priv, '--out', out, '--now', NOW.toISOString()).status, 22);
    const ok = cli('verify', '--report', out, '--pub', pub, '--claims', claims);
    assert.equal(ok.status, 0); assert.match(ok.stderr, /nagelopen tegen --claims/);
    const other = (arr) => { const f = join(root, `o-${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify(arr)); return f; };
    const list = JSON.parse(readFileSync(claims, 'utf8'));
    assert.equal(cli('verify', '--report', out, '--pub', pub, '--claims', other([{ ...list[0], value: 'Siemens' }, list[1]])).status, 1);
    assert.equal(cli('verify', '--report', out, '--pub', pub, '--claims', other([list[0]])).status, 1);
    assert.equal(cli('verify', '--report', out, '--pub', pub, '--claims', other([list[1], list[0]])).status, 1);
  });
  it('verify without --claims says plainly that the claims were not checked, and shows the key id and the clock', () => {
    const v = cli('verify', '--report', out, '--pub', pub);
    assert.equal(v.status, 0); assert.match(v.stderr, /NIET nagelopen/); assert.match(v.stderr, /Sleutel [0-9a-f]{32}/); assert.match(v.stderr, /geen onafhankelijke tijdstempel/);
  });
  it('verify --expect accepts the right key id and refuses another', () => {
    const id = /Sleutel ([0-9a-f]{32})/.exec(cli('verify', '--report', out, '--pub', pub).stderr)[1];
    assert.equal(cli('verify', '--report', out, '--pub', pub, '--expect', id).status, 0);
    assert.equal(cli('verify', '--report', out, '--pub', pub, '--expect', '0'.repeat(32)).status, 1);
  });
});
