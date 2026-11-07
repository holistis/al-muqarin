# Known limits

These numbers were measured by us, with our own tool (`tools/zelfmeting.mjs`), on the EU Financial Sanctions list dated 2026-10-23 (6269 parties). They are not an independent evaluation. The tool edits real names from the list in known ways and checks whether the checker still finds them. A random sample of 300 per class, seed 7, measured 2026-11-07 (the classes that existed on 2026-11-06 gave exactly the same counts).

## Edited names that the checker still finds (found / tried)

| Kind of edit | Found |
|---|---|
| One letter replaced | 292 / 300 |
| One letter missing | 289 / 300 |
| One letter added | 296 / 300 |
| Two letters swapped | 292 / 299 |
| Words in another order | 292 / 292 |
| One word dropped | 223 / 224 |
| One word added | 294 / 300 |
| Other spelling (case, accents, punctuation) | 299 / 299 |
| Legal form changed or left out | 300 / 300 |
| Invisible format characters inserted (soft hyphen, zero-width) | 300 / 300 |
| Other invisible characters inserted (blank Braille cell, Hangul fillers, variation selectors, tag characters) | 300 / 300 |
| A trade mark or numero sign added behind the name | 298 / 300 (the two misses are names of four or five letters) |
| Word split in two | 298 / 300 |
| Initial next to the surname | 299 / 300 |

Short names are weaker than long ones. "Found" includes exact matches after cleaning and fuzzy candidates.

## Other names of the same party (alias test)

When one of several written forms of a party is removed from the list and used as the claim, the checker finds the party through its other names in 542 of 800 tries (68 percent). Transliteration between scripts is the main miss.

## False alarms

- Companies: 3 candidates in 107 well-known company names (2.8 percent), no hits.
- Western personal names: 0.4 percent.
- Arabic and Russian personal names (written in Latin letters): 22 percent give a candidate or a hit. A birth year or a country on the claim lets a person rule out most of them (78 percent here), but the tool never decides on that.

## Not covered

- Names written in Arabic, Cyrillic or other non-Latin scripts cannot be compared and are answered `ONMEETBAAR`. Of the names in the list, 6501 are non-Latin and skipped.
- Only the EU Financial Sanctions list is a source today.
- No independent party has reviewed this yet. Our own reviews are not independent.
- The time on a report is the signer's clock, marked `klok`. There is no third-party timestamp yet.
- Every run carries a run number and the hash of the one before it. A reader that knows the highest number it has seen (`--min-volgnummer`, the counter's memory and the feeder's ledger) refuses an older list. Someone who controls both the folder and the ledger can still restart the chain: there is no copy outside the machine yet.

## What the answers mean

`GEEN_TREFFER_IN_LIJST` means no match in that list version on that date, with the matching rules above. It never means clean, safe or compliant.
