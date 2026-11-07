# When someone reports a miss

1. Reproduce it with the exact claim and the list version (`list_sha256` in the report). Do not argue before it is reproduced.
2. If the checker should have found it: write the failing test first, with the claim as it came in, then fix, then add the input class to `tools/zelfmeting-lib.mjs` and a planted fault in `tools/mutatie-proef.mjs`.
3. Publish a short errata entry in the repository: what was missed, since which version, what was fixed, how many other claims in our own measurement are affected. No excuses, no softening.
4. If a report said `GEEN_TREFFER_IN_LIJST` for something in the list, say so to the people who hold that report, with the report id. Reports older than the fix stay as they are; the errata is how they learn.
5. If the signing key may be exposed: stop the counter, stop the feeder, make a new key, publish the new key id and the time of the change, and sign nothing with the old key again. Old reports stay checkable with the old public key.
6. Afterwards: look for the same class of hole elsewhere in the code and in the measurement, so it is not found twice.
