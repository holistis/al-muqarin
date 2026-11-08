import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { cleanup, tmpRoot } from './fixture.mjs';

const root = tmpRoot();
after(() => cleanup(root));
const af = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DEMO = af('../tools/demo-snapshot.mjs'), CLI = af('../src/cli.mjs'), CLAIMS = af('../examples/claims.json');
const dir = join(root, 'demo');

describe('de proef van een minuut uit de README', () => {
  it('builds a signed demo list with its own keys and says in the manifest that it is not real data', () => {
    const r = spawnSync('node', [DEMO, '--dir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const m = JSON.parse(readFileSync(join(dir, 'snapshots', 'eu-fsf', 'manifest.json'), 'utf8'));
    assert.match(m.license, /DEMO DATA/);
    assert.match(m.license, /not the EU list/);
    // The floor is how a real manifest refuses a list that has shrunk, so the demo shows one that does something.
    assert.ok(m.minEntries >= 2 && m.minEntries < m.entryCount, `floor ${m.minEntries} must sit above 1 and below the count ${m.entryCount}`);
  });
  it('refuses to overwrite an existing folder, and refuses odd usage', () => {
    assert.equal(spawnSync('node', [DEMO, '--dir', dir], { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync('node', [DEMO], { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync('node', [DEMO, '--map', 'x'], { encoding: 'utf8' }).status, 2);
  });
  it('the example claims give a hit, a no-match and an unmeasured answer, and the report verifies against them', () => {
    const rapport = join(root, 'rapport.json');
    const c = spawnSync('node', [CLI, 'check', '--claims', CLAIMS, '--snapshots', join(dir, 'snapshots'), '--pub', join(dir, 'keys', 'muqarin-public.pem'), '--key', join(dir, 'keys', 'muqarin-private.pem'), '--out', rapport, '--bronnen', 'eu-fsf'], { encoding: 'utf8' });
    assert.equal(c.status, 22, c.stderr);
    const rep = JSON.parse(readFileSync(rapport, 'utf8')).report;
    assert.deepEqual(rep.resultaten.map((r) => r.uitkomst), ['TREFFER', 'GEEN_TREFFER_IN_LIJST', 'ONMEETBAAR']);
    const v = spawnSync('node', [CLI, 'verify', '--report', rapport, '--pub', join(dir, 'keys', 'muqarin-public.pem'), '--claims', CLAIMS], { encoding: 'utf8' });
    assert.equal(v.status, 0, v.stderr);
  });
});
