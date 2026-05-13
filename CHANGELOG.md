# Changelog

## 1.1.0 - 2026-05-13

- Forked the Windows-only Zotero 9 plugin into a cross-platform release folder.
- Reworked plugin data storage to use Zotero/Firefox `nsIFile.append()` path handling instead of Windows backslash string concatenation.
- Added a dependency-free Node.js XPI builder that writes ZIP entries with `/` separators and validates required plugin entries.
- Added cross-platform English/Chinese README files and migration notes.
- Kept the previous phase logs in `docs/` so high-risk behavior can be checked before future edits.

## 1.0.0 - 2026-05-13

- Initial Windows + Zotero 9 release snapshot.

