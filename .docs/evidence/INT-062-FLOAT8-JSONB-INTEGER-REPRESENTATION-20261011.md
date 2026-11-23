# C2 finite integer FLOAT8 → JSONB representation

## Disposition

New conditional source supplier, not a previously adopted NUMERIC-floor theorem. It supports encoded JSON numeric17 for finite nonnegative integral binary64 values in[0,2*MAX_SAFE], and signed17 for integral absolute values<=MAX_SAFE, under the fixed PostgreSQL16 shortest-output path and compatible JSONB/numeric implementation. Actual producer/history/finite/rounding premises remain distinct. Source installed parity and positive extra_float_digits are unverified; no GUC change, guard/helper/cap or native execution is proposed. Other output regimes and private/noninteger/custom values remain explicit rather than inheriting17.

Existing timestamp supplier16531110, lines41–49, bounds logical producer magnitudes and physical timestamp output separately; it expressly retains numeric JSON lexical-scale premises. Root checked those lines after an initial larger display was truncated. Existing floor-grant4cb68 is restricted to NUMERIC floor and does not supply this FLOAT8 path.

## Source chain

[PostgreSQL16.5 float.c](https://raw.githubusercontent.com/postgres/postgres/REL_16_5/src/backend/utils/adt/float.c),508–519, chooses shortest decimal when extra_float_digits>0 (source default1), otherwise a separate rounding formatter. Direct FLOAT8 text can contain scientific decoration; no rawTEXT17 or native8-byte substitution follows.

[PostgreSQL16.5 d2s.c](https://raw.githubusercontent.com/postgres/postgres/REL_16_5/src/common/d2s.c):911–947 maps integral values below2^53 to decimal mantissa with exponent0. For[2^53,2^54),329–425 produces e10=-1; its legal interval implies at least one digit removal at478–495, so final exponent589 is nonnegative. Formatting733–793 emits fixed/scientific equivalent integer material. Zero uses the special branch973–975. This is source inference under the binary64 and shortest-path predicates, not a native test.

[PostgreSQL16.5 jsonb.c](https://raw.githubusercontent.com/postgres/postgres/REL_16_5/src/backend/utils/adt/jsonb.c),765–791 converts numeric output through numeric_in;349–352 emits numeric_out. [PostgreSQL16.5 numeric.c](https://raw.githubusercontent.com/postgres/postgres/REL_16_5/src/backend/utils/adt/numeric.c),6713–6716 subtracts exponent from fractional scale and clamps at0;7129 prints fractions only at positive scale. Thus this integral shortest representation becomes scale0 JSONB even when FLOAT8 text was scientific. No arbitrary fractional padding is imported from private input.

## Bounded arithmetic supporting the exponent branch

Let m be the binary significand in[2^52,2^53-1] for a positive value f=2m in[2^53,2^54). In the e2=-1 branch, q=0, e10=-1, vr=20m, vm=20m-5*(1+mmShift), vp=20m+10 with the source acceptBounds adjustment of0 or-1. Integer division yields vm/10=2m-1, vr/10=2m and vp/10>=2m. Therefore vp/10>vm/10 for every permitted m/shift/bound case: the removal loop executes at least once, and final decimal exponent is>=0. Further removal does not lower it. The source interval remains below2^54 for f<=2*MAX_SAFE=2^54-2, including its upper boundary, so its expanded positive integer occupies at most17 decimal digits. Signed values<=MAX_SAFE require at most16 digits plus sign. Exact equality of every intermediate FLOAT8 operation to an intended mathematical value is a separate producer/native premise.

Root checked16 low/high significand/shift/bound boundary combinations with pure JavaScript BigInt, allPASS; the universal division inequalities above supply the nonsampled conclusion. No PostgreSQL executable, parser, compiler, query, native/library install or alternative database was invoked. Two initial upstream Ryu paths were unavailable; the correct fixed release path src/common/d2s.c was subsequently read.

## Application and qualifications

Apply only where actual normal clock lineage supplies finite integral binary64 inputs and this output regime. PHONE1de5 supplies logical bounds for its exact nonstopped fresh5/exclusive/single-active producer; it does not by itself verify the installed formatter/GUC, native arithmetic, all timer histories or source eligibility. Stopped END_ASSISTANCE, invalid/private moments, noninteger material, infinity/SQLNULL and alternate output regimes remain separate. Above-M PHONE restoration failures retain their complete constructor/getter/JSON/hash/storage/error lifetimes; eventual canonical rejection does not erase them.

Normal deadline/anchor/prospective/remaining fields may reuse17 only under their actual finite/sign/range and representation premises. A negative value with absolute magnitude approaching2*MAX_SAFE needs18, so the nonnegative premise must not disappear. Existing SQLNULL4 and JSONnull4 remain their own branches. Complete snapshot/state/proof parents, distinct source evaluated arguments/formals/owned locals and explicit clear/return boundaries stay under H4. This report supplies a representation dependency, not all-four/global fit, profile allocation, source patch, O3 or Part1 acceptance.
