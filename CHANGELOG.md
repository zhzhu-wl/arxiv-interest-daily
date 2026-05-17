# Changelog

## 1.1.2 - 2026-05-17

- Reports now write complete abstracts instead of truncating them with trailing ellipses.
- Report abstracts are localized to the configured report language through the report LLM model, with cached translations for repeat builds.

## 1.1.1 - 2026-05-15

- Hardened LLM screening JSON parsing against fenced output, extra commentary, and nested response objects.
- Added raw LLM response diagnostics under `cache/llm/raw-responses` when a batch cannot be parsed.
- Added automatic small-batch retry for failed LLM prefilter/screening batches before falling back to keyword scoring.
- Exposed `screening.llmRetryBatchSize` in settings and help text.

## 1.1.0 - 2026-05-13

- Forked the Windows-only Zotero 9 plugin into a cross-platform release folder.
- Reworked plugin data storage to use Zotero/Firefox `nsIFile.append()` path handling instead of Windows backslash string concatenation.
- Added a dependency-free Node.js XPI builder that writes ZIP entries with `/` separators and validates required plugin entries.
- Added cross-platform English/Chinese README files and migration notes.
- Kept the previous phase logs in `docs/` so high-risk behavior can be checked before future edits.

## 1.0.0 - 2026-05-13

- Initial Windows + Zotero 9 release snapshot.
