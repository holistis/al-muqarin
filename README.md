# al-muqarin

Al-Muqarin, Arabic for "the one who compares". Compares claims about a supply chain (a company name, a country code) with signed snapshots of public lists, and answers per claim with a signed, dated verdict.

Early release (version 0.0.1), Apache-2.0 (see LICENSE and NOTICE). Measured limits: docs/KNOWN-LIMITS.md. Errors we know about: ERRATA.md. Reporting problems: SECURITY.md.

It is not an audit, not a certification and not legal advice. It never says "clean": the strongest answer is `GEEN_TREFFER_IN_LIJST`, meaning no match under this tool's matching rules in that list version on that date. The matching can miss a listed party: in our own measurement a party written in another Latin spelling of its name was missed in about a third of the tries (numbers in `docs/KNOWN-LIMITS.md`). If a list is missing, empty, stale, truncated, unsigned or altered, the answer is `ONMEETBAAR` (not measured), never a green.

## Try it in a minute (demo data, no network)

This builds a tiny signed list of FICTIONAL names with throw-away keys, then checks three example claims against it. It is not a real list. The demo holds one list, so it asks for that one with `--bronnen eu-fsf`; without that option a check asks for the whole default set (see "Lists" below) and every clean answer would be `ONMEETBAAR`, because the other lists are not there.

```
node tools/demo-snapshot.mjs --dir demo
node src/cli.mjs check --claims examples/claims.json --snapshots demo/snapshots --pub demo/keys/muqarin-public.pem --key demo/keys/muqarin-private.pem --bronnen eu-fsf --out demo/report.json
node src/cli.mjs verify --report demo/report.json --pub demo/keys/muqarin-public.pem --claims examples/claims.json
```

A claims file is a JSON list; every claim has exactly `id` (letters, digits, `._:-`, up to 64), `type` (`entity` or `country`) and `value`, plus an optional `birthYear` and `country` for an entity. See `examples/claims.json`. The report text is in Dutch for now. The first command prints the counts and the worst outcome; the exit code says it too (see below).

With real data you need the feeder (`feeder/`), which fetches the lists from the network (see "Lists" below). The unit tests need nothing: `npm test` (about 10 seconds). The planted-fault proof `npm run mutatie` is slow: with 371 faults it took about 65 minutes on our machine with six parts running at the same time (`node tools/mutatie-proef.mjs "" 0/6` up to `5/6` in six terminals), much longer in one piece; with the 548 faults of today we ran it in separate groups over several hours, and two or three groups at once is the most our machine took (more made the baseline run fail on memory). A fault that makes the tests loop for ever is stopped by a time limit (four minutes) and counted apart; one fault needs real file modes and is skipped on Windows.

## Commands

```
node src/cli.mjs keygen --dir keys
node src/cli.mjs check --claims claims.json --snapshots snapshots --pub keys/muqarin-public.pem --key keys/muqarin-private.pem --out report.json [--bronnen eu-fsf,uk-sanctions,ofac-sdn,us-csl] [--ledger history/ledger.jsonl]
node src/cli.mjs verify --report report.json --pub keys/muqarin-public.pem --claims claims.json [--expect-bronnen eu-fsf,uk-sanctions,ofac-sdn,us-csl]
npm test           # 568 tests, including random and metamorphic ones (one is skipped on Windows: it needs real file modes)
npm run mutatie    # plants 548 faults in the code, the counter and the measuring tool; the tests must catch every one
```

A claim may carry `birthYear` and `country` (entities only). A valid hint never changes the outcome; each candidate just gets a `komt_overeen`, `wijkt_af` or `onbekend` hint so a reader can tell namesakes apart. An invalid hint (a year outside 1850 to 2100, a year written as text, an unknown country code) makes that one claim `ONMEETBAAR`, never green.

Exit codes of `check`, so a pipeline never has to parse text: `0` only when every claim is `GEEN_TREFFER_IN_LIJST`, `20` at least one `ONMEETBAAR`, `21` at least one `KANDIDAAT`, `22` at least one `TREFFER` (the worst outcome decides). `2` is invalid input or usage (unknown, repeated or valueless options are refused), `3` an unexpected error; both print one JSON line on stderr. `verify` exits `1` when the report is not valid. `--min-volgnummer eu-fsf=N` refuses a list with a lower run number than N (a rolled-back list), or one without a number.

