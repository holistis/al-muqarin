# Security

Please report problems through GitHub's private vulnerability reporting (the "Report a vulnerability" button on the Security tab of this repository), not in a public issue.

## What counts as a security problem here

- Any way to make the checker answer `GEEN_TREFFER_IN_LIJST` when the claim is in the list, or `TREFFER` and `KANDIDAAT` wrongly hidden. A missed match is the worst failure of this tool.
- Accepting a list that is unsigned, altered, truncated, older than the limits allow, or signed by another key.
- A report that verifies but is not about the claims it says it is about.
- Leaking or forging the signing key, or making the counter (`loket/`) sign something it should refuse.
- Getting past the counter's limits, reading or writing outside its folders, or crashing it with one request.

## What is known and not fixed

See `docs/KNOWN-LIMITS.md` and the section "Still open" in `docs/DESIGN.md`. Reports about those are welcome but not new.

## What to expect

This is a small project. There is no service level. A confirmed problem gets a fix, a regression test and a public note in the errata, and you are credited there if you want to be.
