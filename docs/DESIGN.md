# Al-Muqarin: design, threat model and known gaps

Status: early (version 0.0.1). Measured limits are in `docs/KNOWN-LIMITS.md`; reports go through `SECURITY.md`.

A note on words: the outcome names and some field names in reports are Dutch, because the project started in Dutch. `TREFFER` is a match, `KANDIDAAT` a candidate (a near match), `ONMEETBAAR` not measurable, `GEEN_TREFFER_IN_LIJST` no match in the list. `uitkomst` is outcome, `bronnen` sources, `volgnummer` run number, `klok` clock. The meaning is the same everywhere; the words stay as they are so that reports written today still verify tomorrow.

## What it is, and what it is not

It compares a claim (a company name or a country code) with public lists and returns, per claim, a signed statement with source, version and date. It is **not an audit, not a certification and not legal advice**. Nothing here replaces an audit or your own legal assessment.

Why it exists: list services often give an answer without a signed, dated statement per claim that someone can check later for changes. This tool gives that receipt, and says "not measured" instead of "no match" when it is unsure.

## Outcomes (never the word "clean")

`TREFFER` · `KANDIDAAT` (with a reason: typo, transliteration, merged words, initial, partial name, single word, similarity, and a score) · `ONMEETBAAR` (with a reason) · `GEEN_TREFFER_IN_LIJST` (means only: no match in that version of the list on that date). The worst outcome counts per claim, ranked TREFFER > KANDIDAAT > ONMEETBAAR > GEEN_TREFFER. A broken list can therefore never produce "no match".

## Rules that never bend

1. Fail closed: unknown, empty, old, truncated or unverifiable is ONMEETBAAR.
2. Signature first, then hash, then count, then freshness, then content.
3. The checker itself does no network, starts no processes and uses no eval (a test scans the source).
4. Zero dependencies: only what Node ships (Ed25519, SHA-256).
5. Only Latin letters and digits are compared. Other scripts are ONMEETBAAR and never silently dropped.
6. Every report carries the required disclaimer and limitations; verification refuses a report without them.
7. Sources only where reuse is allowed. RMI/RMAP are not used: their terms forbid passing on and processing without written permission.

## Threat model

| Threat | Defence | Proof |
|---|---|---|
| List changed, removed, extended or swapped afterwards | Signed manifest with hash and count | matrix: fail closed |
| Empty or truncated list read as "all clear" | minEntries, entryCount, hash | matrix |
| Old list read as current | fetchedAt against `now`, 8 days at most | matrix + CLI |
| Wrong list in the wrong folder | manifest.source must match | matrix |
| Typo, word order, accents, legal form | normalisation, typo rule, partial-name rule | matrix: matching |
| Name in Arabic or Cyrillic script | ONMEETBAAR | matrix: claims |
| Forged or edited report | Ed25519 over canonical JSON | matrix: report + CLI |
| Other spelling (Vyacheslav / Vjatjeslav / Wjatscheslaw) | sound folding, only as KANDIDAAT, never TREFFER | test: translit |
| A birth year or country makes a real hit "easy to strike off" | the hint never changes the outcome; it is only a label per candidate | test: onderscheid |
| A year in another calendar (Islamic 1402 = 1982) read as a plain year | only a Gregorian year, or the Gregorian date next to it; otherwise no year | test: onderscheid |
| The checker's own proof is blind | the planted-fault proof plants faults in the code, the counter and the meter itself (count: see README) and fails itself if one survives | `npm run mutatie` |
| Invisible character inside a name (soft hyphen, zero-width space, joiner; comes along from a PDF) cuts the word in two and gives a false green | every character of category Cf is removed before splitting | test: stille-missers + meter class `onzichtbaar` |
| Abbreviation with dots or spaces ("P.K.K.", "P K K"), an initial next to a surname ("A. Luzyanin"), a word split in two ("Sber bank") | loose letters are glued; an initial does not count (reason `initiaal`); same letters with other word boundaries (reason `samenvoeging`); both only as KANDIDAAT | test: stille-missers + meter classes |
| A list we mostly cannot read (empty names, other script, XML change) says "no match" everywhere | at least 90% of the parties need a readable name: the feeder does not sign otherwise, the checker answers ONMEETBAAR | test: stille-missers + feeder |
| A correctly signed report that says nonsense (empty results, top outcome against its sources, date in 2099, green out of nothing) | `verify` checks the report's internal consistency | test: rapport |
| A report fits other claims than stated | hash per claim; `verify --claims` | test: rapport + cli |
| It is not visible which key signed | `sleutel_id` in the signed report; `verify --expect` | test: rapport + cli |
| A script reads ONMEETBAAR as green | exit code 0 only when every outcome is GEEN_TREFFER_IN_LIJST; 20, 21 and 22 for the rest; a summary at the top of the report | test: cli |
| A typo in an option (`--max-age-day`) is silently ignored | unknown, repeated and valueless options are refused | test: cli |

