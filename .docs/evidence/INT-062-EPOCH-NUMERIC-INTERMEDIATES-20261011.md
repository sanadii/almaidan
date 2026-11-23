# INT-062.E1 — conditional epoch NUMERIC intermediates

## Disposition

For the exact recording-closure expression `floor(extract(epoch FROM e.at)*1000)`, finite nonnegative TIMESTAMPTZ(3) ancestry bounded by2*MAX_SAFE milliseconds supplies separate raw encoded NUMERIC bounds: **EXTRACT21**, **product24**, and existing **floor17**. This applies only under compatible PostgreSQL16 source and the adopted encoded-value measure. Caller inputs, integer1000 conversion, operation outputs, old assignment targets and pending operands remain distinct. No native execution, ABI width, heap bound, cap, cast or runtime edit follows.

## Source binding

- [timestamp.c, REL_16_5](https://raw.githubusercontent.com/postgres/postgres/REL_16_5/src/backend/utils/adt/timestamp.c), returned UTF8 SHA `24241767a590f06fd96427ecad8857c677fd4564699fbb04003b998b72686060`. `extract_timestamptz` uses `timestamptz_part_common` with numeric output. Its epoch fast path calls `int64_div_fast_to_numeric` with scale6; its overflow-avoidance path explicitly rounds the numeric quotient to6 before returning. Both returned finite epoch numerics therefore have six fractional places. The nonnumeric date_part branch is different.
- [numeric.c, REL_16_5](https://raw.githubusercontent.com/postgres/postgres/REL_16_5/src/backend/utils/adt/numeric.c), returned UTF8 SHA `b3ca5deb50a0c7b5c28bd3680d06ca7a6443d123695430c97163bc6ce473bc24`. The fast divider retains the requested display scale. Integer1000 conversion has scale0; numeric multiplication uses the sum of input scales, hence6. `numeric_out`/`get_str_from_var` retains those fractional places. Existing floor supplier4cb68 covers the separate scale-zero result.

## Width derivation / limits

Let M=9007199254740991. For actual finite0≤m≤2M milliseconds, epoch seconds have at most14 integer digits. Six fractional digits and a decimal point give21. Multiplication by1000 has at most17 integer digits and preserves scale6, giving24. These count trailing zeros; no shortest FLOAT8 output rule is imported. Millisecond typmod custody and exact source arithmetic/range remain premises, not new guards. Signed values need an additional sign where applicable; negative/private/infinite/NULL/unproved ancestry retains its own terms and errors. The floor17 premise cannot replace its earlier NUMERIC inputs.

The source references above are identified by function and full returned-text hash. Web-tool displayed line offsets are not raw-file physical line numbers; this also clarifies line references in Root interval supplier8cfb without changing its frozen bytes or facts. No hypothetical formatter call or C-internal heap schedule is added to the actual SQL expression. Final all35/all4/profile/source/native/O3/Part1 acceptance remains open.
