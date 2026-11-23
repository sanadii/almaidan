# ميدان selected display font source — 2026-10-02

The owner-selected warm poster [visual contract](history/0012-maydan-warm-poster-replacement-selection.md) calls for expressive Arabic display type. **Lalezar** is a candidate implementation font for the wordmark and short game names; body and controls keep the already bundled IBM Plex Sans Arabic. This is implementation provenance, not a second visual selection or live homepage approval.

- Official author repository: [BornaIz/Lalezar](https://github.com/BornaIz/Lalezar), pinned commit `238701c4241f207e92515f845a199be9131c1109` (read-only `git ls-remote HEAD` on 2026-10-02).
- Pinned [WOFF2 source](https://raw.githubusercontent.com/BornaIz/Lalezar/238701c4241f207e92515f845a199be9131c1109/fonts/webfonts/Lalezar-Regular.woff2): 85,748 bytes, SHA-256 `148C72044161F7FDD874A7743F5402F15B04BC2B9A609D2734DEB22057BEF2D5`.
- Pinned [OFL.txt](https://raw.githubusercontent.com/BornaIz/Lalezar/238701c4241f207e92515f845a199be9131c1109/OFL.txt): 4,383 bytes, SHA-256 `327BAC41D89CF9F32E0EFE353228018E1661CFF458A5D4905714958514DF7BD5`. Its header identifies the Lalezar Project Authors and SIL Open Font License 1.1.

Both files were fetched to temporary files and their bytes independently hashed. The implementer should copy only these exact pinned bytes into the isolated app and include the license text, then render Arabic sample text on desktop and 320px before considering the font usable. If its glyph shaping or metrics fail, report the deviation and choose a separately licensed Arabic display font with a new provenance record; do not silently substitute the rejected headline treatment.