## Known limits (honest)

- Ownership is not followed: a company owned by a sanctioned party is not on the list itself.
- A single loose word is only flagged when it has at least 5 letters and is rare in the list (at most 25 times). Short or common words are not. A brand name that is part of a long listed name can therefore be missed.
- The threshold 0.75, the typo rules and the rarity limit of 25 are measured on 300 samples per kind (see Self-measurement), but not yet on real customer names.
- One source (the EU sanctions list) has an adapter and a fetcher. The CAHRA list and other sources do not yet.
- Our own review is never independent.

## First measurement on real data (6 Nov 2026, EU list of 2026-10-23, 6,269 parties)

- 35 names in 0.8 s. Known sanctioned parties (Wagner Group, Sberbank, Bank Rossiya, Alrosa, Rosoboronexport) give TREFFER; ordinary sector companies (Siemens, BASF, Umicore, Glencore, CATL, BYD, Norilsk) give GEEN_TREFFER, which a grep on the raw file confirms (our own check).
- **Fault found by this measurement:** "Alrosa" first gave GEEN_TREFFER although "PJSC Alrosa" is on the list (the legal form stood before the name and my code only stripped it behind). Fixed and recorded as a test.
- False alarm: "Tesla Inc" gives KANDIDAAT (typo rule, TESA). "Mohammed Ali" gives TREFFER on the reversed personal name "Ali Mohammed" (a name match only; the report therefore also names the kind of party and the limitation).
- "Rosatom" gives GEEN_TREFFER; the list holds only the subsidiary "Rosatomflot". We do not follow ownership.
- 6,501 of 30,823 names (21%) cannot be compared (other script), but only 1 of 6,269 parties has no comparable name at all.
- The source file itself dates from 23 October while the source says daily; the date of the list itself therefore counts too (30 days at most; not yet measured whether 30 is the right limit).

## Self-measurement on the real list (6 Nov 2026, 6,269 parties, list of 23 Oct, n=300, seed 7)

Tool: `node tools/zelfmeting.mjs --snapshots snapshots --pub keys/muqarin-public.pem --n 300 --seed 7 --out raw/zelfmeting.json`. The meter has tests of its own (a blind matcher must score 0%).

- **Catch rate on mangled names** (the original is on the list, we search an edited version): letter replaced 97.3%, letter missing 96.3%, letter added 98.7%, letters swapped 97%, word order 100%, a word dropped 99.6%, a word added 98.3%, case and punctuation 100%, legal form before and after 100%.
- **Weak spot: short names.** Below 5 characters typo tolerance is deliberately off (too much noise); a typo is then not caught (0 to 33%). Between 5 and 6 characters it varies (40 to 100%).
- **Another spelling than on the list** (an alias without itself): only 47.9% was found through another spelling of the same party. The misses are almost all transcription differences from Cyrillic (Vyacheslav / Vjatjeslav, Yuryevna / Jurjevna). This was the largest measurable improvement still open.
- **False alarms:** ordinary companies 2.8% (Tesla ~ TESA, Safran ~ Anna Safran, LG Electronics ~ an "Ets Electronics"), Western personal names 0%, Arabic and Russian personal names 21.5% (4 hits, 82 candidates out of 400). For that last group an extra feature (birth year or country) is needed.
- These are proxy figures on edited list names and on our own list of 107 companies, not a measurement on real customer data.

### After the sound folding and the hint (6 Nov 2026, same list, same seed 7)

