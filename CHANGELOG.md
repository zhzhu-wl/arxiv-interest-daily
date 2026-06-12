# Changelog

## 1.1.4 - 2026-06-12

- Changed Guess You Like feedback drafts from rating logs into LLM-synthesized preference profiles; raw rating evidence is kept separately as a feedback record.
- Enabled automatic feedback-profile refresh after the user first saves the Guess You Like profile.
- Hardened report rendering so orphaned LLM guide paragraphs and old feedback-record drafts are not shown as report intro or Guess You Like content.

## 1.1.3 - 2026-06-11

- Added feedback-profile readiness detection after 5 uniquely rated papers.
- Added a report-reader shortcut to configure the Guess You Like research profile when feedback is sufficient.
- Added pending feedback-profile draft generation from paper ratings; drafts prefill the feedback editor but are not saved until the user confirms.

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
