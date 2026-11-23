# INT-062 C2 — returned grant expiry representation

## Conditional source supplier

ACL2936/2941 produces grant expiry using floor(extract(epoch FROM expiresAt)*1000); scope2930 preserves that scalar. Protected INT6 canonical92 validates integral safe magnitude and emits BIGINT text. The canonical8192 guard alone does not prove the original JSON numeric scale.

The exact producer does resolve the scale question conditional on PostgreSQL16 source parity and finite normal timestamp ancestry. In [PostgreSQL16.5 numeric source](https://raw.githubusercontent.com/postgres/postgres/REL_16_5/src/backend/utils/adt/numeric.c), numeric_floor calls floor_var; floor_var9384–9397 truncates at scale0; trunc_var11012 sets dscale. Numeric output prints fractional digits only for positive dscale (7129). Thus the finite result has no arbitrary fractional padding or exponent decoration. In [PostgreSQL16.5 JSONB source](https://raw.githubusercontent.com/postgres/postgres/REL_16_5/src/backend/utils/adt/jsonb.c), numeric construction765–791 uses numeric output/input, and numeric emission349–352 uses numeric_out. These branches preserve scale0 representation for this finite producer.

Therefore encoded scalar17 is a conditional upper where normal returned expiry is nonnegative and below2*MAX_SAFE, or signed magnitude at mostMAX_SAFE. After successful canonical validation the signed safe bound suffices. Before that guard, retain the normal grant producer/storage/timestamp range premise; do not infer it from later canonical success. ACL1310 creates expiry from moment+durationSeconds*1000;2224 stores via to_timestamp;2901 checks nonrevoked expiry against authority event+600seconds. This bounded readback identifies those supplier sites but does not certify native timestamp conversion rounding, source history or installed parity. Keep a named magnitude term wherever those premises remain unclosed.

No private arbitrary timestamp, infinity, SQLNULL or failed range path is silently assigned the normal finite17. Count getter, numeric conversion/output and complete containing grant/scope carriers separately under H4. This closes the conditional scale seam only, not all-four closure, numerical profile, native acceptance or runtime patch.

## Evidence scope

Root read actual ACL2925–2942 and protected INT6 86–96, plus narrowly searched producer/store/assert sites. ACL identity aae4c3ce0e0de78a063f03bd5335cc2757e73a2061eefe6d7ec3f8b2a4d5111d; protected INT6 identity from the existing custody record remains required. Official fixed release tag is evidence, not a claim that the installed server uses that release. No upstream code downloaded, parser/compiler/query/native execution or source implementation change. An initial local read used a nonexistent INT6 directory name and was corrected to the actual20261007130000_int6_classic_gameplay path; no edit occurred.
