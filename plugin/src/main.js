/* ==========================================================================
 * Zotero arXiv Interest Daily — Main Module
 *
 * Orchestrates M1 UI initialization: i18n → left pane → menu → button bar.
 * Exposes ArxivDailyActions as the central action handler.
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

  function explainTaskError(err) {
    var msg = err && err.message ? err.message : String(err);
    if (msg.indexOf("No arXiv categories configured") >= 0) {
      return "未配置 arXiv 分区。请先在设置中填写核心 arXiv 分区。\n\n原始信息: " + msg;
    }
    if (msg.indexOf("No papers found after arXiv fetching") >= 0) {
      return "没有抓到论文。请检查 arXiv 分区、日期过滤、网络、缓存，以及当天这些分区是否有新论文。\n\n原始信息: " + msg;
    }
    if (msg.indexOf("All arXiv API fallback requests failed") >= 0 ||
        msg.indexOf("Fetching arXiv papers failed") >= 0 ||
        msg.indexOf("Fetching arXiv metadata failed") >= 0) {
      return "arXiv 抓取阶段失败。常见原因是网络不可达、arXiv 暂时拥挤/限流，或分区代码不正确。\n\n原始信息: " + msg;
    }
    if (msg.indexOf("LLM relevance screening failed") >= 0 || msg.indexOf("LLM not configured") >= 0) {
      return "LLM 筛选阶段失败。请检查 provider、API Key、model 和 base URL。\n\n原始信息: " + msg;
    }
    if (msg.indexOf("Report save failed") >= 0) {
      return "报告保存失败。请检查 Zotero profile 数据目录是否可写。\n\n原始信息: " + msg;
    }
    if (msg.indexOf("fetch failed after") >= 0 || msg.indexOf("HTTP 429") >= 0) {
      return "arXiv 请求在多次重试后仍失败。通常是网络或限流问题，稍后再试更合适。\n\n原始信息: " + msg;
    }
    return msg;
  }

  let gInitialized = false;
  let gShuttingDown = false;
  let gInitTimer = null;

  function isReadyForConfiguredActions() {
    try {
      if (typeof ArxivDailyConfig === "undefined") return false;
      if (!ArxivDailyConfig.isReadyForReport()) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function isLLMReady() {
    try {
      if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.isConfigured) {
        return ArxivDailyLLM.isConfigured({ kind: "qa" }) ||
          ArxivDailyLLM.isConfigured({ kind: "search" }) ||
          ArxivDailyLLM.isConfigured({ kind: "report" }) ||
          ArxivDailyLLM.isConfigured();
      }
      if (typeof ArxivDailyConfig === "undefined") return false;
      return !!(ArxivDailyConfig.get("llm.apiKey") && ArxivDailyConfig.get("llm.model"));
    } catch (e) {
      return false;
    }
  }

  function hasResearchProfile() {
    try {
      if (typeof ArxivDailyDataDir === "undefined") return false;
      if (!ArxivDailyDataDir.getBasePath || !ArxivDailyDataDir.getBasePath()) {
        ArxivDailyDataDir.init();
      }
      var active = ArxivDailyDataDir.readFile("research_interests.active.md") || "";
      var base = ArxivDailyDataDir.readFile("research_interests.base.md") || "";
      var legacy = ArxivDailyDataDir.readFile("research_interests.md") || "";
      return !!(String(active).trim() || String(base).trim() || String(legacy).trim());
    } catch (e) {
      return false;
    }
  }

  function readinessReason() {
    return "请先在设置中完成 arXiv 核心分区配置";
  }

  function profileReason() {
    return "请先完成科研兴趣画像配置";
  }

  function syncReadiness() {
    var baseReady = isReadyForConfiguredActions();
    var llmReady = isLLMReady();
    var profileReady = hasResearchProfile();
    var state = {
      "ari-btn-interests": true,
      "ari-btn-generate": baseReady && profileReady,
      "ari-btn-qa": true,
      "menu-ari-interests": true,
      "menu-ari-generate": baseReady && profileReady,
      "menu-ari-qa": true,
    };
    var reason = {
      "ari-btn-interests": "",
      "ari-btn-generate": baseReady ? profileReason() : readinessReason(),
      "ari-btn-qa": llmReady ? "" : "请先在设置中完成 LLM API Key 和模型配置",
      "menu-ari-interests": "",
      "menu-ari-generate": baseReady ? profileReason() : readinessReason(),
      "menu-ari-qa": llmReady ? "" : "请先在设置中完成 LLM API Key 和模型配置",
    };
    if (typeof ArxivDailyButtonBar !== "undefined" && ArxivDailyButtonBar.updateReadiness) {
      ArxivDailyButtonBar.updateReadiness(state, reason);
    }
    if (typeof ArxivDailyMenu !== "undefined" && ArxivDailyMenu.updateReadiness) {
      ArxivDailyMenu.updateReadiness(state, reason);
    }
    return state;
  }

  function availableLLMModels() {
    try {
      if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.getAvailableModels) {
        return ArxivDailyLLM.getAvailableModels();
      }
    } catch (e) {}
    return [];
  }

  function chooseReportLLM(win, callback) {
    win = win || Zotero.getMainWindow();
    var models = availableLLMModels();
    if (!win || !win.openDialog) {
      callback({ noLLM: models.length === 0, modelRef: "" });
      return;
    }
    var dialog = win.openDialog("about:blank", "arxiv-daily-report-llm-choice",
      "chrome,centerscreen,resizable,width=420,height=230");
    if (!dialog) {
      callback({ noLLM: models.length === 0, modelRef: "" });
      return;
    }
    var done = false;
    function finish(result) {
      if (done) return;
      done = true;
      callback(result || null);
      try { dialog.close(); } catch (e) {}
    }
    function render() {
      if (done || dialog.closed) return;
      var doc = dialog.document;
      doc.open();
      doc.write("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>选择报告生成模型</title></head><body></body></html>");
      doc.close();
      var style = doc.createElement("style");
      style.textContent = [
        "html,body{width:100%;height:100%;margin:0;padding:0}",
        "body{box-sizing:border-box;background:Canvas;color:CanvasText;font:13px message-box,system-ui,sans-serif}",
        ".wrap{height:100%;box-sizing:border-box;padding:16px;display:flex;flex-direction:column;gap:12px}",
        ".title{font-weight:600;font-size:14px}",
        "select{width:100%;box-sizing:border-box;min-height:28px;font:13px message-box,system-ui,sans-serif}",
        ".hint{font-size:12px;color:GrayText;line-height:1.45}",
        ".actions{margin-top:auto;display:flex;justify-content:flex-end;gap:8px}",
        "button{min-width:72px;padding:5px 12px;border:1px solid ThreeDShadow;border-radius:3px;background:ButtonFace;color:ButtonText;font:13px message-box,system-ui,sans-serif;cursor:pointer}",
      ].join("\n");
      doc.head.appendChild(style);
      var root = doc.createElement("main");
      root.className = "wrap";
      var title = doc.createElement("div");
      title.className = "title";
      title.textContent = "生成今日报告";
      var select = doc.createElement("select");
      var no = doc.createElement("option");
      no.value = "__no_llm__";
      no.textContent = "不使用 LLM（仅关键词/本地评分）";
      select.appendChild(no);
      for (var i = 0; i < models.length; i++) {
        var opt = doc.createElement("option");
        opt.value = models[i].ref;
        opt.textContent = models[i].label;
        select.appendChild(opt);
      }
      var current = "";
      try { current = ArxivDailyLLM.getUsageModelRef("report") || ""; } catch (e) {}
      select.value = current === "__no_llm__" ? "__no_llm__" :
        (current && models.some(function (m) { return m.ref === current; }) ? current : (models[0] ? models[0].ref : "__no_llm__"));
      var hint = doc.createElement("div");
      hint.className = "hint";
      hint.textContent = models.length
        ? "本次选择会保存为报告生成默认模型。"
        : "当前没有已配置可用模型；可以先用非 LLM 模式生成。";
      var actions = doc.createElement("div");
      actions.className = "actions";
      var cancel = doc.createElement("button");
      cancel.type = "button";
      cancel.textContent = "取消";
      cancel.addEventListener("click", function () { finish(null); });
      var ok = doc.createElement("button");
      ok.type = "button";
      ok.textContent = "生成";
      ok.addEventListener("click", function () {
        var value = select.value || "";
        if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.setUsageModelRef) {
          ArxivDailyLLM.setUsageModelRef("report", value === "__no_llm__" ? "__no_llm__" : value);
        }
        finish({ noLLM: value === "__no_llm__", modelRef: value === "__no_llm__" ? "" : value });
      });
      actions.appendChild(cancel);
      actions.appendChild(ok);
      root.appendChild(title);
      root.appendChild(select);
      root.appendChild(hint);
      root.appendChild(actions);
      doc.body.appendChild(root);
    }
    dialog.addEventListener("unload", function () { if (!done) finish(null); }, { once: true });
    win.setTimeout(render, 0);
    dialog.addEventListener("load", render, { once: true });
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  function closeReportModelMenu(doc) {
    var old = doc ? doc.getElementById("arxiv-daily-report-model-menu") : null;
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  function chooseReportLLM(anchor, callback) {
    var win = (anchor && anchor.ownerDocument && anchor.ownerDocument.defaultView) || Zotero.getMainWindow();
    var models = availableLLMModels();
    if (!win || !win.document) {
      callback({ noLLM: models.length === 0, modelRef: "" });
      return;
    }
    var doc = win.document;
    closeReportModelMenu(doc);
    var done = false;
    function finish(result) {
      if (done) return;
      done = true;
      callback(result || null);
      closeReportModelMenu(doc);
    }

    var menu = doc.createElement("div");
    menu.id = "arxiv-daily-report-model-menu";
    menu.style.cssText =
      "position:fixed;z-index:2147483647;min-width:240px;max-width:360px;max-height:320px;overflow:auto;" +
      "box-sizing:border-box;padding:4px;background:Canvas;color:CanvasText;border:1px solid ThreeDShadow;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.22);font:12px message-box,system-ui,sans-serif;";

    function addItem(label, value) {
      var item = doc.createElement("button");
      item.type = "button";
      item.textContent = label;
      item.style.cssText =
        "display:block;width:100%;box-sizing:border-box;text-align:left;padding:5px 8px;border:0;" +
        "background:transparent;color:CanvasText;font:12px message-box,system-ui,sans-serif;cursor:pointer;";
      item.addEventListener("mouseenter", function () {
        item.style.background = "SelectedItem";
        item.style.color = "SelectedItemText";
      });
      item.addEventListener("mouseleave", function () {
        item.style.background = "transparent";
        item.style.color = "CanvasText";
      });
      item.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.setUsageModelRef) {
          ArxivDailyLLM.setUsageModelRef("report", value === "__no_llm__" ? "__no_llm__" : value);
        }
        finish({ noLLM: value === "__no_llm__", modelRef: value === "__no_llm__" ? "" : value });
      });
      menu.appendChild(item);
    }

    addItem("不使用 LLM（仅关键词/本地评分）", "__no_llm__");
    for (var i = 0; i < models.length; i++) addItem(models[i].label, models[i].ref);
    if (!models.length) {
      var hint = doc.createElement("div");
      hint.textContent = "当前没有已配置可用模型";
      hint.style.cssText = "padding:5px 8px;color:GrayText;";
      menu.appendChild(hint);
    }

    (doc.documentElement || doc.body).appendChild(menu);
    var rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 12, bottom: 48 };
    var width = Math.max(240, Math.min(360, menu.offsetWidth || 260));
    var left = Math.max(8, Math.min(rect.left || 12, (win.innerWidth || 900) - width - 8));
    var top = Math.max(8, Math.min((rect.bottom || 48) + 4, (win.innerHeight || 700) - (menu.offsetHeight || 220) - 8));
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
    win.setTimeout(function () {
      doc.addEventListener("mousedown", function onDocMouseDown(event) {
        if (!menu.contains(event.target)) {
          doc.removeEventListener("mousedown", onDocMouseDown, true);
          finish(null);
        }
      }, true);
    }, 0);
  }

  function cleanup() {
    if (gShuttingDown) return;
    gShuttingDown = true;
    if (gInitTimer) { clearInterval(gInitTimer); gInitTimer = null; }

    if (typeof ArxivDailySearch !== "undefined") ArxivDailySearch.destroy();
    if (typeof ArxivDailyCalendar !== "undefined" && ArxivDailyCalendar.destroy) ArxivDailyCalendar.destroy();
    if (typeof ArxivDailyProgress !== "undefined") ArxivDailyProgress.destroy();
    if (typeof ArxivDailyCenterWorkspace !== "undefined") ArxivDailyCenterWorkspace.destroy();
    if (typeof ArxivDailyButtonBar !== "undefined") ArxivDailyButtonBar.destroy();
    if (typeof ArxivDailyMenu !== "undefined") ArxivDailyMenu.destroy();
    if (typeof ArxivDailyLeftPane !== "undefined") ArxivDailyLeftPane.destroy();
    if (typeof ArxivDailyReminder !== "undefined") ArxivDailyReminder.destroy();
    if (typeof ArxivDailyQA !== "undefined") ArxivDailyQA.destroy();

    log("cleanup complete");
  }

  globalThis.gArxivDailyShutdown = cleanup;

  // ── Lazy initialization ───────────────────────────────────────────────────

  function tryInit(win) {
    if (gInitialized || gShuttingDown) return;
    if (!win || !win.document || win.document.readyState !== "complete") return;
    if (!win.ZoteroPane) return;

    // 1. Data directory + config + cache
    if (typeof ArxivDailyDataDir !== "undefined") ArxivDailyDataDir.init();
    if (typeof ArxivDailyConfig !== "undefined") ArxivDailyConfig.init();
    if (typeof ArxivDailyCache !== "undefined") ArxivDailyCache.init();

    // 2. i18n → pane → menu → buttons
    if (typeof ArxivDailyI18n !== "undefined") {
      ArxivDailyI18n.init();
    } else {
      logError("ArxivDailyI18n not loaded");
      return;
    }

    var paneOk = false;
    if (typeof ArxivDailyLeftPane !== "undefined") {
      ArxivDailyLeftPane.init(win);
      paneOk = true;
    }

    if (typeof ArxivDailyMenu !== "undefined") {
      ArxivDailyMenu.init(win);
    }

    if (paneOk && typeof ArxivDailyButtonBar !== "undefined") {
      var reportPane = win.document.getElementById("arxiv-daily-reports");
      if (reportPane) {
        ArxivDailyButtonBar.init(win, reportPane);
      }
    }

    // 3. Central reading area + shared bottom dock
    if (typeof ArxivDailyCenterWorkspace !== "undefined") {
      ArxivDailyCenterWorkspace.init(win);
    }

    // 4. Progress UI
    if (typeof ArxivDailyProgress !== "undefined") {
      ArxivDailyProgress.init(win);
    }

    // 5. Search + Calendar + Reminder
    if (typeof ArxivDailySearch !== "undefined") {
      ArxivDailySearch.init(win);
    }
    if (typeof ArxivDailyReminder !== "undefined") {
      ArxivDailyReminder.init(win);
    }

    // 6. QA module
    if (typeof ArxivDailyQA !== "undefined") {
      try {
        ArxivDailyQA.init();
      } catch (qaInitErr) {
        logError("QA init failed: " + (qaInitErr.message || qaInitErr));
      }
    }

    if (typeof ArxivDailyConfig !== "undefined" && ArxivDailyConfig.onChange) {
      ArxivDailyConfig.onChange(function () {
        syncReadiness();
      });
    }
    syncReadiness();

    gInitialized = true;
    log("M5 initialized: all modules loaded");

    // Sync menu checkbox states with pane visibility
    if (typeof ArxivDailyLeftPane !== "undefined" && typeof ArxivDailyMenu !== "undefined") {
      ArxivDailyMenu.updateToggleState(
        "menu-ari-show-report",
        ArxivDailyLeftPane.isReportsVisible()
      );
      ArxivDailyMenu.updateToggleState(
        "menu-ari-show-project",
        ArxivDailyLeftPane.isProjectsVisible()
      );
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  globalThis.ArxivDailyActions = {
    openSettings: function () {
      log("openSettings");
      try {
        var win = Zotero.getMainWindow();
        if (!win) return;
        if (typeof ArxivDailySettingsWindow !== "undefined") {
          ArxivDailySettingsWindow.open(win, {
            config: typeof ArxivDailyConfig !== "undefined" ? ArxivDailyConfig : null,
            envTest: typeof ArxivDailyEnvTest !== "undefined" ? ArxivDailyEnvTest : null,
          });
          return;
        }
        logError("ArxivDailySettingsWindow not loaded");
      } catch (err) {
        logError("openSettings failed: " + (err.message || err));
      }
    },

    openUserGuide: function () {
      log("openUserGuide");
      try {
        var win = Zotero.getMainWindow();
        if (!win) return;
        if (typeof ArxivDailyHelpWindow !== "undefined" && ArxivDailyHelpWindow.open) {
          ArxivDailyHelpWindow.open(win);
          return;
        }
        win.alert(ArxivDailyI18n.t("help.unavailable", "使用教程模块尚未加载。"));
      } catch (err) {
        logError("openUserGuide failed: " + (err.message || err));
        var alertWin = Zotero.getMainWindow();
        if (alertWin) {
          var prefix = typeof ArxivDailyI18n !== "undefined" && ArxivDailyI18n.getLocale && ArxivDailyI18n.getLocale() === "en-US"
            ? "Failed to open user guide:\n"
            : "打开使用教程失败:\n";
          alertWin.alert(prefix + (err.message || err));
        }
      }
    },

    openProjectDirectory: function () {
      log("openProjectDirectory");
      try {
        if (typeof ArxivDailyDataDir === "undefined") {
          throw new Error("Data directory module not loaded");
        }
        ArxivDailyDataDir.init();
        var basePath = ArxivDailyDataDir.getBasePath();
        if (!basePath) throw new Error("Data directory is not available");

        var dir = ArxivDailyDataDir.makeFile
          ? ArxivDailyDataDir.makeFile(basePath)
          : null;
        if (!dir) throw new Error("Local file API is not available");
        if (!dir.exists()) {
          dir.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o755);
        }
        if (typeof dir.reveal === "function") {
          dir.reveal();
          return;
        }
        if (typeof dir.launch === "function") {
          dir.launch();
          return;
        }
        var win = Zotero.getMainWindow();
        if (win) win.alert("插件数据目录:\n" + basePath);
      } catch (err) {
        logError("openProjectDirectory failed: " + (err.message || err));
        var win = Zotero.getMainWindow();
        if (win) win.alert("无法打开项目目录:\n" + (err.message || err));
      }
    },

    exportDiagnostics: function () {
      log("exportDiagnostics");
      try {
        if (typeof ArxivDailyExportTools === "undefined" || !ArxivDailyExportTools.exportDiagnostics) {
          throw new Error("诊断导出工具尚未加载");
        }
        var result = ArxivDailyExportTools.exportDiagnostics();
        var win = Zotero.getMainWindow();
        if (win) win.alert("诊断日志已导出:\n" + result.path);
      } catch (err) {
        logError("exportDiagnostics failed: " + (err.message || err));
        var alertWin = Zotero.getMainWindow();
        if (alertWin) alertWin.alert("导出诊断日志失败:\n" + (err.message || err));
      }
    },

    configureInterests: function () {
      log("configureInterests");
      this.manageProfile(null, "configure");
    },

    chooseReportModel: function (anchor) {
      chooseReportLLM(anchor, function (choice) {
        if (!choice) return;
      });
    },

    generateReport: function (btn, id, options) {
      options = options || {};
      // If stop button triggered, cancel running task
      if (id && id.indexOf("stop") >= 0) {
        ArxivDailyActions.stopGenerate();
        return;
      }

      log("generateReport");

      if (typeof ArxivDailyReportGenerator === "undefined") {
        logError("ReportGenerator not loaded");
        return;
      }

      var readiness = syncReadiness();
      if (!readiness["ari-btn-generate"] || !ArxivDailyReportGenerator.canGenerate()) {
        var win = Zotero.getMainWindow();
        if (win) win.alert(isReadyForConfiguredActions() ? profileReason() : readinessReason());
        return;
      }

      if (typeof ArxivDailyTaskManager === "undefined") {
        logError("TaskManager not loaded");
        return;
      }

      // Switch button bar to stop state
      if (typeof ArxivDailyButtonBar !== "undefined") {
        ArxivDailyButtonBar.setGenerating(true);
      }

      // Start task via TaskManager
      var taskId = ArxivDailyTaskManager.start("generateReport", "生成今日报告", async function (token, onProgress) {
        // Pass cancel token + onProgress to the report generator
        var wrappedToken = { cancelled: false };
        // Link task manager's token
        var checkCancel = setInterval(function () {
          if (token.cancelled) wrappedToken.cancelled = true;
        }, 200);

        try {
          var reportModelRef = options.modelRef || (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.getUsageModelRef ? ArxivDailyLLM.getUsageModelRef("report") : "");
          var result = await ArxivDailyReportGenerator.generate(null, wrappedToken, onProgress, {
            noLLM: !!options.noLLM ||
              (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.getUsageModelRef &&
                ArxivDailyLLM.getUsageModelRef("report") === "__no_llm__"),
            modelRef: reportModelRef === "__no_llm__" ? "" : reportModelRef,
          });

          if (wrappedToken.cancelled) {
            onProgress("Cancelled", 0);
            return;
          }

          log("Report generated: " + (result.meta ? result.meta.date : "?"));
          if (result && result.markdown) {
            log("Report length: " + result.markdown.length + " chars");
          }
          var uiWarning = "";
          if (typeof ArxivDailyLeftPane !== "undefined") {
            try {
              ArxivDailyLeftPane.refreshReports();
              if (result.meta && result.meta.date) {
                ArxivDailyLeftPane.selectReport(result.meta.date, false);
              }
            } catch (uiErr) {
              uiWarning = "报告已保存，但左侧报告栏刷新失败: " + (uiErr.message || uiErr);
              logError(uiWarning);
              onProgress(uiWarning, 97);
            }
          }
          syncReadiness();
          if (typeof ArxivDailyReminder !== "undefined" && ArxivDailyReminder.refresh) {
            try { ArxivDailyReminder.refresh(win || Zotero.getMainWindow()); } catch (reminderErr) {}
          }
          if (options.openAfterGenerate && typeof ArxivDailyCenterWorkspace !== "undefined" && result.meta && result.meta.date) {
            try {
              ArxivDailyCenterWorkspace.showReport(result.meta.date);
            } catch (readerErr) {
              uiWarning = "报告已保存，但中央阅读区打开失败: " + (readerErr.message || readerErr);
              logError(uiWarning);
              onProgress(uiWarning, 98);
            }
          }

          onProgress("Complete", 100);

          var win = Zotero.getMainWindow();
          if (win) win.alert("报告生成成功!\n日期: " + (result.meta ? result.meta.date : "unknown") +
            "\n论文数: " + (result.meta ? result.meta.paperCount : 0) +
            (uiWarning ? "\n\n提示: " + uiWarning : ""));
        } catch (err) {
          if (wrappedToken.cancelled || token.cancelled) {
            onProgress("Cancelled", 0);
          } else {
            logError("Report generation failed: " + (err.message || err));
            var win = Zotero.getMainWindow();
            if (win) win.alert(explainTaskError(err));
            throw err;
            if (win) win.alert("报告生成失败:\n" + explainTaskError(err));
          }
        } finally {
          clearInterval(checkCancel);
          if (typeof ArxivDailyButtonBar !== "undefined") {
            ArxivDailyButtonBar.setGenerating(false);
          }
        }
      });

      log("generateReport: taskId=" + taskId);
    },

    stopGenerate: function () {
      log("stopGenerate");
      if (typeof ArxivDailyTaskManager !== "undefined") {
        var running = ArxivDailyTaskManager.getRunningTask();
        if (running) {
          ArxivDailyTaskManager.cancel(running.id);
        }
        // Also cancel queued tasks of the same type
        var queued = ArxivDailyTaskManager.getQueuedTasks();
        for (var i = 0; i < queued.length; i++) {
          if (queued[i].type === "generateReport") {
            ArxivDailyTaskManager.cancel(queued[i].id);
          }
        }
      }
      if (typeof ArxivDailyButtonBar !== "undefined") {
        ArxivDailyButtonBar.setGenerating(false);
      }
    },

    searchReports: function () {
      log("searchReports");
      if (typeof ArxivDailySearch !== "undefined") {
        ArxivDailySearch.toggle();
      }
    },

    manageProfile: function () {
      log("manageProfile");
      try {
        var win = Zotero.getMainWindow();
        if (!win) return;
        if (typeof ArxivDailyProfileWindow !== "undefined") {
          ArxivDailyProfileWindow.open(win, {
            mode: arguments.length > 1 ? arguments[1] : "manage",
          });
          return;
        }
        logError("ArxivDailyProfileWindow not loaded");
      } catch (err) {
        logError("manageProfile failed: " + (err.message || err));
      }
    },

    openReport: function (dateStr, options) {
      log("openReport: " + dateStr);
      if (typeof ArxivDailyCenterWorkspace !== "undefined") {
        ArxivDailyCenterWorkspace.showReport(dateStr, options || {});
      }
    },

    openReportInNewWindow: function (dateStr) {
      log("openReportInNewWindow: " + dateStr);
      if (typeof ArxivDailyCenterWorkspace !== "undefined") {
        ArxivDailyCenterWorkspace.openReportInNewWindow(dateStr);
      }
    },

    openReportInNewTab: function (dateStr) {
      log("openReportInNewTab: " + dateStr);
      if (typeof ArxivDailyCenterWorkspace !== "undefined") {
        ArxivDailyCenterWorkspace.openReportInNewTab(dateStr);
      }
    },

    openQA: function () {
      log("openQA");
      try {
        syncReadiness();
        if (typeof ArxivDailyCenterWorkspace !== "undefined" &&
            ArxivDailyCenterWorkspace.suppressNativeRestore) {
          ArxivDailyCenterWorkspace.suppressNativeRestore(1400);
        }
        if (typeof ArxivDailyQA !== "undefined" && ArxivDailyQA.show) {
          ArxivDailyQA.show();
          return;
        }
        throw new Error("ArxivDailyQA not loaded");
      } catch (err) {
        logError("openQA failed: " + (err.message || err));
        var win = Zotero.getMainWindow();
        if (win && win.alert) {
          win.alert("打开 LLM 问答失败:\n" + (err.message || err));
        }
      }
    },

    toggleQA: function () {
      log("toggleQA");
      try {
        syncReadiness();
        if (typeof ArxivDailyCenterWorkspace !== "undefined" &&
            ArxivDailyCenterWorkspace.suppressNativeRestore) {
          ArxivDailyCenterWorkspace.suppressNativeRestore(1400);
        }
        if (typeof ArxivDailyQA !== "undefined" && ArxivDailyQA.toggle) {
          ArxivDailyQA.toggle();
          return;
        }
        this.openQA();
      } catch (err) {
        logError("toggleQA failed: " + (err.message || err));
        var win = Zotero.getMainWindow();
        if (win && win.alert) {
          win.alert("打开或关闭 LLM 问答失败:\n" + (err.message || err));
        }
      }
    },

    syncReadiness: function () {
      return syncReadiness();
    },

    openCalendar: function (btn, id, event) {
      log("openCalendar");
      try {
        var win = Zotero.getMainWindow();
        if (!win) return;
        if (typeof ArxivDailyCalendar !== "undefined" && ArxivDailyCalendar.open) {
          ArxivDailyCalendar.open(win, btn || (event && event.currentTarget) || null);
          return;
        }
        win.alert("日历模块尚未加载。");
      } catch (err) {
        logError("openCalendar failed: " + (err.message || err));
        var alertWin = Zotero.getMainWindow();
        if (alertWin) alertWin.alert("打开日历失败:\n" + (err.message || err));
      }
    },

    openProgressPanel: function () {
      log("openProgressPanel");
      if (typeof ArxivDailyProgress !== "undefined") {
        ArxivDailyProgress.showPanel();
      } else {
        logError("ArxivDailyProgress not loaded");
      }
    },

    toggleReportPane: function (menuitem) {
      if (typeof ArxivDailyLeftPane !== "undefined") {
        var visible = ArxivDailyLeftPane.toggleReports();
        if (typeof ArxivDailyMenu !== "undefined") {
          ArxivDailyMenu.updateToggleState("menu-ari-show-report", visible);
        }
        log("report pane visibility: " + visible);
      }
    },

    toggleProjectPane: function (menuitem) {
      if (typeof ArxivDailyLeftPane !== "undefined") {
        var visible = ArxivDailyLeftPane.toggleProjects();
        if (typeof ArxivDailyMenu !== "undefined") {
          ArxivDailyMenu.updateToggleState("menu-ari-show-project", visible);
        }
        log("project pane visibility: " + visible);
      }
    },
  };

  // ── Boot ──────────────────────────────────────────────────────────────────

  log("main.js loaded, waiting for window...");

  var win = Zotero.getMainWindow();
  if (win && win.document && win.document.readyState === "complete" && win.ZoteroPane) {
    tryInit(win);
  } else {
    gInitTimer = setInterval(function () {
      var w = Zotero.getMainWindow();
      if (w && w.document && w.document.readyState === "complete" && w.ZoteroPane) {
        clearInterval(gInitTimer);
        gInitTimer = null;
        tryInit(w);
      }
    }, 300);
  }
})();
