/* ==========================================================================
 * settings-window.js - Programmatic settings window for Zotero 9
 *
 * The window avoids jar-packaged XHTML and native select dropdowns. Zotero 9
 * chrome windows can render packaged XHTML or popup-backed controls
 * inconsistently, so this module builds a stable HTML UI in about:blank.
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";
  const WINDOW_NAME = "arxiv-daily-settings";
  const WINDOW_FEATURES = "chrome,centerscreen,resizable,width=860,height=760";

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

  function t(key, fallback) {
    if (typeof ArxivDailyI18n !== "undefined" && typeof ArxivDailyI18n.t === "function") {
      return ArxivDailyI18n.t(key, fallback);
    }
    return fallback || key;
  }

  function safeText(value) {
    return value === undefined || value === null ? "" : String(value);
  }

  function cleanConfigText(value) {
    return safeText(value).replace(/[\u0000-\u001F\u007F-\u009F\u00A0\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "").trim();
  }

  function normalizeShortcutText(value, fallback) {
    var text = cleanConfigText(value || fallback || "");
    if (typeof ArxivDailyShortcuts !== "undefined" && ArxivDailyShortcuts.defaultShortcut) {
      return ArxivDailyShortcuts.defaultShortcut(text);
    }
    return text;
  }

  function setShortcutVal(doc, id, value, fallback) {
    var original = cleanConfigText(value || "");
    var shown = normalizeShortcutText(original || fallback || "", fallback);
    setVal(doc, id, shown);
    var el = doc.getElementById(id);
    if (!el) return;
    el.setAttribute("data-ari-original-shortcut", original);
    el.setAttribute("data-ari-shown-shortcut", shown);
  }

  function getShortcutVal(doc, id, fallback) {
    var el = doc.getElementById(id);
    var value = cleanConfigText(getVal(doc, id));
    if (el) {
      var original = cleanConfigText(el.getAttribute("data-ari-original-shortcut") || "");
      var shown = cleanConfigText(el.getAttribute("data-ari-shown-shortcut") || "");
      if (original && shown && value === shown) return original;
    }
    return normalizeShortcutText(value || fallback, fallback);
  }

  function shortcutHint() {
    if (typeof ArxivDailyShortcuts !== "undefined" && ArxivDailyShortcuts.isMac && ArxivDailyShortcuts.isMac()) {
      return "Accel = Command on macOS; examples: Accel+L, Accel+Enter.";
    }
    return "Accel = Ctrl on Windows/Linux; examples: Accel+L, Accel+Enter.";
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function createEl(doc, name, className, text) {
    var el = doc.createElement(name);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function createLogo(doc, size) {
    if (typeof ArxivDailyLogo !== "undefined") {
      if (ArxivDailyLogo.longHtml) return ArxivDailyLogo.longHtml(doc, 132, 38, "ari-logo ari-logo-large");
      return ArxivDailyLogo.html(doc, size || 24, "ari-logo");
    }
    var img = createEl(doc, "img", "ari-logo");
    img.alt = "";
    return img;
  }

  function createTitle(doc, text) {
    var title = createEl(doc, "h1", "ari-title");
    title.appendChild(createLogo(doc, 30));
    title.appendChild(createEl(doc, "span", null, text));
    return title;
  }

  function resetDocument(dialog) {
    var doc = dialog.document;
    doc.open();
    doc.write("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title></title></head><body></body></html>");
    doc.close();
    doc.title = t("settings.title", "每日 arXiv - 设置");
    return doc;
  }

  function installStyles(doc) {
    var style = createEl(doc, "style");
    style.textContent = [
      "html,body{width:100%;height:100%;margin:0;padding:0;}",
      "body{box-sizing:border-box;background:Canvas;color:CanvasText;font:13px message-box,system-ui,sans-serif;}",
      ".ari-settings{box-sizing:border-box;width:100%;height:100%;overflow:auto;padding:0 16px 16px 16px;}",
      ".ari-head{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:12px;margin:0 -16px 14px -16px;padding:12px 16px;background:Canvas;border-bottom:1px solid ThreeDShadow;}",
      ".ari-title{font-size:18px;font-weight:600;margin:0;flex:1;min-width:0;display:flex;align-items:center;gap:10px;}",
      ".ari-logo{height:32px;width:auto;min-width:32px;object-fit:contain;}",
      ".ari-logo-large{height:38px!important;width:132px!important;min-width:132px!important;max-width:132px!important;}",
      ".ari-head-actions{display:flex;align-items:center;gap:8px;}",
      ".ari-save-status{color:GrayText;font-size:12px;min-width:72px;text-align:right;}",
      ".ari-section{border:1px solid ThreeDShadow;border-radius:6px;background:Field;margin:0 0 14px 0;overflow:visible;}",
      ".ari-section-title{appearance:none;border:0;background:transparent;color:inherit;display:block;width:100%;box-sizing:border-box;text-align:left;font:600 14px message-box,system-ui,sans-serif;padding:10px 12px;cursor:pointer;}",
      ".ari-section-title:hover{color:-moz-HyperlinkText;}",
      ".ari-section-body{padding:0 12px 12px 12px;overflow:visible;}",
      ".ari-section-body.is-collapsed{display:none;}",
      ".ari-subtitle{font-weight:600;font-size:12px;margin:14px 0 6px 146px;color:CanvasText;}",
      ".ari-row{display:grid;grid-template-columns:138px minmax(0,1fr);align-items:center;gap:8px;margin:8px 0;overflow:visible;}",
      ".ari-row label{text-align:right;font-size:12px;}",
      ".ari-row input,.ari-row textarea{box-sizing:border-box;width:100%;min-width:0;padding:5px 7px;border:1px solid ThreeDShadow;border-radius:3px;background:Field;color:FieldText;font:12px message-box,system-ui,sans-serif;}",
      ".ari-row input[type='checkbox']{width:auto;justify-self:start;}",
      ".ari-row textarea{min-height:72px;resize:vertical;}",
      ".ari-checkbox{justify-self:start;width:auto!important;}",
      ".ari-hint{grid-column:2;color:GrayText;font-size:11px;margin-top:-4px;}",
      ".ari-btn{min-width:82px;padding:6px 14px;font:13px message-box,system-ui,sans-serif;}",
      ".ari-mini-btn{min-width:0;padding:4px 8px;font:12px message-box,system-ui,sans-serif;}",
      ".ari-inline-actions{display:flex;align-items:center;gap:8px;margin:8px 0 0 146px;flex-wrap:wrap;}",
      ".ari-results{margin:10px 0 0 146px;max-height:240px;overflow:auto;}",
      ".ari-result{border-radius:3px;margin:4px 0;padding:6px 8px;font-size:12px;}",
      ".ari-pass{background:#e8f5e9;color:#2e7d32;}",
      ".ari-fail{background:#ffebee;color:#c62828;}",
      ".ari-muted{color:GrayText;font-size:12px;}",
      ".ari-note{border:1px solid ThreeDShadow;border-radius:4px;background:Canvas;padding:8px;font-size:12px;line-height:1.45;}",
      ".ari-profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0 8px 146px;}",
      ".ari-profile-card{border:1px solid ThreeDShadow;border-radius:4px;background:Canvas;padding:8px;min-width:0;}",
      ".ari-profile-card strong{display:block;margin-bottom:4px;}",
      ".ari-profile-preview{display:none;margin-top:8px;max-height:180px;overflow:auto;white-space:pre-wrap;border-top:1px solid ThreeDShadow;padding-top:8px;color:CanvasText;}",
      ".ari-suggestion{margin:10px 0 0 146px;border:1px solid ThreeDShadow;border-radius:4px;background:Canvas;padding:10px;}",
      ".ari-suggestion pre{white-space:pre-wrap;margin:6px 0;font:12px ui-monospace,Consolas,monospace;}",
      ".ari-select{position:relative;box-sizing:border-box;width:100%;min-width:0;}",
      ".ari-select-button{box-sizing:border-box;width:100%;min-height:28px;padding:5px 28px 5px 7px;text-align:left;border:1px solid ThreeDShadow;border-radius:3px;background:Field;color:FieldText;font:12px message-box,system-ui,sans-serif;cursor:pointer;}",
      ".ari-select-button:after{content:'v';position:absolute;right:9px;color:GrayText;}",
      ".ari-select-menu{position:absolute;left:0;right:0;top:calc(100% + 2px);z-index:1000;max-height:220px;overflow:auto;border:1px solid ThreeDShadow;border-radius:3px;background:Field;color:FieldText;box-shadow:0 4px 12px rgba(0,0,0,.18);}",
      ".ari-select-option{padding:6px 8px;cursor:pointer;}",
      ".ari-select-option:hover,.ari-select-option.is-selected{background:Highlight;color:HighlightText;}",
      ".ari-control-group{display:flex;gap:4px;align-items:center;}",
      ".ari-control-group>*:first-child{flex:1;min-width:0;}",
      ".ari-api-list{margin:8px 0 8px 146px;display:flex;flex-direction:column;gap:8px;}",
      ".ari-api-card{border:1px solid ThreeDShadow;border-radius:5px;background:Canvas;padding:8px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;}",
      ".ari-api-card label{display:flex;flex-direction:column;gap:2px;font-size:11px;color:GrayText;}",
      ".ari-api-card input,.ari-api-card select,.ari-api-card textarea{box-sizing:border-box;width:100%;min-width:0;padding:5px 7px;border:1px solid ThreeDShadow;border-radius:3px;background:Field;color:FieldText;font:12px message-box,system-ui,sans-serif;}",
      ".ari-api-card textarea{min-height:58px;resize:vertical;grid-column:1 / -1;}",
      ".ari-api-card .ari-api-wide{grid-column:1 / -1;}",
      ".ari-api-card .ari-api-actions{grid-column:1 / -1;display:flex;justify-content:flex-end;gap:6px;}",
      "@media(max-width:680px){.ari-row{grid-template-columns:1fr}.ari-row label{text-align:left}.ari-hint,.ari-results,.ari-suggestion{grid-column:1;margin-left:0}.ari-inline-actions,.ari-profile-grid,.ari-subtitle{margin-left:0}.ari-profile-grid{grid-template-columns:1fr}}",
    ].join("\n");
    doc.head.appendChild(style);
  }

  function makeInput(doc, id, type, placeholder) {
    var input = createEl(doc, "input");
    input.id = id;
    input.type = type || "text";
    if (placeholder) input.placeholder = placeholder;
    return input;
  }

  function makeTextarea(doc, id, placeholder) {
    var textarea = createEl(doc, "textarea");
    textarea.id = id;
    if (placeholder) textarea.placeholder = placeholder;
    return textarea;
  }

  function closeSelects(doc, except) {
    var menus = doc.querySelectorAll(".ari-select-menu");
    for (var i = 0; i < menus.length; i++) {
      if (!except || menus[i] !== except) menus[i].hidden = true;
    }
  }

  function setSelectValue(selectEl, value) {
    var val = safeText(value);
    var button = selectEl.querySelector(".ari-select-button");
    var options = selectEl.querySelectorAll(".ari-select-option");
    var label = "";
    var found = false;
    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      var selected = opt.getAttribute("data-value") === val;
      opt.classList.toggle("is-selected", selected);
      if (selected) {
        label = opt.textContent;
        found = true;
      }
    }
    if (!found && options.length) {
      val = options[0].getAttribute("data-value") || "";
      label = options[0].textContent;
      options[0].classList.add("is-selected");
    }
    selectEl.setAttribute("data-value", val);
    if (button) button.textContent = label || val;
  }

  function makeSelect(doc, id, options) {
    var wrap = createEl(doc, "div", "ari-select");
    wrap.id = id;
    wrap.setAttribute("data-value", "");
    var button = createEl(doc, "button", "ari-select-button");
    button.type = "button";
    var menu = createEl(doc, "div", "ari-select-menu");
    menu.hidden = true;

    for (var i = 0; i < options.length; i++) {
      var option = createEl(doc, "div", "ari-select-option", options[i][1]);
      option.setAttribute("data-value", options[i][0]);
      option.addEventListener("click", function (event) {
        event.stopPropagation();
        setSelectValue(wrap, this.getAttribute("data-value"));
        menu.hidden = true;
      });
      menu.appendChild(option);
    }

    button.addEventListener("click", function (event) {
      event.stopPropagation();
      var wasHidden = menu.hidden;
      closeSelects(doc, menu);
      menu.hidden = !wasHidden;
    });
    wrap.addEventListener("keydown", function (event) {
      if (event.key === "Escape") menu.hidden = true;
    });
    doc.addEventListener("click", function () {
      menu.hidden = true;
    });

    wrap.appendChild(button);
    wrap.appendChild(menu);
    setSelectValue(wrap, options.length ? options[0][0] : "");
    return wrap;
  }

  function addField(doc, parent, labelText, control, hint) {
    var row = createEl(doc, "div", "ari-row");
    var label = createEl(doc, "label", null, labelText);
    label.setAttribute("for", control.id);
    row.appendChild(label);
    row.appendChild(control);
    if (hint) row.appendChild(createEl(doc, "div", "ari-hint", hint));
    parent.appendChild(row);
    return control;
  }

  function addFieldWithButton(doc, parent, labelText, control, button) {
    var row = createEl(doc, "div", "ari-row");
    var label = createEl(doc, "label", null, labelText);
    label.setAttribute("for", control.id);
    row.appendChild(label);
    var group = createEl(doc, "div", "ari-control-group");
    group.appendChild(control);
    if (button) group.appendChild(button);
    row.appendChild(group);
    parent.appendChild(row);
    return control;
  }

  function addSubtitle(doc, parent, text) {
    parent.appendChild(createEl(doc, "div", "ari-subtitle", text));
  }

  function makeSection(doc, title, expanded) {
    var section = createEl(doc, "section", "ari-section");
    var button = createEl(doc, "button", "ari-section-title");
    button.type = "button";
    var body = createEl(doc, "div", "ari-section-body");

    function renderTitle() {
      button.textContent = (body.classList.contains("is-collapsed") ? "> " : "v ") + title;
    }

    if (!expanded) body.classList.add("is-collapsed");
    renderTitle();
    button.addEventListener("click", function () {
      body.classList.toggle("is-collapsed");
      renderTitle();
    });
    section.appendChild(button);
    section.appendChild(body);
    return { root: section, body: body };
  }

  function setVal(doc, id, val) {
    var el = doc.getElementById(id);
    if (!el) return;
    if (el.classList && el.classList.contains("ari-select")) {
      setSelectValue(el, val);
    } else if (el.type === "checkbox") {
      el.checked = !!val;
    } else {
      el.value = safeText(val);
    }
  }

  function getVal(doc, id) {
    var el = doc.getElementById(id);
    if (!el) return "";
    if (el.classList && el.classList.contains("ari-select")) {
      return el.getAttribute("data-value") || "";
    }
    if (el.type === "checkbox") return el.checked;
    return el.value;
  }

  function getNumber(doc, id, fallback, isFloat) {
    var raw = getVal(doc, id);
    var n = isFloat ? parseFloat(raw) : parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
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

  function splitModels(value) {
    return safeText(value).split(/[\n,;，；、]+/).map(function (part) {
      return cleanConfigText(part);
    }).filter(function (part) {
      return !!part;
    });
  }

  function getEditableModels(doc) {
    if (!doc || !doc.querySelectorAll) return [];
    var apis = collectAPIEditors(doc);
    var baseModels = splitModels(getVal(doc, "cfg-model"));
    var baseProvider = cleanConfigText(getVal(doc, "cfg-llm-provider"));
    var baseKey = cleanConfigText(getVal(doc, "cfg-api-key"));
    var baseKeyEnv = cleanConfigText(getVal(doc, "cfg-api-key-env"));
    if ((baseProvider || baseKey || baseKeyEnv || baseModels.length) && (baseKey || baseKeyEnv) && baseModels.length) {
      apis.unshift({
        id: "default",
        name: "基础配置 API",
        provider: baseProvider,
        apiKey: baseKey,
        apiKeyEnv: baseKeyEnv,
        models: baseModels,
      });
    }
    var out = [];
    var seen = {};
    for (var i = 0; i < apis.length; i++) {
      if (!apis[i].apiKey && !apis[i].apiKeyEnv) continue;
      var models = apis[i].models || [];
      for (var m = 0; m < models.length; m++) {
        var model = cleanConfigText(models[m]);
        if (!model) continue;
        var ref = apis[i].id + "::" + model;
        if (seen[ref]) continue;
        seen[ref] = true;
        out.push({
          ref: ref,
          label: (apis[i].name || apis[i].provider || apis[i].id || "API") + " / " + model,
        });
      }
    }
    return out;
  }

  function getAvailableModels(doc) {
    var edited = getEditableModels(doc);
    if (edited.length) return edited;
    try {
      if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.getAvailableModels) {
        return ArxivDailyLLM.getAvailableModels();
      }
    } catch (e) {}
    return [];
  }

  function refreshUsageSelects(doc) {
    var models = getAvailableModels(doc);
    ["report", "search", "qa"].forEach(function (kind) {
      var select = doc.getElementById("cfg-usage-" + kind);
      if (!select) return;
      var current = select.value || "";
      while (select.firstChild) select.removeChild(select.firstChild);
      var auto = doc.createElement("option");
      auto.value = "";
      auto.textContent = "使用基础配置默认模型";
      select.appendChild(auto);
      if (kind === "report") {
        var noLLM = doc.createElement("option");
        noLLM.value = "__no_llm__";
        noLLM.textContent = "不使用 LLM";
        select.appendChild(noLLM);
      }
      for (var i = 0; i < models.length; i++) {
        var opt = doc.createElement("option");
        opt.value = models[i].ref;
        opt.textContent = models[i].label;
        select.appendChild(opt);
      }
      select.value = current;
    });
  }

  function syncBaseAPIPreview(doc) {
    var box = doc.getElementById("cfg-base-api-preview");
    if (!box) return;
    var provider = cleanConfigText(getVal(doc, "cfg-llm-provider")) || "未选择 provider";
    var baseUrl = cleanConfigText(getVal(doc, "cfg-base-url"));
    var models = splitModels(getVal(doc, "cfg-model"));
    var hasKey = !!(cleanConfigText(getVal(doc, "cfg-api-key")) || cleanConfigText(getVal(doc, "cfg-api-key-env")));
    box.textContent = "基础配置 API / " + provider +
      (models.length ? " / " + models.join(", ") : " / 未填写模型") +
      (hasKey ? "" : " / 未填写 Key") +
      (baseUrl ? " / " + baseUrl : "");
  }

  function apiProviderOptions() {
    return [
      ["openai", "OpenAI"],
      ["deepseek", "DeepSeek"],
      ["anthropic", "Anthropic"],
      ["gemini", "Gemini"],
      ["azure", "Azure OpenAI"],
      ["custom", "自定义 OpenAI-compatible"],
    ];
  }

  function apiStyleOptions() {
    return [
      ["openai", "OpenAI-compatible"],
      ["auto", "Auto"],
      ["anthropic", "Anthropic"],
      ["gemini", "Gemini"],
      ["azure_openai", "Azure OpenAI"],
    ];
  }

  function appendAPIEditor(doc, list, api) {
    api = api || {};
    var card = createEl(doc, "div", "ari-api-card");
    card.setAttribute("data-api-card", "true");
    card.setAttribute("data-api-id", cleanConfigText(api.id || ""));
    function labeled(labelText, node, wide) {
      var label = createEl(doc, "label", wide ? "ari-api-wide" : "");
      label.appendChild(doc.createTextNode(labelText));
      label.appendChild(node);
      card.appendChild(label);
      return node;
    }
    function input(name, type, value, placeholder) {
      var el = doc.createElement("input");
      el.type = type || "text";
      el.setAttribute("data-api-field", name);
      el.value = value || "";
      if (placeholder) el.placeholder = placeholder;
      return el;
    }
    function selectField(name, options, value) {
      var el = doc.createElement("select");
      el.setAttribute("data-api-field", name);
      for (var i = 0; i < options.length; i++) {
        var opt = doc.createElement("option");
        opt.value = options[i][0];
        opt.textContent = options[i][1];
        el.appendChild(opt);
      }
      el.value = value || options[0][0];
      return el;
    }
    labeled("名称", input("name", "text", api.name || "", "DeepSeek 工作号"));
    labeled("Provider", selectField("provider", apiProviderOptions(), api.provider || "openai"));
    labeled("API Style", selectField("apiStyle", apiStyleOptions(), api.apiStyle || "openai"));
    labeled("Base URL", input("baseUrl", "text", api.baseUrl || "", "https://api.openai.com/v1"));
    labeled("API Key", input("apiKey", "password", api.apiKey || "", "sk-..."));
    labeled("Key 环境变量", input("apiKeyEnv", "text", api.apiKeyEnv || "", "DEEPSEEK_API_KEY"));
    var models = doc.createElement("textarea");
    models.setAttribute("data-api-field", "models");
    models.value = Array.isArray(api.models) ? api.models.join("\n") : (api.models || api.model || "");
    models.placeholder = "每行一个模型，例如 deepseek-chat";
    labeled("模型列表", models, true);
    var actions = createEl(doc, "div", "ari-api-actions");
    var remove = createEl(doc, "button", "ari-mini-btn", "删除");
    remove.type = "button";
    remove.addEventListener("click", function () {
      if (card.parentNode) card.parentNode.removeChild(card);
      refreshUsageSelects(doc);
    });
    actions.appendChild(remove);
    card.appendChild(actions);
    list.appendChild(card);
  }

  function collectAPIEditors(doc) {
    var cards = doc.querySelectorAll("[data-api-card='true']");
    var apis = [];
    for (var i = 0; i < cards.length; i++) {
      function val(name) {
        var el = cards[i].querySelector("[data-api-field='" + name + "']");
        return el ? cleanConfigText(el.value || "") : "";
      }
      var models = uniqueList(splitModels(val("models")));
      var name = val("name") || ("API " + (i + 1));
      var existingId = cleanConfigText(cards[i].getAttribute("data-api-id") || "");
      var api = {
        id: existingId || ("api_" + (i + 1) + "_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24)),
        name: name,
        provider: val("provider"),
        apiStyle: val("apiStyle") || "openai",
        apiKey: val("apiKey"),
        apiKeyEnv: val("apiKeyEnv"),
        baseUrl: val("baseUrl"),
        models: models,
        model: models[0] || "",
        enabled: true,
      };
      if (api.provider || api.apiKey || api.apiKeyEnv || api.baseUrl || api.models.length) apis.push(api);
    }
    return apis;
  }

  function fillUsageSelect(doc, id, value) {
    refreshUsageSelects(doc);
    var el = doc.getElementById(id);
    if (el) el.value = value || "";
  }

  function readDataFileSync(relativePath) {
    try {
      if (typeof ArxivDailyDataDir !== "undefined" && ArxivDailyDataDir.getBasePath) {
        if (ArxivDailyDataDir.getFile) {
          var file = ArxivDailyDataDir.getFile(relativePath);
          if (file.exists() && typeof Zotero.File.getContents === "function") {
            return Zotero.File.getContents(file) || "";
          }
        }
        var text = ArxivDailyDataDir.readFile(relativePath);
        if (typeof text === "string") return text;
      }
    } catch (e) {}
    return "";
  }

  function firstExistingProfile(paths) {
    for (var i = 0; i < paths.length; i++) {
      var text = readDataFileSync(paths[i]);
      if (text && text.trim()) {
        return { exists: true, path: paths[i], text: text.trim() };
      }
    }
    return { exists: false, path: "", text: "" };
  }

  function getProfileSnapshot() {
    return {
      base: firstExistingProfile([
        "research_interests.base.md",
        "research_interests.md",
        "research_interests.active.md",
      ]),
      feedback: firstExistingProfile([
        "research_interests.feedback.md",
        "feedback/research_interests.feedback.md",
      ]),
    };
  }

  function buildSuggestionPrompt(snapshot) {
    var parts = [];
    if (snapshot.base.exists) {
      parts.push("Base research profile:\n" + snapshot.base.text);
    }
    if (snapshot.feedback.exists) {
      parts.push("Feedback / guess-you-like profile:\n" + snapshot.feedback.text);
    }
    return [
      "Suggest arXiv categories for a Zotero daily arXiv screening plugin.",
      "Return only JSON with this shape:",
      "{\"coreCategories\":[\"cond-mat.supr-con\"],\"crossCategories\":[\"quant-ph\"],\"reason\":\"short reason\"}",
      "Use valid arXiv category codes. Put central daily-feed categories in coreCategories.",
      "Put adjacent exploratory categories in crossCategories.",
      "",
      parts.join("\n\n") || "(No research profile provided)",
    ].join("\n");
  }

  function parseSuggestion(text) {
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

  function applySuggestion(doc, suggestion, mode) {
    var core = suggestion.coreCategories || [];
    var cross = suggestion.crossCategories || [];
    if (mode === "append") {
      core = uniqueList(parseLines(getVal(doc, "cfg-core-categories")).concat(core));
      cross = uniqueList(parseLines(getVal(doc, "cfg-cross-categories")).concat(cross));
    }
    setVal(doc, "cfg-core-categories", core.join("\n"));
    setVal(doc, "cfg-cross-categories", cross.join("\n"));
  }

  function showSuggestion(doc, dialog, suggestion) {
    var box = doc.getElementById("category-suggestion-result");
    if (!box) return;
    clearNode(box);
    box.className = "ari-suggestion";
    box.appendChild(createEl(doc, "strong", null, "建议分区"));
    var pre = createEl(doc, "pre");
    pre.textContent = [
      "核心分区: " + (suggestion.coreCategories.join(", ") || "(无)"),
      "交叉分区: " + (suggestion.crossCategories.join(", ") || "(无)"),
      suggestion.reason ? "理由: " + suggestion.reason : "",
    ].filter(function (line) { return line; }).join("\n");
    box.appendChild(pre);
    var actions = createEl(doc, "div");
    actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
    var overwrite = createEl(doc, "button", "ari-btn", "覆盖现有分区");
    overwrite.type = "button";
    overwrite.addEventListener("click", function () {
      applySuggestion(doc, suggestion, "overwrite");
      dialog.alert("已覆盖为建议分区。请点击顶部保存。");
    });
    var append = createEl(doc, "button", "ari-btn", "添加到现有分区");
    append.type = "button";
    append.addEventListener("click", function () {
      applySuggestion(doc, suggestion, "append");
      dialog.alert("已添加建议分区；重复分区已自动去重。请点击顶部保存。");
    });
    actions.appendChild(overwrite);
    actions.appendChild(append);
    box.appendChild(actions);
  }

  async function suggestCategories(doc, cfg, dialog, button) {
    var resultBox = doc.getElementById("category-suggestion-result");
    if (!resultBox) return;
    clearNode(resultBox);
    resultBox.className = "ari-suggestion";
    resultBox.textContent = "正在读取画像并请求 LLM...";

    saveSettings(doc, cfg, dialog, false, true);

    try {
      var snapshot = getProfileSnapshot();
      if (!snapshot.base.exists && !snapshot.feedback.exists) {
        throw new Error("未找到基础画像或猜你喜欢画像。请先配置科研兴趣画像。");
      }
      if (typeof ArxivDailyLLM === "undefined" || !ArxivDailyLLM.isConfigured()) {
        throw new Error("LLM 尚未配置，无法自动建议分区。");
      }
      button.disabled = true;
      var prompt = buildSuggestionPrompt(snapshot);
      var response = await ArxivDailyLLM.complete(
        "You are an expert arXiv taxonomy assistant. Return strict JSON only.",
        prompt,
        null
      );
      var suggestion = parseSuggestion(response);
      showSuggestion(doc, dialog, suggestion);
    } catch (err) {
      resultBox.className = "ari-suggestion ari-fail";
      resultBox.textContent = err.message || String(err);
    } finally {
      button.disabled = false;
    }
  }

  function setSaveStatus(doc, text) {
    var el = doc.getElementById("settings-save-status");
    if (el) el.textContent = text || "";
  }

  function loadSettings(doc, cfg) {
    if (!cfg) return;

    setVal(doc, "cfg-llm-provider", cfg.get("llm.provider") || "");
    setVal(doc, "cfg-api-style", cfg.get("llm.apiStyle") || "openai");
    setVal(doc, "cfg-api-key", cfg.get("llm.apiKey") || "");
    setVal(doc, "cfg-api-key-env", cfg.get("llm.apiKeyEnv") || "");
    setVal(doc, "cfg-model", cfg.get("llm.model") || "");
    setVal(doc, "cfg-base-url", cfg.get("llm.baseUrl") || "");
    setVal(doc, "cfg-llm-temperature", cfg.get("llm.temperature") || 0.3);
    setVal(doc, "cfg-llm-max-tokens", cfg.get("llm.maxTokens") || 32768);
    setVal(doc, "cfg-llm-timeout", cfg.get("llm.timeoutSeconds") || 120);
    setVal(doc, "cfg-llm-retry-attempts", cfg.get("llm.retryAttempts") || 3);
    var apiList = doc.getElementById("cfg-api-list");
    if (apiList) {
      clearNode(apiList);
      var apis = cfg.get("llm.apis") || [];
      if (Array.isArray(apis)) {
        for (var apiIndex = 0; apiIndex < apis.length; apiIndex++) {
          appendAPIEditor(doc, apiList, apis[apiIndex]);
        }
      }
    }
    fillUsageSelect(doc, "cfg-usage-report", cfg.get("llm.usage.report") || "");
    fillUsageSelect(doc, "cfg-usage-search", cfg.get("llm.usage.search") || "");
    fillUsageSelect(doc, "cfg-usage-qa", cfg.get("llm.usage.qa") || "");
    syncBaseAPIPreview(doc);

    setVal(doc, "cfg-locale", cfg.get("ui.locale") || "");
    setVal(doc, "cfg-report-locale", cfg.get("ui.reportLocale") || "");
    setVal(doc, "cfg-timezone", cfg.get("ui.timezone") || "");
    setVal(doc, "cfg-reminder-time", cfg.get("ui.reminderTime") || "10:00");
    setVal(doc, "cfg-reader-font-family", cfg.get("ui.readerFontFamily") || "message-box, system-ui, sans-serif");
    setVal(doc, "cfg-reader-font-size", cfg.get("ui.readerFontSize") || 13);
    setVal(doc, "cfg-selection-ask-mode", cfg.get("ui.selectionAskMode") ||
      (cfg.get("ui.selectionAskPopup") === false ? "off" : "global"));
    setShortcutVal(doc, "cfg-shortcut-toggle-sidebar", cfg.get("shortcuts.toggleSidebar"), "Accel+Shift+A");
    setShortcutVal(doc, "cfg-shortcut-toggle-qa", cfg.get("shortcuts.toggleQA"), "Accel+L");
    setVal(doc, "cfg-shortcut-search-keyword", cfg.get("shortcuts.searchKeyword") || "Enter");
    setShortcutVal(doc, "cfg-shortcut-search-llm", cfg.get("shortcuts.searchLLM"), "Accel+Enter");

    setVal(doc, "cfg-core-categories", (cfg.get("arxiv.coreCategories") || []).join("\n"));
    setVal(doc, "cfg-cross-categories", (cfg.get("arxiv.crossCategories") || []).join("\n"));

    setVal(doc, "cfg-arxiv-max-results", cfg.get("arxiv.maxResults") || 150);
    setVal(doc, "cfg-arxiv-days-back", cfg.get("arxiv.daysBack") || 3);
    setVal(doc, "cfg-arxiv-date-source", cfg.get("arxiv.dateSource") || "announcement");
    setVal(doc, "cfg-arxiv-date-filter", cfg.get("arxiv.dateFilter") || "latest");
    setVal(doc, "cfg-announcement-page-size", cfg.get("arxiv.announcementPageSize") || 1000);
    setVal(doc, "cfg-include-cross-lists", cfg.get("arxiv.includeCrossLists") !== false);
    setVal(doc, "cfg-include-replacements", cfg.get("arxiv.includeReplacements") || false);
    setVal(doc, "cfg-id-batch-size", cfg.get("arxiv.idBatchSize") || 100);
    setVal(doc, "cfg-page-size", cfg.get("arxiv.pageSize") || 50);
    setVal(doc, "cfg-request-interval", cfg.get("arxiv.requestIntervalMs") || 3000);
    setVal(doc, "cfg-retry-max", cfg.get("arxiv.retryMax") || 3);
    setVal(doc, "cfg-pagination-threshold", cfg.get("arxiv.paginationContinueThreshold") || 0.8);
    setVal(doc, "cfg-arxiv-cache-enabled", cfg.get("arxiv.cacheEnabled") !== false);
    setVal(doc, "cfg-arxiv-cache-age", cfg.get("arxiv.cacheMaxAgeHours") || 6);

    setVal(doc, "cfg-selection-mode", cfg.get("screening.selectionMode") || "llm");
    setVal(doc, "cfg-keyword-prefilter", cfg.get("screening.keywordPrefilter") !== false);
    setVal(doc, "cfg-keyword-min-score", cfg.get("screening.keywordMinScore") || 1);
    setVal(doc, "cfg-llm-prefilter-min-score", cfg.get("screening.llmPrefilterMinScore") || 2);
    setVal(doc, "cfg-llm-prefilter-passes", cfg.get("screening.llmPrefilterPasses") || 3);
    setVal(doc, "cfg-llm-min-score", cfg.get("screening.llmMinScore") || 2);
    setVal(doc, "cfg-max-candidates", cfg.get("screening.maxCandidates") || 80);
    setVal(doc, "cfg-selection-batch-size", cfg.get("screening.selectionBatchSize") || 8);
    setVal(doc, "cfg-llm-batch-size", cfg.get("screening.llmBatchSize") || 20);
    setVal(doc, "cfg-llm-passes", cfg.get("screening.llmPasses") || 3);
    setVal(doc, "cfg-cross-max-candidates", cfg.get("screening.crossDisciplineMaxCandidates") || 20);

    setVal(doc, "cfg-deep-enabled", cfg.get("deepRead.enabled") !== false);
    setVal(doc, "cfg-deep-top-n", cfg.get("deepRead.topN") || 5);
    setVal(doc, "cfg-deep-cross-n", cfg.get("deepRead.crossN") || 5);
    setVal(doc, "cfg-deep-min-core-score", cfg.get("deepRead.minCoreScore") || 2);
    setVal(doc, "cfg-deep-min-cross-score", cfg.get("deepRead.minCrossScore") || 1);
    setVal(doc, "cfg-max-pdf-pages", cfg.get("deepRead.maxPdfPages") || 10);
    setVal(doc, "cfg-chunk-size", cfg.get("deepRead.chunkSize") || 4000);
    setVal(doc, "cfg-max-chunks", cfg.get("deepRead.maxChunks") || 12);
    setVal(doc, "cfg-min-text-chars", cfg.get("deepRead.minTextChars") || 4000);
    setVal(doc, "cfg-min-core-guide-chars", cfg.get("deepRead.minCoreGuideChars") || 1000);
    setVal(doc, "cfg-min-cross-guide-chars", cfg.get("deepRead.minCrossGuideChars") || 800);
    setVal(doc, "cfg-pdf-timeout", cfg.get("deepRead.pdfTimeoutSeconds") || 90);
    setVal(doc, "cfg-pdf-delay", cfg.get("deepRead.pdfDownloadDelaySeconds") || 1);
    setVal(doc, "cfg-cache-llm-outputs", cfg.get("deepRead.cacheLLMOutputs") !== false);
    setVal(doc, "cfg-deep-concurrency", cfg.get("deepRead.concurrency") || 3);
    setVal(doc, "cfg-auto-pdf", cfg.get("pdf.autoDownload") || false);

    setVal(doc, "cfg-output-top-n", cfg.get("output.topN") || 3);
    setVal(doc, "cfg-guess-like-n", cfg.get("output.guessYouLikeN") || 5);
    setVal(doc, "cfg-output-min-core-score", cfg.get("output.minCoreScore") || 2);
    setVal(doc, "cfg-output-min-cross-score", cfg.get("output.minCrossScore") || 1);
    setVal(doc, "cfg-cross-fallback-n", cfg.get("output.crossFallbackN") || 4);

    setVal(doc, "cfg-search-candidates", cfg.get("search.llmCandidates") || 1000);
    setVal(doc, "cfg-search-batch-size", cfg.get("search.llmBatchSize") || 10);
    setVal(doc, "cfg-search-min-score", cfg.get("search.llmMinScore") || 2);
    setVal(doc, "cfg-search-return-count", cfg.get("search.returnCount") || 10);
    setVal(doc, "cfg-search-excerpt-chars", cfg.get("search.excerptChars") || 1400);
    setVal(doc, "cfg-search-prefilter", cfg.get("search.localPrefilter") || "fuzzy_semantic");

    setVal(doc, "cfg-cache-cleanup", cfg.get("cache.cleanupEnabled") !== false);
    setVal(doc, "cfg-cache-days", cfg.get("cache.retentionDays") || 30);
    setVal(doc, "cfg-cache-arxiv-days", cfg.get("cache.arxivQueryRetentionDays") || 7);
    setVal(doc, "cfg-cache-pdf-days", cfg.get("cache.pdfRetentionDays") || 3);
    setVal(doc, "cfg-cache-text-days", cfg.get("cache.textRetentionDays") || 30);
    setVal(doc, "cfg-cache-llm-days", cfg.get("cache.llmNotesRetentionDays") || 30);
    setVal(doc, "cfg-cache-guide-days", cfg.get("cache.guideRetentionDays") || 30);
    setVal(doc, "cfg-recommendation-write-to", cfg.get("recommendation.writeTo") || "both");
  }

  function saveSettings(doc, cfg, dialog, closeAfter, quiet) {
    if (!cfg) {
      dialog.alert("Config not available");
      return false;
    }

    cfg.set("llm.provider", cleanConfigText(getVal(doc, "cfg-llm-provider")));
    cfg.set("llm.apiStyle", cleanConfigText(getVal(doc, "cfg-api-style")));
    cfg.set("llm.apiKey", cleanConfigText(getVal(doc, "cfg-api-key")));
    cfg.set("llm.apiKeyEnv", cleanConfigText(getVal(doc, "cfg-api-key-env")));
    cfg.set("llm.model", cleanConfigText(getVal(doc, "cfg-model")));
    cfg.set("llm.baseUrl", cleanConfigText(getVal(doc, "cfg-base-url")));
    cfg.set("llm.temperature", getNumber(doc, "cfg-llm-temperature", 0.3, true));
    cfg.set("llm.maxTokens", Math.max(1, Math.min(1000000, getNumber(doc, "cfg-llm-max-tokens", 32768))));
    cfg.set("llm.timeoutSeconds", getNumber(doc, "cfg-llm-timeout", 120));
    cfg.set("llm.retryAttempts", getNumber(doc, "cfg-llm-retry-attempts", 3));
    cfg.set("llm.apis", collectAPIEditors(doc));
    cfg.set("llm.usage.report", cleanConfigText(getVal(doc, "cfg-usage-report")));
    cfg.set("llm.usage.search", cleanConfigText(getVal(doc, "cfg-usage-search")));
    cfg.set("llm.usage.qa", cleanConfigText(getVal(doc, "cfg-usage-qa")));

    cfg.set("ui.locale", getVal(doc, "cfg-locale"));
    cfg.set("ui.reportLocale", getVal(doc, "cfg-report-locale"));
    cfg.set("ui.timezone", getVal(doc, "cfg-timezone"));
    cfg.set("ui.reminderTime", getVal(doc, "cfg-reminder-time"));
    cfg.set("ui.readerFontFamily", getVal(doc, "cfg-reader-font-family"));
    cfg.set("ui.readerFontSize", getNumber(doc, "cfg-reader-font-size", 13));
    var askMode = getVal(doc, "cfg-selection-ask-mode") || "plugin";
    cfg.set("ui.selectionAskMode", askMode);
    cfg.set("ui.selectionAskPopup", askMode !== "off");
    cfg.set("shortcuts.toggleSidebar", getShortcutVal(doc, "cfg-shortcut-toggle-sidebar", "Accel+Shift+A"));
    cfg.set("shortcuts.toggleQA", getShortcutVal(doc, "cfg-shortcut-toggle-qa", "Accel+L"));
    cfg.set("shortcuts.searchKeyword", getVal(doc, "cfg-shortcut-search-keyword") || "Enter");
    cfg.set("shortcuts.searchLLM", getShortcutVal(doc, "cfg-shortcut-search-llm", "Accel+Enter"));

    cfg.set("arxiv.coreCategories", uniqueList(parseLines(getVal(doc, "cfg-core-categories"))));
    cfg.set("arxiv.crossCategories", uniqueList(parseLines(getVal(doc, "cfg-cross-categories"))));
    cfg.set("arxiv.maxResults", getNumber(doc, "cfg-arxiv-max-results", 150));
    cfg.set("arxiv.daysBack", getNumber(doc, "cfg-arxiv-days-back", 3));
    cfg.set("arxiv.dateSource", getVal(doc, "cfg-arxiv-date-source"));
    cfg.set("arxiv.dateFilter", getVal(doc, "cfg-arxiv-date-filter"));
    cfg.set("arxiv.announcementPageSize", getNumber(doc, "cfg-announcement-page-size", 1000));
    cfg.set("arxiv.includeCrossLists", getVal(doc, "cfg-include-cross-lists"));
    cfg.set("arxiv.includeReplacements", getVal(doc, "cfg-include-replacements"));
    cfg.set("arxiv.idBatchSize", getNumber(doc, "cfg-id-batch-size", 100));
    cfg.set("arxiv.pageSize", getNumber(doc, "cfg-page-size", 50));
    cfg.set("arxiv.requestIntervalMs", getNumber(doc, "cfg-request-interval", 3000));
    cfg.set("arxiv.retryMax", getNumber(doc, "cfg-retry-max", 3));
    cfg.set("arxiv.paginationContinueThreshold", getNumber(doc, "cfg-pagination-threshold", 0.8, true));
    cfg.set("arxiv.cacheEnabled", getVal(doc, "cfg-arxiv-cache-enabled"));
    cfg.set("arxiv.cacheMaxAgeHours", getNumber(doc, "cfg-arxiv-cache-age", 6, true));

    cfg.set("screening.selectionMode", getVal(doc, "cfg-selection-mode"));
    cfg.set("screening.keywordPrefilter", getVal(doc, "cfg-keyword-prefilter"));
    cfg.set("screening.keywordMinScore", getNumber(doc, "cfg-keyword-min-score", 1));
    cfg.set("screening.llmPrefilterMinScore", getNumber(doc, "cfg-llm-prefilter-min-score", 2));
    cfg.set("screening.llmPrefilterPasses", getNumber(doc, "cfg-llm-prefilter-passes", 3));
    cfg.set("screening.llmMinScore", getNumber(doc, "cfg-llm-min-score", 2));
    cfg.set("screening.maxCandidates", getNumber(doc, "cfg-max-candidates", 80));
    cfg.set("screening.selectionBatchSize", getNumber(doc, "cfg-selection-batch-size", 8));
    cfg.set("screening.llmBatchSize", getNumber(doc, "cfg-llm-batch-size", 20));
    cfg.set("screening.llmPasses", getNumber(doc, "cfg-llm-passes", 3));
    cfg.set("screening.crossDisciplineMaxCandidates", getNumber(doc, "cfg-cross-max-candidates", 20));

    cfg.set("deepRead.enabled", getVal(doc, "cfg-deep-enabled"));
    cfg.set("deepRead.topN", getNumber(doc, "cfg-deep-top-n", 5));
    cfg.set("deepRead.crossN", getNumber(doc, "cfg-deep-cross-n", 5));
    cfg.set("deepRead.minCoreScore", getNumber(doc, "cfg-deep-min-core-score", 2));
    cfg.set("deepRead.minCrossScore", getNumber(doc, "cfg-deep-min-cross-score", 1));
    cfg.set("deepRead.maxPdfPages", getNumber(doc, "cfg-max-pdf-pages", 10));
    cfg.set("deepRead.chunkSize", getNumber(doc, "cfg-chunk-size", 4000));
    cfg.set("deepRead.maxChunks", getNumber(doc, "cfg-max-chunks", 12));
    cfg.set("deepRead.minTextChars", getNumber(doc, "cfg-min-text-chars", 4000));
    cfg.set("deepRead.minCoreGuideChars", getNumber(doc, "cfg-min-core-guide-chars", 1000));
    cfg.set("deepRead.minCrossGuideChars", getNumber(doc, "cfg-min-cross-guide-chars", 800));
    cfg.set("deepRead.pdfTimeoutSeconds", getNumber(doc, "cfg-pdf-timeout", 90));
    cfg.set("deepRead.pdfDownloadDelaySeconds", getNumber(doc, "cfg-pdf-delay", 1, true));
    cfg.set("deepRead.cacheLLMOutputs", getVal(doc, "cfg-cache-llm-outputs"));
    cfg.set("deepRead.concurrency", getNumber(doc, "cfg-deep-concurrency", 3));
    cfg.set("pdf.autoDownload", getVal(doc, "cfg-auto-pdf"));

    cfg.set("output.topN", getNumber(doc, "cfg-output-top-n", 3));
    cfg.set("output.guessYouLikeN", getNumber(doc, "cfg-guess-like-n", 5));
    cfg.set("output.minCoreScore", getNumber(doc, "cfg-output-min-core-score", 2));
    cfg.set("output.minCrossScore", getNumber(doc, "cfg-output-min-cross-score", 1));
    cfg.set("output.crossFallbackN", getNumber(doc, "cfg-cross-fallback-n", 4));

    cfg.set("search.llmCandidates", getNumber(doc, "cfg-search-candidates", 1000));
    cfg.set("search.llmBatchSize", getNumber(doc, "cfg-search-batch-size", 10));
    cfg.set("search.llmMinScore", getNumber(doc, "cfg-search-min-score", 2));
    cfg.set("search.returnCount", getNumber(doc, "cfg-search-return-count", 10));
    cfg.set("search.excerptChars", getNumber(doc, "cfg-search-excerpt-chars", 1400));
    cfg.set("search.localPrefilter", getVal(doc, "cfg-search-prefilter"));

    cfg.set("cache.cleanupEnabled", getVal(doc, "cfg-cache-cleanup"));
    cfg.set("cache.retentionDays", getNumber(doc, "cfg-cache-days", 30));
    cfg.set("cache.arxivQueryRetentionDays", getNumber(doc, "cfg-cache-arxiv-days", 7));
    cfg.set("cache.pdfRetentionDays", getNumber(doc, "cfg-cache-pdf-days", 3));
    cfg.set("cache.textRetentionDays", getNumber(doc, "cfg-cache-text-days", 30));
    cfg.set("cache.llmNotesRetentionDays", getNumber(doc, "cfg-cache-llm-days", 30));
    cfg.set("cache.guideRetentionDays", getNumber(doc, "cfg-cache-guide-days", 30));
    cfg.set("recommendation.writeTo", getVal(doc, "cfg-recommendation-write-to"));
    cfg.save();

    try {
      if (typeof ArxivDailyI18n !== "undefined" && ArxivDailyI18n.setLocale) {
        ArxivDailyI18n.setLocale(getVal(doc, "cfg-locale"));
      }
      if (typeof ArxivDailyMenu !== "undefined" && ArxivDailyMenu.refreshLabels) {
        ArxivDailyMenu.refreshLabels();
      }
      if (typeof ArxivDailyButtonBar !== "undefined" && ArxivDailyButtonBar.refreshLabels) {
        ArxivDailyButtonBar.refreshLabels();
      }
    } catch (localeErr) {
      logError("refresh locale after settings save failed: " + (localeErr.message || localeErr));
    }

    if (!quiet) setSaveStatus(doc, "已保存");
    if (closeAfter) dialog.close();
    return true;
  }

  function makeVisibilityButton(doc, inputId) {
    var btn = createEl(doc, "button", "ari-mini-btn", "显示");
    btn.title = t("settings.api_key_show", "显示 API Key");
    btn.type = "button";
    btn.addEventListener("click", function () {
      var input = doc.getElementById(inputId);
      if (!input) return;
      if (input.type === "password") {
        input.type = "text";
        btn.textContent = "隐藏";
        btn.title = t("settings.api_key_hide", "隐藏 API Key");
      } else {
        input.type = "password";
        btn.textContent = "显示";
        btn.title = t("settings.api_key_show", "显示 API Key");
      }
    });
    return btn;
  }

  function addProfileCard(doc, parent, title, profile) {
    var card = createEl(doc, "div", "ari-profile-card");
    card.appendChild(createEl(doc, "strong", null, title));
    card.appendChild(createEl(doc, "div", "ari-muted",
      profile.exists ? "已找到: " + profile.path : "未找到"));
    var preview = createEl(doc, "div", "ari-profile-preview");
    preview.textContent = profile.exists ? profile.text : "暂无画像内容";
    var btn = createEl(doc, "button", "ari-mini-btn", profile.exists ? "展开查看画像" : "无可查看内容");
    btn.type = "button";
    btn.disabled = !profile.exists;
    btn.addEventListener("click", function () {
      var open = preview.style.display === "block";
      preview.style.display = open ? "none" : "block";
      btn.textContent = open ? "展开查看画像" : "收起画像";
    });
    card.appendChild(btn);
    card.appendChild(preview);
    parent.appendChild(card);
  }

  function buildCategorySection(doc, parent, cfg, dialog) {
    var snapshot = getProfileSnapshot();
    var summaryRow = createEl(doc, "div", "ari-row");
    summaryRow.appendChild(createEl(doc, "label", null, "画像状态"));
    var summary = createEl(doc, "div", "ari-note");
    summary.textContent = "基础画像: " + (snapshot.base.exists ? "有" : "无") +
      "；猜你喜欢画像: " + (snapshot.feedback.exists ? "有" : "无") +
      "。分区建议会优先参考基础画像，并结合猜你喜欢画像做交叉探索。";
    summaryRow.appendChild(summary);
    parent.appendChild(summaryRow);

    var grid = createEl(doc, "div", "ari-profile-grid");
    addProfileCard(doc, grid, "基础科研兴趣画像", snapshot.base);
    addProfileCard(doc, grid, "猜你喜欢科研兴趣画像", snapshot.feedback);
    parent.appendChild(grid);

    var profileActions = createEl(doc, "div", "ari-inline-actions");
    var openProfile = createEl(doc, "button", "ari-btn", "打开科研兴趣画像配置");
    openProfile.type = "button";
    openProfile.addEventListener("click", function () {
      if (typeof globalThis.ArxivDailyActions !== "undefined" &&
          typeof globalThis.ArxivDailyActions.manageProfile === "function") {
        globalThis.ArxivDailyActions.manageProfile();
        return;
      }
      dialog.alert("已联通顶部“科研兴趣画像”入口。若当前阶段该入口尚未实现，可先在插件数据目录中放置 research_interests.base.md 或 research_interests.feedback.md。");
    });
    profileActions.appendChild(openProfile);
    parent.appendChild(profileActions);

    addField(doc, parent, "核心分区", makeTextarea(doc, "cfg-core-categories", "每行一个, e.g. cond-mat.supr-con"));
    addField(doc, parent, "交叉分区", makeTextarea(doc, "cfg-cross-categories", "每行一个, e.g. quant-ph"));

    var actions = createEl(doc, "div", "ari-inline-actions");
    var suggest = createEl(doc, "button", "ari-btn", "根据画像生成建议分区");
    suggest.type = "button";
    suggest.addEventListener("click", function () {
      suggestCategories(doc, cfg, dialog, suggest);
    });
    actions.appendChild(suggest);
    parent.appendChild(actions);
    var result = createEl(doc, "div");
    result.id = "category-suggestion-result";
    parent.appendChild(result);
  }

  async function runEnvTest(doc, envTest, button) {
    var resultsDiv = doc.getElementById("env-test-results");
    if (!resultsDiv) return;
    clearNode(resultsDiv);

    if (!envTest) {
      resultsDiv.appendChild(createEl(doc, "div", "ari-result ari-fail", t("env.module_unavailable", "环境测试模块不可用")));
      return;
    }

    button.disabled = true;
    button.textContent = t("env.test_running", "测试中...");
    resultsDiv.appendChild(createEl(doc, "div", "ari-muted", t("env.test_running", "测试中...")));

    try {
      var results = await envTest.runAll();
      clearNode(resultsDiv);
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var row = createEl(doc, "div", "ari-result " + (r.passed ? "ari-pass" : "ari-fail"));
        row.textContent = (r.passed ? "✓ " : "✗ ") + r.name + (r.detail ? " - " + r.detail : "");
        resultsDiv.appendChild(row);
      }
    } catch (err) {
      clearNode(resultsDiv);
      resultsDiv.appendChild(createEl(doc, "div", "ari-result ari-fail", err.message || String(err)));
    } finally {
      button.disabled = false;
      button.textContent = t("env.run_test", "运行环境测试");
    }
  }

  function appendToolResult(doc, text, ok) {
    var box = doc.getElementById("maintenance-results");
    if (!box) return;
    var row = createEl(doc, "div", "ari-result " + (ok === false ? "ari-fail" : "ari-pass"));
    row.textContent = text;
    box.insertBefore(row, box.firstChild);
  }

  function exportConfig(doc, includeSecrets, dialog) {
    try {
      if (includeSecrets && !dialog.confirm("完整配置会以明文写出 API Key。确认导出？")) return;
      if (typeof ArxivDailyExportTools === "undefined") {
        throw new Error("导出工具模块不可用");
      }
      var result = ArxivDailyExportTools.exportConfig(includeSecrets);
      appendToolResult(doc, "配置已导出: " + result.path, true);
    } catch (err) {
      appendToolResult(doc, "导出配置失败: " + (err.message || err), false);
    }
  }

  function importConfig(doc, cfg, dialog) {
    try {
      var input = doc.getElementById("cfg-import-json");
      var text = input ? input.value : "";
      if (!text.trim()) {
        dialog.alert("请先粘贴配置 JSON。");
        return;
      }
      if (!dialog.confirm("导入会覆盖当前插件配置。继续？")) return;
      if (typeof ArxivDailyExportTools === "undefined") {
        throw new Error("导入工具模块不可用");
      }
      var result = ArxivDailyExportTools.importConfigText(text);
      if (input) input.value = "";
      loadSettings(doc, cfg);
      appendToolResult(doc, "配置已导入。模型: " + (result.summary.model || "未设置") +
        "；核心分区: " + (result.summary.coreCategories || []).join(", "), true);
    } catch (err) {
      appendToolResult(doc, "导入配置失败: " + (err.message || err), false);
    }
  }

  function exportDiagnostics(doc) {
    try {
      if (typeof ArxivDailyExportTools === "undefined") {
        throw new Error("诊断工具模块不可用");
      }
      var result = ArxivDailyExportTools.exportDiagnostics();
      appendToolResult(doc, "诊断日志已导出: " + result.path, true);
    } catch (err) {
      appendToolResult(doc, "导出诊断日志失败: " + (err.message || err), false);
    }
  }

  function buildWindow(dialog, args) {
    var doc = resetDocument(dialog);
    var cfg = args && args.config;
    var envTest = args && args.envTest;

    installStyles(doc);

    var root = createEl(doc, "main", "ari-settings");
    var head = createEl(doc, "div", "ari-head");
    head.appendChild(createTitle(doc, t("settings.title", "每日 arXiv - 设置")));
    var headActions = createEl(doc, "div", "ari-head-actions");
    var status = createEl(doc, "div", "ari-save-status");
    status.id = "settings-save-status";
    var saveButton = createEl(doc, "button", "ari-btn", t("settings.save", "保存"));
    saveButton.type = "button";
    saveButton.addEventListener("click", function () {
      saveSettings(doc, cfg, dialog, false, false);
    });
    var closeButton = createEl(doc, "button", "ari-btn", t("settings.cancel", "关闭"));
    closeButton.type = "button";
    closeButton.addEventListener("click", function () {
      dialog.close();
    });
    headActions.appendChild(status);
    headActions.appendChild(saveButton);
    headActions.appendChild(closeButton);
    head.appendChild(headActions);
    root.appendChild(head);

    var basic = makeSection(doc, t("settings.basic", "基础配置"), true);
    addField(doc, basic.body, "LLM Provider", makeSelect(doc, "cfg-llm-provider", [
      ["", "未选择"],
      ["openai", "OpenAI"],
      ["deepseek", "DeepSeek"],
      ["anthropic", "Anthropic"],
      ["gemini", "Gemini"],
      ["azure", "Azure OpenAI"],
      ["custom", "自定义 OpenAI-compatible"],
    ]));
    addField(doc, basic.body, "API Style", makeSelect(doc, "cfg-api-style", [
      ["openai", "OpenAI-compatible"],
      ["auto", "Auto"],
      ["anthropic", "Anthropic"],
      ["gemini", "Gemini"],
      ["azure_openai", "Azure OpenAI"],
    ]));
    addFieldWithButton(doc, basic.body, "API Key", makeInput(doc, "cfg-api-key", "password", "sk-..."), makeVisibilityButton(doc, "cfg-api-key"));
    addField(doc, basic.body, "API Key 环境变量", makeInput(doc, "cfg-api-key-env", "text", "DEEPSEEK_API_KEY"));
    addField(doc, basic.body, "Model", makeInput(doc, "cfg-model", "text", "e.g. deepseek-chat / gpt-4o"));
    addField(doc, basic.body, "Base URL", makeInput(doc, "cfg-base-url", "text", "https://api.openai.com/v1"));
    addField(doc, basic.body, "界面语言", makeSelect(doc, "cfg-locale", [
      ["", "跟随 Zotero"],
      ["zh-CN", "简体中文"],
      ["en-US", "English"],
    ]));
    addField(doc, basic.body, "报告语言", makeSelect(doc, "cfg-report-locale", [
      ["", "跟随界面语言"],
      ["zh-CN", "简体中文"],
      ["en-US", "English"],
    ]));
    addField(doc, basic.body, "时区", makeInput(doc, "cfg-timezone", "text", "Asia/Shanghai"));
    addField(doc, basic.body, "提醒时间", makeInput(doc, "cfg-reminder-time", "time"));
    addField(doc, basic.body, "阅读字体", makeInput(doc, "cfg-reader-font-family", "text", "message-box, system-ui, sans-serif"));
    addField(doc, basic.body, "阅读字号", makeInput(doc, "cfg-reader-font-size", "number"));
    addField(doc, basic.body, "选区 LLM 提问入口", makeSelect(doc, "cfg-selection-ask-mode", [
      ["global", "全局开启"],
      ["plugin", "仅插件阅读页开启"],
      ["off", "全局关闭"],
    ]), "全局开启会在 Zotero 原生论文阅读页选中文本后，于右上角显示独立提问入口。");
    root.appendChild(basic.root);

    var apiPool = makeSection(doc, "LLM API 池与用途", false);
    var apiNote = createEl(doc, "div", "ari-note");
    apiNote.textContent = "Add extra API keys or models here. Model lists accept one model per line or comma-separated values.";
    apiPool.body.appendChild(apiNote);
    var basePreview = createEl(doc, "div", "ari-api-card");
    basePreview.id = "cfg-base-api-preview";
    basePreview.style.cssText += ";font-size:12px;color:CanvasText;";
    apiPool.body.appendChild(basePreview);
    var apiList = createEl(doc, "div", "ari-api-list");
    apiList.id = "cfg-api-list";
    apiPool.body.appendChild(apiList);
    var apiActions = createEl(doc, "div", "ari-inline-actions");
    var addAPI = createEl(doc, "button", "ari-btn", "添加 API Key");
    addAPI.type = "button";
    addAPI.addEventListener("click", function () {
      appendAPIEditor(doc, apiList, {});
      refreshUsageSelects(doc);
    });
    var refreshModels = createEl(doc, "button", "ari-btn", "刷新模型菜单");
    refreshModels.type = "button";
    refreshModels.addEventListener("click", function () {
      saveSettings(doc, cfg, dialog, false, true);
      refreshUsageSelects(doc);
      setSaveStatus(doc, "模型菜单已刷新");
    });
    apiActions.appendChild(addAPI);
    apiActions.appendChild(refreshModels);
    apiPool.body.appendChild(apiActions);
    var usageReport = doc.createElement("select");
    usageReport.id = "cfg-usage-report";
    addField(doc, apiPool.body, "报告生成默认模型", usageReport);
    var usageSearch = doc.createElement("select");
    usageSearch.id = "cfg-usage-search";
    addField(doc, apiPool.body, "文献搜索默认模型", usageSearch);
    var usageQA = doc.createElement("select");
    usageQA.id = "cfg-usage-qa";
    addField(doc, apiPool.body, "LLM 问答默认模型", usageQA);
    ["cfg-llm-provider", "cfg-api-style", "cfg-api-key", "cfg-api-key-env", "cfg-model", "cfg-base-url"].forEach(function (id) {
      var el = doc.getElementById(id);
      if (!el) return;
      el.addEventListener("input", function () {
        syncBaseAPIPreview(doc);
        refreshUsageSelects(doc);
      });
      el.addEventListener("change", function () {
        syncBaseAPIPreview(doc);
        refreshUsageSelects(doc);
      });
    });
    root.appendChild(apiPool.root);

    var categories = makeSection(doc, "科研兴趣 arXiv 分区", true);
    buildCategorySection(doc, categories.body, cfg, dialog);
    root.appendChild(categories.root);

    var advanced = makeSection(doc, t("settings.advanced", "高级配置"), false);
    addSubtitle(doc, advanced.body, "LLM 调用");
    addField(doc, advanced.body, "Temperature", makeInput(doc, "cfg-llm-temperature", "number"));
    var maxTokensInput = makeInput(doc, "cfg-llm-max-tokens", "number");
    maxTokensInput.min = "1";
    maxTokensInput.max = "1000000";
    maxTokensInput.step = "1024";
    addField(doc, advanced.body, "Max Output Tokens", maxTokensInput,
      "Maximum tokens the model may generate in one response. This is not context length; providers/models may impose lower caps.");
    addField(doc, advanced.body, "超时秒数", makeInput(doc, "cfg-llm-timeout", "number"));
    addField(doc, advanced.body, "LLM 重试次数", makeInput(doc, "cfg-llm-retry-attempts", "number"));

    addSubtitle(doc, advanced.body, "arXiv 抓取");
    addField(doc, advanced.body, "每分区最大结果", makeInput(doc, "cfg-arxiv-max-results", "number"));
    addField(doc, advanced.body, "回看天数", makeInput(doc, "cfg-arxiv-days-back", "number"));
    addField(doc, advanced.body, "日期来源", makeSelect(doc, "cfg-arxiv-date-source", [
      ["announcement", "arXiv announcement"],
      ["api", "arXiv API"],
    ]));
    addField(doc, advanced.body, "日期过滤", makeSelect(doc, "cfg-arxiv-date-filter", [
      ["latest", "最新版本"],
      ["submitted", "首次提交"],
      ["none", "不过滤"],
    ]));
    addField(doc, advanced.body, "公告页大小", makeInput(doc, "cfg-announcement-page-size", "number"));
    addField(doc, advanced.body, "包含 cross-list", makeInput(doc, "cfg-include-cross-lists", "checkbox"));
    addField(doc, advanced.body, "包含 replacement", makeInput(doc, "cfg-include-replacements", "checkbox"));
    addField(doc, advanced.body, "ID 批量大小", makeInput(doc, "cfg-id-batch-size", "number"));
    addField(doc, advanced.body, "API 页大小", makeInput(doc, "cfg-page-size", "number"));
    addField(doc, advanced.body, "请求间隔 ms", makeInput(doc, "cfg-request-interval", "number"));
    addField(doc, advanced.body, "重试次数", makeInput(doc, "cfg-retry-max", "number"));
    addField(doc, advanced.body, "翻页阈值", makeInput(doc, "cfg-pagination-threshold", "number"));
    addField(doc, advanced.body, "启用 arXiv 缓存", makeInput(doc, "cfg-arxiv-cache-enabled", "checkbox"));
    addField(doc, advanced.body, "缓存有效小时", makeInput(doc, "cfg-arxiv-cache-age", "number"));

    addSubtitle(doc, advanced.body, "筛选");
    addField(doc, advanced.body, "筛选模式", makeSelect(doc, "cfg-selection-mode", [
      ["llm", "LLM 筛选"],
      ["keyword", "关键词筛选"],
      ["hybrid", "关键词 + LLM"],
    ]));
    addField(doc, advanced.body, "关键词模式预筛", makeInput(doc, "cfg-keyword-prefilter", "checkbox"));
    addField(doc, advanced.body, "关键词最低分", makeInput(doc, "cfg-keyword-min-score", "number"));
    addField(doc, advanced.body, "LLM 预筛最低分", makeInput(doc, "cfg-llm-prefilter-min-score", "number"));
    addField(doc, advanced.body, "LLM 预筛轮数", makeInput(doc, "cfg-llm-prefilter-passes", "number"));
    addField(doc, advanced.body, "LLM 最低分", makeInput(doc, "cfg-llm-min-score", "number"));
    addField(doc, advanced.body, "LLM 最大候选", makeInput(doc, "cfg-max-candidates", "number"));
    addField(doc, advanced.body, "候选批大小", makeInput(doc, "cfg-selection-batch-size", "number"));
    addField(doc, advanced.body, "LLM 批大小", makeInput(doc, "cfg-llm-batch-size", "number"));
    addField(doc, advanced.body, "LLM 筛选轮数", makeInput(doc, "cfg-llm-passes", "number"));
    addField(doc, advanced.body, "交叉方向候选", makeInput(doc, "cfg-cross-max-candidates", "number"));

    addSubtitle(doc, advanced.body, "深度阅读 / PDF");
    addField(doc, advanced.body, "启用深度阅读", makeInput(doc, "cfg-deep-enabled", "checkbox"));
    addField(doc, advanced.body, "核心深读数量", makeInput(doc, "cfg-deep-top-n", "number"));
    addField(doc, advanced.body, "交叉深读数量", makeInput(doc, "cfg-deep-cross-n", "number"));
    addField(doc, advanced.body, "核心深读最低分", makeInput(doc, "cfg-deep-min-core-score", "number"));
    addField(doc, advanced.body, "交叉深读最低分", makeInput(doc, "cfg-deep-min-cross-score", "number"));
    addField(doc, advanced.body, "最大 PDF 页数", makeInput(doc, "cfg-max-pdf-pages", "number"));
    addField(doc, advanced.body, "分块字符数", makeInput(doc, "cfg-chunk-size", "number"));
    addField(doc, advanced.body, "最大分块数", makeInput(doc, "cfg-max-chunks", "number"));
    addField(doc, advanced.body, "最少文本字符", makeInput(doc, "cfg-min-text-chars", "number"));
    addField(doc, advanced.body, "核心导读最少字数", makeInput(doc, "cfg-min-core-guide-chars", "number"));
    addField(doc, advanced.body, "交叉导读最少字数", makeInput(doc, "cfg-min-cross-guide-chars", "number"));
    addField(doc, advanced.body, "PDF 超时秒数", makeInput(doc, "cfg-pdf-timeout", "number"));
    addField(doc, advanced.body, "PDF 下载延迟秒", makeInput(doc, "cfg-pdf-delay", "number"));
    addField(doc, advanced.body, "缓存 LLM 导读", makeInput(doc, "cfg-cache-llm-outputs", "checkbox"));
    addField(doc, advanced.body, "并发数", makeInput(doc, "cfg-deep-concurrency", "number"));
    addField(doc, advanced.body, "自动下载 PDF", makeInput(doc, "cfg-auto-pdf", "checkbox"));

    addSubtitle(doc, advanced.body, "报告、搜索与缓存");
    addField(doc, advanced.body, "报告核心 Top N", makeInput(doc, "cfg-output-top-n", "number"));
    addField(doc, advanced.body, "猜你喜欢数量", makeInput(doc, "cfg-guess-like-n", "number"));
    addField(doc, advanced.body, "报告核心最低分", makeInput(doc, "cfg-output-min-core-score", "number"));
    addField(doc, advanced.body, "报告交叉最低分", makeInput(doc, "cfg-output-min-cross-score", "number"));
    addField(doc, advanced.body, "交叉兜底数量", makeInput(doc, "cfg-cross-fallback-n", "number"));
    addField(doc, advanced.body, "搜索 LLM 候选", makeInput(doc, "cfg-search-candidates", "number"));
    addField(doc, advanced.body, "搜索批大小", makeInput(doc, "cfg-search-batch-size", "number"));
    addField(doc, advanced.body, "搜索最低分", makeInput(doc, "cfg-search-min-score", "number"));
    addField(doc, advanced.body, "搜索返回数量", makeInput(doc, "cfg-search-return-count", "number"));
    addField(doc, advanced.body, "搜索摘录字符", makeInput(doc, "cfg-search-excerpt-chars", "number"));
    addField(doc, advanced.body, "本地预筛", makeSelect(doc, "cfg-search-prefilter", [
      ["fuzzy_semantic", "模糊 + 语义"],
      ["keyword", "关键词"],
      ["none", "无"],
    ]));
    addField(doc, advanced.body, "自动清理缓存", makeInput(doc, "cfg-cache-cleanup", "checkbox"));
    addField(doc, advanced.body, "通用缓存天数", makeInput(doc, "cfg-cache-days", "number"));
    addField(doc, advanced.body, "arXiv 查询缓存天数", makeInput(doc, "cfg-cache-arxiv-days", "number"));
    addField(doc, advanced.body, "PDF 缓存天数", makeInput(doc, "cfg-cache-pdf-days", "number"));
    addField(doc, advanced.body, "文本缓存天数", makeInput(doc, "cfg-cache-text-days", "number"));
    addField(doc, advanced.body, "LLM 笔记缓存天数", makeInput(doc, "cfg-cache-llm-days", "number"));
    addField(doc, advanced.body, "导读缓存天数", makeInput(doc, "cfg-cache-guide-days", "number"));
    addField(doc, advanced.body, "推荐写入位置", makeSelect(doc, "cfg-recommendation-write-to", [
      ["both", "笔记 + 附件"],
      ["note", "仅笔记"],
      ["attachment", "仅附件"],
    ]));
    addSubtitle(doc, advanced.body, "快捷键");
    addField(doc, advanced.body, "打开/关闭插件左栏", makeInput(doc, "cfg-shortcut-toggle-sidebar", "text", "Accel+Shift+A"), shortcutHint());
    addField(doc, advanced.body, "打开/关闭 LLM 问答", makeInput(doc, "cfg-shortcut-toggle-qa", "text", "Accel+L"));
    addField(doc, advanced.body, "搜索: 关键词", makeInput(doc, "cfg-shortcut-search-keyword", "text", "Enter"));
    addField(doc, advanced.body, "搜索: LLM", makeInput(doc, "cfg-shortcut-search-llm", "text", "Accel+Enter"));
    root.appendChild(advanced.root);

    var env = makeSection(doc, t("settings.env_test", "环境测试"), false);
    var inlineActions = createEl(doc, "div", "ari-inline-actions");
    var envButton = createEl(doc, "button", "ari-btn", t("env.run_test", "运行环境测试"));
    envButton.type = "button";
    envButton.addEventListener("click", function () {
      runEnvTest(doc, envTest, envButton);
    });
    inlineActions.appendChild(envButton);
    env.body.appendChild(inlineActions);
    var results = createEl(doc, "div", "ari-results");
    results.id = "env-test-results";
    env.body.appendChild(results);
    root.appendChild(env.root);

    var maintenance = makeSection(doc, "维护与迁移", false);
    var maintenanceActions = createEl(doc, "div", "ari-inline-actions");
    var exportSanitized = createEl(doc, "button", "ari-btn", "导出配置(不含 Key)");
    exportSanitized.type = "button";
    exportSanitized.addEventListener("click", function () {
      exportConfig(doc, false, dialog);
    });
    var exportFull = createEl(doc, "button", "ari-btn", "导出完整配置");
    exportFull.type = "button";
    exportFull.title = "包含 API Key 明文，仅用于迁移到你信任的环境";
    exportFull.addEventListener("click", function () {
      exportConfig(doc, true, dialog);
    });
    var exportLog = createEl(doc, "button", "ari-btn", "导出诊断日志");
    exportLog.type = "button";
    exportLog.addEventListener("click", function () {
      exportDiagnostics(doc);
    });
    maintenanceActions.appendChild(exportSanitized);
    maintenanceActions.appendChild(exportFull);
    maintenanceActions.appendChild(exportLog);
    maintenance.body.appendChild(maintenanceActions);
    addField(doc, maintenance.body, "导入配置 JSON", makeTextarea(doc, "cfg-import-json", "粘贴 config-sanitized/full JSON 或原始 config.json"));
    var importActions = createEl(doc, "div", "ari-inline-actions");
    var importButton = createEl(doc, "button", "ari-btn", "导入并覆盖当前配置");
    importButton.type = "button";
    importButton.addEventListener("click", function () {
      importConfig(doc, cfg, dialog);
    });
    importActions.appendChild(importButton);
    maintenance.body.appendChild(importActions);
    var maintenanceResults = createEl(doc, "div", "ari-results");
    maintenanceResults.id = "maintenance-results";
    maintenance.body.appendChild(maintenanceResults);
    root.appendChild(maintenance.root);

    doc.body.appendChild(root);
    loadSettings(doc, cfg);
  }

  function showFatalError(dialog, err) {
    try {
      var doc = resetDocument(dialog);
      installStyles(doc);
      var root = createEl(doc, "main", "ari-settings");
      root.appendChild(createTitle(doc, t("settings.title", "每日 arXiv - 设置")));
      root.appendChild(createEl(doc, "div", "ari-error", "初始化失败:\n" + (err.stack || err.message || String(err))));
      doc.body.appendChild(root);
    } catch (e) {
      logError("settings fatal render failed: " + (e.message || e));
      try {
        dialog.alert("初始化失败: " + (err.message || err));
      } catch (alertErr) {}
    }
  }

  globalThis.ArxivDailySettingsWindow = {
    open: function (parentWin, args) {
      if (gWindow && !gWindow.closed) {
        gWindow.focus();
        return;
      }

      var dialog = parentWin.openDialog("about:blank", WINDOW_NAME, WINDOW_FEATURES);
      if (!dialog) {
        logError("settings window failed to open");
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
          logError("settings window render failed: " + (err.stack || err.message || err));
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