What `verify` proves, and what it does not. It checks the signature, that the report is consistent with itself (every top outcome equals the worst of its sources, the summary matches the results, the dates and ages add up) and, with `--claims`, that the report is about exactly those claims (a hash per claim). The report names the key that signed it (`sleutel_id`); give `--expect <id>` to insist on a key you got from somewhere else. Give `--expect-bronnen` with the lists you demand, and a report that rests on other lists, for any claim about a company, does not verify (a refused claim and a country claim are left out of that); without it nothing is demanded about which lists were used, only that the report says so. It does NOT prove that the signer's clock was right (`gemaakt` is the signer's own clock, marked `klok: opgegeven` when `--now` was used) or that the signer ran this code. A third-party timestamp is not built yet.

`niet_vergelijkbare_namen` in a report counts names in the list that are not written in Latin letters; those cannot be compared. If fewer than 90 percent of the parties on a list have a comparable name, the list is `ONMEETBAAR` and the feeder refuses to sign it.

Fetching the lists (`feeder/`) and the local counter (`loket/`, loopback only) are the only parts that touch the network, kept apart from the checker in `src/`, which has none:

```
node feeder/voeding.mjs --bron eu-fsf --out snapshots --history history --key keys/muqarin-private.pem   # likewise uk-sanctions, ofac-sdn, us-csl, un-sc
node tools/status.mjs --snapshots snapshots --history history --pub keys/muqarin-public.pem   # exit 1 when the feeding bot is not doing its job
node loket/start.mjs --snapshots snapshots --pub keys/muqarin-public.pem --key keys/muqarin-private.pem --port 8744   # 127.0.0.1 only
```

## Lists

Five lists can be fed. A claim about a company is compared with every list in the set it is asked for; the set is `eu-fsf,uk-sanctions,ofac-sdn,us-csl` unless `--bronnen` (on `check`, `loket/start.mjs` and `tools/status.mjs`) says otherwise. A hit in any list is the answer. A list that is missing, stale or refused makes a clean answer `ONMEETBAAR`, never green, so while one list is down you ask for the others by name and the report says that only those were looked at.

| Id | List | Terms, as we read them (details and dates in each signed manifest and in `docs/DESIGN.md`) | Default |
|---|---|---|---|
| `eu-fsf` | EU Financial Sanctions Files | Commission Decision 2011/833/EU: reuse allowed, source acknowledged, meaning not distorted | yes |
| `uk-sanctions` | UK Sanctions List | Open Government Licence v3.0 | yes |
| `ofac-sdn` | US Treasury OFAC SDN list | a US federal government work (no US copyright, our reading); no usage terms found on the OFAC pages we read | yes |
| `us-csl` | US Consolidated Screening List (trade.gov): the export-control and sanctions lists of the Commerce, State and Treasury departments, without the SDN entries (those are `ofac-sdn`) | a US federal government work (no US copyright, our reading); the publisher's terms page could not be read (HTTP 403) | yes |
| `un-sc` | UN Security Council consolidated list | permission granted by the UN Security Council Sanctions Lists Team on 10 Nov 2026, for any legal purpose, with a courtesy attribution requested (this table is part of it) | no |

The UN list is there for whoever wants it: permission is clear, it is just not in the default set. It adds almost nothing: of its 1007 entries (list of 8 Nov 2026), 988 (98 percent) are also in the UK list by UN reference number, and 1002 have a name that is exactly the same, after our cleaning of names, as a name in the EU, UK or OFAC list; the other five are in those lists under a slightly different written form. A new UN listing usually appears on the UN list first and on the others days or weeks later (not measured by us). The lists are the publishers' own and only the publisher's text is authentic; what you get here is a signed copy for comparison.

Design, threat model and what was found and fixed on the way: `docs/DESIGN.md`. Measured limits: `docs/KNOWN-LIMITS.md`.

Cite as: Al-Muqarin, github.com/holistis/al-muqarin, version 0.0.1, November 2026.
