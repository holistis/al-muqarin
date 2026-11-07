# al-muqarin

Al-Muqarin, Arabic for "the one who compares". Compares claims about a supply chain (a company name, a country code) with signed snapshots of public lists, and answers per claim with a signed, dated verdict.

Early release (version 0.0.1), Apache-2.0 (see LICENSE and NOTICE). Measured limits: docs/KNOWN-LIMITS.md. Errors we know about: ERRATA.md. Reporting problems: SECURITY.md.

It is not an audit, not a certification and not legal advice. It never says "clean": the strongest answer is `GEEN_TREFFER_IN_LIJST`, meaning no match under this tool's matching rules in that list version on that date. The matching can miss a listed party: in our own measurement a party written in another Latin spelling of its name was missed in about a third of the tries (numbers in `docs/KNOWN-LIMITS.md`). If a list is missing, empty, stale, truncated, unsigned or altered, the answer is `ONMEETBAAR` (not measured), never a green.

## Try it in a minute (demo data, no network)

This builds a tiny signed list of FICTIONAL names with throw-away keys, then checks three example claims against it. It is not the EU list.

```
node tools/demo-snapshot.mjs --dir demo
node src/cli.mjs check --claims examples/claims.json --snapshots demo/snapshots --pub demo/keys/muqarin-public.pem --key demo/keys/muqarin-private.pem --out demo/report.json
node src/cli.mjs verify --report demo/report.json --pub demo/keys/muqarin-public.pem --claims examples/claims.json
```

A claims file is a JSON list; every claim has exactly `id` (letters, digits, `._:-`, up to 64), `type` (`entity` or `country`) and `value`, plus an optional `birthYear` and `country` for an entity. See `examples/claims.json`. The report text is in Dutch for now. The first command prints the counts and the worst outcome; the exit code says it too (see below).

With real data you need the feeder (`feeder/`), which fetches the EU list from the network. The unit tests need nothing: `npm test` (about 10 seconds). The planted-fault proof `npm run mutatie` is slow: about 65 minutes on our machine with six parts running at the same time (`node tools/mutatie-proef.mjs "" 0/6` up to `5/6` in six terminals), much longer in one piece. A fault that makes the tests loop for ever is stopped by a time limit (four minutes) and counted apart; one fault needs real file modes and is skipped on Windows.

## Commands

```
node src/cli.mjs keygen --dir keys
node src/cli.mjs check --claims claims.json --snapshots snapshots --pub keys/muqarin-public.pem --key keys/muqarin-private.pem --out report.json
node src/cli.mjs verify --report report.json --pub keys/muqarin-public.pem --claims claims.json
npm test           # 445 tests, including random and metamorphic ones
npm run mutatie    # plants 371 faults in the code, the counter and the measuring tool; the tests must catch every one
```

A claim may carry `birthYear` and `country` (entities only). A valid hint never changes the outcome; each candidate just gets a `komt_overeen`, `wijkt_af` or `onbekend` hint so a reader can tell namesakes apart. An invalid hint (a year outside 1850 to 2100, a year written as text, an unknown country code) makes that one claim `ONMEETBAAR`, never green.

Exit codes of `check`, so a pipeline never has to parse text: `0` only when every claim is `GEEN_TREFFER_IN_LIJST`, `20` at least one `ONMEETBAAR`, `21` at least one `KANDIDAAT`, `22` at least one `TREFFER` (the worst outcome decides). `2` is invalid input or usage (unknown, repeated or valueless options are refused), `3` an unexpected error; both print one JSON line on stderr. `verify` exits `1` when the report is not valid. `--min-volgnummer eu-fsf=N` refuses a list with a lower run number than N (a rolled-back list), or one without a number.

What `verify` proves, and what it does not. It checks the signature, that the report is consistent with itself (every top outcome equals the worst of its sources, the summary matches the results, the dates and ages add up) and, with `--claims`, that the report is about exactly those claims (a hash per claim). The report names the key that signed it (`sleutel_id`); give `--expect <id>` to insist on a key you got from somewhere else. It does NOT prove that the signer's clock was right (`gemaakt` is the signer's own clock, marked `klok: opgegeven` when `--now` was used) or that the signer ran this code. A third-party timestamp is not built yet.

`niet_vergelijkbare_namen` in a report counts names in the list that are not written in Latin letters; those cannot be compared. If fewer than 90 percent of the parties on a list have a comparable name, the list is `ONMEETBAAR` and the feeder refuses to sign it.

Fetching the EU list (`feeder/`) and the local counter (`loket/`, loopback only) are the only parts that touch the network, kept apart from the checker in `src/`, which has none:

```
node feeder/fetch-eu-fsf.mjs --out snapshots --history history --key keys/muqarin-private.pem
node tools/status.mjs --snapshots snapshots --history history --pub keys/muqarin-public.pem   # exit 1 when the feeding bot is not doing its job
node loket/start.mjs --snapshots snapshots --pub keys/muqarin-public.pem --key keys/muqarin-private.pem --port 8744   # 127.0.0.1 only
```

Design, threat model and what was found and fixed on the way: `docs/DESIGN.md`. Measured limits: `docs/KNOWN-LIMITS.md`.

Cite as: Al-Muqarin, github.com/holistis/al-muqarin, version 0.0.1, November 2026.
