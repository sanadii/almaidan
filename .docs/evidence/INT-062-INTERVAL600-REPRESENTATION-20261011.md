# INT-062.E1 — conditional fixed interval representation

## Disposition

For the exact `INTERVAL '600 seconds'` occurrence in `int9_scope_fact_complete`, adopt **I600 ≤128** only under the existing raw temporal-output measure and PostgreSQL16 source compatibility. This is an encoded value envelope, not a native Datum, heap, buffer-allocation or ABI measurement. Literal TEXT11, typed interval input, timestamp input and timestamp-addition output remain distinct carriers. No native execution, formatter setting, runtime change, global fit or O3 acceptance follows.

## Source evidence

Fixed release source, fetched read-only and hashed as returned UTF8 text on October11:

| Source | SHA256 |
| --- | --- |
| [timestamp.c](https://raw.githubusercontent.com/postgres/postgres/REL_16_5/src/backend/utils/adt/timestamp.c) | `24241767a590f06fd96427ecad8857c677fd4564699fbb04003b998b72686060` |
| [datetime.c](https://raw.githubusercontent.com/postgres/postgres/REL_16_5/src/backend/utils/adt/datetime.c) | `7a0711a026614e17634273e151ed88d69189095b6dd64e7daa2d5e3454073b24` |
| [datetime.h](https://raw.githubusercontent.com/postgres/postgres/REL_16_5/src/include/utils/datetime.h) | `0e0e845c37a4c547c6ea37fefd000022fcee1782340ded1834594bb58d079709` |

timestamp.c interval_in828–893 initializes zero components and parses the exact positive integral seconds input. itmin2interval1917–1926 preserves month/day/time; interval2itm1865–1883 decomposes it into zero year/month/day/hour/seconds/fraction and ten minutes. interval_out899–911 calls EncodeInterval using IntervalStyle. No arbitrary supplied interval or private replacement is included.

datetime.c seconds-unit decoding3317–3327 multiplies the integral value by microseconds per second. EncodeInterval4244–4421 selects four styles. For those exact components, SQL standard emits `0:10:00`, PostgreSQL emits `00:10:00`, ISO emits `PT10M`, and verbose emits `@ 10 mins`. The longest is nine ASCII bytes. The retained128 envelope therefore covers all four styles without requiring a selected style. datetime.h181–186 defines MAXDATELEN128 for temporal input/output; the explicit formatter analysis, rather than buffer size alone, establishes this constant's output bound.

## Limits

This extends the existing conditional temporal-output convention to one fixed interval. It does not add an interval_out execution to the actual SQL caller or count hypothetical formatter frames. Actual addition/query/parent lifetimes still need their source schedules. The resulting timestamp uses the separate adopted timestamp supplier; its range/error/NULL alternatives are not removed. Alternate implementations, installed conformance, source replacement and native parser/arithmetic remain unverified. Wider intervals retain their own supplier. Only this document is created.