- **Sound folding** (Vyacheslav, Vjatjeslav and Wjatscheslaw get the same sound form; the allowed deviation grows with the name length; never a TREFFER, only KANDIDAAT): alias without itself **47.9% to 67.1%** (of 800: 208 through the folding). Catch rate on mangled names unchanged (96 to 100%). A check takes about 85 ms per name.
- **Price:** false alarms for Western personal names 0% to 0.4% (David Meijer ~ David Mayer), Arabic and Russian personal names 21.5% to 22% (Ahmed Said ~ Saeed Ahmed added), companies unchanged at 2.8%.
- **What is still missing:** 32.9% of the aliases. In the 12 example misses the meter shows, some are not spellings at all but other names (alias "Izo" for "Johnson Andre"), some are larger changes (Shautsou ~ Shevtsov). This is a sample of 12, not a count of all misses.
- **Birth year and country as a hint.** A claim may carry `birthYear` and `country`. Every candidate then gets `onderscheid`: komt_overeen (matches), wijkt_af (differs) or onbekend (unknown). **The outcome never changes**, because a list can be incomplete and a customer can have a year wrong; a real hit must not become lower because of it. An approximate date (circa) allows 2 years of difference. Measured: for 203 real persons with their real year and country, 0 times wrongly "differs"; with a year that is 1 off it says "differs" in 100% of the cases (strict: the year must match). Of the 88 false alarms for Arabic and Russian names, with a random birth year (1955 to 1995) **78.4% (69 of 88) had every candidate struck off** at once; the other 19 have a candidate without a year in the list or by chance the same year.
- **Finding in the source data:** the EU list also holds years in the Islamic calendar (1402 is 1982, 4 cases). Taking them blindly would have marked real persons with the right year as "differs". The list check (year between 1800 and 2200) stopped the first version of the snapshot; the adapter now reads only a Gregorian year, or the Gregorian date next to it, otherwise no year.
- **Residual risk of the hint:** a person who strikes off a hit on "differs" while the customer's year was wrong misses a real party. That is why the sentence that the hint never changes the outcome is in every report (limitations).

## Own review round (6 Nov 2026)

Five simulated roles (a sanctions and privacy lawyer, a name-matching specialist, an attacker, a buyer from the battery chain, a builder of AI agents) each attacked the tool on a copy. They are not real people and our own review is never independent: the findings were hypotheses that counted only when they could be reproduced with code.

- **Found separately by three of the roles, first checked on the real list:** an invisible character inside a name (soft hyphen, zero-width space, joiner; comes along from a PDF) cut the word in two and gave GEEN_TREFFER while the same name without that character is a TREFFER. Measured by the attacker: 17% missed over 117 one-word company names, 32% when the attacker picks the position; the claim text comes from the supplier. The planted-fault proof and the meter were blind to this class (110 of 110 caught, none in this direction). Now: characters of category Cf are removed, and the meter has the class `onzichtbaar`.
- **Also fixed, each with a test and a planted fault:** abbreviation with dots or spaces ("P.K.K." gave GEEN, "PKK" gave TREFFER; 17 of 20 missed); an initial next to a surname ("A. Luzyanin": 36 to 37 of 40 missed); a word split in two ("Sber bank"); a list whose names we cannot read was signed (now: at least 90% of the parties readable, in the feeder and in the checker); `verify` checked only the signature and the fixed text (empty results, top outcome against the sources, a date in 2099 and "green out of nothing" gave VALID); no key id and no hash per claim; exit code 0 for every outcome; typos in options were ignored; the output file was not written through a temporary file; the README said "never changes the outcome" while an invalid birth year makes the claim ONMEETBAAR.
- **Measurement after the repairs** (same list, seed 7, n=300): invisible 100% (all as TREFFER), dots 100% (n=3), initial 99.7%, split 99.3% (as KANDIDAAT; "PK K" and "Alro sa" stay missed: below 6 letters the rule is deliberately off and "sa" is a legal form), alias without itself 67.1% to 67.8%. False alarms unchanged: companies 2.8%, Western persons 0.4%, Arabic and Russian persons 22%. **Price:** three typos in the middle of an abbreviation with dots (S.R.O., E.X.) are now missed; the abbreviation is glued together and then shifts in the sorted key. About 0.3 percentage points on three old classes.
- **Flagged by the buyer role, a hypothesis:** the buyer still reads GEEN_TREFFER_IN_LIJST as "safe, done", did not understand "snapshot" and "receipt", misses owners, and would want a flat monthly fee rather than a price per question. The report now has a plain-language sentence per outcome that names the list and the date. One invented person is not a market.

## Still open after that round (deliberately not fixed, no hidden gaps)

