/* ==========================================================================
 * ui/profile-window.js - Research interest profile builder
 *
 * The default source is the user's normal Zotero library. Generated output is
 * stored in research_interests.base.md. Report generation uses the base profile
 * by default; research_interests.active.md is only a legacy/manual fallback.
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";
  const WINDOW_NAME = "arxiv-daily-profile";
  const WINDOW_FEATURES = "chrome,centerscreen,resizable,width=980,height=820";
  const USER_LIBRARY_ID = 1;
  const MAX_LIBRARY_ITEMS = 160;
  const MAX_PROJECT_FILES = 80;
  const MAX_PROJECT_TEXT_CHARS = 36000;
  const MAX_FILE_CHARS = 5000;
  const MAX_TEXT_FILE_BYTES = 1024 * 1024;

  const PROFILE_FILES = {
    base: "research_interests.base.md",
    feedback: "research_interests.feedback.md",
    active: "research_interests.active.md",
    legacy: "research_interests.md",
  };

  function isReadinessProfileFile(relativePath) {
    return relativePath === PROFILE_FILES.base ||
      relativePath === PROFILE_FILES.active ||
      relativePath === PROFILE_FILES.legacy;
  }

  const BUILD_MODES = [
    {
      id: "llm-zotero",
      label: "LLM 辅助 Zotero 文献库合成",
      tooltip: "默认模式：读取 Zotero 普通文献库中的论文元数据，调用 LLM 合成基础科研兴趣画像。",
    },
    {
      id: "local-zotero",
      label: "不使用 LLM，使用 Zotero 文献库合成",
      tooltip: "读取 Zotero 普通文献库，用本地规则生成关键词和主题草稿，不调用 LLM。",
    },
    {
      id: "custom-library",
      label: "自定义文献库合成",
      tooltip: "选择 Zotero 之外的本地项目文件夹，并默认调用 LLM 理解其中的论文草稿、笔记、代码、配置和其他项目线索。会消耗 API token。",
    },
    {
      id: "project-papers",
      label: "使用项目论文库",
      tooltip: "使用每日 arXiv 插件自己的项目论文库生成画像。该库位于插件数据目录 project-papers/index.json，不会和 Zotero 普通文献库混在一起。",
    },
    {
      id: "import-md",
      label: "导入 MD 文件",
      tooltip: "从 Markdown 文件导入已有科研兴趣画像，写入基础科研兴趣画像。",
    },
  ];

  let gWindow = null;

  function log(msg) {
    const text = "[" + LOG_PREFIX + "] " + msg;
    if (typeof Zotero.debug === "function") Zotero.debug(text);
    else if (typeof Zotero.log === "function") Zotero.log(text);
  }

  function logError(msg) {
    if (typeof Zotero.logError === "function") Zotero.logError(msg);
    else log("ERROR: " + msg);
  }

  function safeText(value) {
    return value === undefined || value === null ? "" : String(value);
  }

  function createEl(doc, name, className, text) {
    var el = doc.createElement(name);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function createLogo(doc, size) {
    if (typeof ArxivDailyLogo !== "undefined") return ArxivDailyLogo.html(doc, size || 18, "ari-logo");
    var img = createEl(doc, "img", "ari-logo");
    img.alt = "";
    return img;
  }

  function createTitle(doc, text) {
    var title = createEl(doc, "h1", "ari-title");
    title.appendChild(createLogo(doc, 18));
    title.appendChild(createEl(doc, "span", null, text));
    return title;
  }

  function getUserLibraryID() {
    try {
      if (typeof Zotero !== "undefined" && Zotero.Libraries && Zotero.Libraries.userLibraryID) {
        return Zotero.Libraries.userLibraryID;
      }
    } catch (e) {}
    return USER_LIBRARY_ID;
  }

  function pickerParent(dialog) {
    if (dialog && dialog.browsingContext) return dialog.browsingContext;
    try {
      var win = Zotero.getMainWindow();
      if (win && win.browsingContext) return win.browsingContext;
    } catch (e) {}
    try {
      if (typeof Services !== "undefined" && Services.wm) {
        var recent = Services.wm.getMostRecentWindow("navigator:browser") ||
          Services.wm.getMostRecentWindow(null);
        if (recent && recent.browsingContext) return recent.browsingContext;
      }
    } catch (e2) {}
    return null;
  }

  function initFilePicker(picker, dialog, title, mode) {
    var parent = pickerParent(dialog);
    if (!parent) {
      throw new Error("Cannot open file picker: Zotero window browsingContext is not available");
    }
    picker.init(parent, title, mode);
  }

  function showFilePicker(picker) {
    if (picker && typeof picker.show === "function") return Promise.resolve(picker.show());
    if (picker && typeof picker.open === "function") {
      return new Promise(function (resolve, reject) {
        var settled = false;
        function done(result) {
          if (settled) return;
          settled = true;
          resolve(result);
        }
        try {
          picker.open(done);
        } catch (err) {
          try {
            picker.open({ done: done });
          } catch (err2) {
            reject(err2 || err);
          }
        }
      });
    }
    return Promise.reject(new Error("File picker is not available"));
  }

  function resetDocument(dialog) {
    var doc = dialog.document;
    doc.open();
    doc.write("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>科研兴趣画像</title></head><body></body></html>");
    doc.close();
    doc.title = "科研兴趣画像";
    return doc;
  }

  function installStyles(doc) {
    var style = createEl(doc, "style");
    style.textContent = [
      "html,body{width:100%;height:100%;margin:0;padding:0;}",
      "body{box-sizing:border-box;background:Canvas;color:CanvasText;font:13px message-box,system-ui,sans-serif;}",
      ".ari-profile{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;min-height:0;}",
      ".ari-head{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid ThreeDShadow;background:Canvas;}",
      ".ari-title{font-size:18px;font-weight:600;margin:0;flex:1;min-width:0;display:flex;align-items:center;gap:8px;}",
      ".ari-logo{width:18px;height:18px;min-width:18px;object-fit:contain;}",
      ".ari-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
      ".ari-status{color:GrayText;font-size:12px;min-width:132px;text-align:right;}",
      ".ari-status.ari-ok{color:#2d6a36;}",
      ".ari-status.ari-warning{color:#8a5a00;}",
      ".ari-status.ari-error{color:#9b1c1c;}",
      ".ari-btn{min-width:86px;padding:6px 12px;font:13px message-box,system-ui,sans-serif;}",
      ".ari-btn.is-primary{min-width:132px;}",
      ".ari-btn.is-running{border-color:Highlight;background:Highlight;color:HighlightText;}",
      ".ari-btn:disabled{opacity:.55;}",
      ".ari-split{display:inline-flex;align-items:stretch;}",
      ".ari-split .ari-btn{border-top-right-radius:0;border-bottom-right-radius:0;}",
      ".ari-menu-btn{min-width:28px;padding:0 7px;border-top-left-radius:0;border-bottom-left-radius:0;}",
      ".ari-body{box-sizing:border-box;flex:1;min-height:0;overflow:auto;padding:14px 16px 16px;}",
      ".ari-note{border:1px solid ThreeDShadow;border-radius:4px;background:Field;padding:10px 12px;line-height:1.45;margin-bottom:12px;}",
      ".ari-workflow{border:1px solid ThreeDShadow;border-radius:6px;background:Field;margin-bottom:12px;padding:10px;}",
      ".ari-workflow-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(230px,300px);gap:12px;margin-bottom:12px;align-items:stretch;}",
      ".ari-workflow-grid .ari-workflow{margin-bottom:0;}",
      ".ari-workflow-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;}",
      ".ari-workflow-title{font-weight:600;flex:1;}",
      ".ari-mode{color:GrayText;font-size:12px;}",
      ".ari-progress-line{height:6px;background:rgba(0,0,0,.13);border-radius:3px;overflow:hidden;margin:8px 0;}",
      ".ari-progress-fill{height:100%;width:0%;background:#4c6f8f;border-radius:3px;transition:width .2s;}",
      ".ari-help{font-size:12px;color:GrayText;line-height:1.45;margin:6px 0 10px;}",
      ".ari-option{display:flex;align-items:flex-start;gap:7px;margin:8px 0;font-size:12px;line-height:1.35;color:CanvasText;}",
      ".ari-option input{margin-top:1px;}",
      ".ari-choice-row{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:6px 0 8px;}",
      ".ari-choice-row button{min-width:0;padding:3px 7px;border:1px solid ThreeDShadow;border-radius:3px;background:ButtonFace;color:ButtonText;font:12px message-box,system-ui,sans-serif;}",
      ".ari-choice-row button.is-selected{background:Highlight;color:HighlightText;border-color:Highlight;}",
      ".ari-select{box-sizing:border-box;width:100%;min-width:0;padding:4px 6px;border:1px solid ThreeDShadow;border-radius:3px;background:Field;color:FieldText;font:12px message-box,system-ui,sans-serif;}",
      ".ari-suggestion-box{border:1px solid ThreeDShadow;border-radius:4px;background:Canvas;padding:7px;min-height:72px;max-height:170px;overflow:auto;white-space:pre-wrap;font:12px ui-monospace,Consolas,monospace;}",
      ".ari-menu{position:absolute;z-index:1000;min-width:260px;border:1px solid ThreeDShadow;border-radius:4px;background:Field;color:FieldText;box-shadow:0 4px 16px rgba(0,0,0,.2);}",
      ".ari-menu button{display:block;width:100%;box-sizing:border-box;text-align:left;border:0;background:transparent;color:inherit;padding:7px 10px;font:12px message-box,system-ui,sans-serif;}",
      ".ari-menu button:hover,.ari-menu button.is-selected{background:Highlight;color:HighlightText;}",
      ".ari-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:stretch;}",
      ".ari-panel{border:1px solid ThreeDShadow;border-radius:6px;background:Field;display:flex;flex-direction:column;min-width:0;min-height:260px;}",
      ".ari-panel.is-wide{grid-column:1 / -1;min-height:250px;}",
      ".ari-panel-head{display:flex;align-items:center;gap:8px;padding:9px 10px;border-bottom:1px solid ThreeDShadow;flex-wrap:wrap;}",
      ".ari-panel-title{font-weight:600;flex:1 1 180px;min-width:0;}",
      ".ari-panel-desc{font-weight:400;color:GrayText;font-size:12px;line-height:1.35;margin-top:2px;}",
      ".ari-file{color:GrayText;font-size:11px;font-family:ui-monospace,Consolas,monospace;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 150px;}",
      ".ari-mini-btn{min-width:0;padding:4px 8px;font:12px message-box,system-ui,sans-serif;}",
      ".ari-editor{box-sizing:border-box;display:block;width:100%;flex:1;min-height:180px;resize:vertical;border:0;background:Canvas;color:CanvasText;padding:10px;font:12px ui-monospace,Consolas,monospace;line-height:1.45;}",
      ".ari-footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px solid ThreeDShadow;padding:8px 10px;color:GrayText;font-size:12px;}",
      ".ari-footer > span:first-child{flex:1 1 150px;min-width:0;}",
      ".ari-feedback-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex:1 1 360px;min-width:0;flex-wrap:wrap;}",
      ".ari-feedback-actions .ari-mini-btn{white-space:normal;line-height:1.25;min-height:28px;max-width:260px;}",
      ".ari-log{margin-top:12px;border:1px solid ThreeDShadow;border-radius:4px;background:Canvas;padding:8px;white-space:pre-wrap;font:12px ui-monospace,Consolas,monospace;max-height:150px;overflow:auto;}",
      ".ari-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center;z-index:3000;}",
      ".ari-modal{width:min(760px,calc(100% - 40px));max-height:86vh;display:flex;flex-direction:column;border:1px solid ThreeDShadow;border-radius:6px;background:Canvas;color:CanvasText;box-shadow:0 10px 30px rgba(0,0,0,.28);}",
      ".ari-modal-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid ThreeDShadow;}",
      ".ari-modal-title{font-weight:600;flex:1;}",
      ".ari-modal-body{padding:12px;overflow:auto;}",
      ".ari-modal-actions{display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;border-top:1px solid ThreeDShadow;}",
      ".ari-check-row{display:flex;align-items:center;gap:8px;padding:6px 0;}",
      ".ari-check-box{width:16px;height:16px;border:1px solid ThreeDShadow;background:Field;display:inline-flex;align-items:center;justify-content:center;font-size:13px;}",
      ".ari-folder-list{border:1px solid ThreeDShadow;border-radius:4px;background:Field;min-height:34px;max-height:96px;overflow:auto;padding:4px 6px;margin:6px 0 8px;}",
      ".ari-folder-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 0;font-size:12px;}",
      ".ari-folder-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,monospace;color:CanvasText;}",
      "@media(max-width:780px){.ari-grid,.ari-workflow-grid{grid-template-columns:1fr}.ari-panel.is-wide{grid-column:auto}.ari-head{align-items:flex-start;flex-direction:column}.ari-status{text-align:left;}}",
    ].join("\n");
    doc.head.appendChild(style);
  }

  function setTooltip(el, text) {
    if (!el) return;
    el.title = text || "";
    el.setAttribute("aria-label", text || el.textContent || "");
  }

  function clearNode(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function setBusy(doc, busy) {
    doc.body.setAttribute("data-profile-busy", busy ? "true" : "false");
    var buttons = doc.querySelectorAll("button[data-profile-action]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].disabled = !!busy;
    }
    var build = doc.getElementById("profile-build-button");
    if (build) {
      build.disabled = !!busy;
      build.classList.toggle("is-running", !!busy);
      if (busy) build.textContent = "生成中...";
      else setBuildButtonMode(doc, getSelectedMode(doc));
    }
  }

  function isBusy(doc) {
    return doc.body.getAttribute("data-profile-busy") === "true";
  }

  function markDirty(doc, dirty) {
    doc.body.setAttribute("data-profile-dirty", dirty ? "true" : "false");
  }

  function isDirty(doc) {
    return doc.body.getAttribute("data-profile-dirty") === "true";
  }

  function updateStatus(doc, message, className) {
    var status = doc.getElementById("profile-save-status");
    if (!status) return;
    status.className = "ari-status" + (className ? " " + className : "");
    status.textContent = message || "";
  }

  function updateProgress(doc, pct, text) {
    var fill = doc.getElementById("profile-progress-fill");
    var label = doc.getElementById("profile-progress-label");
    if (fill) fill.style.width = Math.max(0, Math.min(100, pct || 0)) + "%";
    if (label) label.textContent = text || "";
  }

  function appendLog(doc, message) {
    var logBox = doc.getElementById("profile-log");
    if (!logBox) return;
    logBox.textContent += "[" + new Date().toLocaleTimeString() + "] " + message + "\n";
    logBox.scrollTop = logBox.scrollHeight;
  }

  function readFile(relativePath) {
    try {
      if (typeof ArxivDailyDataDir !== "undefined") {
        var text = ArxivDailyDataDir.readFile(relativePath);
        return typeof text === "string" ? text : "";
      }
    } catch (e) {
      logError("profile read failed: " + relativePath + ": " + (e.message || e));
    }
    return "";
  }

  function writeFile(relativePath, content) {
    if (typeof ArxivDailyDataDir === "undefined") {
      throw new Error("Plugin data directory is not initialized");
    }
    if (!ArxivDailyDataDir.getBasePath || !ArxivDailyDataDir.getBasePath()) {
      ArxivDailyDataDir.init();
    }
    var ok = ArxivDailyDataDir.writeFile(relativePath, safeText(content));
    if (!ok) throw new Error("Failed to write " + relativePath);
    try {
      if (isReadinessProfileFile(relativePath) &&
          typeof ArxivDailyActions !== "undefined" &&
          typeof ArxivDailyActions.syncReadiness === "function") {
        ArxivDailyActions.syncReadiness();
      }
    } catch (e) {}
    return true;
  }

  async function writeFileAsync(relativePath, content) {
    if (typeof ArxivDailyDataDir === "undefined") {
      throw new Error("Plugin data directory is not initialized");
    }
    if (!ArxivDailyDataDir.getBasePath || !ArxivDailyDataDir.getBasePath()) {
      ArxivDailyDataDir.init();
    }
    if (typeof ArxivDailyDataDir.writeFileAsync === "function") {
      await ArxivDailyDataDir.writeFileAsync(relativePath, safeText(content));
    } else {
      writeFile(relativePath, content);
    }
    try {
      if (isReadinessProfileFile(relativePath) &&
          typeof ArxivDailyActions !== "undefined" &&
          typeof ArxivDailyActions.syncReadiness === "function") {
        ArxivDailyActions.syncReadiness();
      }
    } catch (e) {}
    return true;
  }

  function readLocalFile(file, maxBytes) {
    if (!file || !file.exists || !file.exists() || !file.isFile || !file.isFile()) return "";
    if (maxBytes && file.fileSize > maxBytes) return "";
    try {
      if (typeof Zotero !== "undefined" && Zotero.File && typeof Zotero.File.getContents === "function") {
        return Zotero.File.getContents(file) || "";
      }
    } catch (e) {}
    try {
      var fstream = Components.classes["@mozilla.org/network/file-input-stream;1"]
        .createInstance(Components.interfaces.nsIFileInputStream);
      var cstream = Components.classes["@mozilla.org/intl/converter-input-stream;1"]
        .createInstance(Components.interfaces.nsIConverterInputStream);
      fstream.init(file, 0x01, 0, 0);
      cstream.init(fstream, "UTF-8", 0, 0);
      var str = {};
      var out = "";
      while (cstream.readString(4096, str) !== 0 && out.length < (maxBytes || MAX_FILE_CHARS)) {
        out += str.value;
      }
      cstream.close();
      fstream.close();
      return out;
    } catch (err) {
      return "";
    }
  }

  function getValue(doc, id) {
    var el = doc.getElementById(id);
    return el ? el.value : "";
  }

  function setValue(doc, id, value) {
    var el = doc.getElementById(id);
    if (el) el.value = safeText(value);
  }

  function countTerms(text) {
    var cleaned = safeText(text).trim();
    if (!cleaned) return 0;
    var asciiWords = cleaned.match(/[A-Za-z0-9_]+/g) || [];
    var cjk = cleaned.match(/[\u3400-\u9fff]/g) || [];
    return asciiWords.length + cjk.length;
  }

  function parseLines(text) {
    return safeText(text).split(/\r?\n|,/).map(function (s) {
      return s.trim();
    }).filter(function (s) {
      return s;
    });
  }

  function uniqueList(list) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var item = safeText(list[i]).trim();
      if (!item || seen[item]) continue;
      seen[item] = true;
      out.push(item);
    }
    return out;
  }

  function updateCounts(doc) {
    var pairs = [
      ["profile-base", "count-base"],
      ["profile-feedback", "count-feedback"],
      ["profile-active", "count-active"],
    ];
    for (var i = 0; i < pairs.length; i++) {
      var el = doc.getElementById(pairs[i][0]);
      var counter = doc.getElementById(pairs[i][1]);
      if (el && counter) {
        counter.textContent = el.value.length + " chars, about " + countTerms(el.value) + " terms";
      }
    }
  }

  function getSelectedMode(doc) {
    return doc.body.getAttribute("data-build-mode") || "llm-zotero";
  }

  function getModeSpec(id) {
    for (var i = 0; i < BUILD_MODES.length; i++) {
      if (BUILD_MODES[i].id === id) return BUILD_MODES[i];
    }
    return BUILD_MODES[0];
  }

  function setSelectedMode(doc, modeId) {
    var spec = getModeSpec(modeId);
    doc.body.setAttribute("data-build-mode", spec.id);
    var modeLabel = doc.getElementById("profile-mode-label");
    if (modeLabel) modeLabel.textContent = spec.label;
    var modeHelp = doc.getElementById("profile-mode-help");
    if (modeHelp) modeHelp.textContent = spec.tooltip;
    var menu = doc.getElementById("profile-mode-menu");
    if (menu) {
      var items = menu.querySelectorAll("button[data-mode]");
      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle("is-selected", items[i].getAttribute("data-mode") === spec.id);
      }
    }
  }

  function setBuildButtonMode(doc, modeId) {
    var spec = getModeSpec(modeId);
    setSelectedMode(doc, spec.id);
    var build = doc.getElementById("profile-build-button");
    if (build) build.textContent = spec.id === "custom-library" ? "选择项目文件夹" : "生成画像";
  }

  function readProfileSnapshot() {
    var base = readFile(PROFILE_FILES.base);
    if (!base.trim()) base = readFile(PROFILE_FILES.legacy);
    return {
      base: base,
      feedback: readFile(PROFILE_FILES.feedback),
      active: readFile(PROFILE_FILES.active),
    };
  }

  function saveAll(doc) {
    writeFile(PROFILE_FILES.base, getValue(doc, "profile-base"));
    writeFile(PROFILE_FILES.feedback, getValue(doc, "profile-feedback"));
    writeFile(PROFILE_FILES.active, getValue(doc, "profile-active"));
    updateCounts(doc);
    markDirty(doc, false);
    updateStatus(doc, "已保存", "ari-ok");
    appendLog(doc, "Saved all profile files.");
  }

  function saveSingle(doc, kind) {
    var map = {
      base: ["profile-base", PROFILE_FILES.base, "基础画像"],
      feedback: ["profile-feedback", PROFILE_FILES.feedback, "猜你喜欢画像"],
      active: ["profile-active", PROFILE_FILES.active, "日报筛选画像"],
    };
    var spec = map[kind];
    if (!spec) return;
    writeFile(spec[1], getValue(doc, spec[0]));
    updateCounts(doc);
    updateStatus(doc, "已保存 " + spec[2], "ari-ok");
    markDirty(doc, false);
    appendLog(doc, "Saved " + spec[1] + ".");
  }

  function mergeFeedbackIntoBaseText(baseText, feedbackText, mode) {
    var base = safeText(baseText).trim();
    var feedback = safeText(feedbackText).trim();
    var date = new Date().toISOString().slice(0, 10);
    var baseFirst = mode !== "feedback-primary";
    var firstTitle = baseFirst ? "基础画像（主）" : "猜你喜欢画像（主）";
    var secondTitle = baseFirst ? "猜你喜欢画像（补充）" : "基础画像（补充）";
    var firstText = baseFirst ? base : feedback;
    var secondText = baseFirst ? feedback : base;
    return [
      "# 科研兴趣画像",
      "",
      "> " + date + " 由基础画像与猜你喜欢画像融合生成。" +
        (baseFirst ? " 融合策略：以基础画像为主，猜你喜欢作为近期偏好补充。" : " 融合策略：以猜你喜欢画像为主，基础画像作为长期背景约束。"),
      "",
      "## " + firstTitle,
      "",
      firstText || "(空)",
      "",
      "## " + secondTitle,
      "",
      secondText || "(空)",
      "",
    ].join("\n");
  }

  function applyFeedbackToBase(doc, dialog, mode) {
    var base = getValue(doc, "profile-base");
    var feedback = getValue(doc, "profile-feedback");
    if (!safeText(feedback).trim()) {
      dialog.alert("猜你喜欢画像为空，无法融合或覆盖基础画像。");
      return;
    }

    var actionText = mode === "overwrite"
      ? "用猜你喜欢画像覆盖基础画像"
      : (mode === "feedback-primary" ? "以猜你喜欢画像为主融合到基础画像" : "以基础画像为主融合猜你喜欢画像");
    if (!dialog.confirm(actionText + "。\n\n该操作会直接保存 research_interests.base.md。继续？")) {
      return;
    }

    var next = mode === "overwrite"
      ? safeText(feedback)
      : mergeFeedbackIntoBaseText(base, feedback, mode);

    setValue(doc, "profile-base", next);
    writeFile(PROFILE_FILES.base, next);
    updateCounts(doc);
    markDirty(doc, false);
    updateStatus(doc, "已更新基础画像", "ari-ok");
    appendLog(doc, actionText + " and saved " + PROFILE_FILES.base + ".");
  }

  function reloadProfiles(doc) {
    var snapshot = readProfileSnapshot();
    setValue(doc, "profile-base", snapshot.base);
    setValue(doc, "profile-feedback", snapshot.feedback);
    setValue(doc, "profile-active", snapshot.active);
    updateCounts(doc);
    markDirty(doc, false);
    updateStatus(doc, "已重新读取", "");
    updateProgress(doc, 0, "空闲");
    appendLog(doc, "Reloaded profile files.");
  }

  function itemToProfileText(item) {
    if (!item || !item.getField) return "";
    var title = item.getField("title") || "";
    if (!title) return "";
    var lines = ["- " + title];
    var creators = item.getCreators ? item.getCreators() : [];
    if (creators && creators.length) {
      var names = [];
      for (var i = 0; i < Math.min(creators.length, 6); i++) {
        var c = creators[i];
        names.push([c.firstName || "", c.lastName || ""].join(" ").trim() || c.name || "");
      }
      if (names.filter(Boolean).length) lines.push("  - Authors: " + names.filter(Boolean).join(", "));
    }
    var date = item.getField("date") || "";
    if (date) lines.push("  - Date: " + date);
    var publication = item.getField("publicationTitle") || "";
    if (publication) lines.push("  - Publication: " + publication);
    var abstractNote = item.getField("abstractNote") || "";
    if (abstractNote) lines.push("  - Abstract: " + abstractNote.slice(0, 1200));
    var tags = item.getTags ? item.getTags() : [];
    if (tags && tags.length) {
      var tagNames = tags.map(function (tag) { return tag.tag || ""; }).filter(Boolean);
      if (tagNames.length) lines.push("  - Tags: " + tagNames.join(", "));
    }
    return lines.join("\n");
  }

  async function getItemAsync(id) {
    var item = null;
    if (Zotero.Items && typeof Zotero.Items.getAsync === "function") {
      item = await Zotero.Items.getAsync(id);
    }
    if (!item && Zotero.Items && typeof Zotero.Items.get === "function") {
      item = Zotero.Items.get(id);
    }
    return item;
  }

  function itemKey(item) {
    if (!item) return "";
    return item.id || item.itemID || item.key || item.libraryKey || "";
  }

  function isProfileSourceItem(item) {
    if (!item || !item.getField) return false;
    try {
      if (typeof item.isRegularItem === "function" && !item.isRegularItem()) return false;
    } catch (e) {}
    try {
      var extra = safeText(item.getField("extra"));
      if (/arXiv Interest Daily:\s*project-paper/i.test(extra)) return false;
      var tags = item.getTags ? item.getTags() : [];
      for (var t = 0; tags && t < tags.length; t++) {
        if (safeText(tags[t].tag).toLowerCase() === "arxiv-interest-daily-project-paper") {
          return false;
        }
      }
    } catch (markerErr) {}
    try {
      var typeName = item.itemType || "";
      if (!typeName && item.itemTypeID && Zotero.ItemTypes && Zotero.ItemTypes.getName) {
        typeName = Zotero.ItemTypes.getName(item.itemTypeID) || "";
      }
      if (/^(attachment|note|annotation)$/i.test(typeName)) return false;
    } catch (e2) {}
    return !!safeText(item.getField("title")).trim();
  }

  async function addProfileItem(value, items, seen) {
    var item = value && typeof value === "object" ? value : await getItemAsync(value);
    if (!isProfileSourceItem(item)) return;
    var key = itemKey(item) || safeText(item.getField("title"));
    if (seen[key]) return;
    seen[key] = true;
    items.push(item);
  }

  async function collectZoteroLibraryItems(limit, onProgress) {
    var libraryID = getUserLibraryID();
    var ids = [];
    var items = [];
    var seen = {};
    if (Zotero.Items && typeof Zotero.Items.getAll === "function") {
      var all = await Zotero.Items.getAll(libraryID);
      if (Array.isArray(all)) {
        if (all.length && typeof all[0] === "object") {
          for (var ai = 0; ai < all.length && items.length < limit; ai++) {
            await addProfileItem(all[ai], items, seen);
          }
          return items;
        }
        ids = all;
      }
    }
    if (!ids.length && Zotero.Items && typeof Zotero.Items.getAllIDs === "function") {
      ids = await Zotero.Items.getAllIDs(libraryID);
    }
    ids = ids || [];
    for (var i = 0; i < ids.length && items.length < limit; i++) {
      if (onProgress && i % 20 === 0) onProgress("Reading Zotero library " + i + "/" + ids.length, Math.min(35, Math.floor(i / Math.max(1, ids.length) * 35)));
      await addProfileItem(ids[i], items, seen);
    }
    return items;
  }

  function buildSourceText(items, sourceLabel) {
    var lines = ["# Source: " + sourceLabel, ""];
    var count = 0;
    for (var i = 0; i < items.length; i++) {
      var text = itemToProfileText(items[i]);
      if (!text) continue;
      lines.push(text);
      lines.push("");
      count++;
    }
    return { text: lines.join("\n"), count: count };
  }

  function projectPaperToProfileText(paper) {
    if (!paper) return "";
    var title = safeText(paper.title || paper.name).trim();
    var arxivId = safeText(paper.arxivId || paper.id || paper.paperId).trim();
    if (!title && !arxivId) return "";
    var lines = ["- " + (title || arxivId)];
    if (arxivId) lines.push("  - arXiv: " + arxivId);
    var authors = paper.authors || paper.author || "";
    if (Array.isArray(authors)) authors = authors.join(", ");
    if (authors) lines.push("  - Authors: " + safeText(authors));
    var categories = paper.categories || paper.primaryCategory || paper.category || "";
    if (Array.isArray(categories)) categories = categories.join(", ");
    if (categories) lines.push("  - Categories: " + safeText(categories));
    var date = paper.date || paper.published || paper.updated || paper.addedAt || "";
    if (date) lines.push("  - Date: " + safeText(date));
    var abstractText = paper.abstract || paper.summary || paper.recommendation || paper.reason || "";
    if (abstractText) lines.push("  - Abstract/Notes: " + safeText(abstractText).slice(0, 1200));
    return lines.join("\n");
  }

  function collectProjectPaperItems(limit) {
    var index = [];
    try {
      if (typeof ArxivDailyDataDir !== "undefined") {
        index = ArxivDailyDataDir.readJSON("project-papers/index.json") || [];
      }
    } catch (e) {}
    if (!Array.isArray(index)) index = [];
    return index.slice(0, limit || MAX_LIBRARY_ITEMS);
  }

  function buildProjectPapersSource() {
    var papers = collectProjectPaperItems(MAX_LIBRARY_ITEMS);
    var lines = ["# Source: 每日 arXiv 项目论文库", ""];
    var count = 0;
    for (var i = 0; i < papers.length; i++) {
      var text = projectPaperToProfileText(papers[i]);
      if (!text) continue;
      lines.push(text);
      lines.push("");
      count++;
    }
    return {
      text: lines.join("\n"),
      count: count,
      label: "每日 arXiv 项目论文库",
    };
  }

  function mergeSources(primary, extra, label) {
    primary = primary || { text: "", count: 0, label: "" };
    if (!extra || !extra.text || !extra.count) return primary;
    return {
      text: [primary.text || "", "", "---", "", extra.text || ""].join("\n"),
      count: (primary.count || 0) + (extra.count || 0),
      label: label || ((primary.label || "来源") + " + " + (extra.label || "额外来源")),
    };
  }

  function includeProjectPapers(doc) {
    var checkbox = doc.getElementById("profile-include-project-papers");
    return !!(checkbox && checkbox.checked);
  }

  function includeZoteroLibrary(doc) {
    var checkbox = doc.getElementById("profile-include-zotero-library");
    return !checkbox || checkbox.checked;
  }

  function isIgnoredProjectDir(name) {
    return /^(node_modules|\.git|\.svn|\.hg|__pycache__|\.venv|venv|env|dist|build|target|out|\.idea|\.vscode|\.pytest_cache|\.mypy_cache|site-packages)$/i.test(name || "");
  }

  function isTextLikeFile(name) {
    var lower = String(name || "").toLowerCase();
    if (/(\.md|\.markdown|\.txt|\.tex|\.bib|\.rst|\.org|\.csv|\.tsv|\.json|\.jsonl|\.yaml|\.yml|\.toml|\.ini|\.cfg|\.conf|\.py|\.ipynb|\.js|\.ts|\.jsx|\.tsx|\.java|\.c|\.cc|\.cpp|\.h|\.hpp|\.cs|\.go|\.rs|\.m|\.mm|\.jl|\.r|\.sh|\.bat|\.ps1|\.html|\.css|\.xml|\.svg)$/i.test(lower)) return true;
    return /^(readme|license|changelog|notes|todo|requirements|environment|makefile|dockerfile)(\..*)?$/i.test(lower);
  }

  function fileMetaLine(file, relPath, reason) {
    var size = 0;
    try { size = file.fileSize || 0; } catch (e) {}
    return "- " + relPath + " (" + Math.round(size / 1024) + " KB" + (reason ? ", " + reason : "") + ")";
  }

  function cloneFile(file) {
    try { return file.clone(); } catch (e) { return null; }
  }

  function collectProjectFiles(root, onProgress) {
    var files = [];
    var skipped = [];
    var queue = [{ dir: root, rel: "" }];
    while (queue.length && files.length < MAX_PROJECT_FILES) {
      var current = queue.shift();
      var entries = null;
      try { entries = current.dir.directoryEntries; } catch (e) { continue; }
      while (entries && entries.hasMoreElements && entries.hasMoreElements() && files.length < MAX_PROJECT_FILES) {
        var entry = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
        var name = entry.leafName || "";
        var rel = current.rel ? current.rel + "/" + name : name;
        if (entry.isDirectory && entry.isDirectory()) {
          if (isIgnoredProjectDir(name)) {
            skipped.push(fileMetaLine(entry, rel, "ignored directory"));
          } else {
            queue.push({ dir: entry, rel: rel });
          }
        } else if (entry.isFile && entry.isFile()) {
          files.push({ file: cloneFile(entry), rel: rel });
          if (onProgress && files.length % 20 === 0) {
            onProgress("Reading project folder " + files.length + " files", Math.min(35, 10 + files.length));
          }
        }
      }
    }
    return { files: files, skipped: skipped };
  }

  function projectFolderToSource(folder, onProgress) {
    var root = folder && folder.exists && folder.exists() && folder.isDirectory && folder.isDirectory() ? folder : null;
    if (!root) throw new Error("Selected path is not a folder");
    var scanned = collectProjectFiles(root, onProgress);
    var lines = [
      "# Source: 用户自定义项目文件夹",
      "",
      "Folder: " + root.path,
      "",
      "The folder may contain the user's own research project, drafts, notes, code, data descriptions, and configuration files. Use file contents and file names as evidence of actual research interests.",
      "",
    ];
    var count = 0;
    var textChars = 0;
    var binaryLines = [];
    for (var i = 0; i < scanned.files.length; i++) {
      var rec = scanned.files[i];
      if (!rec.file) continue;
      if (isTextLikeFile(rec.rel) && rec.file.fileSize <= MAX_TEXT_FILE_BYTES && textChars < MAX_PROJECT_TEXT_CHARS) {
        var content = readLocalFile(rec.file, MAX_TEXT_FILE_BYTES);
        if (content && content.trim()) {
          var slice = content.slice(0, Math.min(MAX_FILE_CHARS, MAX_PROJECT_TEXT_CHARS - textChars));
          lines.push("## File: " + rec.rel);
          lines.push("");
          lines.push(slice);
          lines.push("");
          textChars += slice.length;
          count++;
          continue;
        }
      }
      binaryLines.push(fileMetaLine(rec.file, rec.rel, isTextLikeFile(rec.rel) ? "not readable or too large" : "non-text project artifact"));
      count++;
    }
    if (binaryLines.length) {
      lines.push("## Non-text or large project artifacts");
      lines.push("");
      lines.push(binaryLines.slice(0, 80).join("\n"));
      lines.push("");
    }
    if (scanned.skipped.length) {
      lines.push("## Skipped directories");
      lines.push("");
      lines.push(scanned.skipped.slice(0, 40).join("\n"));
      lines.push("");
    }
    return {
      text: lines.join("\n"),
      count: count,
      label: "自定义项目文件夹: " + root.path,
    };
  }

  function getProfileForSuggestion(doc, source) {
    var base = getValue(doc, "profile-base");
    var feedback = getValue(doc, "profile-feedback");
    var active = getValue(doc, "profile-active");
    if (source === "base") return base;
    if (source === "feedback") return feedback;
    if (source === "active") return active;
    return [
      base ? "Base research profile:\n" + base : "",
      feedback ? "Feedback / guess-you-like profile:\n" + feedback : "",
      active ? "Daily screening profile:\n" + active : "",
    ].filter(Boolean).join("\n\n");
  }

  function buildCategorySuggestionPrompt(profileText, sourceLabel) {
    return [
      "Suggest arXiv categories for a Zotero daily arXiv screening plugin.",
      "Return only JSON with this shape:",
      "{\"coreCategories\":[\"cond-mat.supr-con\"],\"crossCategories\":[\"quant-ph\"],\"reason\":\"short reason\"}",
      "Use valid arXiv category codes. Put central daily-feed categories in coreCategories.",
      "Put adjacent exploratory categories in crossCategories.",
      "",
      "Profile source: " + sourceLabel,
      "",
      profileText || "(No research profile provided)",
    ].join("\n");
  }

  function parseCategorySuggestion(text) {
    var raw = safeText(text);
    var match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("LLM response did not contain JSON");
    var parsed = JSON.parse(match[0]);
    var core = parsed.coreCategories || parsed.core_categories || parsed.categories || [];
    var cross = parsed.crossCategories || parsed.cross_categories || [];
    if (typeof core === "string") core = parseLines(core);
    if (typeof cross === "string") cross = parseLines(cross);
    return {
      coreCategories: uniqueList(core),
      crossCategories: uniqueList(cross),
      reason: safeText(parsed.reason || parsed.rationale || ""),
    };
  }

  function renderCategorySuggestion(doc, suggestion) {
    var box = doc.getElementById("profile-category-suggestion-result");
    if (!box) return;
    box.textContent = [
      "核心分区: " + ((suggestion.coreCategories || []).join(", ") || "(无)"),
      "交叉分区: " + ((suggestion.crossCategories || []).join(", ") || "(无)"),
      suggestion.reason ? "理由: " + suggestion.reason : "",
    ].filter(Boolean).join("\n");
  }

  function setCategorySource(doc, source) {
    doc.body.setAttribute("data-category-source", source || "active");
    var buttons = doc.querySelectorAll("button[data-category-source-option]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("is-selected", buttons[i].getAttribute("data-category-source-option") === (source || "active"));
    }
  }

  function applyCategorySuggestion(doc, suggestion, mode) {
    if (typeof ArxivDailyConfig === "undefined") throw new Error("Config module is not loaded");
    var core = suggestion.coreCategories || [];
    var cross = suggestion.crossCategories || [];
    if (mode === "append") {
      core = uniqueList((ArxivDailyConfig.get("arxiv.coreCategories") || []).concat(core));
      cross = uniqueList((ArxivDailyConfig.get("arxiv.crossCategories") || []).concat(cross));
    }
    ArxivDailyConfig.set("arxiv.coreCategories", uniqueList(core));
    ArxivDailyConfig.set("arxiv.crossCategories", uniqueList(cross));
    ArxivDailyConfig.save();
    updateStatus(doc, mode === "append" ? "已叠加建议分区" : "已覆盖建议分区", "ari-ok");
    appendLog(doc, "Saved arXiv categories: core=" + uniqueList(core).join(", ") + "; cross=" + uniqueList(cross).join(", "));
  }

  async function suggestArxivCategories(doc, dialog, button) {
    var source = doc.body.getAttribute("data-category-source") || "active";
    var labels = {
      base: "基础科研兴趣画像",
      feedback: "猜你喜欢科研兴趣画像",
      active: "日报筛选画像",
      all: "全部画像",
    };
    var profileText = getProfileForSuggestion(doc, source).trim();
    var box = doc.getElementById("profile-category-suggestion-result");
    if (!profileText) {
      if (box) box.textContent = "当前选择的画像为空。";
      return;
    }
    if (!dialog.confirm("生成 arXiv 建议分区需要调用 LLM，会消耗 API token。\n\n继续？")) return;
    if (typeof ArxivDailyLLM === "undefined" || !ArxivDailyLLM.isConfigured()) {
      if (box) box.textContent = "LLM 尚未配置，无法生成建议分区。";
      return;
    }
    button.disabled = true;
    if (box) box.textContent = "正在请求 LLM 生成建议分区...";
    try {
      var response = await ArxivDailyLLM.complete(
        "You are an expert arXiv taxonomy assistant. Return strict JSON only.",
        buildCategorySuggestionPrompt(profileText, labels[source] || source),
        null
      );
      var suggestion = parseCategorySuggestion(response);
      doc.body.__arxivCategorySuggestion = suggestion;
      renderCategorySuggestion(doc, suggestion);
      var applyButtons = doc.querySelectorAll("button[data-category-apply]");
      for (var i = 0; i < applyButtons.length; i++) applyButtons[i].disabled = false;
    } catch (err) {
      if (box) box.textContent = "生成建议分区失败: " + (err.message || String(err));
    } finally {
      button.disabled = false;
    }
  }

  function localProfileFromSource(source, label) {
    var text = source.text || "";
    var tagCounts = {};
    var keywordCounts = {};
    var tagRegex = /Tags:\s*([^\n]+)/g;
    var m;
    while ((m = tagRegex.exec(text))) {
      var tags = m[1].split(",");
      for (var i = 0; i < tags.length; i++) {
        var tag = tags[i].trim();
        if (tag) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    var words = text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || [];
    var stop = {
      "from": true, "with": true, "that": true, "this": true, "have": true,
      "paper": true, "papers": true, "using": true, "source": true, "file": true,
      "files": true, "abstract": true, "authors": true, "date": true,
    };
    for (var wi = 0; wi < words.length; wi++) {
      if (!stop[words[wi]]) keywordCounts[words[wi]] = (keywordCounts[words[wi]] || 0) + 1;
    }
    var sortedTags = Object.keys(tagCounts).sort(function (a, b) { return tagCounts[b] - tagCounts[a]; }).slice(0, 25);
    var sortedKeywords = Object.keys(keywordCounts).sort(function (a, b) { return keywordCounts[b] - keywordCounts[a]; }).slice(0, 30);
    return [
      "# Research Interests",
      "",
      "> Generated locally from " + label + ".",
      "",
      "## Source Summary",
      "",
      "- Papers scanned: " + source.count,
      "- Source: " + label,
      "",
      "## Frequent Tags",
      "",
      sortedTags.length ? sortedTags.map(function (tag) { return "- " + tag + " (" + tagCounts[tag] + ")"; }).join("\n") : "- No Zotero tags found.",
      "",
      "## Frequent Keywords",
      "",
      sortedKeywords.length ? sortedKeywords.map(function (word) { return "- " + word + " (" + keywordCounts[word] + ")"; }).join("\n") : "- No frequent keywords found.",
      "",
      "## Evidence Notes",
      "",
      text.slice(0, 12000),
    ].join("\n");
  }

  async function synthesizeProfile(source, mode, token, onProgress) {
    if (mode === "import-md") {
      onProgress("Importing Markdown profile", 70);
      return source.text || "";
    }

    if (mode === "local-zotero") {
      onProgress("Local profile synthesis", 70);
      return localProfileFromSource(source, source.label);
    }

    if (typeof ArxivDailyLLM === "undefined" || !ArxivDailyLLM.isConfigured()) {
      throw new Error("LLM not configured. Please configure API key and model, or choose a non-LLM mode.");
    }
    onProgress("LLM profile synthesis", 55);
    var prompt = typeof ArxivDailyPrompts !== "undefined" && ArxivDailyPrompts.profileBuildPrompt
      ? ArxivDailyPrompts.profileBuildPrompt(source.text)
      : "Build a Markdown research interest profile from these Zotero papers:\n\n" + source.text;
    return await ArxivDailyLLM.complete(
      "You build concise research interest profiles for daily arXiv screening. Return Markdown only.",
      prompt,
      token
    );
  }

  function runProfileTask(doc, label, mode, sourceFactory) {
    if (isBusy(doc)) return;
    if (typeof ArxivDailyTaskManager === "undefined") {
      doc.defaultView.alert("任务管理器未加载，无法启动画像生成。");
      return;
    }

    setBusy(doc, true);
    updateStatus(doc, "生成中", "ari-warning");
    updateProgress(doc, 3, "任务已加入统一进度框");
    appendLog(doc, "Started profile task: " + label + ". Progress is recorded in the unified task panel.");

    ArxivDailyTaskManager.start("buildProfile", label, async function (token, onProgress) {
      try {
        onProgress("Collecting source papers", 8);
        if (!doc.defaultView.closed) doc.defaultView.setTimeout(function () { updateProgress(doc, 8, "收集来源文献"); }, 0);
        var source = await sourceFactory(token, onProgress);
        if (!source || !source.text || !source.count) throw new Error("No usable source papers found");
        if (token.cancelled) return;

        onProgress("Building research profile", 45);
        if (!doc.defaultView.closed) doc.defaultView.setTimeout(function () { updateProgress(doc, 45, "生成画像内容"); }, 0);
        var profile = await synthesizeProfile(source, mode, token, onProgress);
        if (token.cancelled) return;

        onProgress("Saving base research profile", 88);
        await writeFileAsync(PROFILE_FILES.base, profile || "");

        if (!doc.defaultView.closed) {
          doc.defaultView.setTimeout(function () {
            setValue(doc, "profile-base", profile || "");
            updateCounts(doc);
            markDirty(doc, false);
            updateProgress(doc, 100, "画像生成完成");
            updateStatus(doc, "生成完成", "ari-ok");
            appendLog(doc, "Profile generated from " + source.label + " and saved to " + PROFILE_FILES.base + ".");
            setBusy(doc, false);
          }, 0);
        }
        onProgress("Complete", 100);
      } catch (err) {
        if (!doc.defaultView.closed) {
          doc.defaultView.setTimeout(function () {
            updateProgress(doc, 100, "画像生成失败");
            updateStatus(doc, "生成失败", "ari-error");
            appendLog(doc, "Profile generation failed: " + (err && err.message ? err.message : String(err)));
            setBusy(doc, false);
          }, 0);
        }
        throw err;
      }
    });
  }

  function buildFromZoteroLibrary(doc, mode) {
    var win = doc.defaultView;
    if (mode === "llm-zotero" && win && !win.confirm("LLM 辅助合成会读取 Zotero 文献库摘要并调用已配置的模型，可能消耗 API token。\n\n继续生成画像？")) {
      return;
    }
    var includeProject = includeProjectPapers(doc);
    var label = mode === "local-zotero" ? "本地合成 Zotero 文献库画像" : "LLM 辅助 Zotero 文献库画像";
    if (includeProject) label += "（含项目论文库）";
    runProfileTask(doc, label, mode, async function (token, onProgress) {
      var items = await collectZoteroLibraryItems(MAX_LIBRARY_ITEMS, onProgress);
      var source = buildSourceText(items, "Zotero 普通文献库");
      source.label = "Zotero 普通文献库";
      if (includeProject) {
        onProgress("Reading project paper library", 36);
        source = mergeSources(source, buildProjectPapersSource(), "Zotero 普通文献库 + 每日 arXiv 项目论文库");
      }
      return source;
    });
  }

  async function chooseProjectFolder(dialog) {
    var picker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
    initFilePicker(picker, dialog, "选择自定义文献库 / 项目文件夹", Components.interfaces.nsIFilePicker.modeGetFolder);
    var rv = await showFilePicker(picker);
    if (rv !== Components.interfaces.nsIFilePicker.returnOK) return null;
    return picker.file;
  }

  async function buildFromProjectPapers(doc, dialog) {
    var source = buildProjectPapersSource();
    if (!source.count) {
      dialog.alert("项目论文库目前为空。它保存在插件数据目录的 project-papers/index.json，不会和 Zotero 普通文献库混在一起。");
      return;
    }
    var useZotero = includeZoteroLibrary(doc);
    var confirmText = useZotero
      ? "将同时使用 Zotero 普通文献库和每日 arXiv 项目论文库生成画像。项目论文库独立保存在插件数据目录中，不会自动并入 Zotero 普通文献库。\n\n继续？"
      : "将只使用每日 arXiv 项目论文库生成画像。该库独立保存在插件数据目录中，不会自动并入 Zotero 普通文献库。\n\n继续？";
    if (!dialog.confirm(confirmText)) {
      return;
    }
    runProfileTask(doc, useZotero ? "本地合成 Zotero 文献库 + 项目论文库画像" : "本地合成项目论文库画像", "local-zotero", async function (token, onProgress) {
      if (useZotero) {
        onProgress("Reading Zotero library", 18);
        var items = await collectZoteroLibraryItems(MAX_LIBRARY_ITEMS, onProgress);
        var zoteroSource = buildSourceText(items, "Zotero 普通文献库");
        zoteroSource.label = "Zotero 普通文献库";
        source = mergeSources(zoteroSource, source, "Zotero 普通文献库 + 每日 arXiv 项目论文库");
      }
      return source;
    });
  }

  async function buildFromProjectFolder(doc, dialog) {
    try {
      if (!dialog.confirm("自定义文献库会选择 Zotero 之外的本地项目文件夹，并默认调用 LLM 理解其中的草稿、笔记、代码、配置和文件结构。\n\n这会消耗 API token。继续选择文件夹？")) {
        return;
      }
      var folder = await chooseProjectFolder(dialog);
      if (!folder) return;
      var useZotero = includeZoteroLibrary(doc);
      var useProject = includeProjectPapers(doc);
      var extras = [];
      if (useZotero) extras.push("Zotero 文献库");
      if (useProject) extras.push("项目论文库");
      var label = "LLM 辅助自定义项目文件夹画像" + (extras.length ? "（含" + extras.join(" + ") + "）" : "");
      runProfileTask(doc, label, "custom-library", async function (token, onProgress) {
        onProgress("Reading custom project folder", 12);
        var source = projectFolderToSource(folder, onProgress);
        if (useZotero) {
          onProgress("Reading Zotero library", 28);
          var items = await collectZoteroLibraryItems(MAX_LIBRARY_ITEMS, onProgress);
          var zoteroSource = buildSourceText(items, "Zotero 普通文献库");
          zoteroSource.label = "Zotero 普通文献库";
          source = mergeSources(source, zoteroSource, "自定义项目文件夹 + Zotero 普通文献库");
        }
        if (useProject) {
          onProgress("Reading project paper library", 36);
          source = mergeSources(source, buildProjectPapersSource(), source.label + " + 每日 arXiv 项目论文库");
        }
        return source;
      });
    } catch (err) {
      dialog.alert("读取自定义项目文件夹失败:\n" + (err.message || err));
    }
  }

  async function importMarkdown(doc, dialog) {
    try {
      var picker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
      initFilePicker(picker, dialog, "导入科研兴趣画像 Markdown", Components.interfaces.nsIFilePicker.modeOpen);
      picker.appendFilter("Markdown", "*.md");
      picker.appendFilters(Components.interfaces.nsIFilePicker.filterAll);
      var rv = await showFilePicker(picker);
      if (rv !== Components.interfaces.nsIFilePicker.returnOK) return;
      var file = picker.file;
      var text = Zotero.File.getContents(file);
      runProfileTask(doc, "导入 MD 科研兴趣画像", "import-md", async function () {
        return { text: text || "", count: 1, label: "Markdown 文件: " + file.leafName };
      });
    } catch (err) {
      dialog.alert("导入 MD 文件失败:\n" + (err.message || err));
    }
  }

  async function runSelectedMode(doc, dialog) {
    var mode = getSelectedMode(doc);
    if (mode === "llm-zotero" || mode === "local-zotero") {
      buildFromZoteroLibrary(doc, mode);
    } else if (mode === "custom-library") {
      await buildFromProjectFolder(doc, dialog);
    } else if (mode === "project-papers") {
      await buildFromProjectPapers(doc, dialog);
    } else if (mode === "import-md") {
      await importMarkdown(doc, dialog);
    }
  }

  function makeActionButton(doc, label, tooltip, handler) {
    var btn = createEl(doc, "button", "ari-btn", label);
    btn.type = "button";
    btn.setAttribute("data-profile-action", "true");
    setTooltip(btn, tooltip);
    btn.addEventListener("click", handler);
    return btn;
  }

  function makeEditorPanel(doc, id, title, fileName, description, placeholder, tooltip, wide) {
    var panel = createEl(doc, "section", "ari-panel" + (wide ? " is-wide" : ""));
    panel.setAttribute("data-profile-panel", id);
    var head = createEl(doc, "div", "ari-panel-head");
    var titleWrap = createEl(doc, "div", "ari-panel-title");
    titleWrap.appendChild(createEl(doc, "div", null, title));
    titleWrap.appendChild(createEl(doc, "div", "ari-panel-desc", description));
    head.appendChild(titleWrap);
    head.appendChild(createEl(doc, "div", "ari-file", fileName));
    var save = createEl(doc, "button", "ari-mini-btn", "保存");
    save.type = "button";
    save.setAttribute("data-save-kind", id.replace("profile-", ""));
    setTooltip(save, tooltip);
    head.appendChild(save);
    panel.appendChild(head);

    var editor = createEl(doc, "textarea", "ari-editor");
    editor.id = id;
    editor.placeholder = placeholder || "";
    editor.spellcheck = false;
    editor.addEventListener("input", function () {
      updateCounts(doc);
      markDirty(doc, true);
      updateStatus(doc, "有未保存修改", "ari-warning");
    });
    panel.appendChild(editor);

    var footer = createEl(doc, "div", "ari-footer");
    var count = createEl(doc, "span");
    count.id = "count-" + id.replace("profile-", "");
    footer.appendChild(count);
    panel.appendChild(footer);
    return panel;
  }

  function addFeedbackBaseActions(doc, panel, dialog) {
    if (!panel) return;
    var footer = panel.querySelector(".ari-footer");
    if (!footer) return;
    var actions = createEl(doc, "div", "ari-feedback-actions");

    var mergeBase = createEl(doc, "button", "ari-mini-btn", "融合到基础（基础为主）");
    mergeBase.type = "button";
    setTooltip(mergeBase, "把猜你喜欢画像作为近期偏好补充到基础画像中，基础画像的长期方向保持主导。");
    mergeBase.addEventListener("click", function () {
      applyFeedbackToBase(doc, dialog, "base-primary");
    });

    var mergeFeedback = createEl(doc, "button", "ari-mini-btn", "融合到基础（猜你喜欢为主）");
    mergeFeedback.type = "button";
    setTooltip(mergeFeedback, "把猜你喜欢画像作为主导偏好写入基础画像，基础画像作为长期背景约束保留。");
    mergeFeedback.addEventListener("click", function () {
      applyFeedbackToBase(doc, dialog, "feedback-primary");
    });

    var overwrite = createEl(doc, "button", "ari-mini-btn", "覆盖基础");
    overwrite.type = "button";
    setTooltip(overwrite, "用猜你喜欢画像直接覆盖基础画像。会弹出确认，并立即保存基础画像。");
    overwrite.addEventListener("click", function () {
      applyFeedbackToBase(doc, dialog, "overwrite");
    });

    actions.appendChild(mergeBase);
    actions.appendChild(mergeFeedback);
    actions.appendChild(overwrite);
    footer.appendChild(actions);
  }

  function makeCategorySuggestionPanel(doc, dialog) {
    var panel = createEl(doc, "section", "ari-workflow");
    var head = createEl(doc, "div", "ari-workflow-head");
    head.appendChild(createEl(doc, "div", "ari-workflow-title", "建议 arXiv 分区"));
    panel.appendChild(head);

    var sourceRow = createEl(doc, "div", "ari-choice-row");
    sourceRow.id = "profile-category-source";
    [
      ["base", "基础画像"],
      ["feedback", "猜你喜欢画像"],
      ["all", "全部画像"],
      ["active", "日报筛选画像（旧版兜底）"],
    ].forEach(function (option) {
      var opt = createEl(doc, "button", null, option[1]);
      opt.type = "button";
      opt.setAttribute("data-category-source-option", option[0]);
      opt.title = "用" + option[1] + "生成建议 arXiv 分区";
      opt.addEventListener("click", function () {
        setCategorySource(doc, option[0]);
      });
      sourceRow.appendChild(opt);
    });
    panel.appendChild(sourceRow);
    setCategorySource(doc, "base");

    panel.appendChild(createEl(doc, "div", "ari-help", "选择用哪个画像生成建议分区。默认使用基础画像；建议结果可覆盖当前配置，也可叠加到当前配置并自动去重；你也可以在“设置”中自行修改 arXiv 分区。"));

    var result = createEl(doc, "div", "ari-suggestion-box", "尚未生成建议。");
    result.id = "profile-category-suggestion-result";
    panel.appendChild(result);

    var actions = createEl(doc, "div", "ari-actions");
    actions.style.marginTop = "8px";
    var suggest = createEl(doc, "button", "ari-mini-btn", "生成建议");
    suggest.type = "button";
    suggest.addEventListener("click", function () {
      suggestArxivCategories(doc, dialog, suggest);
    });
    var overwrite = createEl(doc, "button", "ari-mini-btn", "覆盖");
    overwrite.type = "button";
    overwrite.disabled = true;
    overwrite.setAttribute("data-category-apply", "overwrite");
    overwrite.title = "用建议分区覆盖当前 arXiv 核心/交叉分区配置。";
    overwrite.addEventListener("click", function () {
      var suggestion = doc.body.__arxivCategorySuggestion;
      if (!suggestion) return;
      if (dialog.confirm("用建议分区覆盖当前 arXiv 分区配置？")) applyCategorySuggestion(doc, suggestion, "overwrite");
    });
    var append = createEl(doc, "button", "ari-mini-btn", "叠加");
    append.type = "button";
    append.disabled = true;
    append.setAttribute("data-category-apply", "append");
    append.title = "将建议分区叠加到当前配置；重复分区不会重复写入。";
    append.addEventListener("click", function () {
      var suggestion = doc.body.__arxivCategorySuggestion;
      if (!suggestion) return;
      applyCategorySuggestion(doc, suggestion, "append");
    });
    actions.appendChild(suggest);
    actions.appendChild(overwrite);
    actions.appendChild(append);
    panel.appendChild(actions);
    return panel;
  }

  function buildModeMenu(doc) {
    var menu = createEl(doc, "div", "ari-menu");
    menu.id = "profile-mode-menu";
    menu.hidden = true;
    for (var i = 0; i < BUILD_MODES.length; i++) {
      var spec = BUILD_MODES[i];
      var item = createEl(doc, "button", null, spec.label);
      item.type = "button";
      item.setAttribute("data-mode", spec.id);
      setTooltip(item, spec.tooltip);
      item.addEventListener("click", function () {
        var mode = this.getAttribute("data-mode");
        setBuildButtonMode(doc, mode);
        menu.hidden = true;
        var dialog = doc.defaultView;
        if (mode === "custom-library") {
          updateStatus(doc, "已选择自定义文献库模式，请确认下方来源勾选后再点击“选择项目文件夹”。", "ari-warning");
          appendLog(doc, "Selected custom project folder mode. Waiting for explicit build click.");
          return;
        }
        runSelectedMode(doc, dialog).catch(function (err) {
          dialog.alert("画像生成入口执行失败:\n" + (err.message || err));
        });
      });
      menu.appendChild(item);
    }
    doc.body.appendChild(menu);
    return menu;
  }

  function maybeClose(dialog, doc) {
    if (isBusy(doc)) {
      if (!dialog.confirm("画像生成任务正在运行。关闭窗口不会停止后台任务；之后可以从任务进度框查看。\n\n仍然关闭？")) return;
    } else if (isDirty(doc)) {
      if (!dialog.confirm("还有未保存的画像修改。关闭后这些修改会丢失。\n\n仍然关闭？")) return;
    }
    dialog.close();
  }

  function buildWindow(dialog, args) {
    var doc = resetDocument(dialog);
    installStyles(doc);

    var root = createEl(doc, "main", "ari-profile");
    var head = createEl(doc, "div", "ari-head");
    head.appendChild(createTitle(doc, "科研兴趣画像"));
    var headActions = createEl(doc, "div", "ari-actions");
    var status = createEl(doc, "div", "ari-status");
    status.id = "profile-save-status";
    headActions.appendChild(status);
    headActions.appendChild(makeActionButton(doc, "全部保存", "保存基础画像、猜你喜欢画像和日报筛选画像。", function () {
      try { saveAll(doc); } catch (e) { updateStatus(doc, "保存失败", "ari-error"); dialog.alert(e.message || String(e)); }
    }));
    headActions.appendChild(makeActionButton(doc, "重新读取", "从插件数据目录重新读取画像文件，会覆盖未保存修改。", function () {
      if (!isDirty(doc) || dialog.confirm("重新读取会覆盖窗口内未保存修改。继续？")) reloadProfiles(doc);
    }));
    headActions.appendChild(makeActionButton(doc, "任务进度", "打开统一任务进度框，查看所有后台任务。", function () {
      if (typeof ArxivDailyActions !== "undefined" && ArxivDailyActions.openProgressPanel) ArxivDailyActions.openProgressPanel();
    }));
    headActions.appendChild(makeActionButton(doc, "关闭", "关闭窗口；有任务或未保存修改时会提醒。", function () {
      maybeClose(dialog, doc);
    }));
    head.appendChild(headActions);
    root.appendChild(head);

    var body = createEl(doc, "div", "ari-body");
    var note = createEl(doc, "div", "ari-note");
    note.appendChild(createEl(doc, "strong", null, "默认从 Zotero 普通文献库生成画像。"));
    note.appendChild(doc.createTextNode(" 生成或导入的结果会写入 research_interests.base.md。日报生成默认使用基础画像做论文相关性筛选；猜你喜欢画像只是近期反馈材料，只有点击融合或覆盖后才会影响基础画像。research_interests.active.md 仅作为旧版/手动兜底。"));
    body.appendChild(note);

    var workflowGrid = createEl(doc, "div", "ari-workflow-grid");
    var workflow = createEl(doc, "section", "ari-workflow");
    var workflowHead = createEl(doc, "div", "ari-workflow-head");
    workflowHead.appendChild(createEl(doc, "div", "ari-workflow-title", "生成画像"));
    var modeLabel = createEl(doc, "div", "ari-mode");
    modeLabel.id = "profile-mode-label";
    workflowHead.appendChild(modeLabel);
    workflow.appendChild(workflowHead);

    var progress = createEl(doc, "div", "ari-progress-line");
    var progressFill = createEl(doc, "div", "ari-progress-fill");
    progressFill.id = "profile-progress-fill";
    progress.appendChild(progressFill);
    workflow.appendChild(progress);
    var progressLabel = createEl(doc, "div", "ari-help", "空闲");
    progressLabel.id = "profile-progress-label";
    workflow.appendChild(progressLabel);

    var modeHelp = createEl(doc, "div", "ari-help");
    modeHelp.id = "profile-mode-help";
    workflow.appendChild(modeHelp);

    var includeZoteroRow = createEl(doc, "label", "ari-option");
    var includeZotero = createEl(doc, "input");
    includeZotero.id = "profile-include-zotero-library";
    includeZotero.type = "checkbox";
    includeZotero.checked = true;
    setTooltip(includeZotero, "默认使用 Zotero 普通文献库。选择自定义项目文件夹或项目论文库时，取消勾选即可不把 Zotero 文献库加入本次画像。");
    includeZoteroRow.appendChild(includeZotero);
    includeZoteroRow.appendChild(createEl(doc, "span", null, "使用 Zotero 文献库（默认选择）"));
    workflow.appendChild(includeZoteroRow);

    var includeRow = createEl(doc, "label", "ari-option");
    var includeProject = createEl(doc, "input");
    includeProject.id = "profile-include-project-papers";
    includeProject.type = "checkbox";
    setTooltip(includeProject, "项目论文库保存在插件数据目录 project-papers/index.json。勾选后，本次画像会同时使用每日 arXiv 插件自己的项目论文库。");
    includeRow.appendChild(includeProject);
    includeRow.appendChild(createEl(doc, "span", null, "同时使用项目论文库"));
    workflow.appendChild(includeRow);

    var split = createEl(doc, "span", "ari-split");
    var buildBtn = createEl(doc, "button", "ari-btn is-primary", "生成画像");
    buildBtn.id = "profile-build-button";
    buildBtn.type = "button";
    setTooltip(buildBtn, "按当前模式生成基础科研兴趣画像。任务会进入统一进度框，但不会自动弹出。");
    buildBtn.addEventListener("click", function () {
      runSelectedMode(doc, dialog).catch(function (err) {
        dialog.alert("画像生成入口执行失败:\n" + (err.message || err));
      });
    });
    var menuBtn = createEl(doc, "button", "ari-menu-btn", "▾");
    menuBtn.type = "button";
    setTooltip(menuBtn, "选择画像生成方式");
    split.appendChild(buildBtn);
    split.appendChild(menuBtn);
    workflow.appendChild(split);

    var projectOnlyBtn = createEl(doc, "button", "ari-mini-btn", "使用项目论文库");
    projectOnlyBtn.type = "button";
    projectOnlyBtn.style.marginLeft = "8px";
    setTooltip(projectOnlyBtn, "使用插件项目论文库生成画像；如果上方“使用 Zotero 文献库”保持勾选，会同时加入 Zotero 普通文献库。");
    projectOnlyBtn.addEventListener("click", function () {
      buildFromProjectPapers(doc, dialog).catch(function (err) {
        dialog.alert("项目论文库画像生成入口执行失败:\n" + (err.message || err));
      });
    });
    workflow.appendChild(projectOnlyBtn);

    workflowGrid.appendChild(workflow);
    workflowGrid.appendChild(makeCategorySuggestionPanel(doc, dialog));
    body.appendChild(workflowGrid);

    var grid = createEl(doc, "div", "ari-grid");
    var basePanel = makeEditorPanel(doc, "profile-base", "基础科研兴趣画像", PROFILE_FILES.base,
      "长期稳定研究兴趣，可由生成结果整理后手动保存。",
      "可手动写入长期研究方向、材料体系、方法和现象。",
      "保存基础画像。", false);
    var feedbackPanel = makeEditorPanel(doc, "profile-feedback", "猜你喜欢科研兴趣画像", PROFILE_FILES.feedback,
      "近期反馈和探索偏好，后续评价系统会继续更新它。",
      "可手动写入近期偏好、探索方向或反馈总结。",
      "保存猜你喜欢画像。", false);
    addFeedbackBaseActions(doc, feedbackPanel, dialog);
    var activePanel = makeEditorPanel(doc, "profile-active", "日报筛选画像（旧版兜底）", PROFILE_FILES.active,
      "兼容旧版和临时手动兜底。当前日报默认使用基础画像；只有基础画像为空时才会读取这里。",
      "一般保持为空即可。若你需要临时覆盖旧流程，可手动写入并保存。",
      "保存日报筛选画像兜底。", true);
    grid.appendChild(basePanel);
    grid.appendChild(feedbackPanel);
    grid.appendChild(activePanel);
    body.appendChild(grid);

    var logBox = createEl(doc, "div", "ari-log");
    logBox.id = "profile-log";
    body.appendChild(logBox);
    root.appendChild(body);
    doc.body.appendChild(root);

    var menu = buildModeMenu(doc);
    menuBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      var rect = menuBtn.getBoundingClientRect();
      menu.style.left = rect.left + "px";
      menu.style.top = (rect.bottom + 3) + "px";
      menu.hidden = !menu.hidden;
    });
    doc.addEventListener("click", function () {
      if (menu) menu.hidden = true;
    });
    menu.addEventListener("click", function (event) { event.stopPropagation(); });

    doc.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.getAttribute) return;
      var kind = target.getAttribute("data-save-kind");
      if (!kind) return;
      try { saveSingle(doc, kind); } catch (e) { updateStatus(doc, "保存失败", "ari-error"); dialog.alert(e.message || String(e)); }
    });

    dialog.addEventListener("beforeunload", function (event) {
      if (isBusy(doc) || isDirty(doc)) {
        event.preventDefault();
        event.returnValue = "";
      }
    });

    setBuildButtonMode(doc, "llm-zotero");
    reloadProfiles(doc);
    appendLog(doc, args && args.mode === "configure"
      ? "Opened from Configure Research Interests entry."
      : "Opened from Research Interest Profile entry.");
  }

  function showFatalError(dialog, err) {
    try {
      var doc = resetDocument(dialog);
      installStyles(doc);
      var root = createEl(doc, "main", "ari-profile");
      var head = createEl(doc, "div", "ari-head");
      head.appendChild(createTitle(doc, "科研兴趣画像"));
      root.appendChild(head);
      var body = createEl(doc, "div", "ari-body");
      body.appendChild(createEl(doc, "div", "ari-note", "科研兴趣画像窗口初始化失败:\n" + (err.stack || err.message || String(err))));
      root.appendChild(body);
      doc.body.appendChild(root);
    } catch (e) {
      logError("profile fatal render failed: " + (e.message || e));
      try { dialog.alert("科研兴趣画像窗口初始化失败: " + (err.message || err)); } catch (alertErr) {}
    }
  }

  globalThis.ArxivDailyProfileWindow = {
    open: function (parentWin, args) {
      if (gWindow && !gWindow.closed) {
        gWindow.focus();
        return;
      }

      var dialog = parentWin.openDialog("about:blank", WINDOW_NAME, WINDOW_FEATURES);
      if (!dialog) {
        logError("profile window failed to open");
        return;
      }

      gWindow = dialog;
      var rendered = false;
      var render = function () {
        if (rendered || dialog.closed) return;
        rendered = true;
        try {
          buildWindow(dialog, args || {});
        } catch (err) {
          logError("profile window render failed: " + (err.stack || err.message || err));
          showFatalError(dialog, err);
        }
        dialog.addEventListener("unload", function () {
          if (gWindow === dialog) gWindow = null;
        });
      };

      parentWin.setTimeout(render, 0);
      dialog.addEventListener("load", render, { once: true });
    },
  };
})();
