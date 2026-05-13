/* ==========================================================================
 * export-tools.js - M8 config backup, import, and diagnostics export
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";

  function log(msg) {
    const text = "[" + LOG_PREFIX + "] " + msg;
    if (typeof Zotero.debug === "function") Zotero.debug(text);
    else if (typeof Zotero.log === "function") Zotero.log(text);
  }

  function logError(msg) {
    if (typeof Zotero.logError === "function") Zotero.logError(msg);
    else log("ERROR: " + msg);
  }

  function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  function safeJSON(value) {
    return JSON.stringify(value, null, 2);
  }

  function readJSON(path, fallback) {
    try {
      if (typeof ArxivDailyDataDir === "undefined") return fallback;
      var data = ArxivDailyDataDir.readJSON(path);
      return data === null || data === undefined ? fallback : data;
    } catch (e) {
      return fallback;
    }
  }

  function pluginVersion() {
    return globalThis.__ArxivDailyVersion || "unknown";
  }

  function ensureReady() {
    if (typeof ArxivDailyDataDir === "undefined") throw new Error("数据目录模块未加载");
    if (!ArxivDailyDataDir.getBasePath || !ArxivDailyDataDir.getBasePath()) {
      if (!ArxivDailyDataDir.init()) throw new Error("数据目录初始化失败");
    }
    if (typeof ArxivDailyConfig === "undefined") throw new Error("配置模块未加载");
    if (!ArxivDailyConfig.getAll || !ArxivDailyConfig.getAll()) {
      ArxivDailyConfig.init();
    }
  }

  function writeText(relativePath, text) {
    ensureReady();
    var parent = relativePath.split(/[\\/]/).slice(0, -1).join("/");
    if (parent && ArxivDailyDataDir.ensureSubDir) ArxivDailyDataDir.ensureSubDir(parent);
    if (!ArxivDailyDataDir.writeFile(relativePath, text)) {
      var detail = ArxivDailyDataDir.getLastError ? ArxivDailyDataDir.getLastError() : "";
      throw new Error("写入失败: " + relativePath + (detail ? "; " + detail : ""));
    }
    return {
      relativePath: relativePath,
      path: ArxivDailyDataDir.getSubPath(relativePath),
    };
  }

  function configSummary(config) {
    config = config || {};
    var llm = config.llm || {};
    var arxiv = config.arxiv || {};
    return {
      provider: llm.provider || "",
      apiStyle: llm.apiStyle || "",
      model: llm.model || "",
      baseUrl: llm.baseUrl || "",
      hasApiKey: !!llm.apiKey,
      apiKeyEnv: llm.apiKeyEnv || "",
      coreCategories: arxiv.coreCategories || [],
      crossCategories: arxiv.crossCategories || [],
      reminderTime: config.ui && config.ui.reminderTime || "",
      selectionAskMode: config.ui && config.ui.selectionAskMode || "",
    };
  }

  globalThis.ArxivDailyExportTools = {
    exportConfig: function (includeSecrets) {
      ensureReady();
      var exported = ArxivDailyConfig.exportForBackup(!!includeSecrets);
      var payload = {
        schema: "arxiv-interest-daily.config.v1",
        exportedAt: new Date().toISOString(),
        pluginVersion: pluginVersion(),
        zoteroVersion: (typeof Zotero !== "undefined" && Zotero.version) || "unknown",
        includesSecrets: !!includeSecrets,
        config: exported,
      };
      var suffix = includeSecrets ? "full" : "sanitized";
      var rel = "exports/config-" + suffix + "-" + timestamp() + ".json";
      var written = writeText(rel, safeJSON(payload));
      log("config exported: " + written.relativePath);
      return written;
    },

    importConfigText: function (text) {
      ensureReady();
      var parsed = JSON.parse(String(text || ""));
      var config = parsed && parsed.config ? parsed.config : parsed;
      var validation = ArxivDailyConfig.validateImport(config);
      if (!validation.ok) throw new Error(validation.error);
      var next = ArxivDailyConfig.replaceAll(validation.config);
      log("config imported from pasted JSON");
      return {
        ok: true,
        summary: configSummary(next),
      };
    },

    exportDiagnostics: function () {
      ensureReady();
      var config = ArxivDailyConfig.exportForBackup(false);
      var reports = [];
      try {
        if (typeof ArxivDailyReportStore !== "undefined") {
          reports = ArxivDailyReportStore.listReports();
        }
      } catch (e) {}
      var projects = readJSON("project-papers/index.json", []);
      if (!Array.isArray(projects)) projects = [];
      var threads = readJSON("chat/threads.json", []);
      if (!Array.isArray(threads)) threads = [];
      var taskHistory = readJSON("tasks/task_history.json", []);
      if (!Array.isArray(taskHistory)) taskHistory = [];

      var lines = [];
      lines.push("=== arXiv Interest Daily Diagnostics ===");
      lines.push("Exported at: " + new Date().toISOString());
      lines.push("Plugin version: " + pluginVersion());
      lines.push("Zotero version: " + ((typeof Zotero !== "undefined" && Zotero.version) || "unknown"));
      lines.push("Data directory: " + (ArxivDailyDataDir.getBasePath ? ArxivDailyDataDir.getBasePath() : "unknown"));
      lines.push("Last data-dir error: " + ((ArxivDailyDataDir.getLastError && ArxivDailyDataDir.getLastError()) || "(none)"));
      lines.push("");
      lines.push("[Config summary]");
      lines.push(safeJSON(configSummary(config)));
      lines.push("");
      lines.push("[Indexes]");
      lines.push("Reports: " + reports.length);
      lines.push("Project papers: " + projects.length);
      lines.push("QA threads: " + threads.length);
      lines.push("Task history entries: " + taskHistory.length);
      lines.push("");
      lines.push("[Recent reports]");
      for (var i = 0; i < Math.min(10, reports.length); i++) {
        lines.push("- " + reports[i].date + " | papers=" + (reports[i].paperCount || 0) + " | " + (reports[i].filePath || ""));
      }
      lines.push("");
      lines.push("[Recent task history]");
      for (var t = 0; t < Math.min(10, taskHistory.length); t++) {
        lines.push("- " + safeJSON(taskHistory[t]));
      }
      lines.push("");
      lines.push("Note: API keys are intentionally excluded. Zotero's own debug log is not copied here; attach it separately if a native Zotero error dialog asks for it.");

      var rel = "logs/diagnostics-" + timestamp() + ".txt";
      var written = writeText(rel, lines.join("\n"));
      log("diagnostics exported: " + written.relativePath);
      return written;
    },
  };
})();