- **Rolling back to an older, validly signed list: now partly covered (7 Nov 2026).** Every manifest from the feeder carries a run number and the hash of the previous manifest. The checker can refuse an older list with `--min-volgnummer eu-fsf=N`, the counter remembers the highest number it has seen and then refuses an older list or a list without a number, and `tools/status.mjs` is red when the live list is not the last one in the ledger. **What is still missing:** an outsider who controls the folder and the ledger on the server can start the chain again. That needs a copy outside the machine (an independent timestamp, or the last manifest hash published somewhere).
- **The clock is the signer's.** `gemaakt` follows from `--now`; the report says `klok: opgegeven` (stated) or `systeem` (system), but proves nothing against its maker. The real fix is an independent timestamp (and only then anchoring).
- **One key signs lists and reports**, with no rotation or revocation. On Windows file mode 0600 does not limit access. This is a design choice (two keys, a key ceremony) for the operator.
- **Reuse terms of the EU list: read on 7 Nov 2026** (Decision 2011/833/EU, OJ L 330/39 of 14.12.2011, English text from eur-lex.europa.eu). Reuse is allowed for commercial and non-commercial purposes, free of charge and without application (art. 4). Conditions the Commission may set (art. 6(2)): acknowledge the source, do not distort the original meaning, no liability of the Commission. Not to mislead or deceive (art. 2(4)). The decision does not cover trade marks, logos and names, nor documents with third-party rights (art. 2(2)); personal data stay under the privacy rules (art. 4). **Not checked:** whether the decision still reads this way (the consolidated version was not looked up) and whether the FSF page itself has a condition of its own. We read this ourselves; no lawyer has confirmed it. Consequence for us: source and date are in every report; a KANDIDAAT is our comparison and never a statement of the EU; no EU logos or name used as a brand.
- **GDPR:** the list holds 4,490 natural persons with a birth year; the feeder keeps a source copy every run and does not clean up; no legal basis, processor, retention period or impact assessment is described.
- **Scale (measured 7 Nov 2026, own PC):** 200 claims take 6.0 seconds (about 30 ms per claim), 1 claim 0.5 seconds of which about 0.45 seconds is fixed cost for loading and indexing the list. The counter therefore keeps the checked list in memory for a minute (at most 25 claims per request); the command line still loads per run. Memory use not measured by us.
- **Small things:** "Abd al Samad" against "Abdul Samad" (2 of 40); legal forms such as "ab", "as" and "co" are stripped at the start or end of a name even when it is a real word; Arabic and Cyrillic script stays ONMEETBAAR (by design).
- **False alarms of 22%** for Arabic and Russian names remain; the hint (birth year, country) helps a person, the machine does not decide with it.
- **What this round does not prove:** that there is demand. The persons were invented.

## Feeder, alarm and counter (7 Nov 2026)

- **Feeder:** `feeder/` fetches the list and tests it (count, readable names, which parties and names are still present, the size against the largest ever signed), signs a manifest with a run number and the hash of the previous manifest, and keeps the large files once per content (`history/_inhoud`). A deviation goes to quarantine and the live list stays. A deliberate large change needs `--accepteer-verschil` with a written reason, which goes in the ledger.
- **Alarm:** `tools/status.mjs` reports red for no or refused snapshot, too old, the list itself too old, too few readable names, a quarantine after the last good run, or a live list that is not the last one in the ledger. Silence is red: a measurement that is missing or old is never green.
- **Counter:** `loket/` (a separate folder, because only there and in `feeder/` the network is allowed; `src/` stays without network). It listens on 127.0.0.1 only and refuses another Host header. POST /v1/vergelijk (1 to 25 claims, JSON, at most 64 kB) returns the same signed report as the command line; GET /v1/sleutel and /v1/gezondheid. A missing, old or refused list is a 200 with ONMEETBAAR, never an error that looks like silence. Limits per visitor (an IPv6 /64 is one visitor) and together, time limits, a maximum number of connections. Logs hold no claim text and no address.
- **What the counter does not do:** no login, payment or encryption (that belongs in a layer in front of it), and no separate process for signing: the private key sits in the counter's memory. Behind a proxy only the last address in x-forwarded-for counts, and only with `--vertrouw-proxy ja`.

## Outsider round (7 Nov 2026)

A simulated outsider (an experienced open-source and security engineer, cold read, repository only) looked for gaps and found nineteen; each was first written down as a failing test (`test/buitenstaander*.test.mjs`) and then fixed. This too is our own review, not an independent one.

