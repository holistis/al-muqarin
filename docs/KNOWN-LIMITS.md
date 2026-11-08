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

When one of several written forms of a party is removed from the list and used as the claim, the checker finds the party through its other names in 542 of 800 tries (68 percent). We sorted a random sample of 36 of the 258 misses by hand (one sample, so rough): about 4 in 10 are another Latin spelling of the same name, about 1 in 6 are a company name in another language, about 1 in 5 are an abbreviation or a shorter or longer form of the name, about 1 in 5 are another name of the party that shares no word with the one asked, and 2 in 36 are a legal form that our list of legal forms does not know. A tool that compares text will not find a company name in another language, an abbreviation or an unrelated other name of the party; the missing legal forms can be added.

## False alarms

- Companies: 3 candidates in 107 well-known company names (2.8 percent), no hits.
- Western personal names: 0.4 percent.
- Arabic and Russian personal names (written in Latin letters): 22 percent give a candidate or a hit. A birth year or a country on the claim lets a person rule out most of them (78 percent here), but the tool never decides on that.

## The other lists (measured 8 Nov 2026, same method)

The same tool (`tools/zelfmeting.mjs --bron <list>`, seed 7, 300 tries per kind of edit, 800 tries for the alias test) on a fresh copy of each list. Our own measurement, not an independent one. The lists differ in size and in what is on them, so the numbers differ.

| List (date of the list, parties) | Other names of a party found (alias test) | False alarms: well-known companies | Western personal names | Arabic and Russian personal names |
|---|---|---|---|---|
| EU (23 Oct, 6269) | 542 of 800 (68 percent) | 2.8 percent | 0.4 percent | 22 percent |
| UK (3 Nov, 6420) | 460 of 800 (57.5 percent) | 2.8 percent | 7.1 percent | 22.3 percent |
| US OFAC (6 Nov, 19563) | 401 of 800 (50.1 percent) | 13.1 percent | 3.1 percent | 30.8 percent |
| UN (8 Nov, 1007) | 332 of 703 (47.2 percent) | 0 percent | 0.4 percent | 14 percent |

- The edits of the table above (a letter replaced, dropped, added or swapped, a word dropped or added, another spelling, a legal form, invisible characters, a split word, an initial, a symbol) are found in 91.7 to 100 percent of the tries on every one of these lists. The lowest: one word added on the UK list (275 of 300), one word dropped on the OFAC list (191 of 208), one letter dropped on the UK list (278 of 300).
- A false alarm here is a `KANDIDAAT`, never a `TREFFER`: a name that looks like a listed name and needs a person to look. On the OFAC list 14 of 107 well-known companies get one (for example "Alphabet Inc" next to a listed "ALPHABET INTERNATIONAL DMCC", "Moderna" next to "MODERNA EXPRESS TRANSPORTE DE CARGA LTDA."). More lists means more things to look at; choose the lists you need with `--bronnen`.
- The UK list gave 13.3 percent false alarms on Western personal names in the first measurement, because it lists a ship called MARIA and every claim with the word Maria in it was flagged. Ships and aircraft now have their own type and are left out of the rule that flags a claim for sharing one rare word with a listed name; the figure above (7.1 percent) is after that. What is left is mostly one listed company called "LLC SMITH": every claim that contains the word Smith gets a candidate.

## Not covered

- Names written in Arabic, Cyrillic or other non-Latin scripts cannot be compared and are answered `ONMEETBAAR`. Of the names in the list, 6501 are non-Latin and skipped.
- Four lists can be fed (EU, UK, US OFAC, UN); the lists of other publishers, national lists and lists of beneficial owners are not. A party that is on none of the four lists asked for is not found, whatever it is.
- No independent party has reviewed this yet. Our own reviews are not independent.
- The time on a report is the signer's clock, marked `klok`. There is no third-party timestamp yet.
- Every run carries a run number and the hash of the one before it. A reader that knows the highest number it has seen (`--min-volgnummer`, the counter's memory and the feeder's ledger) refuses an older list. Someone who controls both the folder and the ledger can still restart the chain: there is no copy outside the machine yet.

## What the answers mean

`GEEN_TREFFER_IN_LIJST` means no match in that list version on that date, with the matching rules above. It never means clean, safe or compliant.
