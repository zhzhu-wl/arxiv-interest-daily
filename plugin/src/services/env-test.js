/* ==========================================================================
 * env-test.js — Environment test suite
 *
 * Runs individual checks and compiles a test report.
 * Used in settings dialog and at first-run.
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";

  function log(msg) {
    const text = "[" + LOG_PREFIX + "] " + msg;
    if (typeof Zotero.debug === "function") Zotero.debug(text);
    else if (typeof Zotero.log === "function") Zotero.log(text);
  }

  // ── i18n helper ──────────────────────────────────────────────────────────

  function t(key, fallback) {
    if (typeof ArxivDailyI18n !== "undefined" && typeof ArxivDailyI18n.t === "function") {
      return ArxivDailyI18n.t(key, fallback);
    }
    return fallback || key;
  }

  // ── Test helpers ─────────────────────────────────────────────────────────

  function result(nameKey, passed, detail) {
    return { nameKey: nameKey, name: "", passed: passed, detail: detail || "" };
  }

  function resolveName(nameKey) {
    return t("env." + nameKey, nameKey);
  }

  function requestOptions(timeoutMs) {
    var opts = { method: "GET" };
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      opts.signal = AbortSignal.timeout(timeoutMs || 10000);
    }
    return opts;
  }

  // ── Module ────────────────────────────────────────────────────────────────

  globalThis.ArxivDailyEnvTest = {

    // Run all tests, return array of { nameKey, name, passed, detail }
    resolveNames: function (results) {
      for (var i = 0; i < results.length; i++) {
        results[i].name = resolveName(results[i].nameKey);
      }
      return results;
    },

    runAll: async function () {
      const results = [];

      results.push(this.testZoteroVersion());
      results.push(await this.testDataDir());
      results.push(await this.testCollectionsAPI());
      results.push(await this.testItemsAPI());
      results.push(await this.testArxivNetwork());
      results.push(await this.testLLMConfig());

      return this.resolveNames(results);
    },

    // Generate a plain-text summary
    generateReport: function (results) {
      var lines = [];
      lines.push("=== arXiv Interest Daily — Environment Test Report ===");
      lines.push("Date: " + new Date().toISOString());
      lines.push("Zotero: " + (Zotero.version || "?"));
      lines.push("");

      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        lines.push((r.passed ? "[PASS]" : "[FAIL]") + " " + r.name);
        if (r.detail) lines.push("       " + r.detail);
      }

      var ok = results.filter(function (r) { return r.passed; }).length;
      lines.push("");
      lines.push(ok + "/" + results.length + " passed");
      lines.push("========================================");
      return lines.join("\n");
    },

    // ── Individual tests ──────────────────────────────────────────────────

    testZoteroVersion: function () {
      var ver = Zotero.version || "0.0.0";
      var major = parseInt(ver.split(".")[0], 10);
      if (major >= 9) {
        return result("zotero_version", true, ver);
      }
      return result("zotero_version", false, t("env.need_zotero9") + ", got " + ver);
    },

    testDataDir: async function () {
      if (typeof ArxivDailyDataDir !== "undefined" && ArxivDailyDataDir.getBasePath()) {
        return result("data_dir", true, ArxivDailyDataDir.getBasePath());
      }
      return result("data_dir", false, t("env.not_initialized"));
    },

    testCollectionsAPI: async function () {
      try {
        var collections;
        if (typeof Zotero.Collections.getByLibrary === "function") {
          collections = await Zotero.Collections.getByLibrary(1, true);
        }
        var count = collections ? collections.length : 0;
        return result("collections_api", true, t("env.found") + " " + count + " " + t("env.collections"));
      } catch (e) {
        return result("collections_api", false, e.message || e);
      }
    },

    testItemsAPI: async function () {
      try {
        var item = new Zotero.Item("journalArticle");
        item.setField("title", "Env Test Article");
        item.setField("date", "2026-01-01");
        await item.saveTx();
        await item.eraseTx();
        return result("items_api", true, "");
      } catch (e) {
        return result("items_api", false, e.message || e);
      }
    },

    testArxivNetwork: async function () {
      try {
        var url = "https://export.arxiv.org/api/query?search_query=all:majorana&max_results=1";
        var response = await fetch(url, requestOptions(10000));
        if (response.ok) {
          return result("arxiv_network", true, "HTTP " + response.status);
        }
        return result("arxiv_network", false, "HTTP " + response.status);
      } catch (e) {
        return result("arxiv_network", false, e.message || e);
      }
    },

    testLLMConfig: async function () {
      if (typeof ArxivDailyConfig === "undefined") {
        return result("llm_config", false, t("env.config_not_loaded"));
      }
      var availableModels = [];
      try {
        if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.getAvailableModels) {
          availableModels = ArxivDailyLLM.getAvailableModels();
        }
      } catch (e0) {}
      if (availableModels.length) {
        var chosen = availableModels[0];
        if (typeof ArxivDailyLLM === "undefined" || !ArxivDailyLLM.testConnection) {
          return result("llm_config", true, chosen.label + "（仅检查本地配置，未发送测试请求）");
        }
        try {
          var poolTest = await ArxivDailyLLM.testConnection(null, { modelRef: chosen.ref });
          return result("llm_config", !!poolTest.ok, chosen.label + "，测试耗时 " + Math.round(poolTest.elapsedMs || 0) + " ms");
        } catch (poolErr) {
          return result("llm_config", false, "测试请求失败: " + (poolErr.message || poolErr));
        }
      }
      var provider = ArxivDailyConfig.get("llm.provider");
      var apiKey = ArxivDailyConfig.get("llm.apiKey");
      var model = ArxivDailyConfig.get("llm.model");

      var missing = [];
      if (!provider) missing.push("provider");
      if (!apiKey) missing.push("apiKey");
      if (!model) missing.push("model");
      if (missing.length) {
        return result("llm_config", false, t("env.missing_fields") + ": " + missing.join(", "));
      }
      if (typeof ArxivDailyLLM === "undefined" || !ArxivDailyLLM.testConnection) {
        return result("llm_config", true, provider + " / " + model + "（仅检查本地配置，未发送测试请求）");
      }
      try {
        var test = await ArxivDailyLLM.testConnection();
        return result("llm_config", !!test.ok, provider + " / " + model + "，测试耗时 " + Math.round(test.elapsedMs || 0) + " ms");
      } catch (e) {
        return result("llm_config", false, "测试请求失败: " + (e.message || e));
      }
    },
  };
})();
