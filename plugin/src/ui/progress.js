/* ==========================================================================
 * ui/progress.js - Progress bar and docked progress panel
 *
 * The compact bar stays in the report pane. Clicking it opens a resizable
 * progress panel docked inside Zotero's central reading/items area.
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

  function t(key, fallback) {
    if (typeof ArxivDailyI18n !== "undefined" && typeof ArxivDailyI18n.t === "function") {
      return ArxivDailyI18n.t(key, fallback);
    }
    return fallback || key;
  }

  function getPref(key, def) {
    try {
      var val = Zotero.Prefs.get(PREFS_PREFIX + key);
      return val !== undefined ? val : def;
    } catch (e) {
      return def;
    }
  }

  function setPref(key, value) {
    try { Zotero.Prefs.set(PREFS_PREFIX + key, value); } catch (e) {}
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function pointerInScroller(scroller, event) {
    if (!scroller || !event || !scroller.getBoundingClientRect) {
      return { x: 0, y: 0 };
    }
    var rect = scroller.getBoundingClientRect();
    return {
      x: clamp((event.clientX || rect.left) - rect.left, 0, rect.width || 0),
      y: clamp((event.clientY || rect.top) - rect.top, 0, rect.height || 0),
    };
  }

  function stripLogPrefix(line) {
    return String(line || "").replace(/^\[[^\]]+\]\s*/, "").trim();
  }

  function createLongLogo(doc, width, height) {
    if (typeof ArxivDailyLogo !== "undefined" && typeof ArxivDailyLogo.longHtml === "function") {
      return ArxivDailyLogo.longHtml(doc, width || 86, height || 24);
    }
    var img = doc.createElement("img");
    img.alt = "";
    img.style.cssText = "width:" + (width || 86) + "px;height:" + (height || 24) + "px;min-width:" + (width || 86) + "px;object-fit:contain;";
    return img;
  }

  function translateLogLine(line) {
    var raw = stripLogPrefix(line);
    var lower = raw.toLowerCase();
    if (!lower) return "";
    if (/[\u4e00-\u9fff]/.test(raw)) return raw;
    var m;
    m = raw.match(/^Announcement\s+([^:]+):\s*(\d+)\s+raw entries/i);
    if (m) return "公告页 " + m[1] + " 抓到原始条目 " + m[2] + " 篇";
    m = raw.match(/^Announcement pages kept\s+(\d+)\s+papers after date filtering/i);
    if (m) return "公告页按日期过滤后保留 " + m[1] + " 篇";
    m = raw.match(/^API\s+([^:]+):\s*(\d+)\s+recent papers/i);
    if (m) return "API 分区 " + m[1] + " 保留最近论文 " + m[2] + " 篇";
    m = raw.match(/^API fallback kept\s+(\d+)\s+recent papers/i);
    if (m) return "API 兜底保留最近论文 " + m[1] + " 篇";
    if (lower.indexOf("rate-limited") >= 0 || lower.indexOf("429") >= 0) {
      return "arXiv API 当前较拥挤或正在限流。抓取论文可能变慢，程序会保守等待并自动重试。";
    }
    if (lower.indexOf("fetching arxiv papers") >= 0) return "正在抓取 arXiv 论文";
    if (lower.indexOf("using arxiv cache") >= 0) return "正在使用 arXiv 缓存";
    if (lower.indexOf("filtering by date") >= 0) return "正在按日期过滤论文";
    if (lower.indexOf("selecting candidates") >= 0 || lower.indexOf("keyword pre-filter") >= 0) {
      return "正在筛选候选论文";
    }
    if (lower.indexOf("llm relevance screening") >= 0) return "正在进行 LLM 相关性筛选";
    if (lower.indexOf("generating markdown report") >= 0) return "正在生成 Markdown 报告";
    if (lower.indexOf("report saved") >= 0) return "报告已保存";
    if (lower.indexOf("finalizing") >= 0) return "正在收尾";
    if (lower === "starting") return "正在启动任务";
    if (lower === "complete" || lower === "completed") return "任务已完成";
    if (lower === "failed") return "任务失败";
    if (lower === "cancelled" || lower === "cancelled by user") return "任务已取消";
    if (lower.indexOf("failed:") === 0) return "任务失败";
    return "";
  }

  function statusText(status) {
    if (status === "pending") return "等待中";
    if (status === "running") return "运行中";
    if (status === "completed") return "已完成";
    if (status === "failed") return "失败";
    if (status === "cancelled") return "已取消";
    return status || "";
  }

  function displayLogLine(line) {
    var prefix = String(line || "").match(/^(\[[^\]]+\]\s*)/);
    var translated = translateLogLine(line);
    if (translated) return (prefix ? prefix[1] : "") + translated;
    return line || "";
  }

  function explainErrorText(error) {
    var msg = String(error || "").trim();
    if (!msg) return "";
    if (msg.indexOf("No arXiv categories configured") >= 0) {
      return "未配置 arXiv 分区。请先在设置中填写核心 arXiv 分区。";
    }
    if (msg.indexOf("No papers found after arXiv fetching") >= 0) {
      return "没有抓到论文。请检查 arXiv 分区、日期过滤、网络、缓存，以及当天这些分区是否有新论文。";
    }
    if (msg.indexOf("All arXiv API fallback requests failed") >= 0 ||
        msg.indexOf("Fetching arXiv papers failed") >= 0 ||
        msg.indexOf("Fetching arXiv metadata failed") >= 0) {
      return "arXiv 抓取阶段失败。常见原因是网络不可达、arXiv 暂时拥挤/限流，或分区代码不正确。";
    }
    if (msg.indexOf("LLM relevance screening failed") >= 0 || msg.indexOf("LLM not configured") >= 0) {
      return "LLM 筛选阶段失败。请检查 provider、API Key、model 和 base URL。";
    }
    if (msg.indexOf("Report save failed") >= 0) {
      return "报告保存失败。请检查 Zotero profile 数据目录是否可写。";
    }
    if (msg.indexOf("fetch failed after") >= 0 || msg.indexOf("HTTP 429") >= 0) {
      return "arXiv 请求在多次重试后仍失败。通常是网络或限流问题，稍后再试更合适。";
    }
    return msg;
  }

  function buildTaskText(task) {
    var lines = [];
    lines.push("任务: " + (task.label || ""));
    lines.push("状态: " + statusText(task.status || ""));
    lines.push("进度: " + (task.progress || 0) + "%");
    if (task.currentStep) lines.push("当前步骤: " + (translateLogLine(task.currentStep) || task.currentStep));
    if (task.progressLog && task.progressLog.length) {
      lines.push("");
      lines.push("进度表:");
      for (var p = 0; p < task.progressLog.length; p++) {
        var rec = task.progressLog[p];
        lines.push("[" + (rec.time || "") + "] " + (rec.progress || 0) + "% " +
          (translateLogLine(rec.step) || rec.step || ""));
      }
    }
    lines.push("");
    lines.push("日志:");
    var logLines = task.log || [];
    for (var i = 0; i < logLines.length; i++) {
      lines.push(displayLogLine(logLines[i]));
    }
    if (task.error) {
      lines.push("");
      lines.push("错误原因:");
      lines.push(explainErrorText(task.error));
      lines.push("");
      lines.push("原始错误:");
      lines.push(task.error);
    }
    return lines.join("\n");
  }

  function selectTextControl(control) {
    if (!control) return;
    try {
      control.focus();
      control.select();
      if (typeof control.setSelectionRange === "function") {
        control.setSelectionRange(0, control.value.length);
      }
    } catch (e) {}
  }

  function copyTextControl(control) {
    if (!control) return false;
    selectTextControl(control);
    try {
      if (control.ownerDocument && typeof control.ownerDocument.execCommand === "function" &&
          control.ownerDocument.execCommand("copy")) {
        return true;
      }
    } catch (e) {}
    try {
      if (typeof Components !== "undefined" &&
          Components.classes &&
          Components.interfaces &&
          Components.classes["@mozilla.org/widget/clipboardhelper;1"]) {
        Components.classes["@mozilla.org/widget/clipboardhelper;1"]
          .getService(Components.interfaces.nsIClipboardHelper)
          .copyString(control.value);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function taskProgressColor(status) {
    if (status === "failed") return "#a12622";
    if (status === "cancelled") return "GrayText";
    if (status === "pending") return "#7a6a2e";
    return "#4c6f8f";
  }

  function isUnfinishedStickyStatus(status) {
    return status === "running" || status === "pending";
  }

  function createTaskProgressStrip(doc, task, sticky) {
    var status = task.status || "pending";
    var progress = Math.max(0, Math.min(100, task.progress || 0));
    var strip = doc.createElement("div");
    strip.setAttribute("data-ari-task-strip", "true");
    strip.setAttribute("data-task-id", task.id || "");
    strip.style.cssText =
      "margin-top:6px;padding:4px 0;background:Canvas;" +
      (sticky ? "position:sticky;top:0;bottom:0;z-index:3;" : "");

    var line = doc.createElement("div");
    line.style.cssText = "display:flex;align-items:center;gap:8px;font-size:11px;color:GrayText;";

    var label = doc.createElement("span");
    label.textContent = (translateLogLine(task.currentStep) || stripLogPrefix(task.currentStep || "") || status) + " · " + progress + "%";
    label.style.cssText = "min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

    var pct = doc.createElement("span");
    pct.textContent = progress + "%";
    pct.style.cssText = "flex:0 0 auto;";

    line.appendChild(label);
    line.appendChild(pct);
    strip.appendChild(line);

    var track = doc.createElement("div");
    track.style.cssText =
      "height:6px;margin-top:3px;background:rgba(0,0,0,.14);" +
      "border-radius:3px;overflow:hidden;";
    var fill = doc.createElement("div");
    fill.style.cssText =
      "height:100%;width:" + progress + "%;background:" + taskProgressColor(status) + ";" +
      "border-radius:3px;transition:width .2s;";
    track.appendChild(fill);
    strip.appendChild(track);
    return strip;
  }

  function createProgressTable(doc, task) {
    var records = task.progressLog || [];
    if (!records.length) {
      records = [{
        time: "",
        step: task.currentStep || task.status || "",
        progress: task.progress || 0,
      }];
    }
    var table = doc.createElement("table");
    table.style.cssText =
      "width:100%;border-collapse:collapse;margin-top:6px;font-size:11px;color:CanvasText;";

    var thead = doc.createElement("thead");
    var headRow = doc.createElement("tr");
    ["时间", "进度", "步骤"].forEach(function (text) {
      var th = doc.createElement("th");
      th.textContent = text;
      th.style.cssText =
        "text-align:left;font-weight:600;color:GrayText;border-bottom:1px solid ThreeDShadow;" +
        "padding:2px 4px;";
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = doc.createElement("tbody");
    var start = Math.max(0, records.length - 8);
    for (var i = start; i < records.length; i++) {
      var rec = records[i];
      var tr = doc.createElement("tr");
      var values = [
        rec.time || "",
        (rec.progress || 0) + "%",
        translateLogLine(rec.step) || stripLogPrefix(rec.step || ""),
      ];
      for (var j = 0; j < values.length; j++) {
        var td = doc.createElement("td");
        td.textContent = values[j];
        td.style.cssText =
          "padding:2px 4px;border-bottom:1px solid rgba(128,128,128,.18);" +
          (j === 1 ? "white-space:nowrap;width:42px;" : "") +
          (j === 0 ? "white-space:nowrap;width:58px;color:GrayText;" : "");
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  globalThis.ArxivDailyProgress = {
    _bar: null,
    _barLabel: null,
    _barFill: null,
    _arrow: null,
    _panel: null,
    _panelContent: null,
    _panelCanvas: null,
    _panelBody: null,
    _resizeGrip: null,
    _stickyTop: null,
    _stickyBottom: null,
    _visible: false,
    _doc: null,
    _taskHandler: null,
    _scrollHandler: null,
    _stickyFrame: null,
    _tasksById: null,
    _fontSize: 12,
    _zoom: 1,

    init: function (win) {
      var doc = win.document;
      if (this._bar) return;

      this._doc = doc;
      this._fontSize = parseInt(getPref("progressFontSize", 12), 10) || 12;
      this._zoom = Math.max(0.7, Math.min(1.8, parseFloat(getPref("progressZoom", 1)) || 1));

      var reportPane = doc.getElementById("arxiv-daily-reports");
      if (!reportPane) {
        logError("progress: report pane not found");
        return;
      }

      this._bar = doc.createElement("div");
      this._bar.setAttribute("id", "arxiv-daily-progress-bar");
      this._bar.style.cssText =
        "display:none;width:100%;padding:2px 8px;min-height:20px;" +
        "cursor:pointer;box-sizing:border-box;align-items:center;" +
        "background:transparent;color:inherit;";
      this._bar.addEventListener("mouseenter", function () { this.style.opacity = "0.65"; });
      this._bar.addEventListener("mouseleave", function () { this.style.opacity = "1"; });
      this._bar.addEventListener("click", function () {
        if (typeof ArxivDailyProgress !== "undefined") ArxivDailyProgress.togglePanel();
      });

      this._barLabel = doc.createElement("span");
      this._barLabel.setAttribute("id", "arxiv-daily-progress-label");
      this._barLabel.style.cssText =
        "font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;" +
        "white-space:nowrap;color:inherit;";

      var track = doc.createElement("div");
      track.style.cssText =
        "flex:1;height:6px;background:rgba(0,0,0,0.14);" +
        "border-radius:3px;overflow:hidden;margin:0 6px;";

      this._barFill = doc.createElement("div");
      this._barFill.setAttribute("id", "arxiv-daily-progress-fill");
      this._barFill.style.cssText =
        "height:100%;width:0%;background:#4c6f8f;border-radius:3px;" +
        "transition:width 0.25s;";
      track.appendChild(this._barFill);

      this._arrow = doc.createElement("span");
      this._arrow.setAttribute("id", "arxiv-daily-progress-arrow");
      this._arrow.textContent = ">>";
      this._arrow.style.cssText =
        "font-size:11px;font-weight:bold;color:GrayText;cursor:pointer;padding:0 2px;";
      this._arrow.addEventListener("click", function (e) {
        e.stopPropagation();
        if (typeof ArxivDailyProgress !== "undefined") ArxivDailyProgress.togglePanel();
      });

      this._bar.appendChild(this._barLabel);
      this._bar.appendChild(track);
      this._bar.appendChild(this._arrow);

      var parent = reportPane.parentNode;
      var splitter = doc.getElementById("arxiv-daily-splitter");
      if (splitter && splitter.parentNode === parent) {
        parent.insertBefore(this._bar, splitter);
      } else {
        reportPane.appendChild(this._bar);
      }

      this._taskHandler = this._onTaskChange.bind(this);
      if (typeof ArxivDailyTaskManager !== "undefined") {
        ArxivDailyTaskManager.onChange(this._taskHandler);
      }

      log("progress bar initialized");
    },

    destroy: function () {
      if (typeof ArxivDailyTaskManager !== "undefined" && this._taskHandler) {
        ArxivDailyTaskManager.offChange(this._taskHandler);
      }
      this._removeEl(this._panel);
      this._removeEl(this._bar);
      this._bar = null;
      this._barLabel = null;
      this._barFill = null;
      this._arrow = null;
      this._panel = null;
      this._panelContent = null;
      this._panelCanvas = null;
      this._panelBody = null;
      this._resizeGrip = null;
      this._stickyTop = null;
      this._stickyBottom = null;
      this._doc = null;
      this._taskHandler = null;
      this._scrollHandler = null;
      this._stickyFrame = null;
      this._tasksById = null;
      this._visible = false;
    },

    togglePanel: function () {
      if (this._visible) this.hidePanel();
      else this.showPanel();
    },

    showPanel: function () {
      var win = Zotero.getMainWindow();
      if (!win || this._visible) return;
      var doc = win.document;
      this._doc = doc;

      if (!this._panel) {
        this._createPanel(doc);
        if (typeof ArxivDailyCenterWorkspace !== "undefined") {
          ArxivDailyCenterWorkspace.mountPanel("progress", "Progress", this._panel, "right");
        }
      }

      if (typeof ArxivDailyCenterWorkspace !== "undefined") {
        ArxivDailyCenterWorkspace.showPanel("progress");
      } else if (this._panel) {
        this._panel.style.display = "flex";
      }
      this._visible = true;
      this._refreshPanel();
    },

    hidePanel: function () {
      if (typeof ArxivDailyCenterWorkspace !== "undefined") {
        ArxivDailyCenterWorkspace.hidePanel("progress");
      } else if (this._panel) {
        this._panel.style.display = "none";
      }
      this._visible = false;
    },

    _createPanel: function (doc) {
      this._panel = doc.createElement("div");
      this._panel.setAttribute("id", "arxiv-daily-progress-panel");
      this._panel.style.cssText =
        "display:flex;width:100%;height:100%;" +
        "box-sizing:border-box;background:Canvas;color:CanvasText;" +
        "flex-direction:column;overflow:hidden;";

      this._resizeGrip = doc.createElement("div");
      this._resizeGrip.setAttribute("id", "arxiv-daily-progress-resize");
      this._resizeGrip.setAttribute("title", "拖动调节高度");
      this._resizeGrip.style.cssText =
        "display:none;";
      this._panel.appendChild(this._resizeGrip);

      var header = doc.createElement("div");
      header.style.cssText =
        "display:flex;align-items:center;padding:5px 8px;" +
        "border-bottom:1px solid ThreeDShadow;font-size:12px;gap:8px;";

      var title = doc.createElement("span");
      title.textContent = "任务进度";
      title.style.cssText = "flex:1;font-weight:600;";

      var fontRange = doc.createElement("input");
      fontRange.type = "range";
      fontRange.min = "10";
      fontRange.max = "18";
      fontRange.step = "1";
      fontRange.value = String(this._fontSize);
      fontRange.title = "任务进度字号";
      fontRange.style.cssText = "width:58px;cursor:pointer;";
      fontRange.addEventListener("input", function () {
        ArxivDailyProgress._fontSize = parseInt(fontRange.value, 10) || 12;
        setPref("progressFontSize", ArxivDailyProgress._fontSize);
        ArxivDailyProgress._applyDisplayPrefs();
      });

      var closeBtn = doc.createElement("button");
      closeBtn.textContent = "x";
      closeBtn.setAttribute("title", "关闭");
      closeBtn.style.cssText =
        "cursor:pointer;padding:1px 7px;font-size:12px;border:1px solid ThreeDShadow;" +
        "background:ButtonFace;color:ButtonText;border-radius:3px;";
      closeBtn.addEventListener("click", function () {
        if (typeof ArxivDailyProgress !== "undefined") ArxivDailyProgress.hidePanel();
      });

      header.appendChild(createLongLogo(doc, 88, 24));
      header.appendChild(title);
      header.appendChild(fontRange);
      header.appendChild(closeBtn);
      this._panel.appendChild(header);

      this._panelContent = doc.createElement("div");
      this._panelContent.setAttribute("id", "arxiv-daily-progress-panel-content");
      this._panelContent.style.cssText =
        "padding:0;font-size:12px;overflow:auto;flex:1 1 auto;" +
        "position:relative;user-select:text;-moz-user-select:text;";
      this._panelCanvas = doc.createElement("div");
      this._panelCanvas.setAttribute("data-ari-progress-canvas", "true");
      this._panelCanvas.style.cssText =
        "position:relative;overflow:visible;box-sizing:border-box;min-width:0;min-height:0;";
      this._panelBody = doc.createElement("div");
      this._panelBody.setAttribute("data-ari-progress-body", "true");
      this._panelBody.style.cssText =
        "box-sizing:border-box;padding:6px 8px;transform-origin:top left;";
      this._panelCanvas.appendChild(this._panelBody);
      this._panelContent.appendChild(this._panelCanvas);
      this._panel.appendChild(this._panelContent);
      this._panelContent.addEventListener("wheel", function (event) {
        if (!event.ctrlKey) return;
        event.preventDefault();
        var delta = event.deltaY > 0 ? -0.06 : 0.06;
        ArxivDailyProgress._setZoom(ArxivDailyProgress._zoom + delta, event);
      }, { passive: false });
      this._applyDisplayPrefs();

      this._scrollHandler = this._queueStickyUpdate.bind(this);
      this._panelContent.addEventListener("scroll", this._scrollHandler, true);
    },

    _applyDisplayPrefs: function () {
      if (!this._panelContent) return;
      if (this._panelBody) this._panelBody.style.fontSize = (this._fontSize || 12) + "px";
      this._updatePanelCanvas();
    },

    _clearPanelBody: function () {
      var body = this._panelBody || this._panelContent;
      while (body && body.firstChild) {
        body.removeChild(body.firstChild);
      }
      if (this._panelCanvas) this._panelCanvas.removeAttribute("data-ari-base-width");
      this._updatePanelCanvas();
    },

    _appendPanelBody: function (node) {
      (this._panelBody || this._panelContent).appendChild(node);
      this._updatePanelCanvas();
    },

    _updatePanelCanvas: function () {
      if (!this._panelContent || !this._panelCanvas || !this._panelBody) return;
      var zoom = clamp(this._zoom || 1, 0.7, 1.8);
      var baseWidth = parseFloat(this._panelCanvas.getAttribute("data-ari-base-width") || "0");
      if (!baseWidth) {
        this._panelBody.style.transform = "none";
        baseWidth = Math.max(1, this._panelContent.clientWidth || this._panelBody.offsetWidth || 0);
        this._panelBody.style.width = baseWidth + "px";
        this._panelCanvas.setAttribute("data-ari-base-width", String(baseWidth));
      }
      var baseHeight = Math.max(1, this._panelBody.scrollHeight || this._panelBody.offsetHeight || 0);
      var visualWidth = Math.max(baseWidth, this._panelBody.scrollWidth || 0, this._panelBody.offsetWidth || 0);
      this._panelBody.style.transform = "scale(" + zoom + ")";
      this._panelBody.style.transformOrigin = "top left";
      this._panelCanvas.style.width = Math.ceil(visualWidth * zoom) + "px";
      this._panelCanvas.style.height = Math.ceil(baseHeight * zoom) + "px";
    },

    _setZoom: function (value, anchorEvent) {
      var oldZoom = clamp(this._zoom || 1, 0.7, 1.8);
      var nextZoom = clamp(value, 0.7, 1.8);
      var scroller = this._panelContent;
      var layer = this._panelBody;
      var clientX = anchorEvent && typeof anchorEvent.clientX === "number" ? anchorEvent.clientX : 0;
      var clientY = anchorEvent && typeof anchorEvent.clientY === "number" ? anchorEvent.clientY : 0;
      var contentX = 0;
      var contentY = 0;
      if (scroller && layer && anchorEvent && layer.getBoundingClientRect) {
        var layerRect = layer.getBoundingClientRect();
        contentX = (clientX - layerRect.left) / oldZoom;
        contentY = (clientY - layerRect.top) / oldZoom;
      } else {
        var anchor = pointerInScroller(scroller, anchorEvent);
        contentX = scroller ? (scroller.scrollLeft + anchor.x) / oldZoom : 0;
        contentY = scroller ? (scroller.scrollTop + anchor.y) / oldZoom : 0;
      }

      this._zoom = nextZoom;
      setPref("progressZoom", this._zoom);
      this._applyDisplayPrefs();

      if (scroller && anchorEvent && oldZoom !== nextZoom) {
        layer = this._panelBody;
        if (layer && layer.getBoundingClientRect) {
          var nextRect = layer.getBoundingClientRect();
          scroller.scrollLeft = Math.max(0, scroller.scrollLeft + nextRect.left + contentX * nextZoom - clientX);
          scroller.scrollTop = Math.max(0, scroller.scrollTop + nextRect.top + contentY * nextZoom - clientY);
        }
      }
      this._queueStickyUpdate();
    },

    _onTaskChange: function (tasks, runningId) {
      var running = runningId && tasks[runningId] ? tasks[runningId] : null;

      if (running) {
        var stepText = translateLogLine(running.currentStep) || stripLogPrefix(running.currentStep || "");
        this._bar.style.display = "flex";
        this._barLabel.textContent = running.label +
          (stepText ? " - " + stepText : "") +
          " [" + running.progress + "%]";
        this._barFill.style.width = running.progress + "%";
        if (this._visible) this._refreshPanel();
        return;
      }

      var hasActive = false;
      for (var id in tasks) {
        var t = tasks[id];
        if (t.status === "running" || t.status === "pending") {
          hasActive = true;
          break;
        }
      }
      if (!hasActive) {
        this._bar.style.display = "none";
        if (this._visible) this._refreshPanel();
      }
    },

    _refreshPanel: function () {
      if (!this._panelContent) return;
      var doc = this._doc || document;
      var scroller = this._panelContent;
      var previousScrollLeft = scroller.scrollLeft || 0;
      var previousScrollTop = scroller.scrollTop || 0;
      var wasNearBottom = Math.abs((scroller.scrollHeight || 0) - (previousScrollTop + (scroller.clientHeight || 0))) < 12;
      this._clearPanelBody();
      this._tasksById = {};

      var tasks = [];
      if (typeof ArxivDailyTaskManager !== "undefined") {
        tasks = ArxivDailyTaskManager.getAllTasks();
      }

      if (tasks.length === 0) {
        var empty = doc.createElement("div");
        empty.textContent = "暂无任务记录";
        empty.style.cssText = "color:GrayText;padding:8px;font-size:12px;";
        this._appendPanelBody(empty);
        this._stickyTop = null;
        this._stickyBottom = null;
        return;
      }

      this._stickyTop = this._createStickySlot(doc, "top");
      this._appendPanelBody(this._stickyTop);

      for (var i = 0; i < tasks.length; i++) {
        this._tasksById[tasks[i].id] = tasks[i];
        this._appendPanelBody(this._createTaskRow(doc, tasks[i]));
      }

      this._stickyBottom = this._createStickySlot(doc, "bottom");
      this._appendPanelBody(this._stickyBottom);
      this._applyDisplayPrefs();
      if (wasNearBottom) {
        scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      } else {
        scroller.scrollTop = Math.min(previousScrollTop, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
      }
      scroller.scrollLeft = Math.min(previousScrollLeft, Math.max(0, scroller.scrollWidth - scroller.clientWidth));
      this._queueStickyUpdate();
    },

    _createStickySlot: function (doc, edge) {
      var slot = doc.createElement("div");
      slot.setAttribute("data-ari-sticky-slot", edge);
      slot.style.cssText =
        "display:none;position:sticky;" + edge + ":0;z-index:8;" +
        "background:Canvas;color:CanvasText;padding:3px 0;" +
        "box-shadow:0 " + (edge === "top" ? "2px" : "-2px") + " 4px rgba(0,0,0,.08);";
      return slot;
    },

    _queueStickyUpdate: function () {
      if (!this._visible || !this._panelContent) return;
      if (this._stickyFrame) return;
      var self = this;
      var win = this._doc && this._doc.defaultView;
      var raf = win && win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : null;
      this._stickyFrame = raf ? raf(function () {
        self._stickyFrame = null;
        self._updateStickyProgress();
      }) : setTimeout(function () {
        self._stickyFrame = null;
        self._updateStickyProgress();
      }, 16);
    },

    _updateStickyProgress: function () {
      if (!this._panelContent || !this._stickyTop || !this._stickyBottom) return;
      var contentRect = this._panelContent.getBoundingClientRect();
      var topLimit = contentRect.top + 1;
      var bottomLimit = contentRect.bottom - 1;
      var body = this._panelBody || this._panelContent;
      var strips = body.querySelectorAll("[data-ari-task-row='true'] [data-ari-task-strip='true']");
      var topCandidate = null;
      var bottomCandidate = null;

      for (var i = 0; i < strips.length; i++) {
        var taskId = strips[i].getAttribute("data-task-id");
        var task = this._tasksById && this._tasksById[taskId];
        if (!task || !isUnfinishedStickyStatus(task.status)) continue;

        var rect = strips[i].getBoundingClientRect();
        var visible = rect.bottom > topLimit && rect.top < bottomLimit;
        if (visible) continue;

        if (rect.bottom <= topLimit) {
          if (!topCandidate || rect.bottom > topCandidate.rect.bottom) {
            topCandidate = { task: task, rect: rect };
          }
        } else if (rect.top >= bottomLimit) {
          if (!bottomCandidate || rect.top < bottomCandidate.rect.top) {
            bottomCandidate = { task: task, rect: rect };
          }
        }
      }

      this._renderStickySlot(this._stickyTop, topCandidate ? topCandidate.task : null);
      this._renderStickySlot(this._stickyBottom, bottomCandidate ? bottomCandidate.task : null);
    },

    _renderStickySlot: function (slot, task) {
      if (!slot) return;
      if (!task) {
        slot.style.display = "none";
        slot.setAttribute("data-task-id", "");
        slot.setAttribute("data-render-key", "");
        while (slot.firstChild) slot.removeChild(slot.firstChild);
        return;
      }
      var key = [
        task.id || "",
        task.status || "",
        task.progress || 0,
        task.currentStep || "",
      ].join("|");
      if (slot.getAttribute("data-render-key") !== key) {
        while (slot.firstChild) slot.removeChild(slot.firstChild);
        slot.appendChild(createTaskProgressStrip(this._doc || document, task, false));
        slot.setAttribute("data-render-key", key);
        slot.setAttribute("data-task-id", task.id || "");
      }
      slot.style.display = "block";
    },

    _createTaskRow: function (doc, task) {
      var row = doc.createElement("div");
      row.setAttribute("data-ari-task-row", "true");
      row.setAttribute("data-task-id", task.id || "");
      row.style.cssText =
        "margin:4px 0;padding:6px;border:1px solid ThreeDShadow;" +
        "border-radius:4px;background:Canvas;font-size:12px;overflow:visible;";

      var status = task.status || "pending";
      var canDismiss = status !== "running";
      var label = "[...]";
      if (status === "completed") label = "[OK]";
      else if (status === "failed") label = "[ERR]";
      else if (status === "cancelled") label = "[CANCEL]";
      else if (status === "running") label = "[RUN]";
      else if (status === "pending") label = "[WAIT]";

      var head = doc.createElement("div");
      head.style.cssText = "display:flex;align-items:center;gap:8px;";

      var title = doc.createElement("span");
      title.textContent = label + " " + task.label;
      title.style.cssText = "flex:1;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

      var pct = doc.createElement("span");
      pct.textContent = task.progress + "%";
      pct.style.cssText = "color:GrayText;flex:0 0 auto;";

      var dismissBtn = doc.createElement("button");
      dismissBtn.type = "button";
      dismissBtn.textContent = "x";
      dismissBtn.disabled = !canDismiss;
      dismissBtn.setAttribute("title", canDismiss ? "关闭此任务" : "运行中的任务请使用停止按钮");
      dismissBtn.style.cssText =
        "width:20px;height:20px;padding:0;font-size:12px;line-height:18px;" +
        "border:1px solid ThreeDShadow;background:ButtonFace;color:ButtonText;" +
        "border-radius:3px;cursor:" + (canDismiss ? "pointer" : "default") + ";" +
        "opacity:" + (canDismiss ? "1" : "0.45") + ";";
      dismissBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof ArxivDailyTaskManager !== "undefined") {
          ArxivDailyTaskManager.dismiss(task.id);
        }
      });

      head.appendChild(title);
      head.appendChild(pct);
      head.appendChild(dismissBtn);
      row.appendChild(head);

      if (status !== "completed") {
        row.appendChild(createTaskProgressStrip(doc, task, false));
      }

      var currentLine = task.currentStep || ((task.log && task.log.length > 0) ? task.log[task.log.length - 1] : "");
      var summaryText = translateLogLine(currentLine);
      if (!summaryText && task.error) summaryText = explainErrorText(task.error);
      if (summaryText) {
        var summary = doc.createElement("div");
        summary.textContent = summaryText;
        summary.style.cssText = "margin-top:4px;color:GrayText;font-size:11px;line-height:1.45;";
        row.appendChild(summary);
      }

      if (task.error) {
        var err = doc.createElement("div");
        err.textContent = explainErrorText(task.error);
        err.style.cssText = "font-size:11px;color:#a12622;margin-top:4px;line-height:1.45;";
        row.appendChild(err);
      }

      row.appendChild(createProgressTable(doc, task));

      var actions = doc.createElement("div");
      actions.style.cssText = "display:flex;justify-content:flex-end;gap:6px;margin-top:6px;";

      var detailBox = doc.createElement("textarea");
      detailBox.readOnly = true;
      detailBox.spellcheck = false;
      detailBox.value = buildTaskText(task);
      detailBox.rows = Math.min(12, Math.max(5, (task.log || []).length + (task.error ? 4 : 2)));
      detailBox.style.cssText =
        "width:100%;box-sizing:border-box;margin-top:6px;padding:6px 8px;" +
        "font:11px/1.45 Consolas, 'Courier New', monospace;" +
        "background:Field;color:FieldText;border:1px solid ThreeDShadow;" +
        "border-radius:4px;resize:vertical;user-select:text;-moz-user-select:text;";

      var selectBtn = doc.createElement("button");
      selectBtn.type = "button";
      selectBtn.textContent = "全选";
      selectBtn.style.cssText =
        "padding:2px 8px;font-size:11px;border:1px solid ThreeDShadow;" +
        "background:ButtonFace;color:ButtonText;border-radius:3px;cursor:pointer;";
      selectBtn.addEventListener("click", function () {
        selectTextControl(detailBox);
      });

      var copyBtn = doc.createElement("button");
      copyBtn.type = "button";
      copyBtn.textContent = "复制";
      copyBtn.style.cssText =
        "padding:2px 8px;font-size:11px;border:1px solid ThreeDShadow;" +
        "background:ButtonFace;color:ButtonText;border-radius:3px;cursor:pointer;";
      copyBtn.addEventListener("click", function () {
        if (!copyTextControl(detailBox)) {
          selectTextControl(detailBox);
        }
      });

      actions.appendChild(selectBtn);
      actions.appendChild(copyBtn);
      row.appendChild(actions);
      row.appendChild(detailBox);

      return row;
    },

    _removeEl: function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    },
  };
})();