- **A silent miss in the core (high):** symbols that Unicode turns into letters (™ becomes TM, № becomes No, ℡ becomes TEL) stuck to the word before them, so "Alrosa™" gave no match. Such a character is now a word of its own, and trade mark signs (™ ℠ ® © ℗) are dropped. Invisible characters outside the format category (blank Braille cell, Hangul fillers, variation selectors, everything Unicode calls default-ignorable) no longer cut a word in two; the range 0x80 to 0x85 and the whole C1 range is invalid in a claim.
- **Signed text from the sender:** a refused claim left its own id and type unchecked in the signed report (up to 30 kB). Now only a valid id, otherwise the position; the type only when it is a known type.
- **Unambiguous input:** duplicate keys in JSON (claims, report, manifest, request to the counter) and too deep nesting are refused (`src/strict-json.mjs`); a verify of a report with a duplicate key says INVALID.
- **Verify also checks the sources:** every result must rest on a source that the report itself lists and calls usable; the report says which minimum run number applied, and a minimum for an unknown source is an error instead of silent protection that protects nothing.
- **Feeder:** besides the count, the feeder now tests which parties and names are still present and the distance to the largest signed list ever; the list reader is linear (a file with 32,000 unclosed tags took 6.5 seconds, now 2 milliseconds); duplicate ids in a list make it unusable.
- **Command line:** a known but not allowed command name ("constructor") is a usage error instead of a crash; missing files are invalid input (exit code 2); a BOM is read; a key that does not belong to the public key is refused before anything is signed.
- **Counter:** invented addresses in proxy mode share one bucket; the time limits work to within a second; a Host header that is not local is refused (DNS rebinding); the floor for the run number also comes from the ledger on disk, so a restart does not forget a newer list.
- **The proof itself:** now fails with an exit code if a fault survives or is not found, starts by checking that the unchanged copy passes, refuses faults that only break the syntax, finds multi-line targets also with Windows line endings, and has a self-test of its own (`npm run mutatie-zelftest`). Two faults only on Linux (file permissions of the key file) are skipped elsewhere and run in CI.
- **Not adopted:** the bare space in a short word ("Sib ur") turned out to be found in our own proof and stays as a known limit; a second independent reader and real data were still missing.

## Gaps in our own tests (7 Nov 2026)

The planted-fault proof showed twelve faults that no test caught, in our own tests. They are closed in `test/gaten.test.mjs`, and two proof entries that only broke the syntax were replaced. One defensive count in the list reader turned out to be unreachable (it counted the same thing twice) and was removed as dead code. The proof was run again on the final code. That run found two more things. A last fault survived (the floor in the demo manifest was not checked by anything); it now has a check in `test/demo.test.mjs`. And one fault made the tests loop for ever instead of failing, which stopped the proof for hours because it had no time limit. It now stops a test run after four minutes, counts that as caught, and names it apart (`tijdslimiet:` on the last line); the proof's own self-test contains such a fault.

## Watertight round (7 Nov 2026)

- **Limit per IPv6 /64:** the counter counted per full address, so someone with a /64 had endless fresh buckets. Now every address in one /64 is one visitor (IPv4-mapped counts as IPv4, an unreadable IPv6 address shares one bucket).
- **Worst case measured (own PC, 25 claims of 200 characters, uncached list):** 0.4 to 1.1 seconds, never more, for nine kinds of hostile input (one long word, 60 small words, loose letters with dots, Cyrillic, trigram-heavy). No quadratic outlier found; the ceiling of 25 claims and 200 characters stays the hard ceiling.
- **Our own proof that looks for new gaps:** `test/fuzz.test.mjs` with random text in all scripts, control characters and broken surrogates (2,400 items), random JSON that is not a claim, order and repetition independence, and metamorphic variants of every name in the list (case, invisible characters, spaces, accents, punctuation) that may never lead to a miss. All with fixed seeds, so a failure can be repeated.
- **Automatic:** `.github/workflows/ci.yml` runs the tests on every push and a clean install from `npm pack` with the same count, and weekly and on request the planted-fault proof. The actions are pinned to their commit, the permissions are read-only.
- **Four checks on the counter (auth, data, exposure, rate):** (1) access: no login and no write path, the counter is read-only and listens on 127.0.0.1 only; a login belongs in the layer in front of it. (2) data: JSON only, at most 64 kB, 1 to 25 claims, an id from a fixed character set, a value of at most 200 characters without control characters, every deviation per claim becomes ONMEETBAAR. (3) exposure: no paths, no stack, no claim text or address in logs, the private key appears in no answer. (4) rate: limit per visitor on requests and claims, a shared limit, time limits, 200 connections, a memory and processor ceiling through the service manager.
- **Publication gates, as far as possible without a human:** secrets: the tree was scanned, and the public history starts with one clean commit made from it; claims against the code: the README was read sentence by sentence against the code and the tests; licence: Apache-2.0 in LICENSE and package.json, NOTICE with the attribution; clean install: `npm pack`, unpack and test gives the same count as the working folder.
- **Deliberately not built yet:** two keys (an offline list key and a replaceable report key), an independent timestamp (RFC 3161) on every manifest, a copy of the history outside the machine, a second observer from another address, and a truly independent reader. Each of these needs a choice or a person from outside.
