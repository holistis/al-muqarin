# Running it

For whoever keeps a copy of Al-Muqarin running: what to schedule, what red means, what to do about it. Needs Node 22 or newer and nothing else (no packages).

## One time

```
node src/cli.mjs keygen --dir keys        # one key pair; keep keys/muqarin-private.pem to yourself
```

The private key signs the lists you fetch and the reports you make. Anyone who has it can sign for you.

## Fetching the lists

One run per list. The address of each list is fixed in `feeder/bronnen.mjs`; the feeder takes no address from the command line.

```
node feeder/voeding.mjs --bron eu-fsf       --out snapshots --history history --key keys/muqarin-private.pem
node feeder/voeding.mjs --bron uk-sanctions --out snapshots --history history --key keys/muqarin-private.pem
node feeder/voeding.mjs --bron ofac-sdn     --out snapshots --history history --key keys/muqarin-private.pem
# node feeder/voeding.mjs --bron un-sc ...   only if you decide to use the UN list (see the terms in README.md)
```

A cron entry that runs them twice a day, one after the other, so one list that fails does not stop the others (put the lines in `/etc/cron.d/` with a user name after the time fields):

```
17 5,17 * * * muqarin cd /opt/al-muqarin && for s in eu-fsf uk-sanctions ofac-sdn; do (date -u +\%FT\%TZ; node feeder/voeding.mjs --bron $s --out snapshots --history history --key keys/muqarin-private.pem; echo "$s exit=$?") >> logs/feeder.log 2>&1; done
7 * * * * muqarin cd /opt/al-muqarin && node tools/status.mjs --snapshots snapshots --history history --pub keys/muqarin-public.pem --out logs/status.json; true
```

Exit codes of the feeder: `0` a new signed list is live; `2` nothing was fetched or the file could not be read (the live list stays); `3` the file was fetched but looked wrong and went to quarantine (the live list stays, the file and the reason are in `history/quarantine/<time>--<list>/`).

## Is it working?

`node tools/status.mjs --snapshots snapshots --history history --pub keys/muqarin-public.pem` prints one JSON object and exits `0` when every list in the set is fine, `1` when not. The reasons are named per list, for example `eu-fsf:momentopname_bron_niet_aanwezig` (no signed list yet), `uk-sanctions:momentopname_verouderd` (older than 30 hours), `ofac-sdn:quarantaine_na_laatste_goede_run_1`. Treat a missing or old status file as red too: silence is never green. Look at it from outside the machine as well; a machine that is down cannot tell you so.

When a publisher's service is down (this happens: the EU file service returned HTTP 500 on every file in November 2026), the feeder keeps trying at the next run and the status stays red for that list. Do not copy a list in by hand: the signed time of fetching would then say something that is not true. Ask for the other lists by name in the meantime (`--bronnen uk-sanctions,ofac-sdn` on `check` and on the counter); the report then says that only those lists were looked at.

## The counter

```
node loket/start.mjs --snapshots snapshots --pub keys/muqarin-public.pem --key keys/muqarin-private.pem --port 8744 --ledger history/ledger.jsonl [--bronnen uk-sanctions,ofac-sdn]
```

It listens on 127.0.0.1 only and has no login, payment or encryption: put those in the layer in front of it. Details: `docs/DESIGN.md`.

## What you must decide yourself

- Which lists you use, and whether their terms allow your use. The terms as we read them are in `README.md`, in each signed manifest and in `docs/DESIGN.md`. We are not lawyers.
- Where the private key lives, and who may read the logs.
- What a `KANDIDAAT` or `ONMEETBAAR` means for your process. This tool compares names. It is not an audit and not legal advice.
