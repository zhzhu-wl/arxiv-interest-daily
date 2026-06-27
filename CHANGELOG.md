# Changelog

## 1.2.0 - 2026-06-26

- Added past-report generation from calendar days without an existing report.
- Historical generation now reads arXiv announcement archive pages and selects the closest arXiv release date within the target-date lookback window, avoiding API submission-date semantics.
- Added a `生成过往日报` menu entry under `生成今日报告`.

## 1.1.7 - 2026-06-23

- When a generated report accidentally contains arXiv papers from multiple dates, the saved report date now uses the latest paper date instead of the most frequent date.
- Recorded mixed paper dates and their counts in report metadata to make cross-date fetches easier to diagnose.

## 1.1.6 - 2026-06-16

- Kept the Guess You Like section visible when a usable feedback profile exists by falling back to local profile-aware ranking if the report LLM is unavailable, returns invalid JSON, or produces an empty selection.
- Ranked Guess You Like candidates from the broader scored paper pool instead of only the final recommended papers.

## 1.1.5 - 2026-06-16

- Enabled free text copying in the LLM Q&A sidebar via selection, right-click Copy, and Ctrl/Cmd+C for both questions and answers.
- Added per-message Copy controls to user question bubbles, including selected-passage context when present.
- Improved Q&A context capture so the sidebar refreshes and reuses the latest same-tab Zotero reader/page snapshot when the active reader handle is temporarily unavailable.

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
