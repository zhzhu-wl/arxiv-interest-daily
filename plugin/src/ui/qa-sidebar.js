/* ==========================================================================
 * ui/qa-sidebar.js - LLM Q&A panel mounted in Zotero's native right pane
 *
 * M6 goal:
 *   - Open Q&A from the plugin toolbar, menu, and Zotero tab toolbar.
 *   - Reuse Zotero's original right pane instead of creating a floating
 *     sidebar that covers reader controls.
 *   - Keep Q&A available in reports, project papers, and native Zotero reader.
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";
  const PLUGIN_ID = "arxiv-interest-daily@zotero";
  const THREAD_STORE = "chat/threads.json";
  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
  const ICON_COLOR = "#5f6368";
  const DEFAULT_SIDE_WIDTH = 360;

  const DEPTH_PRESETS = [
    { id: "fast", label: "快速", temperature: 0.1, maxTokens: 2048 },
    { id: "balanced", label: "平衡", temperature: 0.3, maxTokens: 4096 },
    { id: "deep", label: "深入", temperature: 0.5, maxTokens: 8192 },
  ];

  function log(msg) {
    var text = "[" + LOG_PREFIX + "] " + msg;
    if (typeof Zotero !== "undefined" && typeof Zotero.debug === "function") Zotero.debug(text);
    else if (typeof Zotero !== "undefined" && typeof Zotero.log === "function") Zotero.log(text);
  }

  function logError(msg) {
    if (typeof Zotero !== "undefined" && typeof Zotero.logError === "function") Zotero.logError(msg);
    else log("ERROR: " + msg);
  }

  function mainWindow() {
    try {
      return Zotero.getMainWindow();
    } catch (e) {
      return null;
    }
  }

  function getConfig(path, fallback) {
    try {
      if (typeof ArxivDailyConfig !== "undefined") {
        var value = ArxivDailyConfig.get(path);
        return value !== undefined && value !== null && value !== "" ? value : fallback;
      }
    } catch (e) {}
    return fallback;
  }

  function isLLMConfigured() {
    try {
      if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.isConfigured) {
        var ref = "";
        try { ref = ArxivDailyLLM.getUsageModelRef ? ArxivDailyLLM.getUsageModelRef("qa") : ""; } catch (e2) {}
        return ArxivDailyLLM.isConfigured({ kind: "qa", modelRef: ref });
      }
    } catch (e) {}
    return !!(getConfig("llm.apiKey", "") && getConfig("llm.model", ""));
  }

  function create(doc, tag, className, text) {
    var node = doc.createElementNS ? doc.createElementNS(HTML_NS, tag) : doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function createXUL(doc, name) {
    if (typeof doc.createXULElement === "function") return doc.createXULElement(name);
    return doc.createElementNS(XUL_NS, name);
  }

  function replaceInvalidSurrogates(text) {
    return String(text || "").replace(/([\uD800-\uDBFF][\uDC00-\uDFFF])|[\uD800-\uDFFF]/g, function (match, pair) {
      return pair || "\uFFFD";
    });
  }

  function cleanText(text) {
    return replaceInvalidSurrogates(text || "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
      .replace(/\r\n?/g, "\n");
  }

  function cleanSelectionText(text) {
    return cleanText(text || "")
      .replace(/\u00AD/g, "")
      .replace(/([A-Za-z])-\s+([A-Za-z])/g, "$1$2")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .trim();
  }

  function todayStr() {
    var now = new Date();
    return now.getFullYear() + "-" +
      String(now.getMonth() + 1).padStart(2, "0") + "-" +
      String(now.getDate()).padStart(2, "0");
  }

  function uuid() {
    return "qa_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  }

  function sanitizeForStorage(value, depth) {
    if (depth === undefined) depth = 0;
    if (depth > 8) return null;
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return cleanText(value);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) {
      return value.map(function (item) { return sanitizeForStorage(item, depth + 1); });
    }
    if (typeof value === "object") {
      var out = {};
      Object.keys(value).forEach(function (key) {
        if (typeof value[key] === "function") return;
        out[key] = sanitizeForStorage(value[key], depth + 1);
      });
      return out;
    }
    return cleanText(String(value));
  }

  function qaSystemPrompt() {
    var summary = null;
    try {
      if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.getConfigSummary) {
        summary = ArxivDailyLLM.getConfigSummary();
      }
    } catch (e) {}
    var identity = summary
      ? "Current configured LLM client: provider=" + (summary.provider || "未填写") +
        ", apiStyle=" + (summary.apiStyle || "openai") +
        ", model=" + (summary.model || "未填写") +
        ", baseUrl=" + (summary.baseUrl || "未填写") + "."
      : "Current configured LLM client is unknown.";
    return [
      "You are a patient research tutor inside Zotero.",
      identity,
      "Answer the user's question using the current report, current reader item, or selected Zotero item when available.",
      "Use the context snapshot captured at the moment the user sent the question. If the user changes tabs while you answer, do not silently switch to the later file.",
      "If the user asks for background knowledge, explain the core picture intuitively and connect it back to the paper.",
      "Be precise about uncertainty. Answer in the same language as the user.",
    ].join("\n");
  }

  function messageMarkdown(text) {
    return cleanText(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }

  function appendPlainMessage(doc, node, text) {
    var lines = cleanText(text || "").split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (i) node.appendChild(doc.createElement("br"));
      node.appendChild(doc.createTextNode(lines[i]));
    }
  }

  function messageClipboardText(msg) {
    if (!msg) return "";
    var parts = [];
    if (msg.role === "user" && msg.selectedPassage) {
      parts.push("Selected passage:\n" + cleanText(msg.selectedPassage || ""));
      if (msg.selectedPassageContext) {
        parts.push("Located source context:\n" + cleanText(msg.selectedPassageContext || ""));
      }
    }
    if (msg.content) parts.push(cleanText(msg.content || ""));
    return cleanText(parts.join("\n\n")).trim();
  }

  function qaIsEditableTarget(target) {
    try {
      var el = nodeToElement(target);
      if (!el) return false;
      var tag = String(el.localName || el.tagName || "").toLowerCase();
      return tag === "textarea" || tag === "input" || tag === "select" ||
        el.isContentEditable ||
        !!(el.closest && el.closest("textarea,input,select,[contenteditable='true']"));
    } catch (e) {
      return false;
    }
  }

  function qaNodeWithinPanel(node, panel) {
    try {
      if (!node || !panel) return false;
      if (node === panel) return true;
      if (panel.contains && panel.contains(node)) return true;
      var el = nodeToElement(node);
      if (!el) return false;
      if (el === panel) return true;
      if (el.closest) return el.closest("#arxiv-daily-qa-sidebar") === panel;
      while (el) {
        if (el === panel) return true;
        el = el.parentNode;
      }
    } catch (e) {}
    return false;
  }

  function qaPanelSelectionText(doc) {
    try {
      var panel = doc && doc.getElementById ? doc.getElementById("arxiv-daily-qa-sidebar") : null;
      var win = doc && doc.defaultView;
      var sel = win && win.getSelection ? win.getSelection() : null;
      if (!panel || !sel || sel.isCollapsed || !sel.rangeCount) return "";
      var anchorInside = qaNodeWithinPanel(sel.anchorNode, panel);
      var focusInside = qaNodeWithinPanel(sel.focusNode, panel);
      var parts = [];
      for (var i = 0; i < sel.rangeCount; i++) {
        var range = sel.getRangeAt(i);
        if (!range) continue;
        if (qaNodeWithinPanel(range.commonAncestorContainer, panel) || anchorInside || focusInside) {
          var text = cleanText(range.toString ? range.toString() : "");
          if (text) parts.push(text);
        }
      }
      if (!parts.length && (anchorInside || focusInside)) parts.push(cleanText(sel.toString ? sel.toString() : ""));
      return cleanText(parts.join("\n")).trim();
    } catch (e) {
      return "";
    }
  }

  function removeQaCopyMenu(doc) {
    try {
      var old = doc && doc.getElementById ? doc.getElementById("ari-qa-copy-context-menu") : null;
      if (old && old.parentNode) old.parentNode.removeChild(old);
    } catch (e) {}
  }

  function copyQaPanelSelection(event) {
    var doc = event && event.currentTarget ? event.currentTarget.ownerDocument :
      (event && event.target && event.target.ownerDocument);
    var text = qaPanelSelectionText(doc);
    if (!text) return false;
    try {
      if (event && event.clipboardData && event.clipboardData.setData) {
        event.clipboardData.setData("text/plain", text);
      }
    } catch (e) {}
    var ok = writeClipboardText(text);
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    return ok;
  }

  function showQaCopyMenu(event) {
    try {
      if (!event || qaIsEditableTarget(event.target)) return false;
      var doc = event.target && event.target.ownerDocument;
      var panel = doc && doc.getElementById ? doc.getElementById("arxiv-daily-qa-sidebar") : null;
      var text = qaPanelSelectionText(doc);
      if (!doc || !panel || !text) return false;
      event.preventDefault();
      event.stopPropagation();
      removeQaCopyMenu(doc);
      var menu = create(doc, "div", "ari-qa-copy-menu");
      menu.id = "ari-qa-copy-context-menu";
      menu.style.left = Math.max(4, event.clientX || 0) + "px";
      menu.style.top = Math.max(4, event.clientY || 0) + "px";
      var copy = create(doc, "button", "", "Copy");
      copy.addEventListener("click", function (clickEvent) {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        writeClipboardText(text);
        removeQaCopyMenu(doc);
      });
      menu.appendChild(copy);
      panel.appendChild(menu);
      try {
        (doc.defaultView || mainWindow()).setTimeout(function () {
          var rect = menu.getBoundingClientRect ? menu.getBoundingClientRect() : null;
          var vw = (doc.defaultView && doc.defaultView.innerWidth) || 0;
          var vh = (doc.defaultView && doc.defaultView.innerHeight) || 0;
          if (rect && vw && rect.right > vw) menu.style.left = Math.max(4, vw - rect.width - 4) + "px";
          if (rect && vh && rect.bottom > vh) menu.style.top = Math.max(4, vh - rect.height - 4) + "px";
        }, 0);
      } catch (e) {}
      return true;
    } catch (e2) {
      return false;
    }
  }

  function installQaCopyHandlers(panel) {
    if (!panel || panel._ariQaCopyHandlersInstalled) return;
    panel._ariQaCopyHandlersInstalled = true;
    panel.addEventListener("copy", function (event) {
      if (qaIsEditableTarget(event && event.target)) return;
      copyQaPanelSelection(event);
    }, true);
    panel.addEventListener("keydown", function (event) {
      var key = String(event && event.key || "").toLowerCase();
      if ((event.ctrlKey || event.metaKey) && !event.altKey && key === "c" && !qaIsEditableTarget(event.target)) {
        copyQaPanelSelection(event);
      } else if (key === "escape") {
        removeQaCopyMenu(panel.ownerDocument);
      }
    }, true);
    panel.addEventListener("contextmenu", function (event) {
      showQaCopyMenu(event);
    }, true);
    panel.addEventListener("mousedown", function (event) {
      var menu = panel.ownerDocument && panel.ownerDocument.getElementById("ari-qa-copy-context-menu");
      if (menu && !qaNodeWithinPanel(event.target, menu)) removeQaCopyMenu(panel.ownerDocument);
    }, true);
    panel.addEventListener("scroll", function () {
      removeQaCopyMenu(panel.ownerDocument);
    }, true);
  }

  function iconURI() {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="' +
      ICON_COLOR + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16v10.5H8.5L4 20.5z"/><path d="M9 9h6"/><path d="M9 12.5h4"/></svg>';
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }

  function getSelectedTabType(win) {
    try {
      if (win && win.Zotero_Tabs && win.Zotero_Tabs.selectedType) {
        return win.Zotero_Tabs.parseTabType(win.Zotero_Tabs.selectedType).tabContentType;
      }
    } catch (e) {}
    return "library";
  }

  function findRightPaneMount(doc) {
    var win = doc.defaultView || mainWindow();
    var tabType = getSelectedTabType(win);
    var ordered = tabType === "library" ? ["library", "reader"] : ["reader", "library"];

    for (var i = 0; i < ordered.length; i++) {
      if (ordered[i] === "library") {
        var libraryOuter = doc.getElementById("zotero-item-pane");
        var libraryContent = doc.getElementById("zotero-item-pane-content") || libraryOuter;
        if (libraryOuter && libraryContent && libraryContent.appendChild) {
          return { outer: libraryOuter, content: libraryContent, kind: "library" };
        }
      } else {
        var readerOuter = doc.getElementById("zotero-context-pane");
        var readerContent = doc.getElementById("zotero-context-pane-deck") ||
          doc.getElementById("zotero-context-pane-inner") ||
          readerOuter;
        if (readerOuter && readerContent && readerContent.appendChild) {
          return { outer: readerOuter, content: readerContent, kind: "reader" };
        }
      }
    }
    return null;
  }

  function openNativeRightPane(win, host, state) {
    if (!host || !win || !win.document) return;
    var doc = win.document;
    try {
      state.hostCollapsed = host.getAttribute("collapsed");
      state.hostHidden = host.getAttribute("hidden");
      state.hostWidth = host.getAttribute("width");
      state.hostStyleWidth = host.style.width || "";
    } catch (e) {}

    if (host.id === "zotero-context-pane") {
      var contextSplitter = doc.getElementById("zotero-context-splitter");
      var stackedSplitter = doc.getElementById("zotero-context-splitter-stacked");
      state.splitters = [
        contextSplitter ? { node: contextSplitter, state: contextSplitter.getAttribute("state"), hidden: contextSplitter.getAttribute("hidden") } : null,
        stackedSplitter ? { node: stackedSplitter, state: stackedSplitter.getAttribute("state"), hidden: stackedSplitter.getAttribute("hidden") } : null,
      ];
      if (win.ZoteroContextPane) {
        ensureNormalSideWidth(host);
        win.ZoteroContextPane.collapsed = false;
        if (win.ZoteroContextPane.update) win.ZoteroContextPane.update();
      } else {
        host.removeAttribute("collapsed");
        ensureNormalSideWidth(host);
        if (contextSplitter) {
          contextSplitter.setAttribute("state", "open");
          contextSplitter.removeAttribute("hidden");
        }
      }
      return;
    }

    if (host.id === "zotero-item-pane") {
      collapseInactiveReaderPane(doc);
      var itemSplitter = doc.getElementById("zotero-items-splitter");
      state.splitters = [
        itemSplitter ? { node: itemSplitter, state: itemSplitter.getAttribute("state"), hidden: itemSplitter.getAttribute("hidden") } : null,
      ];
      host.removeAttribute("collapsed");
      if (typeof host.collapsed !== "undefined") {
        try {
          host.collapsed = false;
        } catch (e) {}
      }
      host.removeAttribute("collapsed");
      if (itemSplitter) itemSplitter.setAttribute("state", "open");
      ensureNormalSideWidth(host);
      if (typeof host.handleResize === "function") {
        try {
          host.handleResize();
        } catch (e2) {}
      }
    }
  }

  function collapseInactiveReaderPane(doc) {
    try {
      var contextPane = doc.getElementById("zotero-context-pane");
      var contextInner = doc.getElementById("zotero-context-pane-inner");
      var contextSplitter = doc.getElementById("zotero-context-splitter");
      var stackedSplitter = doc.getElementById("zotero-context-splitter-stacked");
      if (contextPane) contextPane.setAttribute("collapsed", "true");
      if (contextInner) contextInner.setAttribute("collapsed", "true");
      if (contextSplitter) contextSplitter.setAttribute("state", "collapsed");
      if (stackedSplitter) stackedSplitter.setAttribute("state", "collapsed");
    } catch (e) {}
  }

  function restoreNativeRightPane(state) {
    if (!state || !state.host) return;
    var host = state.host;
    try {
      if (state.hostCollapsed === null || state.hostCollapsed === undefined || state.hostCollapsed === "false") {
        host.removeAttribute("collapsed");
      } else {
        host.setAttribute("collapsed", state.hostCollapsed);
      }
      if (state.hostHidden === null || state.hostHidden === undefined || state.hostHidden === "false") {
        host.removeAttribute("hidden");
      } else {
        host.setAttribute("hidden", state.hostHidden);
      }
      if (state.hostWidth === null || state.hostWidth === undefined) {
        host.removeAttribute("width");
      } else {
        host.setAttribute("width", state.hostWidth);
      }
      if (state.hostStyleWidth === null || state.hostStyleWidth === undefined) {
        host.style.removeProperty("width");
      } else {
        host.style.width = state.hostStyleWidth;
      }
      if (state.splitters) {
        for (var s = 0; s < state.splitters.length; s++) {
          var entry = state.splitters[s];
          if (!entry || !entry.node) continue;
          if (entry.state === null || entry.state === undefined) entry.node.removeAttribute("state");
          else entry.node.setAttribute("state", entry.state);
          if (entry.hidden === null || entry.hidden === undefined) entry.node.removeAttribute("hidden");
          else entry.node.setAttribute("hidden", entry.hidden);
        }
      }
      var win = host.ownerDocument && host.ownerDocument.defaultView;
      if (win && win.ZoteroContextPane && host.id === "zotero-context-pane") {
        win.ZoteroContextPane.update();
      }
    } catch (e) {}
  }

  function ensureNormalSideWidth(host) {
    if (!host || !host.getBoundingClientRect) return;
    try {
      var attrWidth = parseInt(host.getAttribute("width") || "", 10);
      var rectWidth = host.getBoundingClientRect().width || 0;
      if (!attrWidth || attrWidth < 240 || attrWidth > 520 || rectWidth > 560) {
        host.setAttribute("width", String(DEFAULT_SIDE_WIDTH));
        host.style.width = DEFAULT_SIDE_WIDTH + "px";
      }
    } catch (e) {}
  }

  function setDeckSelectionForPanel(content, panel, state) {
    if (!content || !panel || !/deck$/i.test(String(content.localName || content.tagName || ""))) return;
    try {
      var selectedIndex = typeof content.selectedIndex !== "undefined"
        ? content.selectedIndex
        : content.getAttribute("selectedIndex");
      var index = Array.prototype.indexOf.call(content.children || [], panel);
      if (index >= 0) {
        if (Number(selectedIndex) !== Number(index)) state.selectedIndex = selectedIndex;
        if (typeof content.selectedIndex !== "undefined") content.selectedIndex = index;
        content.setAttribute("selectedIndex", String(index));
      }
    } catch (e) {}
  }

  function restoreDeckSelection(state) {
    if (!state || !state.content || state.selectedIndex === undefined) return;
    try {
      if (state.selectedIndex === null || state.selectedIndex === "") {
        state.content.removeAttribute("selectedIndex");
      } else {
        if (typeof state.content.selectedIndex !== "undefined") {
          state.content.selectedIndex = Number(state.selectedIndex);
        }
        state.content.setAttribute("selectedIndex", String(state.selectedIndex));
      }
    } catch (e) {}
  }

  function repairNativeDeckSelection(state) {
    if (!state || !state.content || !/deck$/i.test(String(state.content.localName || state.content.tagName || ""))) return;
    try {
      var content = state.content;
      var children = Array.prototype.slice.call(content.children || []);
      if (!children.length) return;
      var selectedIndex = typeof content.selectedIndex !== "undefined"
        ? Number(content.selectedIndex)
        : parseInt(content.getAttribute("selectedIndex") || "0", 10);
      var selected = children[selectedIndex];
      if (selected && selected.id !== "arxiv-daily-qa-sidebar" &&
          selected.style.display !== "none" &&
          selected.getAttribute("aria-hidden") !== "true") {
        return;
      }
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (!child || child.id === "arxiv-daily-qa-sidebar") continue;
        if (child.style.display === "none" || child.getAttribute("aria-hidden") === "true") continue;
        if (typeof content.selectedIndex !== "undefined") content.selectedIndex = i;
        content.setAttribute("selectedIndex", String(i));
        break;
      }
    } catch (e) {}
  }

  function installNativeSidenavRestorer(doc, state) {
    if (!doc || !state) return;
    var ids = state.kind === "reader"
      ? ["zotero-context-pane-sidenav"]
      : ["zotero-view-item-sidenav"];
    state.sidenavHandlers = [];
    for (var i = 0; i < ids.length; i++) {
      var nav = doc.getElementById(ids[i]);
      if (!nav) continue;
      var handler = function () {
        try {
          if (globalThis.ArxivDailyQA && globalThis.ArxivDailyQA._visible) {
            var qa = globalThis.ArxivDailyQA;
            setTimeout(function () {
              qa._yieldToNativePane();
            }, 0);
          }
        } catch (e) {}
      };
      nav.addEventListener("click", handler, true);
      nav.addEventListener("command", handler, true);
      state.sidenavHandlers.push({ node: nav, handler: handler });
    }
  }

  function removeNativeSidenavRestorer(state) {
    if (!state || !state.sidenavHandlers) return;
    for (var i = 0; i < state.sidenavHandlers.length; i++) {
      var entry = state.sidenavHandlers[i];
      if (!entry || !entry.node || !entry.handler) continue;
      try {
        entry.node.removeEventListener("click", entry.handler, true);
        entry.node.removeEventListener("command", entry.handler, true);
      } catch (e) {}
    }
    state.sidenavHandlers = [];
  }

  function getLLMSummary() {
    try {
      if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.getConfigSummary) {
        return ArxivDailyLLM.getConfigSummary();
      }
    } catch (e) {}
    return {
      provider: getConfig("llm.provider", ""),
      apiStyle: getConfig("llm.apiStyle", "openai"),
      model: getConfig("llm.model", ""),
      baseUrl: getConfig("llm.baseUrl", ""),
    };
  }

  function contextCharLimit(model) {
    var explicit = Number(getConfig("qa.contextChars", 0));
    if (Number.isFinite(explicit) && explicit > 5000) return Math.min(explicit, 1200000);
    var name = String(model || getConfig("llm.model", "") || "").toLowerCase();
    if (/(^|[-_\s])1m($|[-_\s])|1000k|百万|million|deepseek.*v4|v4.*1m/.test(name)) return 600000;
    if (/200k|128k|100k|long/.test(name)) return 120000;
    return 30000;
  }

  function truncateText(text, maxChars) {
    text = cleanText(text || "");
    if (!maxChars || text.length <= maxChars) return text;
    return text.slice(0, maxChars) + "\n\n[Context truncated by plugin at " + maxChars + " characters. Increase qa.contextChars if your model supports more context.]";
  }

  function debugSnippet(text, maxChars) {
    text = cleanSelectionText(text || "").replace(/\s+/g, " ").trim();
    maxChars = maxChars || 80;
    if (!text || text.length <= maxChars) return text;
    return text.slice(0, Math.max(0, maxChars - 1)) + "...";
  }

  function joinDebugParts(parts) {
    var out = [];
    for (var i = 0; i < (parts || []).length; i++) {
      var value = cleanText(parts[i] || "").trim();
      if (value) out.push(value);
    }
    return out.join("; ");
  }

  function logoNode(doc, size) {
    var px = Math.max(12, parseInt(size, 10) || 14);
    var svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText =
      "display:inline-block;width:" + px + "px;height:" + px + "px;min-width:" + px + "px;" +
      "vertical-align:-2px;flex:0 0 auto;";
    var path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M4.2 21 10.2 5.4c.7-1.8 2.9-1.8 3.6 0L19.8 21h-4.1l-1.1-3.1H9.4L8.3 21H4.2Zm6.3-6.3h3L12 10.2l-1.5 4.5Z");
    path.setAttribute("fill", "#f01824");
    svg.appendChild(path);
    var bar = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    bar.setAttribute("d", "M6.7 15.9c3.1-1.2 6.7-2 10.6-2.1.8 0 1.4.6 1.4 1.4 0 .7-.6 1.3-1.3 1.4-4.1.2-7.7.9-11 2.2l.3-2.9Z");
    bar.setAttribute("fill", "#f01824");
    bar.setAttribute("opacity", "0.9");
    svg.appendChild(bar);
    return svg;
  }

  function rectToPoint(rect) {
    if (!rect) return null;
    var left = Number(rect.left);
    var right = Number(rect.right);
    var top = Number(rect.top);
    var bottom = Number(rect.bottom);
    if (!Number.isFinite(left) || !Number.isFinite(right) ||
        !Number.isFinite(top) || !Number.isFinite(bottom)) return null;
    if (Math.abs(right - left) < 1 && Math.abs(bottom - top) < 1) return null;
    return { x: right, y: top };
  }

  function rectToEdgePoint(rect, atEnd) {
    if (!rect) return null;
    var left = Number(rect.left);
    var right = Number(rect.right);
    var top = Number(rect.top);
    var bottom = Number(rect.bottom);
    if (!Number.isFinite(left) || !Number.isFinite(right) ||
        !Number.isFinite(top) || !Number.isFinite(bottom)) return null;
    if (Math.abs(right - left) < 1 && Math.abs(bottom - top) < 1) return null;
    return { x: atEnd ? right : left, y: top };
  }

  function rectArea(rect) {
    if (!rect) return 0;
    return Math.max(0, (Number(rect.right) || 0) - (Number(rect.left) || 0)) *
      Math.max(0, (Number(rect.bottom) || 0) - (Number(rect.top) || 0));
  }

  function rectOverlapArea(a, b) {
    if (!a || !b) return 0;
    var left = Math.max(Number(a.left) || 0, Number(b.left) || 0);
    var right = Math.min(Number(a.right) || 0, Number(b.right) || 0);
    var top = Math.max(Number(a.top) || 0, Number(b.top) || 0);
    var bottom = Math.min(Number(a.bottom) || 0, Number(b.bottom) || 0);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  }

  function rectCenterInside(rect, container) {
    if (!rect || !container) return false;
    var x = ((Number(rect.left) || 0) + (Number(rect.right) || 0)) / 2;
    var y = ((Number(rect.top) || 0) + (Number(rect.bottom) || 0)) / 2;
    return x >= (Number(container.left) || 0) - 0.5 &&
      x <= (Number(container.right) || 0) + 0.5 &&
      y >= (Number(container.top) || 0) - 0.5 &&
      y <= (Number(container.bottom) || 0) + 0.5;
  }

  function rectIsSelected(charRect, selectedRects) {
    var area = rectArea(charRect);
    if (!area) return false;
    for (var i = 0; i < selectedRects.length; i++) {
      var selRect = selectedRects[i];
      if (rectCenterInside(charRect, selRect)) return true;
      if (rectOverlapArea(charRect, selRect) / area > 0.45) return true;
    }
    return false;
  }

  function selectionEndPoint(selection) {
    try {
      if (!selection || !selection.rangeCount) return null;
      var range = selection.getRangeAt(selection.rangeCount - 1);
      var rects = range.getClientRects ? Array.prototype.slice.call(range.getClientRects()) : [];
      for (var i = rects.length - 1; i >= 0; i--) {
        var point = rectToPoint(rects[i]);
        if (point) return point;
      }
      return rectToPoint(range.getBoundingClientRect ? range.getBoundingClientRect() : null);
    } catch (e) {
      return null;
    }
  }

  function selectionBoundaryEquals(node, offset, boundaryNode, boundaryOffset) {
    return node === boundaryNode && Number(offset) === Number(boundaryOffset);
  }

  function selectionFocusIsEnd(selection, range) {
    try {
      if (!selection || !range) return true;
      if (selectionBoundaryEquals(selection.focusNode, selection.focusOffset, range.endContainer, range.endOffset)) return true;
      if (selectionBoundaryEquals(selection.focusNode, selection.focusOffset, range.startContainer, range.startOffset)) return false;
      var doc = selection.focusNode && selection.focusNode.ownerDocument;
      if (!doc || !doc.createRange) return true;
      var focusRange = doc.createRange();
      focusRange.setStart(selection.focusNode, selection.focusOffset);
      focusRange.collapse(true);
      return range.compareBoundaryPoints(range.START_TO_START, focusRange) <= 0 &&
        range.compareBoundaryPoints(range.END_TO_START, focusRange) <= 0;
    } catch (e) {
      return true;
    }
  }

  function rangeRectPoint(range, atEnd) {
    try {
      if (!range) return null;
      var rects = range.getClientRects ? Array.prototype.slice.call(range.getClientRects()) : [];
      if (!rects.length && range.getBoundingClientRect) rects = [range.getBoundingClientRect()];
      for (var i = atEnd ? rects.length - 1 : 0;
           atEnd ? i >= 0 : i < rects.length;
           atEnd ? i-- : i++) {
        var point = rectToEdgePoint(rects[i], atEnd);
        if (point) return point;
      }
    } catch (e) {}
    return null;
  }

  function selectionFocusPoint(selection) {
    try {
      if (!selection || !selection.rangeCount || !selection.focusNode) return null;
      var range = selection.getRangeAt(selection.rangeCount - 1);
      var atEnd = selectionFocusIsEnd(selection, range);
      var doc = selection.focusNode.ownerDocument;
      if (!doc || !doc.createRange) return null;

      var caret = doc.createRange();
      caret.setStart(selection.focusNode, selection.focusOffset);
      caret.collapse(true);
      var caretPoint = rangeRectPoint(caret, atEnd);
      if (caretPoint) return caretPoint;

      var node = selection.focusNode;
      var offset = Number(selection.focusOffset) || 0;
      var probe = doc.createRange();
      if (node.nodeType === 3) {
        var len = node.nodeValue ? node.nodeValue.length : 0;
        if (atEnd && offset > 0) {
          probe.setStart(node, Math.max(0, offset - 1));
          probe.setEnd(node, offset);
          return rangeRectPoint(probe, true);
        }
        if (!atEnd && offset < len) {
          probe.setStart(node, offset);
          probe.setEnd(node, Math.min(len, offset + 1));
          return rangeRectPoint(probe, false);
        }
      } else if (node.childNodes && node.childNodes.length) {
        var child = atEnd ? node.childNodes[Math.max(0, offset - 1)] : node.childNodes[Math.min(node.childNodes.length - 1, offset)];
        if (child) {
          probe.selectNodeContents(child);
          return rangeRectPoint(probe, atEnd);
        }
      }
      return atEnd ? selectionEndPoint(selection) : rangeRectPoint(range, false);
    } catch (e) {
      return null;
    }
  }

  function selectionEdgeRect(selection, atEnd) {
    try {
      if (!selection || !selection.rangeCount) return null;
      var range = selection.getRangeAt(atEnd ? selection.rangeCount - 1 : 0);
      var rects = range.getClientRects ? Array.prototype.slice.call(range.getClientRects()) : [];
      if (!rects.length && range.getBoundingClientRect) rects = [range.getBoundingClientRect()];
      rects = rects.filter(function (rect) { return !!rectToPoint(rect); }).sort(function (a, b) {
        if (Math.abs(a.top - b.top) > 3) return a.top - b.top;
        return a.left - b.left;
      });
      if (atEnd) rects.reverse();
      for (var i = 0; i < rects.length; i++) {
        var rect = rects[i];
        if (rectToPoint(rect)) return rect;
      }
    } catch (e) {}
    return null;
  }

  function textAtSelectionEdge(win, selection, atEnd) {
    try {
      var doc = win && win.document;
      var rect = selectionEdgeRect(selection, atEnd);
      if (!doc || !rect || !doc.elementFromPoint) return "";
      var x = atEnd ? Math.max(rect.left + 1, rect.right - 2) : rect.left + 2;
      var y = rect.top + Math.max(2, Math.min(rect.height || 12, 12) / 2);
      var el = doc.elementFromPoint(x, y);
      if (!el) return "";
      var candidates = [];
      var node = el;
      while (node && node !== doc.body && node !== doc.documentElement) {
        var text = cleanSelectionText(node.textContent || "");
        if (text && text.length <= 300) candidates.push(text);
        if (node.classList && node.classList.contains("textLayer")) break;
        node = node.parentElement;
      }
      return candidates.length ? candidates[0] : cleanSelectionText(el.textContent || "");
    } catch (e) {
      return "";
    }
  }

  function trimCopiedSelectionToVisibleEdges(text, win, selection) {
    text = cleanSelectionText(text || "");
    if (!text || !win || !selection || !selection.rangeCount) return text;
    var startHint = textAtSelectionEdge(win, selection, false);
    if (startHint) {
      var max = Math.min(80, startHint.length);
      for (var len = max; len >= 8; len--) {
        var piece = startHint.slice(0, len);
        var idx = text.indexOf(piece);
        if (idx > 0 && idx <= 40) {
          text = text.slice(idx);
          break;
        }
      }
      var m = text.match(/^([a-z]{2,18})(?=[A-ZΑ-ΩΦΨΣΩΘΛΞΠΓΔ])/);
      if (m) {
        var trimmed = text.slice(m[1].length);
        if (startHint.indexOf(trimmed.slice(0, Math.min(12, trimmed.length))) === 0) {
          text = trimmed;
        }
      }
    }
    return cleanSelectionText(text);
  }

  function edgeTextContent(node, atEnd, maxChars) {
    try {
      var text = cleanText(node && node.textContent || "");
      if (!text) return "";
      maxChars = maxChars || 120;
      return atEnd ? text.slice(Math.max(0, text.length - maxChars)) : text.slice(0, maxChars);
    } catch (e) {
      return "";
    }
  }

  function selectionBoundaryHint(selection, atEnd) {
    try {
      if (!selection || !selection.rangeCount) return "";
      var range = selection.getRangeAt(0);
      var node = atEnd ? range.endContainer : range.startContainer;
      var offset = Number(atEnd ? range.endOffset : range.startOffset) || 0;
      var text = "";
      if (node && node.nodeType === 3) {
        var value = cleanText(node.nodeValue || "");
        text = atEnd ? value.slice(Math.max(0, offset - 120), offset) : value.slice(offset, offset + 120);
      } else if (node && node.childNodes) {
        var child = atEnd
          ? node.childNodes[Math.max(0, Math.min(node.childNodes.length - 1, offset - 1))]
          : node.childNodes[Math.max(0, Math.min(node.childNodes.length - 1, offset))];
        text = edgeTextContent(child, atEnd, 120);
      }
      return cleanSelectionText(text).replace(/\s+/g, " ").trim();
    } catch (e) {
      return "";
    }
  }

  function hintOffsetInText(text, hint, fromEnd) {
    text = cleanSelectionText(text || "");
    hint = cleanSelectionText(hint || "");
    if (!text || !hint) return null;
    var directHint = hint.length > 90
      ? (fromEnd ? hint.slice(Math.max(0, hint.length - 90)) : hint.slice(0, 90))
      : hint;
    var directIdx = fromEnd ? text.lastIndexOf(directHint) : text.indexOf(directHint);
    if (directIdx >= 0) {
      return { start: directIdx, end: directIdx + directHint.length };
    }
    try {
      var hay = compactTextWithMap(text);
      var ned = compactTextWithMap(hint);
      if (!hay.compact || !ned.compact || ned.compact.length < 8) return null;
      var n = Math.min(80, Math.max(8, ned.compact.length));
      var needle = fromEnd ? ned.compact.slice(Math.max(0, ned.compact.length - n)) : ned.compact.slice(0, n);
      var idx = fromEnd ? hay.compact.lastIndexOf(needle) : hay.compact.indexOf(needle);
      if (idx < 0) return null;
      var start = hay.map[Math.max(0, idx)] || 0;
      var end = hay.map[Math.min(hay.map.length - 1, idx + needle.length - 1)] || start;
      return { start: start, end: Math.min(text.length, end + 1) };
    } catch (e) {
      return null;
    }
  }

  function trimSelectionTextToRange(text, selection) {
    text = cleanSelectionText(text || "");
    if (!text || !selection || !selection.rangeCount) return text;
    try {
      var startHint = selectionBoundaryHint(selection, false);
      var start = hintOffsetInText(text, startHint, false);
      if (start && start.start > 0 && start.start < Math.min(800, text.length)) {
        text = text.slice(start.start);
      }
      var endHint = selectionBoundaryHint(selection, true);
      var end = hintOffsetInText(text, endHint, true);
      if (end && end.end > 0 && end.end < text.length - 1) {
        var trailing = text.slice(end.end);
        if (trailing.length < 800 || /\n/.test(trailing)) text = text.slice(0, end.end);
      }
    } catch (e) {}
    return cleanSelectionText(text);
  }

  function selectionTextFromVisibleRects(win, selection) {
    try {
      var doc = win && win.document;
      if (!doc || !selection || selection.isCollapsed || !selection.rangeCount) return "";
      var range = selection.getRangeAt(0);
      var selectedRects = Array.prototype.slice.call(range.getClientRects ? range.getClientRects() : [])
        .filter(function (rect) { return rectToPoint(rect) && (rect.width || 0) > 1 && (rect.height || 0) > 1; });
      if (!selectedRects.length) return "";
      var root = nodeToElement(range.commonAncestorContainer);
      var textLayer = root && root.closest ? root.closest(".textLayer,#viewer,.page,[data-page-number]") : null;
      textLayer = textLayer || doc;
      var walkerRoot = textLayer.nodeType ? textLayer : doc;
      var walker = doc.createTreeWalker(walkerRoot, 4, {
        acceptNode: function (node) {
          if (!node || !node.nodeValue || !node.nodeValue.trim()) return 2;
          var parent = node.parentElement || node.parentNode;
          if (parent && parent.closest &&
              parent.closest("#arxiv-daily-qa-sidebar,.ari-qa-selection-popup,button,input,textarea,select")) return 2;
          return 1;
        },
      });
      var pieces = [];
      var current = walker.nextNode();
      while (current) {
        var value = current.nodeValue || "";
        var token = "";
        for (var i = 0; i < value.length; i++) {
          var ch = value[i];
          var r = doc.createRange();
          try {
            r.setStart(current, i);
            r.setEnd(current, i + 1);
            var rects = Array.prototype.slice.call(r.getClientRects ? r.getClientRects() : []);
            var selected = false;
            for (var k = 0; k < rects.length; k++) {
              if (rectIsSelected(rects[k], selectedRects)) {
                selected = true;
                break;
              }
            }
            if (selected) token += ch;
            else if (token) {
              pieces.push(token);
              token = "";
            }
          } catch (charErr) {}
        }
        if (token) pieces.push(token);
        current = walker.nextNode();
      }
      return cleanSelectionText(pieces.join(" "));
    } catch (e) {
      return "";
    }
  }

  function frameOffsetToTop(frame) {
    var x = 0;
    var y = 0;
    var node = frame;
    while (node) {
      try {
        if (node.getBoundingClientRect) {
          var rect = node.getBoundingClientRect();
          x += Number(rect.left) || 0;
          y += Number(rect.top) || 0;
        }
        var ownerWin = node.ownerDocument && node.ownerDocument.defaultView;
        if (!ownerWin || ownerWin === mainWindow()) break;
        node = ownerWin.frameElement;
      } catch (e) {
        break;
      }
    }
    return { x: x, y: y };
  }

  function pointWithFrameOffset(point, frame) {
    if (!point) return null;
    var offset = frameOffsetToTop(frame);
    return { x: point.x + offset.x, y: point.y + offset.y };
  }

  function nodeToElement(node) {
    try {
      if (!node) return null;
      return node.nodeType === 1 ? node : node.parentElement || node.parentNode;
    } catch (e) {
      return null;
    }
  }

  function closestSelectionCopyTarget(selection, doc) {
    try {
      if (!selection || !selection.rangeCount || !doc) return null;
      var range = selection.getRangeAt(selection.rangeCount - 1);
      var candidates = [
        nodeToElement(selection.focusNode),
        nodeToElement(selection.anchorNode),
        nodeToElement(range.commonAncestorContainer),
        doc.activeElement,
      ].filter(Boolean);
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (el.closest) {
          var textLayer = el.closest(".textLayer,[data-main-rotation],#viewerContainer,#viewer");
          if (textLayer) return textLayer;
        }
      }
      return candidates[0] || doc.body || doc.documentElement;
    } catch (e) {
      return doc && (doc.body || doc.documentElement);
    }
  }

  function fakeClipboardData() {
    var store = {};
    var types = [];
    return {
      types: types,
      files: [],
      items: [],
      setData: function (type, value) {
        type = String(type || "").toLowerCase();
        store[type] = String(value || "");
        if (types.indexOf(type) < 0) types.push(type);
        return true;
      },
      getData: function (type) {
        type = String(type || "").toLowerCase();
        return store[type] || "";
      },
      clearData: function (type) {
        if (type) {
          type = String(type).toLowerCase();
          delete store[type];
          var idx = types.indexOf(type);
          if (idx >= 0) types.splice(idx, 1);
        } else {
          store = {};
          types.splice(0, types.length);
        }
      },
    };
  }

  function clipboardService() {
    try {
      if (typeof Services !== "undefined" && Services.clipboard) return Services.clipboard;
    } catch (e) {}
    try {
      if (typeof Components !== "undefined" && Components.classes && Components.interfaces) {
        return Components.classes["@mozilla.org/widget/clipboard;1"]
          .getService(Components.interfaces.nsIClipboard);
      }
    } catch (e2) {}
    return null;
  }

  function initTransferable(transferable, win) {
    if (!transferable || typeof transferable.init !== "function") return;
    try {
      transferable.init(null);
      return;
    } catch (e) {}
    try {
      var loadContext = win && win.docShell && win.docShell.QueryInterface
        ? win.docShell.QueryInterface(Components.interfaces.nsILoadContext)
        : null;
      transferable.init(loadContext);
    } catch (e2) {}
  }

  function readClipboardText(win) {
    try {
      if (typeof Components === "undefined" || !Components.classes || !Components.interfaces) return null;
      var clipboard = clipboardService();
      if (!clipboard) return null;
      var transferable = Components.classes["@mozilla.org/widget/transferable;1"]
        .createInstance(Components.interfaces.nsITransferable);
      initTransferable(transferable, win || mainWindow());
      transferable.addDataFlavor("text/unicode");
      clipboard.getData(transferable, clipboard.kGlobalClipboard);
      var data = {};
      var dataLen = {};
      transferable.getTransferData("text/unicode", data, dataLen);
      var value = data && data.value;
      if (!value) return "";
      try {
        value = value.QueryInterface(Components.interfaces.nsISupportsString);
      } catch (e) {}
      var text = typeof value === "string" ? value : (value && value.data ? value.data : "");
      var len = dataLen && Number(dataLen.value) ? Math.floor(Number(dataLen.value) / 2) : text.length;
      return cleanText(text.slice(0, len));
    } catch (e2) {
      return null;
    }
  }

  function writeClipboardText(text) {
    try {
      if (typeof Components !== "undefined" &&
          Components.classes &&
          Components.interfaces &&
          Components.classes["@mozilla.org/widget/clipboardhelper;1"]) {
        Components.classes["@mozilla.org/widget/clipboardhelper;1"]
          .getService(Components.interfaces.nsIClipboardHelper)
          .copyString(cleanText(text || ""));
        return true;
      }
    } catch (e) {}
    return false;
  }

  function compactForCompare(text) {
    try {
      return compactTextWithMap(text || "").compact || "";
    } catch (e) {
      return cleanText(text || "").replace(/\s+/g, "").toLowerCase();
    }
  }

  function clipboardTextLooksRelated(copied, fallback) {
    copied = cleanSelectionText(copied || "");
    fallback = cleanSelectionText(fallback || "");
    if (!copied || !fallback) return true;
    var c = compactForCompare(copied);
    var f = compactForCompare(fallback);
    if (!c || !f || c.length < 8 || f.length < 8) return true;
    var cHead = c.slice(0, Math.min(80, c.length));
    var cTail = c.slice(Math.max(0, c.length - Math.min(80, c.length)));
    var fHead = f.slice(0, Math.min(80, f.length));
    return f.indexOf(cHead) >= 0 || f.indexOf(cTail) >= 0 || c.indexOf(fHead) >= 0;
  }

  function trimCopyEventLeadingNoise(copied, fallback) {
    copied = cleanSelectionText(copied || "");
    fallback = cleanSelectionText(fallback || "");
    if (!copied || !fallback || copied === fallback) return copied;
    var max = Math.min(120, fallback.length);
    for (var len = max; len >= 10; len--) {
      var head = fallback.slice(0, len);
      var idx = copied.indexOf(head);
      if (idx > 0 && idx <= 80) return cleanSelectionText(copied.slice(idx));
    }
    try {
      var c = compactTextWithMap(copied);
      var f = compactTextWithMap(fallback);
      var anchorLen = Math.min(80, Math.max(14, Math.floor(f.compact.length * 0.2)));
      var anchor = f.compact.slice(0, anchorLen);
      var compactIdx = anchor ? c.compact.indexOf(anchor) : -1;
      if (compactIdx > 0 && compactIdx <= 80 && c.map[compactIdx] > 0 && c.map[compactIdx] <= 80) {
        return cleanSelectionText(copied.slice(c.map[compactIdx]));
      }
    } catch (e) {}
    return copied;
  }

  function doCommandWithController(doc, command) {
    try {
      var dispatcher = doc && doc.commandDispatcher;
      var controller = dispatcher && dispatcher.getControllerForCommand
        ? dispatcher.getControllerForCommand(command)
        : null;
      if (!controller) return false;
      if (controller.isCommandEnabled && !controller.isCommandEnabled(command)) return false;
      if (controller.doCommand) {
        controller.doCommand(command);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function domWindowUtils(win) {
    try {
      if (win && win.windowUtils) return win.windowUtils;
    } catch (e) {}
    try {
      if (win && win.QueryInterface && typeof Components !== "undefined") {
        return win.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
          .getInterface(Components.interfaces.nsIDOMWindowUtils);
      }
    } catch (e2) {}
    return null;
  }

  function sendTrustedCopyShortcut(win) {
    try {
      if (!win) return false;
      if (typeof win.focus === "function") win.focus();
      try {
        var active = win.document && win.document.activeElement;
        if (active && typeof active.focus === "function") active.focus();
      } catch (focusErr) {}
      var utils = domWindowUtils(win);
      if (!utils || typeof utils.sendKeyEvent !== "function") return false;
      var accel = Number(utils.MODIFIER_ACCEL || utils.MODIFIER_CONTROL || 2);
      var keyCode = win.KeyboardEvent && win.KeyboardEvent.DOM_VK_C ? win.KeyboardEvent.DOM_VK_C : 67;
      var charCode = "c".charCodeAt(0);
      utils.sendKeyEvent("keydown", keyCode, 0, accel);
      utils.sendKeyEvent("keypress", 0, charCode, accel);
      utils.sendKeyEvent("keyup", keyCode, 0, accel);
      return true;
    } catch (e) {
      return false;
    }
  }

  function executeNativeCopyCommand(win) {
    var ok = false;
    try { if (win && typeof win.focus === "function") win.focus(); } catch (e) {}
    try {
      ok = sendTrustedCopyShortcut(win) || ok;
    } catch (eKey0) {}
    try {
      var focused = mainWindow() && mainWindow().document && mainWindow().document.commandDispatcher
        ? mainWindow().document.commandDispatcher.focusedWindow
        : null;
      if (focused && focused !== win) ok = sendTrustedCopyShortcut(focused) || ok;
    } catch (eKey1) {}
    try {
      if (win && win.document) ok = doCommandWithController(win.document, "cmd_copy") || ok;
    } catch (e0) {}
    try {
      var topWin = mainWindow();
      if (!ok && topWin && topWin.document) {
        ok = doCommandWithController(topWin.document, "cmd_copy") || ok;
      }
    } catch (e1) {}
    try {
      if (win && typeof win.goDoCommand === "function") {
        win.goDoCommand("cmd_copy");
        ok = true;
      }
    } catch (e2) {}
    try {
      var top = mainWindow();
      if (!ok && top && typeof top.goDoCommand === "function") {
        top.goDoCommand("cmd_copy");
        ok = true;
      }
    } catch (e3) {}
    try {
      if (!ok && typeof goDoCommand === "function") {
        goDoCommand("cmd_copy");
        ok = true;
      }
    } catch (e4) {}
    try {
      if (!ok && win && win.document && typeof win.document.execCommand === "function") {
        ok = !!win.document.execCommand("copy") || ok;
      }
    } catch (e5) {}
    try {
      var main = mainWindow();
      if (!ok && main && main.document && typeof main.document.execCommand === "function") {
        ok = !!main.document.execCommand("copy") || ok;
      }
    } catch (e6) {}
    return ok;
  }

  function captureSelectionViaNativeCopy(found, fallbackText) {
    var win = found && found.win ? found.win : mainWindow();
    var before = readClipboardText(win);
    var copiedText = "";
    var copied = false;
    try {
      restoreSelectionForNativeCopy(found);
      copied = executeNativeCopyCommand(win);
      copiedText = readClipboardText(win) || "";
    } catch (e) {
      copiedText = "";
    }
    if (before !== null) {
      try { writeClipboardText(before); } catch (restoreErr) {}
    }
    copiedText = cleanSelectionText(copiedText || "");
    if (!copiedText) return null;
    if (!copied && copiedText === before) return null;
    if (copiedText === before && !clipboardTextLooksRelated(copiedText, fallbackText || (found && found.text))) {
      return null;
    }
    var fallback = cleanSelectionText(fallbackText || (found && found.text) || "");
    return makeSelectionRecord({
      text: copiedText,
      html: found && found.html,
      source: "native-copy-command",
      debug: joinDebugParts([
        "beforeLen=" + (before === null ? "unreadable" : String(cleanSelectionText(before).length)),
        "copiedFlag=" + copied,
        "copiedLen=" + copiedText.length,
        "fallbackLen=" + fallback.length,
        "copiedHead=" + debugSnippet(copiedText, 90),
        fallback ? "fallbackHead=" + debugSnippet(fallback, 70) : "",
        found && found.debug ? found.debug : "",
      ]),
      point: found && found.point,
    });
  }

  function activeZoteroReader() {
    var win = mainWindow();
    try {
      if (win && win.ZoteroPane && win.ZoteroPane.getActiveReader) {
        var active = win.ZoteroPane.getActiveReader();
        if (active) return active;
      }
    } catch (e) {}
    try {
      var selectedID = win && win.Zotero_Tabs && (win.Zotero_Tabs.selectedID || win.Zotero_Tabs._selectedID);
      var zr = (typeof Zotero !== "undefined" && Zotero.Reader) ||
        (win && win.Zotero && win.Zotero.Reader);
      if (zr && selectedID && typeof zr.getByTabID === "function") {
        var byTab = zr.getByTabID(selectedID);
        if (byTab) return byTab;
      }
    } catch (e2) {}
    try {
      var readers = allZoteroReaders();
      var best = null;
      var bestScore = -Infinity;
      for (var i = 0; i < readers.length; i++) {
        var reader = readers[i];
        var internal = unwrapReader(reader);
        var score = 0;
        if (reader && (reader._isActive || reader.active || reader.selected)) score += 1000;
        if (internal && (internal._isActive || internal.active || internal.selected)) score += 1000;
        if (reader && readerWindowCandidates(reader).length) score += 100;
        score += Number(reader && reader._lastActiveTime || internal && internal._lastActiveTime || reader && reader.lastActiveTime || 0) / 1000000000000;
        if (score > bestScore) {
          bestScore = score;
          best = reader;
        }
      }
      return best;
    } catch (e3) {}
    return null;
  }

  function unwrapReader(reader) {
    try {
      if (!reader) return null;
      return reader._internalReader || reader.wrappedJSObject || reader;
    } catch (e) {
      return reader || null;
    }
  }

  function pushUniqueReader(list, reader) {
    if (!reader) return;
    try {
      for (var i = 0; i < list.length; i++) {
        if (list[i] === reader || unwrapReader(list[i]) === unwrapReader(reader)) return;
      }
    } catch (e) {}
    list.push(reader);
  }

  function allZoteroReaders() {
    try {
      if (typeof Zotero !== "undefined" && Zotero.Reader && Zotero.Reader._readers) {
        return Array.prototype.slice.call(Zotero.Reader._readers || []);
      }
    } catch (e) {}
    try {
      var win = mainWindow();
      if (win && win.Zotero && win.Zotero.Reader && win.Zotero.Reader._readers) {
        return Array.prototype.slice.call(win.Zotero.Reader._readers || []);
      }
    } catch (e2) {}
    return [];
  }

  function readerWindowCandidates(reader) {
    var windows = [];
    function add(win) {
      if (!win || windows.indexOf(win) >= 0) return;
      windows.push(win);
    }
    function addFrames(doc, depth) {
      if (!doc || !doc.querySelectorAll || depth > 3) return;
      var frames = [];
      try {
        frames = doc.querySelectorAll("iframe,browser,frame");
      } catch (e0) {
        frames = [];
      }
      for (var i = 0; i < frames.length; i++) {
        var frame = frames[i];
        var childWin = null;
        try { childWin = frame.contentWindow; } catch (e1) {}
        if (!childWin) {
          try { childWin = frame.contentDocument && frame.contentDocument.defaultView; } catch (e2) {}
        }
        add(childWin);
        try { addFrames(childWin && childWin.document, depth + 1); } catch (e3) {}
      }
    }
    try {
      var internal = unwrapReader(reader);
      add(reader && reader._iframeWindow);
      add(reader && reader._iframe && reader._iframe.contentWindow);
      add(reader && reader._browser && reader._browser.contentWindow);
      add(reader && reader._browser && reader._browser._contentWindow);
      add(reader && reader._browser && reader._browser.browsingContext && reader._browser.browsingContext.currentWindowGlobal && reader._browser.browsingContext.currentWindowGlobal.document && reader._browser.browsingContext.currentWindowGlobal.document.defaultView);
      add(internal && internal._iframeWindow);
      add(internal && internal._iframe && internal._iframe.contentWindow);
      add(internal && internal._browser && internal._browser.contentWindow);
      add(internal && internal._primaryView && internal._primaryView._iframeWindow);
      add(internal && internal._primaryView && internal._primaryView._iframe && internal._primaryView._iframe.contentWindow);
      add(internal && internal._primaryView && internal._primaryView._browser && internal._primaryView._browser.contentWindow);
      add(internal && internal._secondaryView && internal._secondaryView._iframeWindow);
      add(internal && internal._secondaryView && internal._secondaryView._iframe && internal._secondaryView._iframe.contentWindow);
      add(internal && internal._secondaryView && internal._secondaryView._browser && internal._secondaryView._browser.contentWindow);
      add(internal && internal._lastView && internal._lastView._iframeWindow);
      add(internal && internal._lastView && internal._lastView._iframe && internal._lastView._iframe.contentWindow);
      add(internal && internal._lastView && internal._lastView._browser && internal._lastView._browser.contentWindow);
      add(mainWindow());
      for (var w = 0; w < windows.length; w++) {
        try { addFrames(windows[w] && windows[w].document, 0); } catch (e4) {}
      }
    } catch (e) {}
    return windows;
  }

  function readerOwnsWindow(reader, win) {
    try {
      if (!reader || !win) return false;
      var windows = readerWindowCandidates(reader);
      for (var i = 0; i < windows.length; i++) {
        if (windows[i] === win) return true;
        if (windows[i] && windows[i].document && win.document && windows[i].document === win.document) return true;
      }
    } catch (e) {}
    return false;
  }

  function readerCandidates(found, readerOverride) {
    var readers = [];
    pushUniqueReader(readers, readerOverride);
    pushUniqueReader(readers, found && found.reader);
    pushUniqueReader(readers, activeZoteroReader());
    var all = allZoteroReaders();
    var foundWin = found && found.win;
    for (var i = 0; i < all.length; i++) {
      if (readerOwnsWindow(all[i], foundWin)) pushUniqueReader(readers, all[i]);
    }
    for (var j = 0; j < all.length; j++) pushUniqueReader(readers, all[j]);
    return readers;
  }

  function selectionLikelyFromZoteroReader(found) {
    try {
      if (!found) return false;
      var source = String(found.source || "");
      if (/^reader-|active-reader/.test(source)) return true;
      var readers = readerCandidates(found, null);
      for (var i = 0; i < readers.length; i++) {
        if (readerOwnsWindow(readers[i], found.win)) return true;
      }
    } catch (e) {}
    return false;
  }

  function readerDiagnosticSummary(reader, index, found) {
    try {
      var internal = unwrapReader(reader);
      var parts = ["reader" + index + "Internal=" + !!internal];
      parts.push("reader" + index + "OwnsFoundWin=" + readerOwnsWindow(reader, found && found.win));
      if (!internal) return parts.join(", ");
      parts.push("reader" + index + "LastPrimary=" + (internal._lastViewPrimary !== false));
      var state = internal._state || {};
      ["primaryViewSelectionPopup", "secondaryViewSelectionPopup"].forEach(function (key) {
        var popup = state[key];
        var text = cleanSelectionText(popup && popup.annotation && popup.annotation.text || "");
        parts.push("reader" + index + "." + key + "Len=" + text.length);
      });
      var views = readerViewsInOrder(internal);
      for (var v = 0; v < views.length; v++) {
        var ranges = views[v] && views[v]._selectionRanges;
        parts.push("reader" + index + ".view" + v + "Ranges=" + (ranges && ranges.length || 0));
        parts.push("reader" + index + ".view" + v + "Live=" + readerViewHasLiveSelection(views[v]));
      }
      return parts.join(", ");
    } catch (e) {
      return "reader" + index + "DebugError=" + (e.message || e);
    }
  }

  function setReaderMissDebug(found, readers) {
    try {
      var qa = globalThis.ArxivDailyQA;
      if (!qa) return;
      var parts = [
        "readerStateMiss=true",
        "readerCandidates=" + (readers && readers.length || 0),
        found && found.source ? "liveSource=" + found.source : "",
        found && found.text ? "liveLen=" + cleanSelectionText(found.text).length : "",
      ];
      for (var i = 0; i < (readers || []).length; i++) {
        parts.push(readerDiagnosticSummary(readers[i], i, found));
      }
      qa._lastReaderSelectionMissDebug = joinDebugParts(parts);
      qa._lastReaderSelectionMissAt = Date.now();
    } catch (e) {}
  }

  function readerSelectionPointFromState(internal, fallbackPoint) {
    try {
      var primary = internal && internal._lastViewPrimary !== false;
      var key = primary ? "primaryViewSelectionPopup" : "secondaryViewSelectionPopup";
      var popup = internal && internal._state && internal._state[key];
      var rect = popup && popup.rect;
      if (rect) {
        var left = Number(rect.left !== undefined ? rect.left : rect[0]);
        var top = Number(rect.top !== undefined ? rect.top : rect[1]);
        var right = Number(rect.right !== undefined ? rect.right : rect[2]);
        if (isFinite(left) && isFinite(top)) {
          return {
            x: isFinite(right) ? right : left,
            y: top,
          };
        }
      }
    } catch (e) {}
    return fallbackPoint || null;
  }

  function readerViewsInOrder(internal) {
    var primary = internal && internal._lastViewPrimary !== false;
    var raw = primary
      ? [internal && internal._primaryView, internal && internal._secondaryView, internal && internal._lastView]
      : [internal && internal._secondaryView, internal && internal._primaryView, internal && internal._lastView];
    var views = [];
    for (var i = 0; i < raw.length; i++) {
      if (raw[i] && views.indexOf(raw[i]) < 0) views.push(raw[i]);
    }
    return views;
  }

  function readerViewForPopupKey(internal, key) {
    if (!internal) return null;
    if (key === "primaryViewSelectionPopup") return internal._primaryView || null;
    if (key === "secondaryViewSelectionPopup") return internal._secondaryView || null;
    return null;
  }

  function readerViewHasLiveSelection(view) {
    try {
      if (!view || !view._selectionRanges || !view._selectionRanges.length) return false;
      return !view._selectionRanges[0].collapsed;
    } catch (e) {
      return false;
    }
  }

  function readerHasAnyLiveSelection(internal) {
    var views = readerViewsInOrder(internal);
    for (var i = 0; i < views.length; i++) {
      if (readerViewHasLiveSelection(views[i])) return true;
    }
    return false;
  }

  function readerTextRelatedToFound(text, found) {
    try {
      if (!found || !found.text || !text) return false;
      return clipboardTextLooksRelated(text, found.text) ||
        clipboardTextLooksRelated(found.text, text);
    } catch (e) {
      return false;
    }
  }

  function textFromReaderSelectionState(reader, found) {
    var internal = unwrapReader(reader);
    var debug = [];
    try {
      if (!internal) return null;
      var state = internal._state || {};
      var primary = internal._lastViewPrimary !== false;
      var popupKeys = primary
        ? ["primaryViewSelectionPopup", "secondaryViewSelectionPopup"]
        : ["secondaryViewSelectionPopup", "primaryViewSelectionPopup"];
      for (var i = 0; i < popupKeys.length; i++) {
        var popup = state[popupKeys[i]];
        var annotation = popup && popup.annotation;
        var popupText = cleanSelectionText(annotation && annotation.text || "");
        var popupLive = readerViewHasLiveSelection(readerViewForPopupKey(internal, popupKeys[i]));
        var popupRelated = readerTextRelatedToFound(popupText, found);
        debug.push(popupKeys[i] + "Len=" + popupText.length);
        debug.push(popupKeys[i] + "Live=" + popupLive);
        debug.push(popupKeys[i] + "Related=" + popupRelated);
        if (popupText && (popupLive || popupRelated)) {
          return makeSelectionRecord({
            text: popupText,
            html: "",
            source: "reader-state",
            debug: joinDebugParts([
              "readerStateSource=" + popupKeys[i] + ".annotation.text",
              "readerStateLen=" + popupText.length,
              "readerStateHead=" + debugSnippet(popupText, 90),
              debug.join("; "),
            ]),
            point: readerSelectionPointFromState(internal, null),
          });
        }
      }
      var views = readerViewsInOrder(internal);
      for (var v = 0; v < views.length; v++) {
        var view = views[v];
        if (!readerViewHasLiveSelection(view)) continue;
        var ranges = Array.prototype.slice.call(view._selectionRanges || []);
        var parts = [];
        for (var r = 0; r < ranges.length; r++) {
          var part = cleanSelectionText(ranges[r] && ranges[r].text || "");
          if (part) parts.push(part);
        }
        var text = cleanSelectionText(parts.join("\n"));
        debug.push("view" + v + "Ranges=" + ranges.length);
        debug.push("view" + v + "Len=" + text.length);
        if (text) {
          return makeSelectionRecord({
            text: text,
            html: "",
            source: "reader-state",
            debug: joinDebugParts([
              "readerStateSource=view._selectionRanges",
              "readerStateRanges=" + ranges.length,
              "readerStateLen=" + text.length,
              "readerStateHead=" + debugSnippet(text, 90),
              debug.join("; "),
            ]),
            point: readerSelectionPointFromState(internal, null),
          });
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function captureSelectionViaReaderCopy(reader, found) {
    var internal = unwrapReader(reader);
    try {
      if (!internal || typeof internal._handleSetDataTransferAnnotations !== "function") return null;
      if (!readerHasAnyLiveSelection(internal)) return null;
      var clipboard = fakeClipboardData();
      var copied = false;
      var views = readerViewsInOrder(internal);
      for (var i = 0; i < views.length && !copied; i++) {
        var view = views[i];
        if (!view || typeof view._handleCopy !== "function" || !readerViewHasLiveSelection(view)) continue;
        try {
          view._handleCopy({
            clipboardData: clipboard,
            preventDefault: function () {},
            stopPropagation: function () {},
          });
          copied = true;
        } catch (viewErr) {}
      }
      var plain = cleanSelectionText(
        clipboard.getData("text/plain") ||
        clipboard.getData("text/unicode") ||
        clipboard.getData("text")
      );
      var html = cleanText(clipboard.getData("text/html") || "");
      if (!plain) return null;
      return makeSelectionRecord({
        text: plain,
        html: html,
        source: "reader-copy-event",
        debug: joinDebugParts([
          "readerCopyEvent=true",
          "readerCopyLen=" + plain.length,
          "readerCopyHead=" + debugSnippet(plain, 90),
          found && found.debug ? found.debug : "",
        ]),
        point: (found && found.point) || readerSelectionPointFromState(internal, null),
      });
    } catch (e) {
      return null;
    }
  }

  function selectionFromZoteroReaderState(found, readerOverride, options) {
    options = options || {};
    var readers = readerCandidates(found, readerOverride);
    if (!readers.length) {
      setReaderMissDebug(found, readers);
      return null;
    }
    for (var i = 0; i < readers.length; i++) {
      var reader = readers[i];
      var stateRecord = textFromReaderSelectionState(reader, found);
      if (stateRecord && stateRecord.text) {
        stateRecord.point = stateRecord.point || (found && found.point) || null;
        stateRecord.debug = joinDebugParts([
          stateRecord.debug || "",
          "readerCandidateIndex=" + i,
          found && found.debug ? found.debug : "",
        ]);
        return stateRecord;
      }
      if (options.allowCopy !== false) {
        var copyRecord = captureSelectionViaReaderCopy(reader, found);
        if (copyRecord && copyRecord.text) {
          copyRecord.debug = joinDebugParts([
            copyRecord.debug || "",
            "readerCandidateIndex=" + i,
          ]);
          return copyRecord;
        }
      }
    }
    setReaderMissDebug(found, readers);
    return null;
  }

  function cachedNativeSelectionFor(found) {
    try {
      var qa = globalThis.ArxivDailyQA;
      var cached = qa && qa._lastNativeCopyCapture;
      if (!cached || !cached.text || Date.now() - (cached.at || 0) > 3500) return null;
      if (cached.contextKey && cached.contextKey !== activeContextKey()) return null;
      if (cached.signature && selectionSignature(found) && cached.signature !== selectionSignature(found)) return null;
      return makeSelectionRecord({
        text: cached.text,
        html: found && found.html || "",
        source: cached.source || "native-copy-cache",
        debug: joinDebugParts([
          cached.debug || "",
          found && found.debug ? found.debug : "",
        ]),
        point: found && found.point,
      });
    } catch (e) {
      return null;
    }
  }

  function cachedPopupSelectionRecord(found, fallbackText) {
    try {
      var cached = cachedNativeSelectionFor(found);
      if (cached && cached.text) return cached;
    } catch (e) {}
    return makeSelectionRecord({
      text: (found && found.text) || fallbackText || "",
      html: found && found.html || "",
      source: found && found.source || "selection-popup-cache",
      debug: joinDebugParts([
        found && found.debug ? found.debug : "",
        "popupCachedRecord=true",
      ]),
      point: found && found.point,
    });
  }

  function restoreSelectionForNativeCopy(found) {
    try {
      if (!found || !found.win || !found.ranges || !found.ranges.length) return false;
      var win = found.win;
      if (typeof win.focus === "function") win.focus();
      var sel = win.getSelection ? win.getSelection() : null;
      if (!sel) return false;
      try { sel.removeAllRanges(); } catch (e) {}
      for (var i = 0; i < found.ranges.length; i++) {
        try { sel.addRange(found.ranges[i].cloneRange()); } catch (rangeErr) {}
      }
      return !!(sel.rangeCount && !sel.isCollapsed);
    } catch (e2) {
      return false;
    }
  }

  function createSyntheticCopyEvent(win, clipboard) {
    var doc = win && win.document;
    var event = null;
    try {
      if (typeof win.Event === "function") {
        event = new win.Event("copy", { bubbles: true, cancelable: true });
      }
    } catch (e) {}
    if (!event && doc && doc.createEvent) {
      try {
        event = doc.createEvent("Event");
        event.initEvent("copy", true, true);
      } catch (e2) {}
    }
    if (!event) return null;
    try {
      Object.defineProperty(event, "clipboardData", {
        value: clipboard,
        configurable: true,
      });
    } catch (e3) {
      try { event.clipboardData = clipboard; } catch (e4) {}
    }
    return event;
  }

  function selectionHTML(selection) {
    try {
      if (!selection || !selection.rangeCount) return "";
      var doc = selection.anchorNode && selection.anchorNode.ownerDocument;
      if (!doc) return "";
      var div = doc.createElement("div");
      for (var i = 0; i < selection.rangeCount; i++) {
        div.appendChild(selection.getRangeAt(i).cloneContents());
      }
      return div.innerHTML || "";
    } catch (e) {
      return "";
    }
  }

  function cloneSelectionRanges(selection) {
    var ranges = [];
    try {
      if (!selection || !selection.rangeCount) return ranges;
      for (var i = 0; i < selection.rangeCount; i++) {
        ranges.push(selection.getRangeAt(i).cloneRange());
      }
    } catch (e) {}
    return ranges;
  }

  function htmlFormulaHints(html) {
    html = String(html || "");
    if (!html) return "";
    try {
      var doc = mainWindow() && mainWindow().document;
      var parser = doc && doc.defaultView && doc.defaultView.DOMParser
        ? new doc.defaultView.DOMParser()
        : (typeof DOMParser !== "undefined" ? new DOMParser() : null);
      if (!parser) return "";
      var parsed = parser.parseFromString("<div>" + html + "</div>", "text/html");
      var root = parsed.body && parsed.body.firstElementChild;
      if (!root) return "";
      var walker = parsed.createTreeWalker(root, 1, null);
      var pieces = [];
      var node = walker.currentNode;
      while (node) {
        var tag = String(node.localName || "").toLowerCase();
        if (tag === "math" || tag === "mrow" || tag === "mi" || tag === "mo" || tag === "mn") {
          var mathText = cleanSelectionText(node.textContent || "");
          if (mathText && pieces.indexOf(mathText) < 0) pieces.push(mathText);
        } else if (tag === "sub" || tag === "sup") {
          var marker = tag === "sub" ? "_" : "^";
          var value = cleanSelectionText(node.textContent || "");
          if (value) pieces.push(marker + "{" + value + "}");
        }
        node = walker.nextNode();
      }
      return pieces.join(" ").trim();
    } catch (e) {
      return "";
    }
  }

  function captureSelectionViaCopy(win, selection) {
    try {
      if (!win || !win.document || !selection || selection.isCollapsed || !selection.rangeCount) return null;
      var clipboard = fakeClipboardData();
      var event = createSyntheticCopyEvent(win, clipboard);
      if (!event || !event.clipboardData) return null;
      var target = closestSelectionCopyTarget(selection, win.document);
      if (!target || !target.dispatchEvent) return null;
      target.dispatchEvent(event);
      var plain = cleanSelectionText(
        clipboard.getData("text/plain") ||
        clipboard.getData("text/unicode") ||
        clipboard.getData("text")
      );
      var html = cleanText(clipboard.getData("text/html") || "");
      if (!html) html = selectionHTML(selection);
      var formulaHints = htmlFormulaHints(html);
      if (!plain && html) plain = cleanSelectionText(formulaHints || html.replace(/<[^>]+>/g, " "));
      if (!plain) return null;
      if (formulaHints && plain.indexOf(formulaHints) < 0) {
        plain += "\n\n[公式/特殊字符线索]\n" + formulaHints;
      }
      return {
        text: plain,
        html: html,
        source: "copy-event",
        debug: "copyLen=" + plain.length + "; copyHead=" + debugSnippet(plain, 90),
      };
    } catch (e) {
      return null;
    }
  }

  function selectionFromWindow(win, options) {
    try {
      options = options || {};
      if (!win || !win.getSelection) return null;
      var sel = win.getSelection();
      if (!sel || sel.isCollapsed) return null;
      var domText = trimSelectionTextToRange(cleanSelectionText(sel && sel.toString ? sel.toString() : ""), sel);
      var copied = null;
      var visualText = "";
      if (!domText && options.allowCopy === true) {
        try { copied = captureSelectionViaCopy(win, sel); } catch (copyErr) {}
      }
      if (!domText && !(copied && copied.text) && options.allowVisualScan) {
        visualText = selectionTextFromVisibleRects(win, sel);
      }
      var rawCopiedText = cleanSelectionText(copied && copied.text || "");
      var text = domText || (copied && copied.text) || visualText;
      var source = domText ? "dom-selection" : ((copied && copied.text) ? (copied.source || "copy-event") : (visualText ? "visual-selection" : ""));
      if (!text) return null;
      return {
        win: win,
        selection: sel,
        text: text,
        html: copied && copied.html ? copied.html : "",
        point: selectionFocusPoint(sel) || selectionEndPoint(sel),
        source: source || "window",
        domText: domText,
        visualText: visualText,
        anchorText: domText || visualText,
        debug: joinDebugParts([
          "chosen=" + (source || "window"),
          "copyRawLen=" + rawCopiedText.length,
          "copyLen=" + cleanSelectionText(copied && copied.text || "").length,
          "domLen=" + cleanSelectionText(domText).length,
          "visualLen=" + cleanSelectionText(visualText).length,
          "copyRawHead=" + debugSnippet(rawCopiedText, 70),
          "copyHead=" + debugSnippet(copied && copied.text || "", 70),
          "domHead=" + debugSnippet(domText, 70),
          "visualHead=" + debugSnippet(visualText, 70),
          copied && copied.debug ? copied.debug : "",
        ]),
        ranges: cloneSelectionRanges(sel),
      };
    } catch (e) {
      return null;
    }
  }

  function selectionPointFromDocument(doc) {
    try {
      var win = doc && doc.defaultView;
      var sel = win && win.getSelection ? win.getSelection() : null;
      var point = selectionFocusPoint(sel) || selectionEndPoint(sel);
      var frame = win && win.frameElement;
      return frame ? pointWithFrameOffset(point, frame) : point;
    } catch (e) {
      return null;
    }
  }

  function textFromReaderSelectionEvent(event) {
    try {
      var params = event && event.params ? event.params : {};
      var annotation = params.annotation || {};
      var candidates = [
        annotation.text,
        annotation.comment,
        params.text,
        params.selectedText,
        params.selectionText,
      ];
      if (params.annotations && params.annotations.length) {
        for (var i = 0; i < params.annotations.length; i++) {
          candidates.push(params.annotations[i] && params.annotations[i].text);
        }
      }
      for (var j = 0; j < candidates.length; j++) {
        var text = cleanSelectionText(candidates[j]);
        if (text) return text;
      }
    } catch (e) {}
    return "";
  }

  function readerEventParamDebug(event) {
    try {
      var params = event && event.params ? event.params : {};
      var annotation = params.annotation || {};
      var values = {
        annotationText: annotation.text,
        annotationComment: annotation.comment,
        paramsText: params.text,
        selectedText: params.selectedText,
        selectionText: params.selectionText,
      };
      var parts = [];
      Object.keys(values).forEach(function (key) {
        var text = cleanSelectionText(values[key] || "");
        parts.push(key + "Len=" + text.length);
        if (text) parts.push(key + "Head=" + debugSnippet(text, 50));
      });
      if (params.annotations && params.annotations.length) {
        parts.push("annotationsLen=" + params.annotations.length);
      }
      return joinDebugParts(parts);
    } catch (e) {
      return "";
    }
  }

  function appendReaderSelectionAskButton(event, record) {
    try {
      record = makeSelectionRecord(record);
      if (!event || typeof event.append !== "function" || !event.doc || !record || !record.text) return false;
      var doc = event.doc;
      var button = doc.createElement("button");
      button.type = "button";
      button.className = "ari-qa-reader-selection-button";
      button.title = "向 LLM 提问选中部分";
      button.style.cssText =
        "display:inline-flex;align-items:center;gap:4px;min-width:0;height:24px;padding:0 7px;" +
        "border:1px solid ThreeDShadow;border-radius:4px;background:ButtonFace;color:ButtonText;" +
        "font:12px message-box,system-ui,sans-serif;cursor:pointer;";
      button.appendChild(logoNode(doc, 13));
      button.appendChild(doc.createTextNode("向LLM提问选中部分"));
      var activated = false;
      var contextKey = activeContextKey();
      function activate(e) {
        e.preventDefault();
        e.stopPropagation();
        if (activated) return;
        activated = true;
        try {
          var qa = globalThis.ArxivDailyQA;
          if (qa && qa.askAboutSelection) {
            var freshRecord = makeSelectionRecord(record);
            if (contextKey && contextKey !== activeContextKey()) return;
            qa._ignoredSelectionSignature = selectionSignature(record);
            qa._selectionClearUntil = Date.now() + 2500;
            qa._suppressSelectionAskUntil = Date.now() + 2500;
            qa._removeNativeSelectionAskPopup();
            freshRecord.debug = joinDebugParts([
              freshRecord.debug || "",
              "readerPopupButton=true",
              "readerPopupOriginalSource=" + (record.source || "unknown"),
              "readerPopupOriginalLen=" + cleanSelectionText(record.text).length,
              "readerPopupOriginalHead=" + debugSnippet(record.text, 90),
            ]);
            freshRecord.contextKey = contextKey || activeContextKey();
            qa.askAboutSelection(freshRecord);
          }
        } catch (clickErr) {
          logError("reader selection ask click failed: " + (clickErr.message || clickErr));
        }
      }
      button.addEventListener("mousedown", function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
      button.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        activate(e);
      });
      event.append(button);
      return true;
    } catch (e) {
      return false;
    }
  }

  function recentReaderSelectionCapture(maxAgeMs) {
    try {
      var qa = globalThis.ArxivDailyQA;
      var capture = qa && qa._lastReaderSelectionCapture;
      if (!capture || !capture.text) return null;
      if (Date.now() - (capture.at || 0) > (maxAgeMs || 1800)) return null;
      if (capture.contextKey && capture.contextKey !== activeContextKey()) return null;
      return {
        win: mainWindow(),
        selection: null,
        text: capture.text,
        html: capture.html || "",
        point: capture.point || null,
        source: capture.source || "reader-event",
        debug: capture.debug || "",
      };
    } catch (e) {
      return null;
    }
  }

  function recentReaderPopupButtonActive(maxAgeMs) {
    try {
      var qa = globalThis.ArxivDailyQA;
      if (!qa || !qa._readerSelectionButtonUntil) return false;
      if (Date.now() > qa._readerSelectionButtonUntil) return false;
      return Date.now() - (qa._readerSelectionButtonAt || 0) < (maxAgeMs || 6500);
    } catch (e) {
      return false;
    }
  }

  function recentReaderSelectionMissDebug(maxAgeMs) {
    try {
      var qa = globalThis.ArxivDailyQA;
      var debug = qa && qa._lastReaderSelectionMissDebug;
      var at = qa && qa._lastReaderSelectionMissAt;
      if (!debug) return "";
      if (at && Date.now() - at > (maxAgeMs || 4000)) return "";
      return debug;
    } catch (e) {
      return "";
    }
  }

  function pointsClose(a, b, maxDistance) {
    if (!a || !b) return false;
    var dx = (Number(a.x) || 0) - (Number(b.x) || 0);
    var dy = (Number(a.y) || 0) - (Number(b.y) || 0);
    return Math.sqrt(dx * dx + dy * dy) <= (maxDistance || 120);
  }

  function selectionSignature(found) {
    if (!found || !found.text) return "";
    var text = cleanText(found.text || "").replace(/\s+/g, " ").trim();
    var point = found.point ? (Math.round(found.point.x) + "," + Math.round(found.point.y)) : "";
    return text + "@" + point;
  }

  function selectionTextSignature(found) {
    var text = cleanSelectionText(found && found.text || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return simpleHash(text);
  }

  function currentSelectionTextSignature(doc) {
    try {
      return directDocSelectionTextSignature(doc);
    } catch (e) {
      return "";
    }
  }

  function directDocSelectionTextSignature(doc) {
    try {
      var sel = doc && doc.defaultView && doc.defaultView.getSelection ? doc.defaultView.getSelection() : null;
      var text = cleanSelectionText(sel && !sel.isCollapsed && sel.toString ? sel.toString() : "");
      return text ? simpleHash(text) : "";
    } catch (e) {
      return "";
    }
  }

  function clearDocumentSelection(doc) {
    try {
      var sel = doc && doc.defaultView && doc.defaultView.getSelection ? doc.defaultView.getSelection() : null;
      if (sel && sel.rangeCount) sel.removeAllRanges();
    } catch (e) {}
  }

  function simpleHash(text) {
    var str = cleanText(text || "");
    var hash = 2166136261;
    for (var i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }

  function tabValuePart(value) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (typeof value !== "object") return "";
    var keys = ["id", "tabID", "type", "itemID", "dataKey", "title", "selected"];
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      try {
        if (value[keys[i]] !== undefined && value[keys[i]] !== null && value[keys[i]] !== "") {
          parts.push(keys[i] + "=" + String(value[keys[i]]));
        }
      } catch (e) {}
    }
    return parts.join(",");
  }

  function zoteroTabSignature(win) {
    try {
      var tabs = win && win.Zotero_Tabs;
      if (!tabs) return "";
      var parts = [];
      var props = [
        "selectedID", "selectedIndex", "selectedType", "selectedTabID",
        "selected", "_selectedID", "_selectedIndex", "_selectedType",
      ];
      for (var i = 0; i < props.length; i++) {
        try {
          var part = tabValuePart(tabs[props[i]]);
          if (part) parts.push(props[i] + ":" + part);
        } catch (e) {}
      }
      var methods = ["getSelectedID", "getSelectedIndex", "getSelectedType", "getSelected"];
      for (var m = 0; m < methods.length; m++) {
        try {
          if (typeof tabs[methods[m]] !== "function") continue;
          var methodPart = tabValuePart(tabs[methods[m]]());
          if (methodPart) parts.push(methods[m] + ":" + methodPart);
        } catch (e2) {}
      }
      try {
        var list = tabs._tabs || tabs.tabs || [];
        var selectedIndex = Number(tabs.selectedIndex !== undefined ? tabs.selectedIndex : tabs._selectedIndex);
        for (var t = 0; t < list.length; t++) {
          var tab = list[t];
          if (!tab) continue;
          if (tab.selected || t === selectedIndex || tab.id === tabs.selectedID || tab.id === tabs._selectedID) {
            var selectedPart = tabValuePart(tab);
            if (selectedPart) parts.push("tab" + t + ":" + selectedPart);
          }
        }
      } catch (e3) {}
      return parts.join("|");
    } catch (e4) {
      return "";
    }
  }

  function readerPageHint(reader, internal, view, pdfViewer) {
    var props = [
      "currentPageNumber", "currentPage", "page", "pageIndex",
      "_currentPageNumber", "_currentPageIndex", "_pageIndex",
      "_lastPageIndex", "lastPageIndex",
    ];
    var owners = [pdfViewer, view, internal, reader];
    for (var i = 0; i < owners.length; i++) {
      var owner = owners[i];
      if (!owner) continue;
      for (var p = 0; p < props.length; p++) {
        try {
          var value = owner[props[p]];
          if (value !== undefined && value !== null && value !== "") return String(value);
        } catch (e) {}
      }
    }
    try {
      var windows = readerWindowCandidates(reader);
      for (var w = 0; w < windows.length; w++) {
        var doc = windows[w] && windows[w].document;
        if (!doc || !doc.querySelectorAll) continue;
        var pages = doc.querySelectorAll(".page[data-page-number]");
        var best = null;
        var bestScore = Infinity;
        var vh = windows[w].innerHeight || doc.documentElement.clientHeight || 800;
        for (var j = 0; j < pages.length; j++) {
          var rect = pages[j].getBoundingClientRect ? pages[j].getBoundingClientRect() : null;
          if (!rect || rect.bottom < 0 || rect.top > vh) continue;
          var score = Math.abs(rect.top);
          if (score < bestScore) {
            bestScore = score;
            best = pages[j];
          }
        }
        if (best) return String(best.getAttribute("data-page-number") || "");
      }
    } catch (e2) {}
    return "";
  }

  function readerPageValueFromObjects(reader, internal, view, pdfViewer) {
    var props = [
      "currentPageNumber", "currentPage", "page", "pageIndex",
      "_currentPageNumber", "_currentPageIndex", "_pageIndex",
      "_lastPageIndex", "lastPageIndex",
    ];
    var state = null;
    try { state = reader && reader._state || reader && reader.state || internal && internal._state || internal && internal.state || null; } catch (e0) {}
    var owners = [state, pdfViewer, view, internal, reader];
    for (var i = 0; i < owners.length; i++) {
      var owner = owners[i];
      if (!owner) continue;
      for (var p = 0; p < props.length; p++) {
        try {
          var value = owner[props[p]];
          if (value !== undefined && value !== null && value !== "") return value;
        } catch (e) {}
      }
    }
    return "";
  }

  function normalizeReaderPageNumber(page) {
    if (page === undefined || page === null || page === "") return "";
    var num = parseInt(page, 10);
    if (!isFinite(num)) return String(page);
    if (num >= 0 && String(page).indexOf(String(num)) === 0 && /index/i.test(String(page))) return String(num + 1);
    if (num === 0 && String(page) === "0") return "1";
    return String(num);
  }

  function readerPageDocumentLooksLikePDF(doc) {
    try {
      return !!(doc && doc.querySelector &&
        (doc.querySelector(".page[data-page-number]") ||
         doc.querySelector(".textLayer") ||
         doc.querySelector("#viewer") ||
         doc.querySelector("#viewerContainer")));
    } catch (e) {
      return false;
    }
  }

  function visibleReaderPageElementInWindow(win) {
    try {
      var doc = win && win.document;
      if (!doc || !doc.querySelectorAll || !readerPageDocumentLooksLikePDF(doc)) return null;
      var pages = doc.querySelectorAll(".page[data-page-number]");
      var best = null;
      var bestScore = -Infinity;
      var vh = win.innerHeight || doc.documentElement.clientHeight || 800;
      var centerY = Math.max(0, vh * 0.5);
      for (var j = 0; j < pages.length; j++) {
        var page = pages[j];
        var rect = page.getBoundingClientRect ? page.getBoundingClientRect() : null;
        if (!rect || rect.bottom <= 0 || rect.top >= vh || rect.height <= 0) continue;
        var visible = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
        var centerDistance = Math.abs(((rect.top + rect.bottom) / 2) - centerY);
        var score = visible * 1000 - centerDistance;
        if (score > bestScore) {
          bestScore = score;
          best = page;
        }
      }
      return best;
    } catch (e) {}
    return null;
  }

  function currentReaderPageElement(reader, pageHint, preferVisible) {
    try {
      var normalized = normalizeReaderPageNumber(pageHint);
      var windows = readerWindowCandidates(reader);
      for (var w = 0; w < windows.length; w++) {
        if (preferVisible) {
          var visible = visibleReaderPageElementInWindow(windows[w]);
          if (visible) return visible;
        }
        var doc = windows[w] && windows[w].document;
        if (!doc || !doc.querySelectorAll) continue;
        if (normalized) {
          var exact = doc.querySelector('.page[data-page-number="' + normalized.replace(/"/g, '\\"') + '"]');
          if (exact) return exact;
        }
        var pages = doc.querySelectorAll(".page[data-page-number]");
        var best = null;
        var bestScore = Infinity;
        var vh = windows[w].innerHeight || doc.documentElement.clientHeight || 800;
        for (var j = 0; j < pages.length; j++) {
          var rect = pages[j].getBoundingClientRect ? pages[j].getBoundingClientRect() : null;
          if (!rect || rect.bottom < 0 || rect.top > vh) continue;
          var score = Math.abs(rect.top);
          if (score < bestScore) {
            bestScore = score;
            best = pages[j];
          }
        }
        if (best) return best;
      }
    } catch (e) {}
    return null;
  }

  function extractReaderPageText(pageEl, maxChars) {
    try {
      if (!pageEl) return "";
      var textRoot = null;
      try {
        textRoot = pageEl.querySelector(".textLayer") || pageEl;
      } catch (e0) {
        textRoot = pageEl;
      }
      var text = cleanText(textRoot && textRoot.textContent || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (!text) return "";
      if (maxChars && text.length > maxChars) text = text.slice(0, maxChars);
      return text;
    } catch (e) {}
    return "";
  }

  function currentReaderPageSnapshot(reader, pageHint, maxChars) {
    var out = { page: "", text: "", source: "" };
    try {
      var visiblePage = currentReaderPageElement(reader, "", true);
      if (visiblePage) {
        out.page = normalizeReaderPageNumber(visiblePage.getAttribute("data-page-number") || pageHint || "");
        out.text = extractReaderPageText(visiblePage, maxChars);
        out.source = "pdfjs-visible-page";
        return out;
      }
      var exactPage = currentReaderPageElement(reader, pageHint, false);
      if (exactPage) {
        out.page = normalizeReaderPageNumber(exactPage.getAttribute("data-page-number") || pageHint || "");
        out.text = extractReaderPageText(exactPage, maxChars);
        out.source = "pdfjs-hinted-page";
        return out;
      }
      out.page = normalizeReaderPageNumber(pageHint || "");
      out.source = out.page ? "reader-state" : "";
    } catch (e) {}
    return out;
  }

  function currentReaderPageText(reader, pageHint, maxChars) {
    return currentReaderPageSnapshot(reader, pageHint, maxChars).text || "";
  }

  function activeContextKey() {
    var win = mainWindow();
    var parts = [];
    try {
      parts.push("tab:" + zoteroTabSignature(win));
    } catch (e) {}
    try {
      var reader = activeZoteroReader();
      var internal = unwrapReader(reader);
      parts.push("reader:" + (reader && reader.itemID || internal && internal.itemID || ""));
      parts.push("readerKey:" + (reader && reader._instanceID || reader && reader.id || internal && internal._instanceID || ""));
      var view = internal && (internal._primaryView || internal._lastView || internal._lastViewPrimary || null);
      var pdfViewer = view && (view._pdfViewer || view.pdfViewer) ||
        internal && (internal._pdfViewer || internal.pdfViewer) ||
        reader && (reader._pdfViewer || reader.pdfViewer);
      var state = reader && reader._state || reader && reader.state || internal && internal._state || internal && internal.state || {};
      var page = state.pageIndex || state.page || state.currentPage ||
        internal && (internal._lastPageIndex || internal._currentPageIndex || internal._pageIndex) ||
        view && (view._currentPageIndex || view._pageIndex || view.pageIndex) ||
        pdfViewer && (pdfViewer.currentPageNumber || pdfViewer.currentPage || pdfViewer.page) ||
        readerPageHint(reader, internal, view, pdfViewer);
      parts.push("page:" + (page === undefined || page === null ? "" : String(page)));
    } catch (e2) {}
    try {
      if (typeof ArxivDailyCenterWorkspace !== "undefined") {
        parts.push("report:" + (ArxivDailyCenterWorkspace._currentReportDate || ""));
        var meta = ArxivDailyCenterWorkspace._currentMeta || {};
        parts.push("center:" + (meta.arxivId || meta.paperId || meta.title || ""));
      }
    } catch (e3) {}
    try {
      if (win && win.location) parts.push("loc:" + String(win.location.href || "").slice(0, 160));
    } catch (e4) {}
    return simpleHash(parts.join("|"));
  }

  function currentSelectionSignature(doc) {
    try {
      var textSig = directDocSelectionTextSignature(doc);
      return textSig ? "text:" + textSig : "";
    } catch (e) {
      return "";
    }
  }

  function selectionSourceIsTrusted(source) {
    source = String(source || "");
    return source === "reader-event" ||
      source === "reader-state" ||
      source === "reader-copy-event" ||
      source === "active-reader-method" ||
      source === "native-copy-command" ||
      source === "native-copy-cache";
  }

  function makeSelectionFailureRecord(found, reason) {
    var fallback = cleanSelectionText(found && found.text || "");
    return makeSelectionRecord({
      text: fallback || "[未能精准读取 Zotero PDF 选区]",
      html: found && found.html || "",
      source: "reader-selection-miss",
      debug: joinDebugParts([
        reason || "readerSelectionMiss=true",
        recentReaderSelectionMissDebug(6000),
        found && found.debug ? found.debug : "",
        fallback ? "untrustedFallbackLen=" + fallback.length : "",
        fallback ? "untrustedFallbackHead=" + debugSnippet(fallback, 90) : "",
      ]),
      point: found && found.point,
    });
  }

  function selectionWithFreshReaderCapture(found) {
    if (!found || !found.text) return found;
    var readerRecord = selectionFromZoteroReaderState(found, null, { allowCopy: false });
    if (readerRecord && readerRecord.text) {
      var readerClose = pointsClose(found.point, readerRecord.point, 220);
      var readerRelated = clipboardTextLooksRelated(readerRecord.text, found.text) ||
        clipboardTextLooksRelated(found.text, readerRecord.text);
      if (readerClose || readerRelated) {
        var readerMerged = {};
        for (var rk in found) readerMerged[rk] = found[rk];
        readerMerged.text = readerRecord.text;
        readerMerged.html = readerRecord.html || found.html || "";
        readerMerged.source = readerRecord.source || "reader-state";
        readerMerged.debug = joinDebugParts([
          readerRecord.debug || "",
          "readerStateOverride=true",
          "liveSource=" + (found.source || "unknown"),
          "liveLen=" + cleanSelectionText(found.text).length,
          "liveHead=" + debugSnippet(found.text, 70),
          found.debug || "",
        ]);
        return readerMerged;
      }
    }
    var capture = recentReaderSelectionCapture(2500);
    if (!capture || !capture.text || !selectionSourceIsTrusted(capture.source)) return found;
    var close = pointsClose(found.point, capture.point, 180);
    var related = clipboardTextLooksRelated(capture.text, found.text) ||
      clipboardTextLooksRelated(found.text, capture.text);
    if (!close && !related) return found;
    var merged = {};
    for (var key in found) merged[key] = found[key];
    merged.text = capture.text;
    merged.html = capture.html || found.html || "";
    merged.source = capture.source || "reader-event";
    merged.debug = joinDebugParts([
      capture.debug || "",
      "readerCaptureOverride=true",
      "readerCaptureSource=" + (capture.source || "reader-event"),
      "readerCaptureLen=" + cleanSelectionText(capture.text).length,
      "readerCaptureHead=" + debugSnippet(capture.text, 70),
      "liveSource=" + (found.source || "unknown"),
      "liveLen=" + cleanSelectionText(found.text).length,
      "liveHead=" + debugSnippet(found.text, 70),
      found.debug || "",
    ]);
    return merged;
  }

  function selectionInsidePluginReader(doc) {
    try {
      var sel = doc && doc.defaultView && doc.defaultView.getSelection ? doc.defaultView.getSelection() : null;
      if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
      return nodeInsidePluginReader(sel.getRangeAt(0).commonAncestorContainer);
    } catch (e) {
      return false;
    }
  }

  function nodeInsidePluginReader(node) {
    try {
      var el = node && node.nodeType === 1 ? node : node && node.parentNode;
      return !!(el && el.closest && el.closest("#arxiv-daily-center-viewer,#arxiv-daily-qa-sidebar,.ari-qa-selection-popup"));
    } catch (e) {
      return false;
    }
  }

  function eventTargetBlocksSelectionAsk(event) {
    try {
      var nodes = [];
      var target = event && event.target;
      if (event && typeof event.composedPath === "function") {
        try { nodes = event.composedPath() || []; } catch (pathErr) { nodes = []; }
      }
      if (!nodes.length && target) {
        var node = target;
        for (var depth = 0; node && depth < 12; depth++) {
          nodes.push(node);
          node = node.parentNode || node.parentElement || node.ownerDocument && node.ownerDocument.defaultView && node.ownerDocument.defaultView.frameElement;
        }
      }
      for (var i = 0; i < nodes.length; i++) {
        var item = nodes[i];
        if (!item || item.nodeType !== 1) continue;
        if (item.closest &&
            item.closest("#arxiv-daily-center-viewer,#arxiv-daily-qa-sidebar,.ari-qa-selection-popup")) {
          return true;
        }
        var local = String(item.localName || item.tagName || "").toLowerCase();
        if (/^(button|toolbarbutton|tab|tabs|toolbar|input|textarea|select|menulist|menu|menuitem)$/.test(local)) {
          return true;
        }
        var id = String(item.id || "").toLowerCase();
        var cls = "";
        try {
          cls = typeof item.className === "string"
            ? item.className
            : item.className && item.className.baseVal || "";
        } catch (classErr) {}
        cls = String(cls || "").toLowerCase();
        var role = String(item.getAttribute && item.getAttribute("role") || "").toLowerCase();
        var text = id + " " + cls + " " + role;
        if (/(^|[\s_-])(tab|tabs|tabbar|toolbar|titlebar|zotero-tabs|tab-bar|title-bar)([\s_-]|$)/.test(text) ||
            /zotero[-_]?tabs|tab[-_]?bar|title[-_]?bar|tabs[-_]?toolbar/.test(text) ||
            role === "tab" || role === "tablist" || role === "toolbar") {
          return true;
        }
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  function frameVisibleForSelection(frame) {
    try {
      if (!frame || !frame.ownerDocument) return false;
      var win = frame.ownerDocument.defaultView;
      var node = frame;
      while (node && node.nodeType === 1) {
        if (node.hidden || node.collapsed ||
            node.getAttribute && (node.getAttribute("hidden") === "true" ||
              node.getAttribute("collapsed") === "true" ||
              node.getAttribute("aria-hidden") === "true")) return false;
        var parent = node.parentNode;
        if (parent && /deck$/i.test(String(parent.localName || parent.tagName || ""))) {
          var selectedIndex = typeof parent.selectedIndex !== "undefined"
            ? Number(parent.selectedIndex)
            : parseInt(parent.getAttribute && parent.getAttribute("selectedIndex") || "0", 10);
          var index = Array.prototype.indexOf.call(parent.children || [], node);
          if (index >= 0 && Number.isFinite(selectedIndex) && selectedIndex !== index) return false;
        }
        var style = win && win.getComputedStyle ? win.getComputedStyle(node) : null;
        if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
        node = parent && parent.nodeType === 1 ? parent : null;
      }
      var rect = frame.getBoundingClientRect ? frame.getBoundingClientRect() : null;
      if (rect) {
        if (rect.width < 2 || rect.height < 2) return false;
        var vw = win && win.innerWidth || frame.ownerDocument.documentElement.clientWidth || 0;
        var vh = win && win.innerHeight || frame.ownerDocument.documentElement.clientHeight || 0;
        if (vw && vh && (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh)) return false;
      }
      return true;
    } catch (e) {
      return true;
    }
  }

  function selectionWindowVisible(win) {
    try {
      if (!win || !win.document) return false;
      var top = mainWindow();
      if (win === top) return true;
      var current = win;
      for (var depth = 0; current && current !== top && depth < 8; depth++) {
        var frame = current.frameElement;
        if (!frame) break;
        if (!frameVisibleForSelection(frame)) return false;
        current = frame.ownerDocument && frame.ownerDocument.defaultView;
      }
      return true;
    } catch (e) {
      return true;
    }
  }

  function pointInMainViewport(point, margin) {
    try {
      if (!point) return false;
      margin = Number(margin) || 0;
      var win = mainWindow();
      var doc = win && win.document;
      var vw = win && win.innerWidth || doc && doc.documentElement && doc.documentElement.clientWidth || 0;
      var vh = win && win.innerHeight || doc && doc.documentElement && doc.documentElement.clientHeight || 0;
      if (!vw || !vh) return true;
      var x = Number(point.x);
      var y = Number(point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      return x >= -margin && x <= vw + margin && y >= -margin && y <= vh + margin;
    } catch (e) {
      return true;
    }
  }

  function eventBelongsToSelectionWindow(event, found) {
    try {
      if (!event || !found || !found.win || !event.target) return true;
      var targetDoc = event.target.ownerDocument || event.target.document || null;
      var foundDoc = found.win.document || null;
      if (!targetDoc || !foundDoc) return true;
      if (targetDoc === foundDoc) return true;
      var current = found.win;
      for (var depth = 0; current && depth < 8; depth++) {
        var frame = current.frameElement;
        if (!frame) break;
        if (targetDoc === frame.ownerDocument) {
          var path = [];
          try {
            path = typeof event.composedPath === "function" ? event.composedPath() || [] : [];
          } catch (pathErr) { path = []; }
          return path.indexOf(frame) >= 0 || event.target === frame;
        }
        current = frame.ownerDocument && frame.ownerDocument.defaultView;
      }
      return false;
    } catch (e) {
      return true;
    }
  }

  function selectionFromDocumentTree(doc, depth, options) {
    if (!doc || depth > 4) return null;
    var direct = selectionFromWindow(doc.defaultView, options);
    if (direct && options && options.excludePluginReader &&
        direct.selection && direct.selection.rangeCount) {
      try {
        if (nodeInsidePluginReader(direct.selection.getRangeAt(0).commonAncestorContainer)) direct = null;
      } catch (e0) {}
    }
    if (direct) return direct;
    var frames = [];
    try {
      frames = Array.prototype.slice.call(doc.querySelectorAll("iframe,browser"));
    } catch (e) {}
    for (var i = 0; i < frames.length; i++) {
      try {
        if (!frameVisibleForSelection(frames[i])) continue;
        var win = frames[i].contentWindow || (frames[i].contentDocument && frames[i].contentDocument.defaultView);
        var result = selectionFromWindow(win, options);
        if (result) {
          result.point = pointWithFrameOffset(result.point, frames[i]);
          return result;
        }
        if (win && win.document) {
          result = selectionFromDocumentTree(win.document, depth + 1, options);
          if (result) {
            result.point = pointWithFrameOffset(result.point, frames[i]);
            return result;
          }
        }
      } catch (e2) {}
    }
    return null;
  }

  function selectionFromReaderObject(reader) {
    if (!reader) return "";
    var stateRecord = selectionFromZoteroReaderState({ point: null, debug: "" }, reader, { allowCopy: false });
    if (stateRecord && stateRecord.text) return stateRecord;
    var paths = [
      ["_iframeWindow"],
      ["_internalReader", "_iframeWindow"],
      ["_internalReader", "_iframe", "contentWindow"],
      ["_iframe", "contentWindow"],
      ["iframe", "contentWindow"],
      ["_browser", "contentWindow"],
      ["browser", "contentWindow"],
      ["window"],
    ];
    for (var p = 0; p < paths.length; p++) {
      try {
        var obj = reader;
        for (var j = 0; j < paths[p].length && obj; j++) obj = obj[paths[p][j]];
        var found = selectionFromWindow(obj, { allowCopy: false });
        if (found && found.text) return found;
        if (obj && obj.document) {
          found = selectionFromDocumentTree(obj.document, 0, { excludePluginReader: true });
          if (found && found.text) return found;
        }
      } catch (e2) {}
    }
    var methodNames = [
      "getSelectedText",
      "getSelectedTextContent",
      "getSelectionText",
      "getSelectedAnnotationText",
    ];
    for (var i = 0; i < methodNames.length; i++) {
      try {
        if (typeof reader[methodNames[i]] !== "function") continue;
        var value = reader[methodNames[i]]();
        if (value && typeof value.then !== "function") {
          value = cleanText(value).trim();
          if (value) return { win: mainWindow(), selection: null, text: value, point: null, source: "active-reader-method" };
        }
      } catch (e) {}
    }
    return null;
  }

  function selectedTextFromReaderObject(reader) {
    var found = selectionFromReaderObject(reader);
    return found && found.text ? found.text : "";
  }

  function activeReaderHasWindowSelection(reader) {
    var found = selectionFromReaderObject(reader);
    return !!(found && found.text && found.point);
  }

  function selectedTextFromReaderMethodOnly(reader) {
    if (!reader) return "";
    var methodNames = [
      "getSelectedText",
      "getSelectedTextContent",
      "getSelectionText",
      "getSelectedAnnotationText",
    ];
    for (var i = 0; i < methodNames.length; i++) {
      try {
        if (typeof reader[methodNames[i]] !== "function") continue;
        var value = reader[methodNames[i]]();
        if (value && typeof value.then !== "function") {
          value = cleanText(value).trim();
          if (value) return value;
        }
      } catch (e) {}
    }
    return "";
  }

  function readerHasActiveSelection(reader) {
    if (!reader) return false;
    if (activeReaderHasWindowSelection(reader)) return true;
    if (selectedTextFromReaderMethodOnly(reader)) return true;
    return false;
  }

  function selectionFromActiveReader() {
    var win = mainWindow();
    if (!win || !win.ZoteroPane || !win.ZoteroPane.getActiveReader) return null;
    try {
      var reader = activeZoteroReader();
      var direct = selectionFromZoteroReaderState(null, null, { allowCopy: false });
      if (direct && direct.text) return direct;
      var found = selectionFromReaderObject(reader);
      if (found && found.text) {
        found.source = found.source || "active-reader";
        return found;
      }
    } catch (e) {}
    return null;
  }

  function selectionFromFrames(doc) {
    var direct = selectionFromDocumentTree(doc, 0, { excludePluginReader: true });
    if (direct) {
      return selectionWithFreshReaderCapture(direct);
    }
    var recent = recentReaderSelectionCapture(3500);
    if (recent && recent.text && selectionSourceIsTrusted(recent.source)) return recent;
    var reader = selectionFromActiveReader();
    if (reader && reader.text) return reader;
    return null;
  }

  function selectionFromVisibleFramesOnly(doc, options) {
    options = options || {};
    var direct = selectionFromDocumentTree(doc, 0, {
      excludePluginReader: true,
      allowCopy: options.allowCopy === true,
      allowVisualScan: options.allowVisualScan === true,
    });
    return direct ? selectionWithFreshReaderCapture(direct) : null;
  }

  function bestSelectionTextForAsk(found, fallbackText) {
    var preferred = cleanSelectionText((found && found.text) || fallbackText || "");
    try {
      var win = found && found.win ? found.win : mainWindow();
      var sel = found && found.selection ? found.selection : (win && win.getSelection ? win.getSelection() : null);
      var copied = captureSelectionViaCopy(win, sel);
      if (copied && copied.text) return copied.text;
    } catch (e) {}
    return preferred;
  }

  function makeSelectionRecord(value) {
    if (!value) return null;
    if (typeof value === "object") {
      var text = cleanSelectionText(value.text || value.selectedText || "");
      if (!text) return null;
      return {
        text: text,
        html: cleanText(value.html || ""),
        source: String(value.source || "unknown"),
        debug: cleanText(value.debug || ""),
        contextKey: String(value.contextKey || ""),
        point: value.point || null,
      };
    }
    var plain = cleanSelectionText(value);
    return plain ? { text: plain, html: "", source: "plain", point: null } : null;
  }

  function selectionAnchorText(found, fallbackText) {
    var candidates = [
      found && found.anchorText,
      found && found.domText,
      found && found.visualText,
    ];
    for (var i = 0; i < candidates.length; i++) {
      var text = cleanSelectionText(candidates[i] || "");
      if (text && (!found || text !== cleanSelectionText(found.text || ""))) return text;
    }
    if (found && String(found.source || "") !== "copy-event") return cleanSelectionText(fallbackText || "");
    return "";
  }

  function bestSelectionForAsk(found, fallbackText) {
    var preferred = cleanSelectionText((found && found.text) || fallbackText || "");
    var html = cleanText(found && found.html || "");
    var source = found && found.source ? found.source : (preferred ? "selection" : "unknown");
    var debug = cleanText(found && found.debug || "");
    try {
      if (preferred && selectionSourceIsTrusted(source)) {
        return makeSelectionRecord({
          text: preferred,
          html: html,
          source: source,
          debug: debug,
          point: found && found.point,
        });
      }
      var win = found && found.win ? found.win : mainWindow();
      var sel = found && found.selection ? found.selection : (win && win.getSelection ? win.getSelection() : null);
      var copied = captureSelectionViaCopy(win, sel);
      if (copied && copied.text) {
        var rawCopiedText = cleanSelectionText(copied.text || "");
        var anchor = selectionAnchorText(found, fallbackText);
        copied.text = trimCopyEventLeadingNoise(copied.text, anchor || preferred);
        return makeSelectionRecord({
          text: copied.text,
          html: copied.html || (found && found.html) || "",
          source: copied.source || "copy-event",
          debug: joinDebugParts([
            copied.debug || "",
            rawCopiedText !== cleanSelectionText(copied.text || "") ? "copyLeadingTrimmed=true" : "",
            "copyRawHead=" + debugSnippet(rawCopiedText, 70),
            anchor ? "anchorLen=" + anchor.length : "",
            anchor ? "anchorHead=" + debugSnippet(anchor, 70) : "",
            preferred ? "fallbackSource=" + source : "",
            preferred ? "fallbackLen=" + preferred.length : "",
            preferred ? "fallbackHead=" + debugSnippet(preferred, 70) : "",
          ]),
          point: found && found.point,
        });
      }
      if (!html && copied && copied.html) html = copied.html;
    } catch (e) {}
    return makeSelectionRecord({
      text: preferred,
      html: html,
      source: source,
      debug: debug,
      point: found && found.point,
    });
  }

  function normalizeForLocateChar(ch) {
    ch = String(ch || "");
    if (!ch) return "";
    try { ch = ch.normalize("NFKC"); } catch (e) {}
    ch = ch
      .replace(/[\u00AD]/g, "")
      .replace(/[‐‑‒–—−]/g, "-")
      .toLowerCase();
    if (!ch || /\s/.test(ch)) return "";
    if (/["'`´‘’“”.,;:!?，。；：！？、()[\]{}<>《》]/.test(ch)) return "";
    return ch;
  }

  function compactTextWithMap(text) {
    text = cleanText(text || "");
    var chars = [];
    var map = [];
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      var code = ch.charCodeAt(0);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length) {
        var next = text[i + 1];
        var nextCode = next.charCodeAt(0);
        if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
          ch += next;
          i++;
        }
      }
      var normalized = normalizeForLocateChar(ch);
      if (!normalized) continue;
      for (var j = 0; j < normalized.length; j++) {
        chars.push(normalized[j]);
        map.push(i - (ch.length > 1 ? 1 : 0));
      }
    }
    return { compact: chars.join(""), map: map, original: text };
  }

  function locateSelectionInText(haystack, needle, radius) {
    haystack = cleanText(haystack || "");
    needle = cleanSelectionText(needle || "");
    if (!haystack || !needle) return null;
    radius = radius || 1200;

    var exact = haystack.indexOf(needle);
    if (exact >= 0) {
      var exactStart = Math.max(0, exact - radius);
      var exactEnd = Math.min(haystack.length, exact + needle.length + radius);
      return {
        found: true,
        confidence: "exact",
        snippet: haystack.slice(exactStart, exact) +
          "\n[[SELECTED_BEGIN]]\n" +
          haystack.slice(exact, exact + needle.length) +
          "\n[[SELECTED_END]]\n" +
          haystack.slice(exact + needle.length, exactEnd),
        selectedOriginal: haystack.slice(exact, exact + needle.length),
      };
    }

    var hay = compactTextWithMap(haystack);
    var ned = compactTextWithMap(needle);
    if (ned.compact.length < 10 || hay.compact.length < ned.compact.length) return null;

    var idx = hay.compact.indexOf(ned.compact);
    var startCompact = idx;
    var endCompact = idx >= 0 ? idx + ned.compact.length - 1 : -1;
    var confidence = "compact";
    if (idx < 0) {
      var anchorLen = Math.min(120, Math.max(28, Math.floor(ned.compact.length * 0.45)));
      var startAnchor = ned.compact.slice(0, anchorLen);
      var endAnchor = ned.compact.slice(Math.max(0, ned.compact.length - anchorLen));
      var startIdx = startAnchor.length >= 12 ? hay.compact.indexOf(startAnchor) : -1;
      var endIdx = endAnchor.length >= 12 ? hay.compact.indexOf(endAnchor, Math.max(0, startIdx)) : -1;
      if (startIdx >= 0) {
        startCompact = startIdx;
        endCompact = endIdx >= 0 ? endIdx + endAnchor.length - 1 : startIdx + startAnchor.length - 1;
        confidence = endIdx >= 0 ? "anchor-both" : "anchor-start";
      } else {
        return null;
      }
    }

    var start = hay.map[Math.max(0, startCompact)] || 0;
    var end = hay.map[Math.min(hay.map.length - 1, Math.max(startCompact, endCompact))] || start;
    end = Math.min(haystack.length, end + 1);
    var snippetStart = Math.max(0, start - radius);
    var snippetEnd = Math.min(haystack.length, end + radius);
    return {
      found: true,
      confidence: confidence,
      snippet: haystack.slice(snippetStart, start) +
        "\n[[SELECTED_BEGIN]]\n" +
        haystack.slice(start, end) +
        "\n[[SELECTED_END]]\n" +
        haystack.slice(end, snippetEnd),
      selectedOriginal: haystack.slice(start, end),
    };
  }

  function resolveSelectionAgainstContext(selection, ctx) {
    var record = makeSelectionRecord(selection);
    if (!record) return null;
    var candidates = [];
    if (ctx && ctx.readerPageText) candidates.push({ label: "current visible PDF page", text: ctx.readerPageText });
    if (ctx && ctx.reportText) candidates.push({ label: "当前插件阅读页", text: ctx.reportText });
    if (ctx && ctx.contextSearchText) candidates.push({ label: "当前可用全文/条目上下文", text: ctx.contextSearchText });
    if (ctx && ctx.contextText) candidates.push({ label: "已截断上下文", text: ctx.contextText });
    for (var i = 0; i < candidates.length; i++) {
      var located = locateSelectionInText(candidates[i].text, record.text, 1400);
      if (located && located.found) {
        record.locatedLabel = candidates[i].label;
        record.locatedConfidence = located.confidence;
        record.locatedSnippet = located.snippet;
        record.locatedOriginal = located.selectedOriginal;
        break;
      }
    }
    return record;
  }

  function selectionAskMode() {
    var mode = String(getConfig("ui.selectionAskMode", "") || "").trim();
    if (mode) return mode;
    return getConfig("ui.selectionAskPopup", true) === false ? "off" : "global";
  }

  async function getItemAsync(itemID) {
    if (!itemID || typeof Zotero === "undefined" || !Zotero.Items) return null;
    try {
      if (Zotero.Items.getAsync) return await Zotero.Items.getAsync(itemID);
    } catch (e) {}
    try {
      if (Zotero.Items.get) return Zotero.Items.get(itemID);
    } catch (e2) {}
    return null;
  }

  function creatorName(creator) {
    if (!creator) return "";
    return [creator.firstName || "", creator.lastName || ""].join(" ").trim() ||
      creator.name ||
      creator.lastName ||
      "";
  }

  function itemMetadataText(item, label) {
    if (!item || !item.getField) return "";
    var lines = ["## " + (label || "Zotero item")];
    var title = item.getField("title") || "";
    if (title) lines.push("Title: " + title);
    try {
      var creators = item.getCreators ? item.getCreators() : [];
      var names = [];
      for (var i = 0; creators && i < creators.length; i++) {
        var name = creatorName(creators[i]);
        if (name) names.push(name);
      }
      if (names.length) lines.push("Authors: " + names.join("; "));
    } catch (e) {}
    var fields = [
      ["Date", "date"],
      ["Publication", "publicationTitle"],
      ["DOI", "DOI"],
      ["Archive", "archive"],
      ["Archive ID", "archiveID"],
      ["URL", "url"],
      ["Abstract", "abstractNote"],
      ["Extra", "extra"],
    ];
    for (var f = 0; f < fields.length; f++) {
      var value = item.getField(fields[f][1]) || "";
      if (value) lines.push(fields[f][0] + ": " + value);
    }
    try {
      var tags = item.getTags ? item.getTags() : [];
      var names2 = tags.map(function (tag) { return tag.tag || ""; }).filter(Boolean);
      if (names2.length) lines.push("Tags: " + names2.join(", "));
    } catch (e2) {}
    return lines.join("\n");
  }

  async function readAttachmentCacheText(attachment, maxChars) {
    if (!attachment || typeof Zotero === "undefined" || !Zotero.Fulltext || !Zotero.File) return "";
    try {
      var cacheFile = Zotero.Fulltext.getItemCacheFile(attachment);
      if (!cacheFile || !cacheFile.exists || !cacheFile.exists()) return "";
      if (Zotero.File.getContentsAsync) {
        return await Zotero.File.getContentsAsync(cacheFile, "utf-8", maxChars || 50000);
      }
      if (Zotero.File.getContents) return Zotero.File.getContents(cacheFile).slice(0, maxChars || 50000);
    } catch (e) {}
    return "";
  }

  async function itemFullTextContext(item, maxChars) {
    if (!item) return "";
    var chunks = [];
    async function addAttachmentText(attachment, title) {
      var text = await readAttachmentCacheText(attachment, Math.max(6000, Math.floor(maxChars / 2)));
      if (text) chunks.push("## Full text cache: " + (title || attachment.getField && attachment.getField("title") || "attachment") + "\n" + text);
    }
    try {
      if (typeof item.isAttachment === "function" && item.isAttachment()) {
        await addAttachmentText(item, item.getField && item.getField("title"));
        if (item.parentItemID) {
          var parent = await getItemAsync(item.parentItemID);
          if (parent) chunks.unshift(itemMetadataText(parent, "Parent Zotero item"));
        }
        return truncateText(chunks.join("\n\n"), maxChars);
      }
    } catch (e) {}
    try {
      var attachmentIDs = item.getAttachments ? item.getAttachments() : [];
      for (var i = 0; attachmentIDs && i < attachmentIDs.length && chunks.join("\n").length < maxChars; i++) {
        var attachment = await getItemAsync(attachmentIDs[i]);
        if (attachment) await addAttachmentText(attachment, attachment.getField && attachment.getField("title"));
      }
    } catch (e2) {}
    return truncateText(chunks.join("\n\n"), maxChars);
  }

  globalThis.ArxivDailyQA = {
    _panel: null,
    _tabButton: null,
    _tabButtonTimer: null,
    _tabButtonAttempts: 0,
    _visible: false,
    _thread: null,
    _selectedModel: "",
    _thinkingDepth: "balanced",
    _nodes: {},
    _host: null,
    _outerHost: null,
    _hostState: null,
    _threads: [],
    _viewMode: "chat",
    _pendingSelectionText: "",
    _pendingSelection: null,
    _pendingSelectionContextKey: "",
    _selectionExpanded: false,
    _thinkingExpanded: {},
    _inputHeight: 96,
    _tabObserverID: null,
    _remountTimer: null,
    _lastFailedRequest: null,
    _titleSummaryPending: false,
    _confirmDeleteThreadID: "",
    _selectionAskPopup: null,
    _selectionAskContextKey: "",
    _selectionAskSourceWin: null,
    _selectionMousePosition: null,
    _selectionGestureUntil: 0,
    _selectionGestureContextKey: "",
    _nativeSelectionHandlersInstalled: false,
    _nativeSelectionTabChange: null,
    _nativeSelectionFrameHandlers: [],
    _nativeYieldHandlersInstalled: false,
    _nativeYieldMouseUp: null,
    _nativeYieldSelect: null,
    _selectionPollTimer: null,
    _pageInteractionTimer: null,
    _lastNativeSelectionText: "",
    _lastNativeSelectionPointKey: "",
    _lastNativeSelectionAt: 0,
    _lastNativeCopyCapture: null,
    _lastReaderSelectionMissDebug: "",
    _lastReaderSelectionMissAt: 0,
    _lastActiveContextKey: "",
    _selectionClearUntil: 0,
    _suppressSelectionAskUntil: 0,
    _readerSelectionButtonUntil: 0,
    _readerSelectionButtonAt: 0,
    _ignoredSelectionSignature: "",
    _ignoredSelectionTextSignature: "",
    _readerSelectionHandler: null,
    _readerSelectionListenerInstalled: false,
    _lastReaderSelectionCapture: null,
    _lastContextSnapshot: null,
    _lastContextSnapshotAt: 0,
    _lastContextRefreshAt: 0,

    init: function () {
      this._scheduleTabButton();
      this._registerTabObserver();
      this._installNativeYieldObserver();
      this._installNativeSelectionAsk();
      this._installReaderSelectionCapture();
      log("QA module initialized");
    },

    destroy: function () {
      if (this._tabButtonTimer) {
        clearInterval(this._tabButtonTimer);
        this._tabButtonTimer = null;
      }
      if (this._tabButton && this._tabButton.parentNode) {
        this._tabButton.parentNode.removeChild(this._tabButton);
      }
      if (this._tabObserverID && typeof Zotero !== "undefined" && Zotero.Notifier) {
        try { Zotero.Notifier.unregisterObserver(this._tabObserverID); } catch (e) {}
      }
      if (this._remountTimer) {
        clearTimeout(this._remountTimer);
        this._remountTimer = null;
      }
      if (this._pageInteractionTimer) {
        clearTimeout(this._pageInteractionTimer);
        this._pageInteractionTimer = null;
      }
      this._removeNativeSelectionAsk();
      this._removeNativeYieldObserver();
      this._removeReaderSelectionCapture();
      this.hide();
      this._tabButton = null;
      this._panel = null;
      this._nodes = {};
      this._tabObserverID = null;
    },

    toggle: function () {
      if (this._visible && this._isPanelActuallyVisible()) this.hide();
      else this.show();
    },

    show: function () {
      try {
        var win = mainWindow();
        if (!win || !win.document) throw new Error("Zotero main window is not available");
        this._loadThreads();
        this._ensurePanel(win.document);
        this._visible = true;
        this._refreshControls();
        this._refreshContext();
      if (this._nodes.input) this._nodes.input.focus();
      log("QA panel opened in Zotero right pane");
      } catch (err) {
        logError("open QA panel failed: " + (err.message || err));
        var alertWin = mainWindow();
        if (alertWin && alertWin.alert) {
          alertWin.alert("打开 LLM 问答失败:\n" + (err.message || err));
        }
      }
    },

    _isPanelActuallyVisible: function () {
      if (!this._visible || !this._panel || !this._panel.parentNode) return false;
      try {
        if (this._panel.ownerDocument.defaultView.getComputedStyle(this._panel).display === "none") return false;
      } catch (e) {}
      var host = this._host;
      if (host && /deck$/i.test(String(host.localName || host.tagName || ""))) {
        try {
          var index = Array.prototype.indexOf.call(host.children || [], this._panel);
          var selected = typeof host.selectedIndex !== "undefined"
            ? Number(host.selectedIndex)
            : parseInt(host.getAttribute("selectedIndex") || "0", 10);
          if (index >= 0 && selected !== index) return false;
        } catch (e2) {}
      }
      return true;
    },

    _currentContextKey: function () {
      return activeContextKey();
    },

    _clearPendingSelection: function () {
      this._pendingSelectionText = "";
      this._pendingSelection = null;
      this._pendingSelectionContextKey = "";
      this._selectionExpanded = false;
      this._renderSelectionQuote();
    },

    _clearPendingSelectionIfContextChanged: function () {
      if (!this._pendingSelectionText && !this._pendingSelection) return false;
      if (this._inputHasDraft()) return false;
      var currentKey = this._currentContextKey();
      var pendingKey = this._pendingSelectionContextKey ||
        (this._pendingSelection && this._pendingSelection.contextKey) || "";
      if (currentKey && pendingKey && currentKey !== pendingKey) {
        this._clearPendingSelection();
        return true;
      }
      return false;
    },

    _inputHasDraft: function () {
      try {
        return !!(this._nodes && this._nodes.input && cleanText(this._nodes.input.value || "").trim());
      } catch (e) {
        return false;
      }
    },

    _armSelectionAskGesture: function (durationMs) {
      var key = this._currentContextKey();
      this._selectionGestureUntil = Date.now() + (durationMs || 2500);
      this._selectionGestureContextKey = key || "";
      if (key) this._lastActiveContextKey = key;
    },

    _disarmSelectionAskGesture: function () {
      this._selectionGestureUntil = 0;
      this._selectionGestureContextKey = "";
      this._selectionMousePosition = null;
    },

    _cancelSelectionAskForUIInteraction: function () {
      this._disarmSelectionAskGesture();
      this._lastReaderSelectionCapture = null;
      this._lastNativeCopyCapture = null;
      this._selectionAskContextKey = "";
      try {
        var win = mainWindow();
        this._ignoredSelectionSignature = currentSelectionSignature(win && win.document);
        this._ignoredSelectionTextSignature = currentSelectionTextSignature(win && win.document);
      } catch (e) {}
      this._selectionClearUntil = Date.now() + 2500;
      this._suppressSelectionAskUntil = Date.now() + 2500;
      this._removeNativeSelectionAskPopup();
    },

    _clearSelectionStateForPageChange: function () {
      this._disarmSelectionAskGesture();
      this._lastReaderSelectionCapture = null;
      this._lastNativeCopyCapture = null;
      this._selectionAskContextKey = "";
      try {
        var win = mainWindow();
        this._ignoredSelectionSignature = currentSelectionSignature(win && win.document);
        this._ignoredSelectionTextSignature = currentSelectionTextSignature(win && win.document);
      } catch (e) {}
      this._selectionClearUntil = Date.now() + 2500;
      this._suppressSelectionAskUntil = Date.now() + 2500;
      this._removeNativeSelectionAskPopup();
      if (!this._inputHasDraft()) this._clearPendingSelection();
    },

    _noteReaderPageInteraction: function (doc, event) {
      var type = String(event && event.type || "");
      if (/^key/.test(type)) {
        var key = String(event && event.key || "");
        if (!/^(PageDown|PageUp|ArrowDown|ArrowUp|ArrowLeft|ArrowRight|Home|End| )$/.test(key)) return;
      }
      if (!this._selectionAskPopup) return;
      var point = null;
      try {
        var sel = doc && doc.defaultView && doc.defaultView.getSelection ? doc.defaultView.getSelection() : null;
        point = selectionFocusPoint(sel) || selectionEndPoint(sel);
        var frame = doc && doc.defaultView && doc.defaultView.frameElement;
        if (frame) point = pointWithFrameOffset(point, frame);
      } catch (e) {}
      if (point && pointInMainViewport(point, 12)) return;
      this._lastReaderSelectionCapture = null;
      this._lastNativeCopyCapture = null;
      this._selectionAskContextKey = "";
      this._disarmSelectionAskGesture();
      this._selectionClearUntil = Date.now() + 1200;
      this._suppressSelectionAskUntil = Date.now() + 1200;
      this._removeNativeSelectionAskPopup();
    },

    _scheduleReaderPageInteraction: function (doc, event) {
      if (this._pageInteractionTimer) return;
      var self = this;
      var info = {
        type: String(event && event.type || ""),
        key: String(event && event.key || ""),
      };
      this._pageInteractionTimer = setTimeout(function () {
        self._pageInteractionTimer = null;
        self._noteReaderPageInteraction(doc, info);
      }, 0);
    },

    _clearPopupIfContextChanged: function () {
      if (!this._selectionAskPopup) return false;
      var currentKey = this._currentContextKey();
      var sourceHidden = this._selectionAskSourceWin && !selectionWindowVisible(this._selectionAskSourceWin);
      if (sourceHidden || (this._selectionAskContextKey && currentKey && currentKey !== this._selectionAskContextKey)) {
        this._lastReaderSelectionCapture = null;
        this._lastNativeCopyCapture = null;
        this._removeNativeSelectionAskPopup();
        this._disarmSelectionAskGesture();
        this._selectionClearUntil = Date.now() + 1500;
        this._suppressSelectionAskUntil = Date.now() + 1500;
        return true;
      }
      return false;
    },

    _clearIfActiveContextChanged: function () {
      var currentKey = this._currentContextKey();
      if (!currentKey) return false;
      if (!this._lastActiveContextKey) {
        this._lastActiveContextKey = currentKey;
        return false;
      }
      if (currentKey === this._lastActiveContextKey) return false;
      this._lastActiveContextKey = currentKey;
      this._clearSelectionStateForPageChange();
      this._selectionClearUntil = Date.now() + 1800;
      this._suppressSelectionAskUntil = Date.now() + 1800;
      return true;
    },

    askAboutSelection: function (selection) {
      var record = makeSelectionRecord(selection);
      var contextKey = this._currentContextKey();
      if (record) record.contextKey = record.contextKey || contextKey;
      this._pendingSelection = record;
      this._pendingSelectionText = record ? record.text : "";
      this._pendingSelectionContextKey = record ? (record.contextKey || contextKey) : "";
      this._selectionExpanded = false;
      this._disarmSelectionAskGesture();
      this.show();
      this._viewMode = "chat";
      this._renderView();
      if (this._nodes.input) this._nodes.input.focus();
    },

    clearPendingSelection: function () {
      this._clearSelectionStateForPageChange();
    },

    hide: function () {
      if (this._panel && this._panel.parentNode) {
        this._panel.parentNode.removeChild(this._panel);
      }
      this._viewMode = "chat";
      this._pendingSelectionText = "";
      this._pendingSelection = null;
      this._pendingSelectionContextKey = "";
      this._disarmSelectionAskGesture();
      this._restoreHost();
      this._visible = false;
    },

    _restoreHost: function () {
      if (this._hostState) {
        removeNativeSidenavRestorer(this._hostState);
        if (this._hostState.children) {
          for (var i = 0; i < this._hostState.children.length; i++) {
            var entry = this._hostState.children[i];
            if (!entry || !entry.node) continue;
            entry.node.style.display = entry.display || "";
            if (entry.ariaHidden === null || entry.ariaHidden === undefined) {
              entry.node.removeAttribute("aria-hidden");
            } else {
              entry.node.setAttribute("aria-hidden", entry.ariaHidden);
            }
          }
        }
        if (!this._hostState.skipDeckRestore) restoreDeckSelection(this._hostState);
        if (!this._hostState.skipNativeRestore) restoreNativeRightPane(this._hostState);
        repairNativeDeckSelection(this._hostState);
      }
      this._host = null;
      this._outerHost = null;
      this._hostState = null;
    },

    _ensurePanel: function (doc) {
      this._ensureThread();

      var mount = findRightPaneMount(doc);
      if (!mount || !mount.content || !mount.outer) {
        throw new Error("没有找到 Zotero 原生右侧栏挂载点");
      }

      if (!this._panel || this._panel.ownerDocument !== doc) {
        this._panel = this._buildPanel(doc);
      }

      var host = mount.content;
      if (this._host !== host || this._panel.parentNode !== host) {
        this._restoreHost();
        this._host = host;
        this._outerHost = mount.outer;
        this._hostState = { host: mount.outer, content: host, children: [], splitters: [], kind: mount.kind };
        openNativeRightPane(doc.defaultView || mainWindow(), mount.outer, this._hostState);

        var children = Array.prototype.slice.call(host.children || []);
        var hostIsDeck = /deck$/i.test(String(host.localName || host.tagName || ""));
        for (var i = 0; i < children.length; i++) {
          if (children[i] === this._panel) continue;
          this._hostState.children.push({
            node: children[i],
            display: children[i].style.display,
            ariaHidden: children[i].getAttribute("aria-hidden"),
          });
          if (!hostIsDeck) {
            children[i].style.display = "none";
            children[i].setAttribute("aria-hidden", "true");
          }
        }
        host.appendChild(this._panel);
        installNativeSidenavRestorer(doc, this._hostState);
      }
      this._activatePanelInHost();

      this._renderMessages();
      this._updateThreadList();
      this._renderView();
    },

    _activatePanelInHost: function () {
      if (!this._host || !this._panel) return;
      var host = this._host;
      var hostIsDeck = /deck$/i.test(String(host.localName || host.tagName || ""));
      this._panel.style.display = "flex";
      this._panel.removeAttribute("aria-hidden");
      openNativeRightPane((this._panel.ownerDocument && this._panel.ownerDocument.defaultView) || mainWindow(), this._outerHost, this._hostState || {});
      if (hostIsDeck) {
        setDeckSelectionForPanel(host, this._panel, this._hostState || {});
        return;
      }
      if (this._hostState && this._hostState.children) {
        for (var i = 0; i < this._hostState.children.length; i++) {
          var entry = this._hostState.children[i];
          if (!entry || !entry.node || entry.node === this._panel) continue;
          entry.node.style.display = "none";
          entry.node.setAttribute("aria-hidden", "true");
        }
      }
    },

    _yieldToNativePane: function () {
      if (!this._hostState || !this._host || !this._panel) return;
      var host = this._host;
      var hostIsDeck = /deck$/i.test(String(host.localName || host.tagName || ""));
      if (hostIsDeck) {
        restoreDeckSelection(this._hostState);
        repairNativeDeckSelection(this._hostState);
        return;
      }
      this._panel.style.display = "none";
      this._panel.setAttribute("aria-hidden", "true");
      if (this._hostState.children) {
        for (var i = 0; i < this._hostState.children.length; i++) {
          var entry = this._hostState.children[i];
          if (!entry || !entry.node) continue;
          entry.node.style.display = entry.display || "";
          if (entry.ariaHidden === null || entry.ariaHidden === undefined) {
            entry.node.removeAttribute("aria-hidden");
          } else {
            entry.node.setAttribute("aria-hidden", entry.ariaHidden);
          }
        }
      }
    },

    _renderView: function () {
      var managerMode = this._viewMode === "manager";
      if (this._nodes.manager) this._nodes.manager.style.display = managerMode ? "block" : "none";
      if (this._nodes.messages) this._nodes.messages.style.display = managerMode ? "none" : "block";
      if (this._nodes.inputBox) this._nodes.inputBox.style.display = managerMode ? "none" : "block";
      if (this._nodes.context) this._nodes.context.style.display = managerMode ? "none" : "block";
      if (this._nodes.back) {
        this._nodes.back.textContent = managerMode ? "›" : "‹";
        this._nodes.back.title = managerMode ? "返回当前会话" : "返回会话管理";
      }
      if (managerMode) this._renderThreadManager();
      else {
        this._renderSelectionQuote();
        this._renderMessages();
      }
    },

    _showManager: function () {
      this._viewMode = this._viewMode === "manager" ? "chat" : "manager";
      this._renderView();
    },

    _renderSelectionQuote: function () {
      if (!this._nodes.selection || !this._nodes.selectionText) return;
      this._clearPendingSelectionIfContextChanged();
      var record = makeSelectionRecord(this._pendingSelection || this._pendingSelectionText);
      var fullText = cleanText(this._pendingSelectionText || "").trim();
      var text = fullText.replace(/\s+/g, " ").trim();
      if (!text) {
        this._nodes.selection.style.display = "none";
        this._nodes.selectionText.textContent = "";
        if (this._nodes.selectionDetail) {
          this._nodes.selectionDetail.textContent = "";
          this._nodes.selectionDetail.style.display = "none";
        }
        return;
      }
      this._nodes.selection.style.display = "block";
      this._nodes.selectionText.textContent = "选中段落: " + text;
      this._nodes.selection.title = fullText;
      this._nodes.selectionText.title = fullText;
      if (this._nodes.selectionExpand) {
        this._nodes.selectionExpand.textContent = this._selectionExpanded ? "▾" : "▴";
        this._nodes.selectionExpand.title = this._selectionExpanded ? "收起选中段落全文" : "展开选中段落全文";
      }
      if (this._nodes.selectionDetail) {
        this._nodes.selectionDetail.textContent = fullText;
        this._nodes.selectionDetail.style.display = this._selectionExpanded ? "block" : "none";
        this._nodes.selectionDetail.title = fullText;
      }
    },

    _renderThreadManager: function () {
      var box = this._nodes.manager;
      if (!box) return;
      while (box.firstChild) box.removeChild(box.firstChild);
      this._loadThreads();
      if (!this._threads.length) {
        var empty = create(box.ownerDocument, "div", "ari-qa-message ari-qa-assistant", "暂无历史会话。");
        box.appendChild(empty);
        return;
      }
      for (var i = 0; i < this._threads.length; i++) {
        var thread = this._threads[i];
        var row = create(box.ownerDocument, "div", "ari-qa-thread-row");
        var open = create(box.ownerDocument, "button", "ari-qa-thread-open", this._threadTitle(thread));
        open.title = this._threadTitle(thread);
        open.setAttribute("data-thread-id", thread.id);
        open.addEventListener("click", function (event) {
          ArxivDailyQA._selectThread(event.currentTarget.getAttribute("data-thread-id"));
          ArxivDailyQA._viewMode = "chat";
          ArxivDailyQA._renderView();
        });
        var del = create(box.ownerDocument, "button", "ari-qa-thread-delete", "×");
        del.title = "删除会话";
        del.setAttribute("data-thread-id", thread.id);
        del.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          ArxivDailyQA._deleteThreadByID(event.currentTarget.getAttribute("data-thread-id"));
        });
        row.appendChild(open);
        row.appendChild(del);
        box.appendChild(row);
        if (this._confirmDeleteThreadID === thread.id) {
          var confirm = create(box.ownerDocument, "div", "ari-qa-thread-confirm");
          var text = create(box.ownerDocument, "span", "", "删除这个会话？");
          var yes = create(box.ownerDocument, "button", "", "删除");
          var no = create(box.ownerDocument, "button", "", "取消");
          yes.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            ArxivDailyQA._deleteThreadByIDConfirmed(ArxivDailyQA._confirmDeleteThreadID);
          });
          no.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            ArxivDailyQA._confirmDeleteThreadID = "";
            ArxivDailyQA._renderThreadManager();
          });
          confirm.appendChild(text);
          confirm.appendChild(yes);
          confirm.appendChild(no);
          box.appendChild(confirm);
        }
      }
    },

    _loadThreads: function () {
      try {
        if (typeof ArxivDailyDataDir === "undefined") {
          this._threads = [];
          return;
        }
        var threads = ArxivDailyDataDir.readJSON(THREAD_STORE) || [];
        if (!Array.isArray(threads)) threads = [];
        threads.sort(function (a, b) {
          return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
        });
        this._threads = threads.slice(0, 30);
        if (this._thread) {
          for (var i = 0; i < this._threads.length; i++) {
            if (this._threads[i].id === this._thread.id) {
              this._thread = this._threads[i];
              break;
            }
          }
        }
      } catch (err) {
        this._threads = [];
        logError("load QA threads failed: " + (err.message || err));
      }
    },

    _ensureThread: function () {
      if (this._thread && this._thread.id) return;
      if (this._threads && this._threads.length) {
        this._thread = this._threads[0];
        return;
      }
      this._thread = {
        id: uuid(),
        title: "问答 " + new Date().toLocaleString(),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    },

    _threadTitle: function (thread) {
      if (!thread) return "未命名会话";
      if (thread.title && !/^问答\s/.test(thread.title)) return thread.title;
      var messages = thread.messages || [];
      for (var i = 0; i < messages.length; i++) {
        if (messages[i].role === "user" && messages[i].content) {
          return cleanText(messages[i].content).replace(/\s+/g, " ").slice(0, 28);
        }
      }
      return "问答 " + new Date(thread.createdAt || Date.now()).toLocaleString();
    },

    _updateThreadList: function () {
      var select = this._nodes.threadSelect;
      if (!select) return;
      this._ensureThread();
      select.innerHTML = "";
      var threads = this._threads && this._threads.length ? this._threads.slice() : [this._thread];
      var seen = {};
      if (this._thread && !seen[this._thread.id]) {
        threads.unshift(this._thread);
      }
      for (var i = 0; i < threads.length; i++) {
        var thread = threads[i];
        if (!thread || !thread.id || seen[thread.id]) continue;
        seen[thread.id] = true;
        var opt = create(select.ownerDocument, "option", "", this._threadTitle(thread));
        opt.value = thread.id;
        select.appendChild(opt);
      }
      select.value = this._thread.id;
    },

    _newThread: function () {
      this._thread = {
        id: uuid(),
        title: "问答 " + new Date().toLocaleString(),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this._threads.unshift(this._thread);
      this._saveThread();
      this._updateThreadList();
      this._viewMode = "chat";
      this._renderView();
      if (this._nodes.input) this._nodes.input.focus();
    },

    _selectThread: function (threadID) {
      if (!threadID) return;
      this._loadThreads();
      for (var i = 0; i < this._threads.length; i++) {
        if (this._threads[i].id === threadID) {
          this._thread = this._threads[i];
          this._updateThreadList();
          this._viewMode = "chat";
          this._renderView();
          return;
        }
      }
    },

    _deleteCurrentThread: function () {
      if (!this._thread) return;
      this._viewMode = "manager";
      this._confirmDeleteThreadID = this._thread.id;
      this._renderView();
    },

    _deleteThreadByID: function (threadID) {
      if (!threadID) return;
      this._confirmDeleteThreadID = threadID;
      this._viewMode = "manager";
      this._renderView();
    },

    _deleteThreadByIDConfirmed: function (threadID) {
      if (!threadID) return;
      try {
        this._threads = (this._threads || []).filter(function (thread) {
          return thread && thread.id !== threadID;
        });
        if (typeof ArxivDailyDataDir !== "undefined") {
          ArxivDailyDataDir.writeJSON(THREAD_STORE, this._threads);
        }
        if (this._thread && this._thread.id === threadID) {
          this._thread = this._threads[0] || null;
          this._ensureThread();
        }
        this._confirmDeleteThreadID = "";
        this._updateThreadList();
        this._renderThreadManager();
      } catch (err) {
        logError("delete QA thread failed: " + (err.message || err));
      }
    },

    _buildPanel: function (doc) {
      var panel = createXUL(doc, "vbox");
      panel.id = "arxiv-daily-qa-sidebar";
      panel.setAttribute("flex", "1");
      panel.style.cssText = [
        "box-sizing:border-box",
        "width:100%",
        "height:100%",
        "min-width:0",
        "min-height:0",
        "display:flex",
        "flex-direction:column",
        "background:var(--material-sidepane,#fafafa)",
        "color:CanvasText",
        "font:13px message-box,system-ui,sans-serif",
        "overflow:hidden",
      ].join(";");

      var style = create(doc, "style");
      style.textContent = [
        "#arxiv-daily-qa-sidebar button{font:inherit;cursor:pointer}",
        "#arxiv-daily-qa-sidebar select,#arxiv-daily-qa-sidebar textarea{font:inherit}",
        ".ari-qa-header{display:flex;align-items:center;gap:6px;padding:7px 8px;border-bottom:1px solid rgba(0,0,0,.12);flex:0 0 auto;min-height:0}",
        ".ari-qa-title{font-weight:600;white-space:nowrap}",
        ".ari-qa-thread{flex:1;min-width:84px;max-width:190px}",
        ".ari-qa-thread select{width:100%;min-height:24px;box-sizing:border-box}",
        ".ari-qa-status{flex:1;color:GrayText;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".ari-qa-iconbtn{border:0;background:transparent;width:24px;height:24px;border-radius:3px;line-height:20px;padding:0;display:inline-flex;align-items:center;justify-content:center}",
        ".ari-qa-iconbtn:hover{background:rgba(0,0,0,.07)}",
        ".ari-qa-context{padding:5px 8px;color:GrayText;background:rgba(0,0,0,.035);border-bottom:1px solid rgba(0,0,0,.08);font-size:11px;line-height:1.35;flex:0 0 auto;max-height:52px;overflow:auto}",
        ".ari-qa-messages{flex:1 1 0;overflow:auto;padding:8px;background:Canvas;min-height:0;max-height:100%;box-sizing:border-box}",
        ".ari-qa-message{padding:7px 9px;margin:0 0 7px;border-radius:5px;line-height:1.48;white-space:normal;user-select:text;-moz-user-select:text;cursor:text}",
        ".ari-qa-message *{user-select:text;-moz-user-select:text}",
        ".ari-qa-message-tools{display:flex;justify-content:flex-end;gap:5px;margin-top:5px;user-select:none;-moz-user-select:none}",
        ".ari-qa-message-tools button{font-size:11px;border:1px solid ThreeDShadow;border-radius:3px;background:ButtonFace;color:ButtonText;padding:1px 6px;cursor:pointer;user-select:none;-moz-user-select:none}",
        ".ari-qa-message-tools button:hover{background:rgba(0,0,0,.07)}",
        ".ari-qa-copy-menu{position:fixed;z-index:2147483647;display:block;padding:3px;background:Menu;color:MenuText;border:1px solid ThreeDShadow;border-radius:3px;box-shadow:0 2px 8px rgba(0,0,0,.22);user-select:none;-moz-user-select:none}",
        ".ari-qa-copy-menu button{display:block;min-width:76px;text-align:left;border:0;background:transparent;color:inherit;padding:4px 10px;border-radius:2px}",
        ".ari-qa-copy-menu button:hover{background:Highlight;color:HighlightText}",
        ".ari-qa-retry{font-size:11px;border:1px solid ThreeDShadow;border-radius:3px;background:ButtonFace;color:ButtonText;padding:1px 6px}",
        ".ari-qa-user{background:rgba(0,0,0,.07);margin-left:24px}",
        ".ari-qa-assistant{background:rgba(27,110,194,.10);margin-right:12px}",
        ".ari-qa-error{background:#fff1f0;color:#a40000;border:1px solid #f0c0bd}",
        ".ari-qa-input{position:relative;border-top:1px solid rgba(0,0,0,.12);padding:7px 8px;background:var(--material-sidepane,#fafafa);flex:0 0 auto;box-sizing:border-box}",
        ".ari-qa-input-controls{display:grid;grid-template-columns:1fr 92px auto;gap:5px;align-items:end;margin-bottom:6px}",
        ".ari-qa-selection{display:none;position:relative;margin:0 0 6px;padding:5px 7px;border:1px solid rgba(0,0,0,.14);border-radius:4px;background:rgba(0,0,0,.055);color:GrayText;font-size:12px;line-height:1.35;overflow:visible}",
        ".ari-qa-selection button{float:right;margin-left:6px;border:0;background:transparent;color:GrayText;padding:0;border-radius:3px;min-width:18px;height:18px;font-size:13px;line-height:18px;display:inline-flex;align-items:center;justify-content:center;position:relative;top:0}",
        ".ari-qa-selection button:hover{background:rgba(0,0,0,.08);color:CanvasText}",
        ".ari-qa-selection-text{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".ari-qa-selection-detail{display:none;white-space:pre-wrap;color:CanvasText;background:Canvas;border:1px solid rgba(0,0,0,.16);border-radius:4px;padding:7px;max-height:220px;overflow:auto;box-shadow:0 2px 10px rgba(0,0,0,.16);z-index:2147483646}",
        ".ari-qa-input .ari-qa-selection-detail{position:absolute;left:0;right:0;bottom:100%;margin-bottom:6px}",
        ".ari-qa-message .ari-qa-selection-detail{clear:both;margin-top:6px}",
        ".ari-qa-field{min-width:0}",
        ".ari-qa-field-label{display:block;color:GrayText;font-size:11px;margin-bottom:2px}",
        ".ari-qa-field select{width:100%;box-sizing:border-box;min-height:24px}",
        ".ari-qa-default{min-height:24px;border:1px solid ThreeDShadow;border-radius:4px;background:ButtonFace;color:ButtonText;padding:2px 7px;white-space:nowrap}",
        ".ari-qa-input textarea{width:100%;box-sizing:border-box;min-height:72px;max-height:260px;resize:vertical;padding:6px 7px;border:1px solid ThreeDShadow;border-radius:4px;background:Field;color:FieldText}",
        ".ari-qa-send-row{display:flex;align-items:center;gap:8px;margin-top:6px}",
        ".ari-qa-send{padding:4px 14px;border:1px solid #3367a8;border-radius:4px;background:#3367a8;color:white}",
        ".ari-qa-send[disabled]{opacity:.55;cursor:default}",
        ".ari-qa-hint{flex:1;color:GrayText;font-size:11px;line-height:1.3}",
        ".ari-qa-manager{display:none;flex:1 1 0;overflow:auto;background:Canvas;padding:8px;box-sizing:border-box}",
        ".ari-qa-thread-row{display:flex;align-items:center;gap:6px;padding:7px 6px;border-bottom:1px solid rgba(0,0,0,.10)}",
        ".ari-qa-thread-open{flex:1;text-align:left;border:0;background:transparent;color:CanvasText;padding:2px 4px;border-radius:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".ari-qa-thread-open:hover,.ari-qa-thread-delete:hover{background:rgba(0,0,0,.07)}",
        ".ari-qa-thread-delete{border:0;background:transparent;color:GrayText;width:24px;height:24px;border-radius:3px}",
        ".ari-qa-thread-confirm{display:flex;align-items:center;gap:7px;margin:0 4px 6px 12px;padding:6px 7px;border:1px solid ThreeDShadow;border-radius:4px;background:rgba(0,0,0,.045);color:CanvasText;font-size:12px}",
        ".ari-qa-thread-confirm span{flex:1;color:GrayText}",
        ".ari-qa-thread-confirm button{border:1px solid ThreeDShadow;border-radius:3px;background:ButtonFace;color:ButtonText;padding:2px 7px}",
        ".ari-qa-think{margin:0 0 6px;padding:4px 6px;border-radius:4px;background:rgba(0,0,0,.045);color:GrayText;font-size:11px}",
        ".ari-qa-think-toggle{border:0;background:transparent;color:GrayText;padding:0;margin:0 4px 0 0;border-radius:3px}",
        ".ari-qa-think-body{display:none;margin-top:5px;max-height:190px;overflow:auto;white-space:pre-wrap;color:CanvasText;background:Canvas;border:1px solid rgba(0,0,0,.10);border-radius:3px;padding:5px}",
      ].join("\n");
      panel.appendChild(style);

      var header = create(doc, "div", "ari-qa-header");
      var back = create(doc, "button", "ari-qa-iconbtn", "‹");
      back.title = "返回会话管理";
      back.addEventListener("click", function () {
        ArxivDailyQA._showManager();
      });
      var title = create(doc, "div", "ari-qa-title", "LLM 问答");
      var threadWrap = create(doc, "div", "ari-qa-thread");
      var threadSelect = create(doc, "select");
      threadSelect.title = "选择历史会话";
      threadSelect.addEventListener("change", function () {
        ArxivDailyQA._selectThread(threadSelect.value);
      });
      threadWrap.appendChild(threadSelect);
      var newThread = create(doc, "button", "ari-qa-iconbtn", "+");
      newThread.title = "新建会话";
      newThread.addEventListener("click", this._newThread.bind(this));
      var deleteThread = create(doc, "button", "ari-qa-iconbtn", "−");
      deleteThread.title = "删除当前会话";
      deleteThread.addEventListener("click", this._deleteCurrentThread.bind(this));
      var status = create(doc, "div", "ari-qa-status", "");
      var close = create(doc, "button", "ari-qa-iconbtn", "×");
      close.title = "关闭";
      close.addEventListener("click", this.hide.bind(this));
      header.appendChild(back);
      header.appendChild(title);
      header.appendChild(threadWrap);
      header.appendChild(newThread);
      header.appendChild(deleteThread);
      header.appendChild(status);
      header.appendChild(close);

      var context = create(doc, "div", "ari-qa-context", "正在读取上下文...");
      var manager = create(doc, "div", "ari-qa-manager");
      var messages = create(doc, "div", "ari-qa-messages");
      var inputBox = create(doc, "div", "ari-qa-input");

      var controls = create(doc, "div", "ari-qa-input-controls");
      var modelField = create(doc, "div", "ari-qa-field");
      var modelLabel = create(doc, "span", "ari-qa-field-label", "模型");
      var modelSelect = create(doc, "select");
      modelField.appendChild(modelLabel);
      modelField.appendChild(modelSelect);

      var depthField = create(doc, "div", "ari-qa-field");
      var depthLabel = create(doc, "span", "ari-qa-field-label", "思考深度");
      var depthSelect = create(doc, "select");
      depthField.appendChild(depthLabel);
      depthField.appendChild(depthSelect);

      var defaultButton = create(doc, "button", "ari-qa-default", "设为默认");
      defaultButton.title = "把当前模型和思考深度写入插件设置";
      defaultButton.addEventListener("click", this._saveDefaults.bind(this));
      modelSelect.addEventListener("change", function () {
        ArxivDailyQA._selectedModel = modelSelect.value || "";
        ArxivDailyQA._refreshStatus();
      });
      depthSelect.addEventListener("change", function () {
        ArxivDailyQA._thinkingDepth = depthSelect.value || "balanced";
      });
      controls.appendChild(modelField);
      controls.appendChild(depthField);
      controls.appendChild(defaultButton);

      var selection = create(doc, "div", "ari-qa-selection");
      var selectionClose = create(doc, "button", "", "×");
      selectionClose.title = "清除选中段落";
      selectionClose.addEventListener("click", function (event) {
        event.preventDefault();
        ArxivDailyQA._clearPendingSelection();
      });
      var selectionExpand = create(doc, "button", "", "▴");
      selectionExpand.title = "展开选中段落全文";
      selectionExpand.addEventListener("click", function (event) {
        event.preventDefault();
        ArxivDailyQA._selectionExpanded = !ArxivDailyQA._selectionExpanded;
        ArxivDailyQA._renderSelectionQuote();
      });
      var selectionText = create(doc, "span", "ari-qa-selection-text", "");
      var selectionDetail = create(doc, "div", "ari-qa-selection-detail", "");
      selection.appendChild(selectionClose);
      selection.appendChild(selectionExpand);
      selection.appendChild(selectionText);
      selection.appendChild(selectionDetail);

      var input = create(doc, "textarea");
      input.placeholder = "输入问题。Enter 发送，Shift+Enter 换行。";
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          ArxivDailyQA._sendMessage();
        }
      });
      input.addEventListener("input", function () {
        ArxivDailyQA._inputHeight = Math.max(72, Math.min(260, input.getBoundingClientRect().height || 96));
      });

      var sendRow = create(doc, "div", "ari-qa-send-row");
      var send = create(doc, "button", "ari-qa-send", "发送");
      send.addEventListener("click", this._sendMessage.bind(this));
      var hint = create(doc, "div", "ari-qa-hint", "会把当前问题和可用上下文发送给已配置的 LLM 服务。");
      sendRow.appendChild(send);
      sendRow.appendChild(hint);

      inputBox.appendChild(controls);
      inputBox.appendChild(selection);
      inputBox.appendChild(input);
      inputBox.appendChild(sendRow);
      panel.appendChild(header);
      panel.appendChild(context);
      panel.appendChild(manager);
      panel.appendChild(messages);
      panel.appendChild(inputBox);
      installQaCopyHandlers(panel);

      this._nodes = {
        back: back,
        status: status,
        threadSelect: threadSelect,
        manager: manager,
        modelSelect: modelSelect,
        depthSelect: depthSelect,
        context: context,
        messages: messages,
        inputBox: inputBox,
        selection: selection,
        selectionText: selectionText,
        selectionExpand: selectionExpand,
        selectionDetail: selectionDetail,
        input: input,
        send: send,
      };

      return panel;
    },

    _refreshControls: function () {
      var modelSelect = this._nodes.modelSelect;
      var depthSelect = this._nodes.depthSelect;
      if (!modelSelect || !depthSelect) return;

      var configuredModel = getConfig("llm.model", "");
      var values = [];
      try {
        if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.getAvailableModels) {
          var availableModels = ArxivDailyLLM.getAvailableModels();
          for (var i = 0; i < availableModels.length; i++) {
            if (availableModels[i].ref && values.indexOf(availableModels[i].ref) < 0) values.push(availableModels[i].ref);
          }
        }
      } catch (e) {}
      if (!values.length && configuredModel) values.push(configuredModel);

      modelSelect.innerHTML = "";
      var defaultOpt = create(modelSelect.ownerDocument, "option", "", configuredModel ? "使用设置: " + configuredModel : "使用设置模型");
      defaultOpt.value = "";
      modelSelect.appendChild(defaultOpt);
      for (var m = 0; m < values.length; m++) {
        var label = values[m];
        try {
          if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.resolveModelLabel) {
            label = ArxivDailyLLM.resolveModelLabel(values[m]) || values[m];
          }
        } catch (e2) {}
        var opt = create(modelSelect.ownerDocument, "option", "", label);
        opt.value = values[m];
        modelSelect.appendChild(opt);
      }
      var usageRef = "";
      try { usageRef = ArxivDailyLLM.getUsageModelRef ? ArxivDailyLLM.getUsageModelRef("qa") : ""; } catch (e3) {}
      var selected = this._selectedModel || usageRef || "";
      modelSelect.value = values.indexOf(selected) >= 0 ? selected : "";
      this._selectedModel = modelSelect.value || "";

      depthSelect.innerHTML = "";
      for (var d = 0; d < DEPTH_PRESETS.length; d++) {
        var depth = create(depthSelect.ownerDocument, "option", "", DEPTH_PRESETS[d].label);
        depth.value = DEPTH_PRESETS[d].id;
        depthSelect.appendChild(depth);
      }
      depthSelect.value = this._thinkingDepth || "balanced";
      if (this._nodes.input) this._nodes.input.style.height = (this._inputHeight || 96) + "px";
      this._renderSelectionQuote();
      this._refreshStatus();
    },

    _refreshStatus: function () {
      if (!this._nodes.status) return;
      var summary = getLLMSummary();
      var model = this._selectedModel || summary.model || "";
      try {
        if (this._selectedModel && typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.resolveModelLabel) {
          model = ArxivDailyLLM.resolveModelLabel(this._selectedModel) || this._selectedModel;
        }
      } catch (e) {}
      var provider = summary.provider || "自定义";
      var style = summary.apiStyle || "openai";
      this._nodes.status.textContent = isLLMConfigured()
        ? provider + " / " + style + " / " + (model || "设置默认模型")
        : "LLM 未配置，仍可打开侧栏";
      this._nodes.status.title = summary.baseUrl
        ? "Base URL: " + summary.baseUrl
        : "Base URL 未填写时会按 provider/API style 使用默认值";
    },

    _saveDefaults: function () {
      try {
        if (typeof ArxivDailyConfig === "undefined") return;
        if (this._selectedModel && typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.setUsageModelRef) {
          ArxivDailyLLM.setUsageModelRef("qa", this._selectedModel);
        }
        var preset = this._depthPreset();
        ArxivDailyConfig.set("llm.temperature", preset.temperature);
        ArxivDailyConfig.set("llm.maxTokens", preset.maxTokens);
        if (ArxivDailyConfig.save) ArxivDailyConfig.save();
        this._appendMessage("assistant", "已保存当前模型和思考深度为默认设置。");
      } catch (err) {
        this._appendMessage("assistant", "保存默认设置失败: " + (err.message || err), true);
      }
    },

    _depthPreset: function () {
      for (var i = 0; i < DEPTH_PRESETS.length; i++) {
        if (DEPTH_PRESETS[i].id === this._thinkingDepth) return DEPTH_PRESETS[i];
      }
      return DEPTH_PRESETS[1];
    },

    _contextTabKey: function () {
      try {
        var win = mainWindow();
        var parts = ["tab:" + zoteroTabSignature(win)];
        if (typeof ArxivDailyCenterWorkspace !== "undefined") {
          parts.push("report:" + (ArxivDailyCenterWorkspace._currentReportDate || ""));
          var meta = ArxivDailyCenterWorkspace._currentMeta || {};
          parts.push("center:" + (meta.arxivId || meta.paperId || meta.title || ""));
        }
        return simpleHash(parts.join("|"));
      } catch (e) {
        return "";
      }
    },

    _contextSnapshotUseful: function (snapshot) {
      return !!(snapshot && (
        snapshot.reportText ||
        snapshot.topTitle ||
        snapshot.readerItemID ||
        snapshot.readerTitle ||
        snapshot.readerPage ||
        snapshot.readerPageText ||
        snapshot.selectedItemID ||
        snapshot.selectedTitle
      ));
    },

    _prepareContextSnapshot: function (snapshot) {
      snapshot = snapshot || {};
      snapshot.contextKey = this._currentContextKey();
      snapshot.contextTabKey = this._contextTabKey();
      if (this._contextSnapshotUseful(snapshot)) {
        this._lastContextSnapshot = Object.assign({}, snapshot);
        this._lastContextSnapshotAt = Date.now();
        return snapshot;
      }
      var cached = this._lastContextSnapshot;
      if (cached && cached.contextTabKey && cached.contextTabKey === snapshot.contextTabKey &&
          Date.now() - (this._lastContextSnapshotAt || 0) < 10 * 60 * 1000) {
        return Object.assign({}, cached, {
          fromRecentContext: true,
          contextKey: snapshot.contextKey || cached.contextKey || "",
          contextTabKey: snapshot.contextTabKey || cached.contextTabKey || "",
        });
      }
      return this._prepareContextSnapshot(snapshot);
    },

    _captureContextSeeds: function () {
      var snapshot = {
        reportText: "",
        reportDate: "",
        topTitle: "",
        topKind: "",
        readerItemID: null,
        readerPage: "",
        readerPageText: "",
        readerPageSource: "",
        selectedItemID: null,
        readerTitle: "",
        selectedTitle: "",
      };
      try {
        if (typeof ArxivDailyCenterWorkspace !== "undefined") {
          var top = ArxivDailyCenterWorkspace.getTopReadableContext ?
            ArxivDailyCenterWorkspace.getTopReadableContext() : null;
          if (top && top.text) {
            snapshot.reportDate = top.date || "";
            snapshot.reportText = top.text;
            snapshot.topTitle = top.title || "";
            snapshot.topKind = top.kind || "report";
          } else {
            snapshot.reportDate = ArxivDailyCenterWorkspace._currentReportDate || "";
            if (ArxivDailyCenterWorkspace._currentReportText) {
              snapshot.reportText = ArxivDailyCenterWorkspace._currentReportText;
            } else if (ArxivDailyCenterWorkspace._currentReportDate &&
                       typeof ArxivDailyReportStore !== "undefined") {
              snapshot.reportText = ArxivDailyReportStore.loadReport(ArxivDailyCenterWorkspace._currentReportDate) || "";
            }
          }
        }
      } catch (e) {}

      var win = mainWindow();
      try {
        if (win) {
          var reader = activeZoteroReader();
          if (reader && reader.itemID && typeof Zotero !== "undefined" && Zotero.Items) {
            snapshot.readerItemID = reader.itemID;
            var readerItem = Zotero.Items.get(reader.itemID);
            if (readerItem) snapshot.readerTitle = readerItem.getField("title") || "";
          }
          if (reader) {
            var internal = unwrapReader(reader);
            var view = internal && (internal._primaryView || internal._lastView || internal._lastViewPrimary || null);
            var pdfViewer = view && (view._pdfViewer || view.pdfViewer) ||
              internal && (internal._pdfViewer || internal.pdfViewer) ||
              reader && (reader._pdfViewer || reader.pdfViewer);
            var page = readerPageValueFromObjects(reader, internal, view, pdfViewer) ||
              readerPageHint(reader, internal, view, pdfViewer);
            var pageSnapshot = currentReaderPageSnapshot(reader, page, 24000);
            snapshot.readerPage = pageSnapshot.page || normalizeReaderPageNumber(page);
            snapshot.readerPageText = pageSnapshot.text || "";
            snapshot.readerPageSource = pageSnapshot.source || "";
          }
        }
      } catch (e) {}

      try {
        if (win && win.ZoteroPane && win.ZoteroPane.getSelectedItems) {
          var items = win.ZoteroPane.getSelectedItems();
          if (items && items.length) {
            snapshot.selectedItemID = items[0].id || items[0].itemID || null;
            snapshot.selectedTitle = items[0].getField("title") || "";
          }
        }
      } catch (e) {}

      return snapshot;
    },

    _captureContext: function () {
      return this._captureContextSeeds();
    },

    _captureContextAsync: async function () {
      var seeds = this._captureContextSeeds();
      var summary = getLLMSummary();
      var limit = contextCharLimit(this._selectedModel || summary.model || "");
      var chunks = [];
      var labels = [];

      if (seeds.reportText) {
        chunks.push("## Top visible arXiv Interest Daily " + (seeds.topKind || "report") +
          (seeds.reportDate ? " (" + seeds.reportDate + ")" : "") +
          (seeds.topTitle ? "\nTitle: " + seeds.topTitle : "") +
          "\n" + truncateText(seeds.reportText, Math.floor(limit * 0.45)));
        labels.push(seeds.topKind === "project-paper" ? "最上层项目论文页" : "最上层日报页");
      }

      if (seeds.readerPageText) labels.push("current PDF page");

      var remaining = Math.max(8000, limit - chunks.join("\n").length);
      try {
        if (seeds.readerItemID) {
          var readerItem = await getItemAsync(seeds.readerItemID);
          if (readerItem) {
            chunks.push(itemMetadataText(readerItem, "Current reader item"));
            var readerText = await itemFullTextContext(readerItem, Math.floor(remaining * 0.7));
            if (readerText) chunks.push(readerText);
            labels.push("当前阅读文件");
          }
        }
      } catch (readerErr) {
        chunks.push("## Current reader item\nFailed to read full text cache: " + (readerErr.message || readerErr));
      }

      try {
        if (seeds.selectedItemID && seeds.selectedItemID !== seeds.readerItemID) {
          var selectedItem = await getItemAsync(seeds.selectedItemID);
          if (selectedItem) {
            chunks.push(itemMetadataText(selectedItem, "Selected Zotero item"));
            var selectedText = await itemFullTextContext(selectedItem, Math.floor(remaining * 0.35));
            if (selectedText) chunks.push(selectedText);
            labels.push("选中条目");
          }
        }
      } catch (selectedErr) {
        chunks.push("## Selected Zotero item\nFailed to read full text cache: " + (selectedErr.message || selectedErr));
      }

      if (seeds.fromRecentContext) labels.push("recent same-tab context");
      seeds.contextSearchText = chunks.join("\n\n");
      seeds.contextText = truncateText(seeds.contextSearchText, limit);
      seeds.contextLimit = limit;
      seeds.contextLabel = labels.length ? labels.join("、") : "无活动上下文";
      return seeds;
    },

    _refreshContext: function () {
      if (!this._nodes.context) return;
      this._clearPendingSelectionIfContextChanged();
      var ctx = this._captureContext();
      var parts = [];
      if (ctx.readerPage) parts.push("Current page: " + ctx.readerPage + (ctx.readerPageText ? " (page text captured)" : ""));
      if (ctx.topTitle) parts.push("最上层页面: " + ctx.topTitle);
      if (ctx.readerTitle) parts.push("正在阅读: " + ctx.readerTitle);
      if (ctx.selectedTitle) parts.push("选中条目: " + ctx.selectedTitle);
      if (ctx.reportText) parts.push("已读取当前日报上下文");
      this._nodes.context.textContent = parts.length ? parts.join(" | ") : "无活动阅读上下文，将仅根据你的问题回答。";
    },

    _contextPrompt: function (ctx) {
      var lines = [];
      if (ctx && ctx.selectedPassage) {
        lines.push(
          "User-selected passage captured from Zotero/PDF.js copy pipeline when available. Treat it as the highlighted focus of the question, but still answer the actual wording of the user question. Preserve formulas, Greek letters, subscripts/superscripts, and special symbols if present:\n" +
          ctx.selectedPassage
        );
      }
      if (ctx && ctx.selectedPassageLocatedSnippet) {
        lines.push(
          "Original context located by matching the copied selection back into the current document/full-text cache. Use this to disambiguate formulas or special characters in the selected passage:\n" +
          ctx.selectedPassageLocatedSnippet
        );
      }
      if (ctx.fromRecentContext) {
        lines.push("The live Zotero reader handle was temporarily unavailable, so the plugin is using the most recent reading context captured from the same Zotero tab.");
      }
      if (ctx.topTitle) lines.push("Top visible plugin reading page: " + ctx.topTitle);
      if (ctx.readerPage) {
        lines.push("The plugin has detected the current Zotero PDF reader page as page " + ctx.readerPage + ". Treat this as the user's current reading page unless the user says otherwise.");
      }
      if (ctx.readerPageText) {
        lines.push("Full text extracted from the currently visible Zotero PDF page" + (ctx.readerPage ? " (page " + ctx.readerPage + ")" : "") + ":\n" + ctx.readerPageText);
      }
      if (ctx.readerTitle) lines.push("Current Zotero reader item: " + ctx.readerTitle);
      if (ctx.selectedTitle) lines.push("Selected Zotero item: " + ctx.selectedTitle);
      if (ctx.contextText) lines.push(ctx.contextText);
      else if (ctx.reportText) lines.push("Current report excerpt:\n" + truncateText(ctx.reportText, 12000));
      return lines.length ? "\n\nContext:\n" + lines.join("\n\n") : "";
    },

    _sendMessage: function () {
      var input = this._nodes.input;
      if (!input) return;
      var text = cleanText(input.value || "").trim();
      if (!text) return;
      this._clearPendingSelectionIfContextChanged();
      input.value = "";
      var pendingSelection = makeSelectionRecord(this._pendingSelection || this._pendingSelectionText);
      var selectedPassage = pendingSelection ? pendingSelection.text : "";

      if (!isLLMConfigured() || typeof ArxivDailyLLM === "undefined") {
        this._appendMessage("user", text);
        this._appendMessage("assistant", "LLM 尚未配置。请先在设置中填写 API Key、模型和 Base URL，然后再发送问题。", true);
        return;
      }

      if (this._nodes.send) this._nodes.send.setAttribute("disabled", "true");
      this._appendMessage("user", text);
      var userIndex = this._thread.messages.length - 1;
      this._appendMessage("assistant", "正在读取上下文并请求 LLM...");
      var pendingIndex = this._thread.messages.length - 1;
      this._saveThread();

      var self = this;
      this._captureContextAsync().then(function (ctx) {
        var resolvedSelection = selectedPassage ? resolveSelectionAgainstContext(pendingSelection, ctx) : null;
        if (resolvedSelection && resolvedSelection.text) {
          selectedPassage = resolvedSelection.text;
          if (resolvedSelection.locatedSnippet) {
            ctx.selectedPassageLocatedSnippet = [
              "Located in: " + (resolvedSelection.locatedLabel || "unknown"),
              "Match confidence: " + (resolvedSelection.locatedConfidence || "unknown"),
              resolvedSelection.locatedSnippet,
            ].join("\n");
          }
        }
        if (selectedPassage) {
          ctx.selectedPassage = selectedPassage;
          ctx.contextLabel = (ctx.contextLabel && ctx.contextLabel !== "无活动上下文" ? ctx.contextLabel + "、" : "") + "选中段落";
        }
        if (self._thread.messages[userIndex]) {
          self._thread.messages[userIndex].contextLabel = ctx.contextLabel || "";
          if (selectedPassage) self._thread.messages[userIndex].selectedPassage = selectedPassage;
          if (resolvedSelection && resolvedSelection.locatedSnippet) {
            self._thread.messages[userIndex].selectedPassageContext = resolvedSelection.locatedSnippet;
          }
        }
        if (selectedPassage) {
          self._pendingSelectionText = "";
          self._pendingSelection = null;
          self._pendingSelectionContextKey = "";
          self._renderSelectionQuote();
        }
        return self._requestLLM(text, ctx, pendingIndex);
      }).catch(function (err) {
        self._thread.messages[pendingIndex] = {
          role: "assistant",
          content: "读取上下文或 LLM 请求失败: " + (err.message || err),
          error: true,
          retryText: text,
          timestamp: Date.now(),
        };
        self._lastFailedRequest = { text: text, context: null, pendingIndex: pendingIndex };
        self._renderMessages();
        self._saveThread();
      }).then(function () {
        if (self._nodes.send) self._nodes.send.removeAttribute("disabled");
      });
    },

    _requestLLM: function (text, ctx, pendingIndex) {
      var preset = this._depthPreset();
      var overrides = {
        temperature: preset.temperature,
        maxTokens: preset.maxTokens,
      };
      if (this._selectedModel) overrides.modelRef = this._selectedModel;
      else if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.getUsageModelRef) overrides.modelRef = ArxivDailyLLM.getUsageModelRef("qa");
      overrides.kind = "qa";

      var self = this;
      function applyResult(result, usedCtx, note) {
        var finalContent = cleanText((note ? note + "\n\n" : "") + (result && result.content ? result.content : ""));
        self._thread.messages[pendingIndex] = {
          role: "assistant",
          content: finalContent,
          thinking: cleanText(result && result.thinking ? result.thinking : ""),
          thinkingElapsedMs: result && result.elapsedMs ? result.elapsedMs : 0,
          thinkingDone: true,
          model: (getLLMSummary().model || ""),
          contextLabel: usedCtx && usedCtx.contextLabel,
          timestamp: Date.now(),
        };
        self._renderMessages();
        self._saveThread();
        self._maybeSummarizeThreadTitle();
      }
      function requestWithContext(usedCtx) {
        var system = cleanText(qaSystemPrompt() + "\nToday is " + todayStr() + "." + self._contextPrompt(usedCtx));
        var userText = cleanText(text);
        if (!ArxivDailyLLM.completeQAStream) {
          return ArxivDailyLLM.completeQA(system, userText, overrides, null);
        }
        return new Promise(function (resolve, reject) {
          var content = "";
          var thinking = "";
          var lastRender = 0;
          var streamStartedAt = Date.now();

          function renderPartial(force) {
            var now = Date.now();
            if (!force && now - lastRender < 220) return;
            lastRender = now;
            var visible = content || "正在接收 LLM 回答...";
            if (thinking && !content) {
              visible = "正在思考...\n\n" + thinking.slice(-1200);
            }
            self._thread.messages[pendingIndex] = {
              role: "assistant",
              content: cleanText(content || "正在接收 LLM 回答..."),
              thinking: cleanText(thinking || ""),
              thinkingElapsedMs: Date.now() - streamStartedAt,
              thinkingDone: false,
              model: (getLLMSummary().model || ""),
              contextLabel: usedCtx && usedCtx.contextLabel,
              streaming: true,
              timestamp: Date.now(),
            };
            try {
              self._renderMessages();
            } catch (renderErr) {
              logError("render QA partial failed: " + (renderErr.message || renderErr));
            }
          }

          renderPartial(true);
          ArxivDailyLLM.completeQAStream(system, userText, overrides, function (chunk, done, thinkingDelta) {
            if (thinkingDelta) thinking = cleanText(thinking + thinkingDelta);
            if (chunk) content = cleanText(content + chunk);
            if (done) {
              if (!String(content || "").trim()) {
                reject(new Error("LLM 返回了空响应。请检查模型名、API style、Base URL，或在设置中的环境测试里查看连接诊断。"));
                return;
              }
              resolve({
                content: content,
                thinking: thinking,
                elapsedMs: Date.now() - streamStartedAt,
              });
              return;
            }
            renderPartial(false);
          }, null).catch(function (streamErr) {
            if (String(content || "").trim()) {
              resolve({
                content: content + "\n\n[流式连接在回答过程中中断，已保留已收到的内容。原始错误: " + (streamErr.message || streamErr) + "]",
                thinking: thinking,
                elapsedMs: Date.now() - streamStartedAt,
                partial: true,
              });
              return;
            }
            reject(streamErr);
          });
        }).catch(function (streamErr) {
          var msg = String((streamErr && streamErr.message) || streamErr || "");
          if (/stream|streaming|event-stream|空响应/i.test(msg) && ArxivDailyLLM.completeQA) {
            return ArxivDailyLLM.completeQA(system, userText, overrides, null);
          }
          throw streamErr;
        });
      }
      function shouldCompactRetry(err) {
        var msg = String((err && err.message) || err || "");
        return ctx && ctx.contextText && ctx.contextText.length > 18000 &&
          /context|token|maximum|max|too long|length|413|400|invalid_request/i.test(msg);
      }

      return requestWithContext(ctx).then(function (result) {
        applyResult(result, ctx, "");
      }).catch(function (err) {
        if (shouldCompactRetry(err)) {
          var compactCtx = Object.assign({}, ctx, {
            contextText: truncateText(ctx.contextText, 12000),
            contextLabel: (ctx.contextLabel || "上下文") + "（已压缩重试）",
          });
          return requestWithContext(compactCtx).then(function (retryResult) {
            applyResult(retryResult, compactCtx, "第一次请求可能因上下文过长失败，已自动压缩上下文后重试。");
          }).catch(function (retryErr) {
            retryErr.message = (retryErr.message || retryErr) + "\n压缩上下文重试仍失败。原始错误: " + (err.message || err);
            throw retryErr;
          });
        }
        throw err;
      }).catch(function (err) {
        self._thread.messages[pendingIndex] = {
          role: "assistant",
          content: "LLM 请求失败: " + (err.message || err),
          thinking: "",
          thinkingDone: true,
          error: true,
          retryText: text,
          contextSnapshot: ctx,
          timestamp: Date.now(),
        };
        self._lastFailedRequest = { text: text, context: ctx, pendingIndex: pendingIndex };
        self._renderMessages();
        self._saveThread();
      });
    },

    _retryMessage: function (messageIndex) {
      if (!this._thread || !this._thread.messages || !this._thread.messages[messageIndex]) return;
      var failed = this._thread.messages[messageIndex];
      var text = failed.retryText || (this._lastFailedRequest && this._lastFailedRequest.text) || "";
      if (!text) return;
      failed.content = "正在重试 LLM 请求...";
      failed.error = false;
      this._renderMessages();
      if (this._nodes.send) this._nodes.send.setAttribute("disabled", "true");
      var ctx = failed.contextSnapshot || (this._lastFailedRequest && this._lastFailedRequest.context);
      var self = this;
      var run = ctx ? Promise.resolve(ctx) : this._captureContextAsync();
      run.then(function (snapshot) {
        return self._requestLLM(text, snapshot, messageIndex);
      }).catch(function (err) {
        self._thread.messages[messageIndex] = {
          role: "assistant",
          content: "LLM 重试失败: " + (err.message || err),
          error: true,
          retryText: text,
          contextSnapshot: ctx || null,
          timestamp: Date.now(),
        };
        self._renderMessages();
        self._saveThread();
      }).then(function () {
        if (self._nodes.send) self._nodes.send.removeAttribute("disabled");
      });
    },

    _appendMessage: function (role, content, error) {
      if (!this._thread) {
        this._thread = { id: uuid(), title: "问答 " + new Date().toLocaleString(), messages: [], createdAt: Date.now() };
      }
      this._thread.messages.push({
        role: role,
        content: cleanText(content || ""),
        error: !!error,
        timestamp: Date.now(),
      });
      this._renderMessages();
      this._saveThread();
    },

    _maybeSummarizeThreadTitle: function () {
      if (!this._thread || this._thread.titleLocked || this._titleSummaryPending) return;
      var messages = this._thread.messages || [];
      var firstUser = "";
      var firstAssistant = "";
      for (var i = 0; i < messages.length; i++) {
        if (!firstUser && messages[i].role === "user") firstUser = messages[i].content || "";
        else if (firstUser && !firstAssistant && messages[i].role === "assistant" && !messages[i].error) {
          firstAssistant = messages[i].content || "";
          break;
        }
      }
      if (!firstUser || !firstAssistant || typeof ArxivDailyLLM === "undefined" || !ArxivDailyLLM.completeQA) return;
      var threadID = this._thread.id;
      this._titleSummaryPending = true;
      var prompt = [
        "You name Zotero LLM chat sessions.",
        "Return one concise Chinese title, 6 to 16 characters if possible.",
        "No quotes, no punctuation unless necessary.",
      ].join("\n");
      var content = "用户问题:\n" + firstUser.slice(0, 1000) + "\n\n回答摘要材料:\n" + firstAssistant.slice(0, 1200);
      var self = this;
      ArxivDailyLLM.completeQA(prompt, content, { maxTokens: 60, temperature: 0.1 }, null).then(function (result) {
        var title = cleanText(result && result.content ? result.content : "")
          .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "")
          .replace(/\s+/g, " ")
          .slice(0, 32);
        if (!title) return;
        self._loadThreads();
        var updated = false;
        for (var i = 0; i < self._threads.length; i++) {
          if (self._threads[i].id === threadID) {
            self._threads[i].title = title;
            self._threads[i].titleLocked = true;
            updated = true;
            if (self._thread && self._thread.id === threadID) self._thread = self._threads[i];
            break;
          }
        }
        if (!updated && self._thread && self._thread.id === threadID) {
          self._thread.title = title;
          self._thread.titleLocked = true;
        }
        self._saveThread();
        self._updateThreadList();
      }).catch(function (err) {
        logError("summarize QA thread title failed: " + (err.message || err));
      }).then(function () {
        self._titleSummaryPending = false;
      });
    },

    _renderMessages: function () {
      var box = this._nodes.messages;
      if (!box) return;
      var wasNearBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 32;
      var previousScrollTop = box.scrollTop;
      while (box.firstChild) box.removeChild(box.firstChild);
      var messages = this._thread && this._thread.messages ? this._thread.messages : [];
      if (!messages.length) {
        var empty = create(box.ownerDocument, "div", "ari-qa-message ari-qa-assistant");
        empty.textContent = "输入问题开始问答。可在任何 Zotero 阅读场景中打开此侧栏。";
        box.appendChild(empty);
        return;
      }
      for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        var node = create(box.ownerDocument, "div", "ari-qa-message " +
          (msg.role === "user" ? "ari-qa-user" : "ari-qa-assistant") +
          (msg.error ? " ari-qa-error" : ""));
        if (msg.selectedPassage) {
          var quote = create(box.ownerDocument, "div", "ari-qa-selection");
          quote.style.display = "block";
          var fullSelected = cleanText(msg.selectedPassage || "").trim();
          quote.title = fullSelected;
          var quoteToggle = create(box.ownerDocument, "button", "", "▾");
          quoteToggle.title = "展开选中段落全文";
          var quoteText = create(box.ownerDocument, "span", "ari-qa-selection-text",
            "选中段落: " + fullSelected.replace(/\s+/g, " "));
          quoteText.title = fullSelected;
          var quoteDetail = create(box.ownerDocument, "div", "ari-qa-selection-detail", fullSelected +
            (msg.selectedPassageContext ? "\n\n定位原文上下文:\n" + cleanText(msg.selectedPassageContext) : ""));
          quoteToggle.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            var detail = event.currentTarget.parentNode.querySelector(".ari-qa-selection-detail");
            var open = detail && detail.style.display === "block";
            if (detail) detail.style.display = open ? "none" : "block";
            event.currentTarget.textContent = open ? "▾" : "▴";
            event.currentTarget.title = open ? "展开选中段落全文" : "收起选中段落全文";
          });
          quote.appendChild(quoteToggle);
          quote.appendChild(quoteText);
          quote.appendChild(quoteDetail);
          node.appendChild(quote);
        }
        if (msg.role === "assistant" && (msg.thinking || msg.streaming)) {
          var think = create(box.ownerDocument, "div", "ari-qa-think");
          var indexKey = String(i);
          var expanded = !!this._thinkingExpanded[indexKey];
          var toggle = create(box.ownerDocument, "button", "ari-qa-think-toggle", expanded ? "▾" : "▸");
          toggle.title = expanded ? "收起思考过程" : "展开思考过程";
          toggle.setAttribute("data-message-index", indexKey);
          toggle.addEventListener("click", function (event) {
            var idx = event.currentTarget.getAttribute("data-message-index");
            ArxivDailyQA._thinkingExpanded[idx] = !ArxivDailyQA._thinkingExpanded[idx];
            ArxivDailyQA._renderMessages();
          });
          var elapsed = msg.thinkingElapsedMs ? "（用时 " + Math.max(1, Math.round(msg.thinkingElapsedMs / 1000)) + " 秒）" : "";
          var label = create(box.ownerDocument, "span", "", msg.thinkingDone ? ("思考完成" + elapsed) : "正在思考中");
          var body = create(box.ownerDocument, "div", "ari-qa-think-body");
          body.style.display = expanded ? "block" : "none";
          body.textContent = msg.thinking || "暂无可显示的思考过程。";
          body.addEventListener("wheel", function (event) {
            var el = event.currentTarget;
            var atTop = el.scrollTop <= 0;
            var atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
            if ((event.deltaY < 0 && !atTop) || (event.deltaY > 0 && !atBottom)) {
              event.stopPropagation();
            }
          }, { passive: false });
          think.appendChild(toggle);
          think.appendChild(label);
          think.appendChild(body);
          node.appendChild(think);
        }
        appendPlainMessage(box.ownerDocument, node, msg.content);
        var fullCopyText = messageClipboardText(msg);
        if (fullCopyText || (msg.error && msg.retryText)) {
          var tools = create(box.ownerDocument, "div", "ari-qa-message-tools");
          if (fullCopyText) {
            var copy = create(box.ownerDocument, "button", "ari-qa-copy", "Copy");
            copy.title = msg.role === "user" ? "Copy this question" : "Copy this answer";
            copy.setAttribute("data-message-index", String(i));
            copy.addEventListener("click", function (event) {
              event.preventDefault();
              event.stopPropagation();
              var index = parseInt(event.currentTarget.getAttribute("data-message-index"), 10);
              var message = ArxivDailyQA._thread && ArxivDailyQA._thread.messages ?
                ArxivDailyQA._thread.messages[index] : null;
              var ok = writeClipboardText(messageClipboardText(message));
              event.currentTarget.textContent = ok ? "Copied" : "Copy failed";
              var button = event.currentTarget;
              try {
                (box.ownerDocument.defaultView || mainWindow()).setTimeout(function () {
                  if (button) button.textContent = "Copy";
                }, 1200);
              } catch (e) {}
            });
            tools.appendChild(copy);
          }
          if (msg.error && msg.retryText) {
            var retry = create(box.ownerDocument, "button", "ari-qa-retry", "重试");
          retry.title = "用发送问题时的上下文快照重新请求";
          retry.setAttribute("data-message-index", String(i));
          retry.addEventListener("click", function (event) {
            var index = parseInt(event.currentTarget.getAttribute("data-message-index"), 10);
            ArxivDailyQA._retryMessage(index);
          });
            tools.appendChild(retry);
          }
          node.appendChild(tools);
        }
        box.appendChild(node);
      }
      if (wasNearBottom) box.scrollTop = box.scrollHeight;
      else box.scrollTop = previousScrollTop;
    },

    _saveThread: function () {
      try {
        if (!this._thread || typeof ArxivDailyDataDir === "undefined") return;
        this._thread = sanitizeForStorage(this._thread) || this._thread;
        this._thread.updatedAt = Date.now();
        if (!this._thread.title) {
          this._thread.title = this._threadTitle(this._thread);
        }
        var threads = ArxivDailyDataDir.readJSON(THREAD_STORE) || [];
        if (!Array.isArray(threads)) threads = [];
        threads = sanitizeForStorage(threads) || [];
        var updated = false;
        for (var i = 0; i < threads.length; i++) {
          if (threads[i].id === this._thread.id) {
            threads[i] = this._thread;
            updated = true;
            break;
          }
        }
        if (!updated) threads.push(this._thread);
        threads.sort(function (a, b) {
          return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
        });
        if (threads.length > 30) threads = threads.slice(0, 30);
        this._threads = threads;
        ArxivDailyDataDir.writeJSON(THREAD_STORE, threads);
        this._updateThreadList();
      } catch (err) {
        logError("save QA thread failed: " + (err.message || err));
      }
    },

    _registerTabObserver: function () {
      if (this._tabObserverID || typeof Zotero === "undefined" || !Zotero.Notifier) return;
      var self = this;
      try {
        this._tabObserverID = Zotero.Notifier.registerObserver({
          notify: function (event, type) {
            if (type !== "tab") return;
            if (!/^(select|load|close)$/i.test(String(event || ""))) return;
            self._clearSelectionStateForPageChange();
            self._lastActiveContextKey = self._currentContextKey();
            if (self._visible) self._scheduleRemount();
            else self._scheduleTabButton();
          },
        }, ["tab"], "arxiv-interest-daily-qa", 100);
      } catch (err) {
        logError("register QA tab observer failed: " + (err.message || err));
      }
    },

    _scheduleRemount: function () {
      if (this._remountTimer) clearTimeout(this._remountTimer);
      var self = this;
      this._remountTimer = setTimeout(function () {
        self._remountTimer = null;
        if (!self._visible) return;
        try {
          var win = mainWindow();
          if (!win || !win.document) return;
          self._ensurePanel(win.document);
          self._refreshControls();
          self._refreshContext();
        } catch (err) {
          logError("QA remount failed: " + (err.message || err));
        }
      }, 120);
    },

    _installNativeYieldObserver: function () {
      var win = mainWindow();
      if (!win || !win.document || this._nativeYieldHandlersInstalled) return;
      var self = this;
      this._nativeYieldHandlersInstalled = true;
      function maybeYield(event) {
        if (!self._visible || !self._isPanelActuallyVisible()) return;
        var target = event && event.target;
        if (!target || !target.closest) return;
        if (target.closest("#arxiv-daily-qa-sidebar,#arxiv-daily-qa-tab-btn")) return;
        if (target.closest("#zotero-items-tree") ||
            target.closest(".zotero-items-tree") ||
            target.closest("#zotero-items-pane") ||
            target.closest("#zotero-collections-tree")) {
          setTimeout(function () {
            self._yieldToNativePane();
          }, 0);
        }
      }
      this._nativeYieldMouseUp = maybeYield;
      this._nativeYieldSelect = maybeYield;
      try {
        win.document.addEventListener("mouseup", this._nativeYieldMouseUp, true);
        win.document.addEventListener("select", this._nativeYieldSelect, true);
      } catch (e) {}
    },

    _removeNativeYieldObserver: function () {
      var win = mainWindow();
      if (win && win.document && this._nativeYieldHandlersInstalled) {
        try {
          win.document.removeEventListener("mouseup", this._nativeYieldMouseUp, true);
          win.document.removeEventListener("select", this._nativeYieldSelect, true);
        } catch (e) {}
      }
      this._nativeYieldHandlersInstalled = false;
      this._nativeYieldMouseUp = null;
      this._nativeYieldSelect = null;
    },

    _installReaderSelectionCapture: function () {
      if (this._readerSelectionListenerInstalled || typeof Zotero === "undefined" || !Zotero.Reader ||
          typeof Zotero.Reader.registerEventListener !== "function") return;
      var self = this;
      this._readerSelectionHandler = function (event) {
        try {
          var eventWin = event && event.doc && event.doc.defaultView;
          var eventSel = eventWin && eventWin.getSelection ? eventWin.getSelection() : null;
          var point = selectionPointFromDocument(event && event.doc);
          var found = selectionFromWindow(eventWin, { allowCopy: false, allowVisualScan: false }) || {
            win: eventWin,
            selection: eventSel,
            text: "",
            point: point,
            source: "reader-popup-window",
          };
          var readerRecord = selectionFromZoteroReaderState(found, event && event.reader, { allowCopy: false });
          var eventText = textFromReaderSelectionEvent(event);
          var windowText = "";
          var copySelection = null;
          try {
            windowText = trimSelectionTextToRange(cleanSelectionText(eventSel && eventSel.toString ? eventSel.toString() : ""), eventSel);
          } catch (copyErr) {}
          var copyRecord = copySelection && copySelection.text ? makeSelectionRecord({
            text: copySelection.text,
            html: copySelection.html || "",
            source: copySelection.source || "copy-event",
            debug: copySelection.debug || "",
            point: point,
          }) : null;
          var windowRecord = windowText ? makeSelectionRecord({
            text: windowText,
            html: "",
            source: "reader-window-selection",
            debug: "",
            point: point,
          }) : null;
          var eventRecord = eventText ? makeSelectionRecord({
            text: eventText,
            html: copySelection && copySelection.html ? copySelection.html : "",
            source: "reader-event",
            debug: "",
            point: point,
          }) : null;
          var record = readerRecord || eventRecord || windowRecord || copyRecord;
          if (!record || !record.text) return;
          var debug = joinDebugParts([
            readerEventParamDebug(event),
            readerRecord && readerRecord.debug ? readerRecord.debug : "",
            "copyLen=" + cleanSelectionText(copySelection && copySelection.text || "").length,
            "eventLen=" + cleanSelectionText(eventText).length,
            "windowLen=" + cleanSelectionText(windowText).length,
            "chosen=" + (record.source || "unknown"),
            "copyHead=" + debugSnippet(copySelection && copySelection.text || "", 70),
            "eventHead=" + debugSnippet(eventText, 70),
            "windowHead=" + debugSnippet(windowText, 70),
            copySelection && copySelection.debug ? copySelection.debug : "",
          ]);
          record.debug = joinDebugParts([record.debug || "", debug]);
          var appendedReaderButton = false;
          if (record.text) {
            self._armSelectionAskGesture(2500);
            appendedReaderButton = appendReaderSelectionAskButton(event, record);
            if (appendedReaderButton) {
              self._readerSelectionButtonAt = Date.now();
              self._readerSelectionButtonUntil = Date.now() + 6500;
              self._suppressSelectionAskUntil = Date.now() + 6500;
            }
            self._removeNativeSelectionAskPopup();
          }
          self._lastReaderSelectionCapture = {
            text: record.text,
            html: record.html || (copySelection && copySelection.html ? copySelection.html : ""),
            point: record.point || point,
            source: record.source || "reader-event",
            debug: record.debug || debug,
            contextKey: activeContextKey(),
            at: Date.now(),
          };
          if (!appendedReaderButton) {
            setTimeout(function () { self._maybeShowNativeSelectionAsk(null); }, 20);
          }
        } catch (err) {
          logError("reader selection capture failed: " + (err.message || err));
        }
      };
      try {
        Zotero.Reader.registerEventListener("renderTextSelectionPopup", this._readerSelectionHandler, PLUGIN_ID);
        this._readerSelectionListenerInstalled = true;
      } catch (err) {
        logError("register reader selection capture failed: " + (err.message || err));
      }
    },

    _removeReaderSelectionCapture: function () {
      if (!this._readerSelectionListenerInstalled || typeof Zotero === "undefined" || !Zotero.Reader) return;
      try {
        if (Zotero.Reader._registeredListeners && Array.isArray(Zotero.Reader._registeredListeners)) {
          var handler = this._readerSelectionHandler;
          Zotero.Reader._registeredListeners = Zotero.Reader._registeredListeners.filter(function (listener) {
            return !(listener && listener.type === "renderTextSelectionPopup" &&
              (listener.handler === handler || listener.pluginID === PLUGIN_ID));
          });
        }
      } catch (err) {
        logError("remove reader selection capture failed: " + (err.message || err));
      }
      this._readerSelectionHandler = null;
      this._readerSelectionListenerInstalled = false;
      this._lastReaderSelectionCapture = null;
    },

    _installNativeSelectionAsk: function () {
      var win = mainWindow();
      if (!win || !win.document || this._nativeSelectionHandlersInstalled) return;
      var self = this;
      this._nativeSelectionHandlersInstalled = true;
      this._nativeSelectionMouseUp = function (event) {
        if (self._selectionAskPopup && self._selectionAskPopup.contains(event.target)) return;
        if (recentReaderPopupButtonActive(6500)) {
          self._suppressSelectionAskUntil = Math.max(self._suppressSelectionAskUntil || 0, Date.now() + 3500);
          self._removeNativeSelectionAskPopup();
          return;
        }
        if (eventTargetBlocksSelectionAsk(event)) {
          self._cancelSelectionAskForUIInteraction();
          return;
        }
        self._selectionMousePosition = { x: event.clientX || 0, y: event.clientY || 0, at: Date.now() };
        self._lastReaderSelectionCapture = null;
          self._selectionClearUntil = 0;
          self._suppressSelectionAskUntil = 0;
          setTimeout(function () {
            if (recentReaderPopupButtonActive(6500)) {
              self._removeNativeSelectionAskPopup();
              return;
            }
            var found = selectionFromVisibleFramesOnly(win.document);
            if (!found) {
            self._lastNativeCopyCapture = null;
            self._disarmSelectionAskGesture();
            self._removeNativeSelectionAskPopup();
            return;
          }
          if (!found || !eventBelongsToSelectionWindow(event, found)) {
            self._cancelSelectionAskForUIInteraction();
            return;
          }
          self._armSelectionAskGesture(2600);
          self._captureNativeCopyCache(found);
          self._maybeShowNativeSelectionAsk(event, found);
        }, 40);
      };
      this._nativeSelectionKeyUp = function (event) {
        if (self._selectionAskPopup && self._selectionAskPopup.contains(event.target)) return;
        if (eventTargetBlocksSelectionAsk(event)) {
          self._cancelSelectionAskForUIInteraction();
          return;
        }
        var key = String(event && event.key || "");
        var lower = key.toLowerCase();
        var selectionKey = (!!(event && event.shiftKey) && /^(ArrowDown|ArrowUp|ArrowLeft|ArrowRight|PageDown|PageUp|Home|End)$/.test(key)) ||
          (!!(event && (event.ctrlKey || event.metaKey)) && lower === "a");
        if (!selectionKey) return;
        self._armSelectionAskGesture(1800);
        setTimeout(function () { self._maybeShowNativeSelectionAsk(event); }, 40);
      };
      this._nativeSelectionTabChange = function () {
        self._cancelSelectionAskForUIInteraction();
        setTimeout(function () { self._clearIfActiveContextChanged(); }, 0);
      };
      win.document.addEventListener("mouseup", this._nativeSelectionMouseUp, true);
      win.document.addEventListener("keyup", this._nativeSelectionKeyUp, true);
      win.document.addEventListener("select", this._nativeSelectionTabChange, true);
      win.document.addEventListener("TabSelect", this._nativeSelectionTabChange, true);
      win.document.addEventListener("command", this._nativeSelectionTabChange, true);
      win.document.addEventListener("visibilitychange", this._nativeSelectionTabChange, true);
      win.document.addEventListener("mousedown", function (event) {
        if (self._selectionAskPopup && self._selectionAskPopup.contains(event.target)) return;
        if (eventTargetBlocksSelectionAsk(event)) {
          self._cancelSelectionAskForUIInteraction();
          return;
        }
        if (self._selectionAskPopup && !self._selectionAskPopup.contains(event.target)) {
          self._lastReaderSelectionCapture = null;
          self._lastNativeCopyCapture = null;
          self._ignoredSelectionSignature = "";
          self._ignoredSelectionTextSignature = "";
          self._disarmSelectionAskGesture();
          self._selectionClearUntil = Date.now() + 2500;
          self._suppressSelectionAskUntil = Date.now() + 2500;
          self._removeNativeSelectionAskPopup();
        }
      }, true);
      win.document.addEventListener("selectionchange", function () {
        self._lastNativeSelectionText = "";
      }, true);
      this._installSelectionFrameHandlers();
      this._startSelectionPolling();
    },

    _selectionFrameHandlerInstalled: function (doc) {
      var handlers = this._nativeSelectionFrameHandlers || [];
      for (var i = 0; i < handlers.length; i++) {
        if (handlers[i] && handlers[i].doc === doc) return true;
      }
      return false;
    },

    _docHasLiveSelection: function (doc) {
      try {
        var sel = doc && doc.defaultView && doc.defaultView.getSelection ? doc.defaultView.getSelection() : null;
        return !!(sel && !sel.isCollapsed && sel.rangeCount);
      } catch (e) {
        return false;
      }
    },

    _installSelectionFrameHandlers: function () {
      var win = mainWindow();
      if (!win || !win.document) return;
      var self = this;
      function installForDoc(doc, depth) {
        if (!doc || depth > 4 || self._selectionFrameHandlerInstalled(doc)) return;
        var down = function () {
          if (recentReaderPopupButtonActive(6500)) {
            self._suppressSelectionAskUntil = Math.max(self._suppressSelectionAskUntil || 0, Date.now() + 3500);
            self._removeNativeSelectionAskPopup();
            return;
          }
          self._lastReaderSelectionCapture = null;
          self._lastNativeCopyCapture = null;
          self._ignoredSelectionSignature = "";
          self._ignoredSelectionTextSignature = "";
          self._disarmSelectionAskGesture();
          self._selectionClearUntil = Date.now() + 2500;
          self._suppressSelectionAskUntil = Date.now() + 2500;
          self._removeNativeSelectionAskPopup();
        };
        var up = function (event) {
          if (recentReaderPopupButtonActive(6500)) {
            self._suppressSelectionAskUntil = Math.max(self._suppressSelectionAskUntil || 0, Date.now() + 3500);
            self._removeNativeSelectionAskPopup();
            return;
          }
          try {
            var frame = doc.defaultView && doc.defaultView.frameElement;
            var point = pointWithFrameOffset({ x: event.clientX || 0, y: event.clientY || 0 }, frame);
            self._selectionMousePosition = { x: point.x, y: point.y, at: Date.now() };
          } catch (e) {}
          self._selectionClearUntil = 0;
          self._suppressSelectionAskUntil = 0;
          setTimeout(function () {
            if (recentReaderPopupButtonActive(6500)) {
              self._removeNativeSelectionAskPopup();
              return;
            }
            var found = selectionFromVisibleFramesOnly(mainWindow() && mainWindow().document || doc);
            if (!found) {
              self._lastNativeCopyCapture = null;
              self._disarmSelectionAskGesture();
              self._removeNativeSelectionAskPopup();
              return;
            }
            self._armSelectionAskGesture(2600);
            self._captureNativeCopyCache(found);
            self._maybeShowNativeSelectionAsk(null, found);
          }, 40);
        };
        var change = function () {
          setTimeout(function () {
            try {
              var sel = doc.defaultView && doc.defaultView.getSelection ? doc.defaultView.getSelection() : null;
              if (!sel || sel.isCollapsed) {
                self._lastReaderSelectionCapture = null;
                self._ignoredSelectionSignature = currentSelectionSignature(mainWindow() && mainWindow().document || doc);
                self._ignoredSelectionTextSignature = currentSelectionTextSignature(mainWindow() && mainWindow().document || doc);
                self._suppressSelectionAskUntil = Date.now() + 2500;
                self._disarmSelectionAskGesture();
                self._removeNativeSelectionAskPopup();
                return;
              }
            } catch (e) {}
          }, 40);
        };
        var pageInteraction = function (event) {
          self._scheduleReaderPageInteraction(doc, event);
        };
        try {
          doc.addEventListener("mousedown", down, true);
          doc.addEventListener("mouseup", up, true);
          doc.addEventListener("selectionchange", change, true);
          doc.addEventListener("scroll", pageInteraction, true);
          doc.addEventListener("wheel", pageInteraction, true);
          doc.addEventListener("keydown", pageInteraction, true);
          doc.addEventListener("pagechange", pageInteraction, true);
          doc.addEventListener("pagechanging", pageInteraction, true);
          self._nativeSelectionFrameHandlers.push({
            doc: doc,
            down: down,
            up: up,
            change: change,
            pageInteraction: pageInteraction,
          });
        } catch (e2) {}
        var frames = [];
        try { frames = Array.prototype.slice.call(doc.querySelectorAll("iframe,browser")); } catch (e3) {}
        for (var i = 0; i < frames.length; i++) {
          try {
            var childDoc = frames[i].contentDocument ||
              (frames[i].contentWindow && frames[i].contentWindow.document);
            installForDoc(childDoc, depth + 1);
          } catch (e4) {}
        }
      }
      try {
        var frames = Array.prototype.slice.call(win.document.querySelectorAll("iframe,browser"));
        for (var i = 0; i < frames.length; i++) {
          var doc = frames[i].contentDocument ||
            (frames[i].contentWindow && frames[i].contentWindow.document);
          installForDoc(doc, 1);
        }
      } catch (e5) {}
    },

    _removeSelectionFrameHandlers: function () {
      var handlers = this._nativeSelectionFrameHandlers || [];
      for (var i = 0; i < handlers.length; i++) {
        var entry = handlers[i];
        if (!entry || !entry.doc) continue;
        try {
          entry.doc.removeEventListener("mousedown", entry.down, true);
          entry.doc.removeEventListener("mouseup", entry.up, true);
          entry.doc.removeEventListener("selectionchange", entry.change, true);
          if (entry.pageInteraction) {
            entry.doc.removeEventListener("scroll", entry.pageInteraction, true);
            entry.doc.removeEventListener("wheel", entry.pageInteraction, true);
            entry.doc.removeEventListener("keydown", entry.pageInteraction, true);
            entry.doc.removeEventListener("pagechange", entry.pageInteraction, true);
            entry.doc.removeEventListener("pagechanging", entry.pageInteraction, true);
          }
        } catch (e) {}
      }
      this._nativeSelectionFrameHandlers = [];
    },

    _removeNativeSelectionAsk: function () {
      var win = mainWindow();
      if (win && win.document && this._nativeSelectionHandlersInstalled) {
        try {
          win.document.removeEventListener("mouseup", this._nativeSelectionMouseUp, true);
          win.document.removeEventListener("keyup", this._nativeSelectionKeyUp, true);
          if (this._nativeSelectionTabChange) {
            win.document.removeEventListener("select", this._nativeSelectionTabChange, true);
            win.document.removeEventListener("TabSelect", this._nativeSelectionTabChange, true);
            win.document.removeEventListener("command", this._nativeSelectionTabChange, true);
            win.document.removeEventListener("visibilitychange", this._nativeSelectionTabChange, true);
          }
        } catch (e) {}
      }
      this._nativeSelectionHandlersInstalled = false;
      this._nativeSelectionTabChange = null;
      this._removeSelectionFrameHandlers();
      this._stopSelectionPolling();
      this._removeNativeSelectionAskPopup();
    },

    _startSelectionPolling: function () {
      if (this._selectionPollTimer) return;
      var self = this;
      this._selectionPollTimer = setInterval(function () {
        try {
          if (selectionAskMode() !== "global") {
            self._lastNativeSelectionText = "";
            self._removeNativeSelectionAskPopup();
            return;
          }
          if (self._clearIfActiveContextChanged()) return;
          self._clearPendingSelectionIfContextChanged();
          self._clearPopupIfContextChanged();
          self._installSelectionFrameHandlers();
          if (self._visible && Date.now() - (self._lastContextRefreshAt || 0) > 1800) {
            self._lastContextRefreshAt = Date.now();
            self._refreshContext();
          }
        } catch (e) {}
      }, 650);
    },

    _stopSelectionPolling: function () {
      if (this._selectionPollTimer) {
        clearInterval(this._selectionPollTimer);
        this._selectionPollTimer = null;
      }
    },

    _removeNativeSelectionAskPopup: function () {
      if (this._selectionAskPopup && this._selectionAskPopup.parentNode) {
        this._selectionAskPopup.parentNode.removeChild(this._selectionAskPopup);
      }
      this._selectionAskPopup = null;
      this._selectionAskContextKey = "";
      this._selectionAskSourceWin = null;
      this._lastNativeSelectionText = "";
      this._lastNativeSelectionPointKey = "";
    },

    _captureNativeCopyCache: function (found) {
      try {
        var win = mainWindow();
        var doc = win && win.document;
        if (!doc || selectionAskMode() !== "global") return;
        found = found || selectionFromVisibleFramesOnly(doc);
        if (!found || !found.text || selectionInsidePluginReader(doc)) return;
        var readerRecord = recentReaderSelectionCapture(3000);
        if (readerRecord && readerRecord.text && !clipboardTextLooksRelated(readerRecord.text, found.text) &&
            !clipboardTextLooksRelated(found.text, readerRecord.text)) {
          readerRecord = null;
        }
        var record = readerRecord || makeSelectionRecord({
          text: found.text,
          html: found.html || "",
          source: found.source || "selection-cache",
          debug: joinDebugParts([
            "cachedAtMouseup=true",
            "noNativeCopy=true",
            found.debug || "",
          ]),
          point: found.point,
        });
        if (!record || !record.text) {
          this._lastNativeCopyCapture = {
            text: "",
            signature: selectionSignature(found),
            debug: "cachedAtMouseup=true; nativeCopyCacheMiss=true; readerStateMiss=true; liveSource=" + (found.source || "unknown") +
              "; liveLen=" + cleanSelectionText(found.text || "").length,
            contextKey: activeContextKey(),
            at: Date.now(),
          };
          return;
        }
        this._lastNativeCopyCapture = {
          text: record.text,
          source: record.source || "selection-cache",
          signature: selectionSignature(found),
          debug: joinDebugParts([
            "cachedAtMouseup=true",
            record.debug || "",
          ]),
          contextKey: activeContextKey(),
          at: Date.now(),
        };
      } catch (e) {}
    },

    _maybeShowNativeSelectionAsk: function (event, knownFound) {
      if (selectionAskMode() !== "global") return;
      this._lastActiveContextKey = this._currentContextKey();
      if (this._clearPopupIfContextChanged()) return;
      var now = Date.now();
      if (now < (this._suppressSelectionAskUntil || 0)) {
        this._removeNativeSelectionAskPopup();
        return;
      }
      var win = mainWindow();
      if (!win || !win.document) return;
      var doc = win.document;
      if (!this._selectionAskPopup) {
        var hasRecentReader = this._lastReaderSelectionCapture &&
          now - (this._lastReaderSelectionCapture.at || 0) < 3000;
        var hasRecentNative = this._lastNativeCopyCapture &&
          now - (this._lastNativeCopyCapture.at || 0) < 3000;
        if (!event && !hasRecentReader && !hasRecentNative) {
          this._disarmSelectionAskGesture();
          this._removeNativeSelectionAskPopup();
          return;
        }
        if (!this._selectionGestureUntil || now > this._selectionGestureUntil) {
          this._removeNativeSelectionAskPopup();
          return;
        }
        var gestureKey = this._selectionGestureContextKey || "";
        var currentKey = this._currentContextKey();
        if (gestureKey && currentKey && gestureKey !== currentKey) {
          this._disarmSelectionAskGesture();
          this._removeNativeSelectionAskPopup();
          return;
        }
      }
      try {
        if (eventTargetBlocksSelectionAsk(event)) {
          this._cancelSelectionAskForUIInteraction();
          return;
        }
      } catch (e) {}
      var found = knownFound || selectionFromVisibleFramesOnly(doc);
      if (found && selectionInsidePluginReader(doc)) {
        this._removeNativeSelectionAskPopup();
        return;
      }
      if (!found || !found.text) {
        this._removeNativeSelectionAskPopup();
        return;
      }
      if (!eventBelongsToSelectionWindow(event, found)) {
        this._cancelSelectionAskForUIInteraction();
        return;
      }
      if (found.win && !selectionWindowVisible(found.win)) {
        this._removeNativeSelectionAskPopup();
        return;
      }
      if (found.point && !pointInMainViewport(found.point, 24)) {
        this._removeNativeSelectionAskPopup();
        return;
      }
      var text = found && found.text ? found.text.replace(/\s+/g, " ").trim() : "";
      var freshMouse = this._selectionMousePosition &&
        (Date.now() - (this._selectionMousePosition.at || 0) < 1600);
      var sig = selectionSignature(found);
      if (sig && sig === this._ignoredSelectionSignature) {
        this._removeNativeSelectionAskPopup();
        return;
      }
      var textSig = selectionTextSignature(found);
      if (textSig && textSig === this._ignoredSelectionTextSignature) {
        this._removeNativeSelectionAskPopup();
        return;
      }
      if (now < (this._selectionClearUntil || 0)) {
        this._removeNativeSelectionAskPopup();
        return;
      }
      if (text.length < 2) {
        this._removeNativeSelectionAskPopup();
        return;
      }
      if (!found.point && found.source === "active-reader-method" && !freshMouse) {
        this._removeNativeSelectionAskPopup();
        return;
      }
      if (!found.point && !freshMouse) {
        this._removeNativeSelectionAskPopup();
        return;
      }
      var pointKey = found && found.point
        ? Math.round(found.point.x) + "," + Math.round(found.point.y)
        : "";
      if (text === this._lastNativeSelectionText &&
          pointKey === this._lastNativeSelectionPointKey &&
          this._selectionAskPopup) return;
      this._lastNativeSelectionText = text;
      this._lastNativeSelectionPointKey = pointKey;
      this._lastNativeSelectionAt = now;
      this._selectionAskContextKey = this._currentContextKey();
      this._showNativeSelectionAskPopup(text, found, event);
    },

    _showNativeSelectionAskPopup: function (text, found, event) {
      this._removeNativeSelectionAskPopup();
      var win = mainWindow();
      if (!win || !win.document) return;
      var doc = win.document;
      var popupContextKey = this._selectionAskContextKey || this._currentContextKey();
      this._selectionAskContextKey = popupContextKey;
      var popup = create(doc, "button", "ari-qa-selection-popup");
      popup.type = "button";
      popup.title = "向 LLM 提问选中部分";
      popup.style.cssText =
        "position:fixed;z-index:2147483647;display:inline-flex;align-items:center;gap:5px;" +
        "padding:5px 8px;border:1px solid ThreeDShadow;border-radius:4px;background:ButtonFace;color:ButtonText;" +
        "font:12px message-box,system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.18);cursor:pointer;";
      popup.appendChild(logoNode(doc, 14));
      popup.appendChild(doc.createTextNode("向LLM提问选中部分"));
      var activated = false;
      var popupRecord = cachedPopupSelectionRecord(found, text);
      if (popupRecord) popupRecord.contextKey = popupContextKey || this._currentContextKey();
      function activatePopupAsk(sourceEvent) {
        sourceEvent.preventDefault();
        sourceEvent.stopPropagation();
        if (activated) return;
        activated = true;
        ArxivDailyQA._removeNativeSelectionAskPopup();
        if (popupContextKey && popupContextKey !== ArxivDailyQA._currentContextKey()) {
          return;
        }
        if (found && found.win && !selectionWindowVisible(found.win)) {
          return;
        }
        ArxivDailyQA._ignoredSelectionSignature = selectionSignature(found);
        ArxivDailyQA._selectionClearUntil = Date.now() + 2500;
        ArxivDailyQA._suppressSelectionAskUntil = Date.now() + 2500;
        var record = popupRecord || cachedPopupSelectionRecord(found, text);
        if (record) record.contextKey = popupContextKey || ArxivDailyQA._currentContextKey();
        if (!record) {
          var alertWin = mainWindow();
          if (alertWin && alertWin.alert) {
            alertWin.alert("没有读取到当前 PDF 选区。请重新选中一段文字后再试。");
          }
          return;
        }
        ArxivDailyQA.askAboutSelection(record);
      }
      popup.addEventListener("mousedown", function (downEvent) {
        downEvent.preventDefault();
        downEvent.stopPropagation();
      });
      popup.addEventListener("click", function (clickEvent) {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        activatePopupAsk(clickEvent);
      });
      doc.documentElement.appendChild(popup);
      this._selectionAskSourceWin = found && found.win ? found.win : null;
      var point = found && found.point ? found.point : null;
      if (!point && event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        point = { x: event.clientX, y: event.clientY };
      }
      if (!point && this._selectionMousePosition) {
        point = { x: this._selectionMousePosition.x, y: this._selectionMousePosition.y };
      }
      var width = popup.getBoundingClientRect ? popup.getBoundingClientRect().width || 148 : 148;
      var height = popup.getBoundingClientRect ? popup.getBoundingClientRect().height || 30 : 30;
      var vw = win.innerWidth || 900;
      var vh = win.innerHeight || 700;
      var left;
      var top;
      if (point) {
        left = point.x + 8;
        top = point.y - height - 8;
        if (left + width > vw - 8) left = point.x - width - 8;
        if (top < 8) top = point.y + 8;
      } else {
        left = vw - width - 18;
        top = 58;
      }
      popup.style.left = Math.max(8, Math.min(vw - width - 8, left)) + "px";
      popup.style.top = Math.max(8, Math.min(vh - height - 8, top)) + "px";
      this._selectionAskPopup = popup;
    },

    _scheduleTabButton: function () {
      if (this._addTabButton()) return;
      if (this._tabButtonTimer) return;
      var self = this;
      this._tabButtonAttempts = 0;
      this._tabButtonTimer = setInterval(function () {
        self._tabButtonAttempts++;
        if (self._addTabButton() || self._tabButtonAttempts >= 40) {
          clearInterval(self._tabButtonTimer);
          self._tabButtonTimer = null;
        }
      }, 500);
    },

    _findTabToolbar: function (doc) {
      return doc.getElementById("zotero-tabs-toolbar") ||
        doc.getElementById("zotero-title-bar") ||
        doc.getElementById("tab-bar-container");
    },

    _addTabButton: function () {
      var win = mainWindow();
      if (!win || !win.document || this._tabButton) return !!this._tabButton;
      var doc = win.document;
      var host = this._findTabToolbar(doc);
      if (!host) return false;

      var btn = createXUL(doc, "toolbarbutton");
      btn.id = "arxiv-daily-qa-tab-btn";
      btn.setAttribute("class", "zotero-tb-button");
      btn.setAttribute("tabindex", "-1");
      btn.setAttribute("tooltiptext", "LLM 问答");
      btn.setAttribute("aria-label", "LLM 问答");
      btn.setAttribute("image", iconURI());
      btn.style.cssText = [
        "list-style-image:url('" + iconURI() + "')",
        "width:28px",
        "height:28px",
        "min-width:28px",
        "padding:0",
        "margin:0 1px",
        "cursor:pointer",
      ].join(";");

      var lastActionAt = 0;
      function openQA(event) {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        var now = Date.now();
        if (now - lastActionAt < 250) return;
        lastActionAt = now;
        if (typeof ArxivDailyActions !== "undefined" && ArxivDailyActions.openQA) {
          ArxivDailyActions.openQA();
        } else {
          ArxivDailyQA.show();
        }
      }
      btn.addEventListener("command", openQA);
      btn.addEventListener("click", openQA);

      var menuButton = doc.getElementById("zotero-tb-tabs-menu");
      if (menuButton && menuButton.parentNode === host) {
        host.insertBefore(btn, menuButton);
      } else {
        host.appendChild(btn);
      }
      this._tabButton = btn;
      log("QA tab toolbar button added");
      return true;
    },
  };
})();
