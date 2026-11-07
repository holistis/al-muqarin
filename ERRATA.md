# Errata

Every miss or wrong answer we know about: what was missed, since which version, what was fixed. Newest first.

## 2026-11-07, before the first release

Found by our own reviews before anything was published, so no released version ever carried them (version 0.0.1 is the first release). They are listed because a reader should be able to see what kind of holes this tool had.

- A trade mark or numero sign behind a name stuck to the word, so "Alrosa™" gave GEEN_TREFFER_IN_LIJST although "Alrosa" is a match. Fixed. Test: `test/buitenstaander.test.mjs`.
- Invisible characters beyond the format category (blank Braille cell, Hangul fillers, variation selectors) cut a word in two. Fixed in the same place.
- `verify` accepted a report whose results rested on a source the report itself called unusable or did not list. Fixed.
- A refused claim could leave up to 30 kB of its own text in the signed report. Fixed: only a valid id and a known type are copied.
- Duplicate keys in JSON were accepted, so the last one silently won. Now refused.
- The counter limited per full IPv6 address, so a /64 gave endless fresh allowances. Now one /64 is one visitor.
- Twelve planted faults in the code were not caught by any test (see "Gaps in our own tests" in `docs/DESIGN.md`). Closed in `test/gaten.test.mjs`.
