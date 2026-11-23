# Rejected combined homepage source snapshot — 2026-10-02

This is recoverable implementation evidence for [human live rejection 0011](history/0011-maydan-homepage-rejection.md), not an approved design. The isolated integration checkout was based on `c48594bfeb1a93f6db88eadddc1021944dcb0dec`. Before replacement work, `git diff --binary` for the seven tracked homepage/auth/test files was saved as [rejected-homepage-2026-10-02.patch](rejected-homepage-2026-10-02.patch), 54,824 bytes, SHA-256 `89BB6AC6786D0EAB143460B8C0F67F0CA8D7A11D4FD89C78E1F72BA03444CDF5`. It does not include untracked integration service or design records.

| File in isolated checkout | Current SHA-256 |
| --- | --- |
| `src/routes/HomeSurface.tsx` | `0F0E33E3463B493AD9924B618CE96D9CF0A3DA028296D2762B3D9D8FC042A37C` |
| `src/styles/khaliah.css` | `2DC811F4BA6653F4B9FBC6CFFA10CADFF62EF77A4A01AE9FAEF49BBF67CDCA5B` |
| `src/routes/EntryRoute.tsx` | `6FD13D304CD95134B424417A3BE87356AB17BA1F4A1F8CEF3517D340204D5BE4` |
| `src/routes/AuthRoutes.tsx` | `10A4E7A82B6125F96A1514BBAAB6A08B14593FD3D23919A36CBFA308371B7B26` |
| `tests/app/home-surface-inventory.test.tsx` | `195EE6807777225D61F394A395D0D4EE5DC634C97E1942CD0D0B1ED1F40759BF` |
| `tests/app/entry-route.test.tsx` | `1F57BFBD0B0A2A15FF10641B66D0EC13CC5971F1C4201C6B7A2FA2F5A2C2E0BD` |
| `tests/app/auth-routes.test.tsx` | `E794B75761C519F4E858D965DF54538B36C6700EF94D36DF7895DC32516A9AFC` |

The snapshot protects the rejected visual state from being mislabeled as approved and lets the replacement implementation retain functional host/join/account checks. It makes no claim about production deployment or content readiness.
