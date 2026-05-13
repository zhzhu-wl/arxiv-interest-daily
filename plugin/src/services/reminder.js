/* ==========================================================================
 * services/reminder.js - Daily report generation reminder
 *
 * Checks once per minute. If no report exists for today and not yet reminded,
 * shows a quiet prompt bar in the report panel.
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";
  const PREFS_PREFIX = "extensions.arxiv-interest-daily.";

  function log(msg) {
    const text = "[" + LOG_PREFIX + "] " + msg;
    if (typeof Zotero.debug === "function") Zotero.debug(text);
    else if (typeof Zotero.log === "function") Zotero.log(text);
  }

  function logError(msg) {
    if (typeof Zotero.logError === "function") Zotero.logError(msg);
    else log("ERROR: " + msg);
  }

  function getPref(key, def) {
    try {
      var val = Zotero.Prefs.get(PREFS_PREFIX + key);
      return val !== undefined ? val : def;
    } catch (e) {
      return def;
    }
  }

  function setPref(key, val) {
    try {
      Zotero.Prefs.set(PREFS_PREFIX + key, val);
    } catch (e) {}
  }

  function todayStr() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, "0");
    var d = String(now.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function currentMinutes() {
    var now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  function askReminderDecision(win, callback) {
    var models = [];
    try {
      if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.getAvailableModels) {
        models = ArxivDailyLLM.getAvailableModels();
      }
    } catch (e) {}
    if (!win || !win.openDialog) {
      var generate = win && win.confirm ? win.confirm("是否生成今日报告？") : false;
      callback({ generate: generate, dismiss: false, noLLM: models.length === 0, modelRef: "" });
      return;
    }

    var dialog = win.openDialog("about:blank", "arxiv-daily-reminder-confirm",
      "chrome,centerscreen,resizable,width=360,height=190");
    if (!dialog) {
      var fallback = win.confirm("是否生成今日报告？");
      callback({ generate: fallback, dismiss: false, noLLM: models.length === 0, modelRef: "" });
      return;
    }

    var done = false;
    function finish(result) {
      if (done) return;
      done = true;
      callback(result || { generate: false, dismiss: false });
      try { dialog.close(); } catch (e) {}
    }

    function render() {
      if (done || dialog.closed) return;
      var doc = dialog.document;
      doc.open();
      doc.write("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>每日 arXiv 提醒</title></head><body></body></html>");
      doc.close();

      var style = doc.createElement("style");
      style.textContent = [
        "html,body{width:100%;height:100%;margin:0;padding:0}",
        "body{box-sizing:border-box;background:Canvas;color:CanvasText;font:13px message-box,system-ui,sans-serif}",
        ".ari-reminder{height:100%;box-sizing:border-box;padding:16px;display:flex;flex-direction:column;gap:12px}",
        ".ari-title{font-weight:600;font-size:14px}",
        ".ari-text{line-height:1.45;color:CanvasText}",
        "select{width:100%;box-sizing:border-box;min-height:28px;font:13px message-box,system-ui,sans-serif}",
        ".ari-check{display:flex;align-items:center;gap:6px;color:GrayText;font-size:12px}",
        ".ari-actions{margin-top:auto;display:flex;justify-content:flex-end;gap:8px}",
        "button{min-width:72px;padding:5px 12px;border:1px solid ThreeDShadow;border-radius:3px;background:ButtonFace;color:ButtonText;font:13px message-box,system-ui,sans-serif;cursor:pointer}",
      ].join("\n");
      doc.head.appendChild(style);

      var root = doc.createElement("main");
      root.className = "ari-reminder";
      var title = doc.createElement("div");
      title.className = "ari-title";
      title.textContent = "生成今日 arXiv 报告";
      var text = doc.createElement("div");
      text.className = "ari-text";
      text.textContent = "现在还没有检测到今天的报告。是否立即开始生成？";
      var select = doc.createElement("select");
      var noLLM = doc.createElement("option");
      noLLM.value = "__no_llm__";
      noLLM.textContent = "不使用 LLM";
      select.appendChild(noLLM);
      for (var mi = 0; mi < models.length; mi++) {
        var opt = doc.createElement("option");
        opt.value = models[mi].ref;
        opt.textContent = models[mi].label;
        select.appendChild(opt);
      }
      var currentModelRef = "";
      try { currentModelRef = ArxivDailyLLM.getUsageModelRef("report") || ""; } catch (e2) {}
      var hasCurrent = false;
      for (var hm = 0; hm < models.length; hm++) {
        if (models[hm].ref === currentModelRef) hasCurrent = true;
      }
      select.value = currentModelRef === "__no_llm__" ? "__no_llm__" :
        (hasCurrent ? currentModelRef : (models[0] ? models[0].ref : "__no_llm__"));
      var label = doc.createElement("label");
      label.className = "ari-check";
      var checkbox = doc.createElement("input");
      checkbox.type = "checkbox";
      label.appendChild(checkbox);
      label.appendChild(doc.createTextNode("今天不再提醒"));
      var actions = doc.createElement("div");
      actions.className = "ari-actions";
      var no = doc.createElement("button");
      no.type = "button";
      no.textContent = "取消";
      no.addEventListener("click", function () {
        finish({ generate: false, dismiss: checkbox.checked });
      });
      var yes = doc.createElement("button");
      yes.type = "button";
      yes.textContent = "生成";
      yes.addEventListener("click", function () {
        var value = select.value || "";
        if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.setUsageModelRef) {
          ArxivDailyLLM.setUsageModelRef("report", value === "__no_llm__" ? "__no_llm__" : value);
        }
        finish({ generate: true, dismiss: false, noLLM: value === "__no_llm__", modelRef: value === "__no_llm__" ? "" : value });
      });
      actions.appendChild(no);
      actions.appendChild(yes);
      root.appendChild(title);
      root.appendChild(text);
      root.appendChild(select);
      root.appendChild(label);
      root.appendChild(actions);
      doc.body.appendChild(root);
    }

    dialog.addEventListener("unload", function () {
      if (!done) finish({ generate: false, dismiss: false });
    }, { once: true });
    win.setTimeout(render, 0);
    dialog.addEventListener("load", render, { once: true });
  }

  askReminderDecision = function (win, callback) {
    if (!win || !win.document) {
      var generate = win && win.confirm ? win.confirm("是否生成今日报告？") : false;
      callback({ generate: generate, dismiss: false });
      return;
    }
    var doc = win.document;
    var old = doc.getElementById("arxiv-daily-reminder-confirm");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var anchor = doc.getElementById("arxiv-daily-reminder-bar");
    var popup = doc.createElement("div");
    popup.id = "arxiv-daily-reminder-confirm";
    popup.style.cssText =
      "position:fixed;z-index:2147483647;box-sizing:border-box;width:280px;padding:10px 12px;" +
      "background:Canvas;color:CanvasText;border:1px solid ThreeDShadow;box-shadow:0 4px 16px rgba(0,0,0,.22);" +
      "font:12px message-box,system-ui,sans-serif;";
    var text = doc.createElement("div");
    text.textContent = "是否生成今日报告？";
    text.style.cssText = "font-weight:600;margin-bottom:8px;";
    var actions = doc.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:6px;";
    var cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    cancel.style.cssText = "padding:3px 10px;border:1px solid ThreeDShadow;background:ButtonFace;color:ButtonText;";
    var yes = doc.createElement("button");
    yes.type = "button";
    yes.textContent = "生成";
    yes.style.cssText = cancel.style.cssText;
    function close(result) {
      if (popup.parentNode) popup.parentNode.removeChild(popup);
      callback(result || { generate: false, dismiss: false });
    }
    cancel.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      close({ generate: false, dismiss: false });
    });
    yes.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      close({ generate: true, dismiss: false });
    });
    popup.appendChild(text);
    actions.appendChild(cancel);
    actions.appendChild(yes);
    popup.appendChild(actions);
    (doc.documentElement || doc.body).appendChild(popup);
    var rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 8, bottom: 40 };
    var left = Math.max(8, Math.min(rect.left || 8, (win.innerWidth || 900) - 288));
    var top = Math.max(8, Math.min((rect.bottom || 40) + 4, (win.innerHeight || 700) - (popup.offsetHeight || 90) - 8));
    popup.style.left = Math.round(left) + "px";
    popup.style.top = Math.round(top) + "px";
  };

  globalThis.ArxivDailyReminder = {
    _timer: null,
    _bar: null,
    _dismissedToday: false,

    init: function (win) {
      var self = this;
      var doc = win.document;

      this._bar = doc.createElement("div");
      this._bar.setAttribute("id", "arxiv-daily-reminder-bar");
      this._bar.style.cssText =
        "display:none;width:100%;padding:5px 8px;background:Canvas;color:CanvasText;" +
        "font-size:12px;box-sizing:border-box;align-items:center;justify-content:center;" +
        "gap:6px;cursor:pointer;border-bottom:1px solid ThreeDShadow;";

      var icon = doc.createElement("span");
      icon.textContent = "!";
      icon.style.cssText =
        "display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;" +
        "border:1px solid #b36b00;border-radius:50%;color:#8a4b00;background:#fff7e6;" +
        "font-size:11px;font-weight:600;flex:0 0 auto;";

      var text = doc.createElement("span");
      text.textContent = "是否生成今日报告？";
      text.style.cssText = "color:#8a4b00;line-height:16px;flex:1;min-width:0;";
      var modelMenu = doc.createElement("button");
      modelMenu.type = "button";
      modelMenu.textContent = "▾";
      modelMenu.title = "选择报告生成模型";
      modelMenu.style.cssText =
        "margin-left:auto;padding:0;border:0;background:transparent;color:#8a4b00;" +
        "font:12px message-box,system-ui,sans-serif;line-height:16px;min-width:16px;cursor:pointer;";
      modelMenu.addEventListener("click", function (event) {
        event.stopPropagation();
        if (typeof ArxivDailyActions !== "undefined" && ArxivDailyActions.chooseReportModel) {
          ArxivDailyActions.chooseReportModel(modelMenu);
        }
      });

      icon.addEventListener("click", function (event) {
        event.stopPropagation();
        self._onReminderClick(win);
      });

      this._bar.appendChild(icon);
      this._bar.appendChild(text);
      this._bar.appendChild(modelMenu);
      this._bar.addEventListener("click", function () {
        self._onReminderClick(win);
      });

      var reportPane = doc.getElementById("arxiv-daily-reports");
      if (reportPane) {
        reportPane.insertBefore(this._bar, reportPane.firstChild);
      }

      this._timer = setInterval(function () {
        self._check(win);
      }, 60000);
      this._check(win);

      log("reminder initialized");
    },

    destroy: function () {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
      if (this._bar && this._bar.parentNode) {
        this._bar.parentNode.removeChild(this._bar);
      }
      this._bar = null;
    },

    dismissToday: function () {
      this._dismissedToday = true;
      if (this._bar) this._bar.style.display = "none";
      setPref("reminderLastDismissedDate", todayStr());
    },

    refresh: function (win) {
      this._check(win || Zotero.getMainWindow());
    },

    _check: function (win) {
      try {
        var today = todayStr();
        var reminderTime = getPref("reminderTime", "10:00");
        var parts = reminderTime.split(":");
        var reminderMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        var nowMin = currentMinutes();

        if (nowMin < reminderMin) return;
        if (this._dismissedToday) return;
        if (getPref("reminderLastDismissedDate", "") === today) return;

        var alreadyGenerated = false;
        if (typeof ArxivDailyReportStore !== "undefined") {
          var index = ArxivDailyReportStore.listReports();
          for (var i = 0; i < index.length; i++) {
            if (index[i].date === today) {
              alreadyGenerated = true;
              break;
            }
          }
        }

        var taskRunning = false;
        if (typeof ArxivDailyTaskManager !== "undefined") {
          var running = ArxivDailyTaskManager.getRunningTask();
          if (running && running.type === "generateReport") taskRunning = true;
          var queued = ArxivDailyTaskManager.getQueuedTasks();
          for (var j = 0; j < queued.length; j++) {
            if (queued[j].type === "generateReport") taskRunning = true;
          }
        }

        if ((alreadyGenerated || taskRunning) && this._bar) {
          this._bar.style.display = "none";
          return;
        }

        if (!alreadyGenerated && !taskRunning && this._bar) {
          this._bar.style.display = "flex";
          setPref("reminderLastReminderDate", today);
        }
      } catch (e) {
        logError("reminder check failed: " + (e.message || e));
      }
    },

    _onReminderClick: function (win) {
      var self = this;
      askReminderDecision(win, function (decision) {
        if (decision && decision.generate) {
          if (self._bar) self._bar.style.display = "none";
          if (typeof ArxivDailyActions !== "undefined" && ArxivDailyActions.generateReport) {
            ArxivDailyActions.generateReport(null, null, { skipChoice: true });
          }
        }
      });
    },
  };
})();
