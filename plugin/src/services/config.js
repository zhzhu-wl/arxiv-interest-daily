/* ==========================================================================
 * config.js — Configuration management
 *
 * Reads/writes config.json. Provides typed accessors and change listeners.
 * Default config values are defined here.
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";
  const CONFIG_FILE = "config.json";
  const PREFS_PREFIX = "extensions.arxiv-interest-daily.";
  const CONFIG_BACKUP_PREF = PREFS_PREFIX + "configBackupJSON";

  function log(msg) {
    const text = "[" + LOG_PREFIX + "] " + msg;
    if (typeof Zotero.debug === "function") Zotero.debug(text);
    else if (typeof Zotero.log === "function") Zotero.log(text);
  }

  function logError(msg) {
    if (typeof Zotero.logError === "function") Zotero.logError(msg);
    else log("ERROR: " + msg);
  }

  const DEFAULT_CONFIG = {
    llm: {
      provider: "",
      apiStyle: "openai",
      apiKey: "",
      apiKeyEnv: "",
      model: "",
      baseUrl: "",
      temperature: 0.3,
      maxTokens: 32768,
      timeoutSeconds: 120,
      retryAttempts: 3,
      apis: [],
      usage: {
        report: "",
        search: "",
        qa: "",
      },
    },
    arxiv: {
      coreCategories: [],
      crossCategories: [],
      maxResults: 150,
      daysBack: 3,
      dateSource: "announcement",
      dateFilter: "latest",
      announcementPageSize: 1000,
      includeCrossLists: true,
      includeReplacements: false,
      idBatchSize: 100,
      pageSize: 50,
      requestIntervalMs: 3000,
      requestTimeoutSeconds: 60,
      retryMax: 3,
      retryWaitSeconds: [30, 60, 120, 240, 480],
      paginationContinueThreshold: 0.8,
      cacheEnabled: true,
      cacheMaxAgeHours: 6,
    },
    screening: {
      selectionMode: "llm",
      keywordPrefilter: true,
      keywordMinScore: 1,
      llmPrefilterMinScore: 2,
      llmPrefilterPasses: 3,
      llmMinScore: 2,
      maxCandidates: 80,
      selectionBatchSize: 8,
      llmBatchSize: 20,
      llmRetryBatchSize: 5,
      llmPasses: 3,
      crossDisciplineMaxCandidates: 20,
    },
    deepRead: {
      enabled: true,
      topN: 5,
      crossN: 5,
      minCoreScore: 2,
      minCrossScore: 1,
      maxPdfPages: 10,
      chunkSize: 4000,
      maxChunks: 12,
      minTextChars: 4000,
      minCoreGuideChars: 1000,
      minCrossGuideChars: 800,
      pdfTimeoutSeconds: 90,
      pdfDownloadDelaySeconds: 1,
      cacheLLMOutputs: true,
      concurrency: 3,
    },
    search: {
      llmCandidates: 1000,
      llmBatchSize: 10,
      llmMinScore: 2,
      returnCount: 10,
      excerptChars: 1400,
      localPrefilter: "fuzzy_semantic",
    },
    cache: {
      cleanupEnabled: true,
      retentionDays: 30,
      arxivQueryRetentionDays: 7,
      pdfRetentionDays: 3,
      textRetentionDays: 30,
      llmNotesRetentionDays: 30,
      guideRetentionDays: 30,
    },
    pdf: {
      autoDownload: false,
    },
    recommendation: {
      writeTo: "both", // "note" | "attachment" | "both"
    },
    output: {
      topN: 3,
      guessYouLikeN: 5,
      minCoreScore: 2,
      minCrossScore: 1,
      crossFallbackN: 4,
    },
    ui: {
      locale: "", // empty = follow Zotero
      reportLocale: "", // empty = follow ui.locale
      timezone: "",
      reminderTime: "10:00",
      readerFontFamily: "message-box, system-ui, sans-serif",
      readerFontSize: 13,
      selectionAskPopup: true,
      selectionAskMode: "global",
    },
    shortcuts: {
      toggleSidebar: "Accel+Shift+A",
      toggleQA: "Accel+L",
      searchKeyword: "Enter",
      searchLLM: "Accel+Enter",
    },
  };

  let gConfig = null;
  let gListeners = [];

  function isObject(val) {
    return !!(val && typeof val === "object" && !Array.isArray(val));
  }

  function nonEmptyString(val) {
    return typeof val === "string" && val.trim().length > 0;
  }

  function arrayScore(val) {
    return Array.isArray(val) ? val.filter(nonEmptyString).length : 0;
  }

  function configScore(config) {
    if (!isObject(config)) return -1;

    let score = 0;
    const llm = isObject(config.llm) ? config.llm : {};
    const arxiv = isObject(config.arxiv) ? config.arxiv : {};

    if (nonEmptyString(llm.provider)) score += 4;
    if (nonEmptyString(llm.apiKey)) score += 5;
    if (nonEmptyString(llm.apiKeyEnv)) score += 3;
    if (nonEmptyString(llm.model)) score += 4;
    if (nonEmptyString(llm.baseUrl)) score += 2;

    score += arrayScore(arxiv.coreCategories) * 4;
    score += arrayScore(arxiv.crossCategories) * 2;

    if (isObject(config.ui)) {
      if (nonEmptyString(config.ui.locale)) score += 1;
      if (nonEmptyString(config.ui.reportLocale)) score += 1;
      if (nonEmptyString(config.ui.timezone)) score += 1;
    }

    return score;
  }

  function normalizePrefsBackup(raw) {
    if (!isObject(raw)) return null;
    if (isObject(raw.config)) return raw.config;
    return raw;
  }

  function readPrefsBackup() {
    if (typeof Zotero === "undefined" || !Zotero.Prefs) return null;
    try {
      const text = Zotero.Prefs.get(CONFIG_BACKUP_PREF);
      if (!nonEmptyString(text)) return null;
      return normalizePrefsBackup(JSON.parse(text));
    } catch (e) {
      logError("config prefs backup read failed: " + (e.message || e));
      return null;
    }
  }

  function writePrefsBackup(config) {
    if (typeof Zotero === "undefined" || !Zotero.Prefs) return false;
    try {
      const existing = readPrefsBackup();
      if (configScore(config) <= 0 && configScore(existing) > 0) {
        log("config prefs backup kept existing non-empty copy");
        return true;
      }
      Zotero.Prefs.set(CONFIG_BACKUP_PREF, JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        config: config,
      }));
      return true;
    } catch (e) {
      logError("config prefs backup write failed: " + (e.message || e));
      return false;
    }
  }

  function pickSavedConfig(fileConfig, prefConfig) {
    const fileScore = configScore(fileConfig);
    const prefScore = configScore(prefConfig);

    if (prefScore > fileScore) {
      return {
        source: "prefs-backup",
        config: prefConfig,
        fileScore: fileScore,
        prefScore: prefScore,
      };
    }

    return {
      source: fileScore >= 0 ? "config-file" : (prefScore >= 0 ? "prefs-backup" : "defaults"),
      config: fileScore >= 0 ? fileConfig : prefConfig,
      fileScore: fileScore,
      prefScore: prefScore,
    };
  }

  function normalizeLegacyConfig(config) {
    if (!isObject(config)) return config;
    if (!isObject(config.arxiv)) return config;

    var dateFilter = config.arxiv.dateFilter;
    if (dateFilter === "none") config.arxiv.dateFilter = "rolling";
    else if (dateFilter === "submitted") config.arxiv.dateFilter = "latest";

    return config;
  }

  globalThis.ArxivDailyConfig = {
    init: function () {
      if (gConfig) return true;
      if (typeof ArxivDailyDataDir === "undefined") {
        logError("config init: ArxivDailyDataDir not available");
        return false;
      }

      const fileConfig = ArxivDailyDataDir.readJSON(CONFIG_FILE);
      const prefConfig = readPrefsBackup();
      const picked = pickSavedConfig(fileConfig, prefConfig);

      gConfig = this._mergeDefaults(normalizeLegacyConfig(picked.config || {}) || {}, DEFAULT_CONFIG);

      if (picked.source === "prefs-backup") {
        ArxivDailyDataDir.writeJSON(CONFIG_FILE, gConfig);
        log("config restored from Zotero prefs backup");
      } else if (configScore(gConfig) > 0) {
        writePrefsBackup(gConfig);
      }

      log("config initialized from " + picked.source +
          " (fileScore=" + picked.fileScore +
          ", prefScore=" + picked.prefScore + ")");
      return true;
    },

    get: function (path) {
      if (!gConfig) return undefined;
      const parts = path.split(".");
      let val = gConfig;
      for (const p of parts) {
        if (val === null || val === undefined) return undefined;
        val = val[p];
      }
      return val;
    },

    set: function (path, value) {
      if (!gConfig) return;
      const parts = path.split(".");
      let obj = gConfig;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]]) obj[parts[i]] = {};
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
      this.save();

      // Notify listeners
      for (const listener of gListeners) {
        try { listener(path, value); } catch (e) {}
      }
    },

    getAll: function () {
      return gConfig;
    },

    exportForBackup: function (includeSecrets) {
      const copy = JSON.parse(JSON.stringify(gConfig || {}));
      if (!includeSecrets && copy.llm) {
        copy.llm.apiKey = "";
        if (Array.isArray(copy.llm.apis)) {
          for (let i = 0; i < copy.llm.apis.length; i++) {
            if (copy.llm.apis[i]) copy.llm.apis[i].apiKey = "";
          }
        }
        copy.llm.apiKeyExported = false;
      } else if (copy.llm) {
        copy.llm.apiKeyExported = true;
      }
      return copy;
    },

    validateImport: function (config) {
      if (!isObject(config)) {
        return { ok: false, error: "导入内容不是 JSON 对象" };
      }
      if (config.config && isObject(config.config)) config = config.config;
      if (!isObject(config.llm) && !isObject(config.arxiv) && !isObject(config.ui)) {
        return { ok: false, error: "未找到 llm、arxiv 或 ui 配置段" };
      }
      return { ok: true, config: config };
    },

    replaceAll: function (config) {
      const validation = this.validateImport(config);
      if (!validation.ok) throw new Error(validation.error);
      gConfig = this._mergeDefaults(normalizeLegacyConfig(validation.config || {}) || {}, DEFAULT_CONFIG);
      this.save();
      for (const listener of gListeners) {
        try { listener("*", gConfig); } catch (e) {}
      }
      return gConfig;
    },

    save: function () {
      let saved = false;
      if (typeof ArxivDailyDataDir !== "undefined") {
        saved = ArxivDailyDataDir.writeJSON(CONFIG_FILE, gConfig) || saved;
      }
      saved = writePrefsBackup(gConfig) || saved;
      if (!saved) logError("config save failed: no storage backend succeeded");
      return saved;
    },

    onChange: function (callback) {
      gListeners.push(callback);
    },

    // Validate config completeness for report generation
    isReadyForReport: function () {
      if (!gConfig) return false;
      return !!(gConfig.arxiv.coreCategories.length > 0);
    },

    // ── Internal ──────────────────────────────────────────────────────────

    _mergeDefaults: function (saved, defaults) {
      const result = {};
      for (const key of Object.keys(defaults)) {
        if (saved[key] !== undefined && typeof defaults[key] === "object" &&
            !Array.isArray(defaults[key]) && defaults[key] !== null) {
          result[key] = this._mergeDefaults(saved[key] || {}, defaults[key]);
        } else if (saved[key] !== undefined) {
          result[key] = saved[key];
        } else {
          result[key] = defaults[key];
        }
      }
      return result;
    },
  };
})();
