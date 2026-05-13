/* ==========================================================================
 * Zotero arXiv Interest Daily — Bootstrap
 *
 * Lifecycle hooks called by Zotero's extension loader.
 * Services is injected by Zotero's sandbox — do NOT declare const Services.
 * ========================================================================== */

"use strict";

const LOG_PREFIX = "arxiv-interest-daily";

function log(msg) {
  const text = `[${LOG_PREFIX}] ${msg}`;
  if (typeof Zotero.debug === "function") Zotero.debug(text);
  else if (typeof Zotero.log === "function") Zotero.log(text);
}

function logError(msg) {
  if (typeof Zotero.logError === "function") Zotero.logError(msg);
  else log("ERROR: " + msg);
}

function install(data, reason) {
  log("installed v" + data.version);
}

async function startup({ id, version, rootURI }, reason) {
  log("starting up (reason: " + reason + ")");
  log("rootURI = " + rootURI);
  globalThis.__ArxivDailyRootURI = rootURI;
  globalThis.__ArxivDailyVersion = version;

  const modules = [
    // Services (no UI deps)
    "src/storage/data-dir.js",
    "src/services/config.js",
    "src/services/env-test.js",
    // arXiv + LLM modules
    "src/arxiv/fetcher.js",
    "src/storage/cache.js",
    "src/llm/prompts.js",
    "src/llm/client.js",
    "src/services/keywords.js",
    "src/storage/report-store.js",
    "src/services/report-generator.js",
    "src/services/task-manager.js",
    "src/services/export-tools.js",
    // UI modules
    "src/ui/i18n.js",
    "src/ui/logo.js",
    "src/ui/platform-shortcuts.js",
    "src/ui/left-pane.js",
    "src/ui/menu.js",
    "src/ui/button-bar.js",
    "src/ui/settings-window.js",
    "src/ui/profile-window.js",
    "src/ui/help-window.js",
    "src/ui/center-workspace.js",
    "src/ui/progress.js",
    "src/ui/search-panel.js",
    "src/ui/calendar.js",
    "src/ui/qa-sidebar.js",
    "src/services/reminder.js",
    // Orchestrator
    "src/main.js",
  ];

  for (const mod of modules) {
    try {
      Services.scriptloader.loadSubScript(rootURI + mod);
      log("loaded " + mod);
    } catch (err) {
      logError("failed to load " + mod + ": " + (err.message || err));
      if (err.stack) logError(err.stack);
    }
  }
}

function shutdown(data, reason) {
  log("shutting down (reason: " + reason + ")");
  if (typeof globalThis.gArxivDailyShutdown === "function") {
    globalThis.gArxivDailyShutdown(reason);
  }
}

function uninstall(data, reason) {
  log("uninstalled");
}
