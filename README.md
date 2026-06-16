# arXiv Interest Daily for Zotero 9

arXiv Interest Daily is a cross-platform Zotero 9 plugin for personalized arXiv screening, daily report generation, project-paper management, historical report search, and LLM-assisted reading/Q&A.

中文文档: [README.zh-CN.md](README.zh-CN.md)

## Supported Platforms

- Zotero 9.x
- Windows, macOS, and Linux
- Network access to arXiv
- Optional: an LLM API compatible with OpenAI-style, Anthropic-style, or similar chat APIs

This folder is the cross-platform XPI target. The older `zotero-arxiv-interest-daily-win-zotero9` folder is kept as a Windows validation snapshot and should not be treated as the portable release source.

## Features

- Generate personalized daily arXiv reports from configured categories and research-interest profiles.
- Rank papers with local signals and optional LLM screening.
- Save reports, cache, project-paper metadata, chat history, and settings inside the Zotero profile.
- Add papers to a Zotero project collection with duplicate checks.
- Search historical reports by keyword or LLM-assisted relevance.
- Ask an LLM about the current report, Zotero item, PDF context, selected text, or project papers.
- Use selected text in reports/PDFs as Q&A context through a lifecycle-managed floating entry.

## Installation

1. Download `arxiv-interest-daily-v1.1.5.xpi` from the GitHub Release page.
2. Open Zotero.
3. Go to `Tools -> Plugins`.
4. Click the gear icon.
5. Choose `Install Add-on From File...`.
6. Select the downloaded `.xpi` file.
7. Restart Zotero if prompted.

## Basic Configuration

Open `Daily arXiv -> Settings` in Zotero and configure:

- arXiv core categories and optional cross categories.
- LLM provider, API style, base URL, API key, and models.
- Separate defaults for report generation, search, and Q&A models.
- UI language, report language, reminder time, and selected-text Q&A mode.

LLM features require a valid API key and model configuration. Without LLM configuration, the non-LLM/basic workflows still remain available.

## Data Location

The plugin stores generated data under the active Zotero profile:

```text
<Zotero profile>/arxiv-interest-daily
```

The plugin uses Zotero/Firefox file APIs and platform-native path handling. It does not hardcode `%APPDATA%`, `/Users/...`, `/home/...`, or Windows-only path separators.

## Build

Node.js 18 or newer is required. No npm dependency installation is needed.

```bash
npm run check
npm run build
```

If Windows PowerShell blocks `npm.ps1`, use `npm.cmd run check` / `npm.cmd run build`, or run the Node scripts directly:

```bash
node scripts/check-js.js
node scripts/build-xpi.js
```

The generated XPI will be written to:

```text
build/arxiv-interest-daily-v1.1.5.xpi
```

The build script creates ZIP/XPI entries with `/` separators and verifies that required files such as `manifest.json`, `bootstrap.js`, and `src/main.js` are present.

## Updates

`plugin/manifest.json` points Zotero to:

```text
https://raw.githubusercontent.com/zhzhu-wl/arxiv-interest-daily/main/updates.json
```

`npm run build` regenerates `updates.json` for the current manifest version and XPI SHA-256. When publishing a new release, attach the generated XPI to the matching GitHub Release tag, for example `v1.1.5`.

## Development Notes

See [docs/USER_REQUIREMENTS_FROM_CODEX_SESSIONS_zh.md](docs/USER_REQUIREMENTS_FROM_CODEX_SESSIONS_zh.md) and [docs/CROSS_PLATFORM_MIGRATION_zh.md](docs/CROSS_PLATFORM_MIGRATION_zh.md) before changing path, packaging, reader-selection, LLM, or Zotero data-sync behavior. Those files capture the requirements and the bugs that previously caused breakage.
