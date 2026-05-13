/* ==========================================================================
 * left-pane.js - Left pane report/project panels
 *
 * The plugin panes sit near the bottom of Zotero's left pane. The report pane
 * and project pane keep independent heights:
 *   - drag the upper edge to resize the report pane
 *   - drag the middle splitter to resize the project pane
 * The collection tree above absorbs the resulting total-height changes.
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";
  const PREFS_PREFIX = "extensions.arxiv-interest-daily.";
  const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const DEFAULT_REPORT_HEIGHT = 128;
  const DEFAULT_PROJECT_HEIGHT = 128;
  const MIN_PANEL_HEIGHT = 70;
  const MIN_UPPER_AREA_HEIGHT = 96;
  const MAX_CONTAINER_HEIGHT = 760;
  const SPLITTER_HEIGHT = 6;

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
      const val = Zotero.Prefs.get(PREFS_PREFIX + key);
      return val !== undefined ? val : def;
    } catch (e) {
      return def;
    }
  }

  function getNumberPref(key, def) {
    const val = parseFloat(getPref(key, ""));
    return Number.isFinite(val) ? val : def;
  }

  function setPref(key, val) {
    try {
      Zotero.Prefs.set(PREFS_PREFIX + key, val);
    } catch (e) {
      logError("Pref set failed: " + key);
    }
  }

  function cfg(path, fallback) {
    try {
      if (typeof ArxivDailyConfig !== "undefined") {
        var val = ArxivDailyConfig.get(path);
        return val || fallback;
      }
    } catch (e) {}
    return fallback;
  }

  function matchesShortcut(event, shortcut) {
    if (typeof ArxivDailyShortcuts !== "undefined" && ArxivDailyShortcuts.matches) {
      return ArxivDailyShortcuts.matches(event, shortcut);
    }
    var parts = String(shortcut || "").toLowerCase().split("+").map(function (p) { return p.trim(); });
    var key = parts[parts.length - 1] || "";
    var eventKey = String(event.key || "").toLowerCase();
    if (key === "enter") key = "enter";
    if (key.length === 1 && eventKey !== key) return false;
    if (key.length > 1 && eventKey !== key) return false;
    return (!!event.ctrlKey === (parts.indexOf("ctrl") >= 0)) &&
      (!!event.metaKey === (parts.indexOf("meta") >= 0 || parts.indexOf("cmd") >= 0 || parts.indexOf("command") >= 0)) &&
      (!!event.shiftKey === (parts.indexOf("shift") >= 0)) &&
      (!!event.altKey === (parts.indexOf("alt") >= 0));
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function createXUL(doc, name) {
    if (typeof doc.createXULElement === "function") return doc.createXULElement(name);
    return doc.createElementNS(XUL_NS, name);
  }

  function installStyles(doc) {
    if (doc.getElementById("arxiv-daily-left-pane-style")) return;
    var style = doc.createElementNS ? doc.createElementNS(HTML_NS, "style") : doc.createElement("style");
    style.id = "arxiv-daily-left-pane-style";
    style.textContent = [
      "#arxiv-daily-left-panels{background:var(--material-sidepane,Canvas);border-bottom:1px solid var(--material-panedivider,ThreeDShadow);}",
      "#arxiv-daily-top-splitter,#arxiv-daily-splitter{-moz-appearance:none;cursor:ns-resize;border-top:1px solid var(--material-panedivider,ThreeDShadow);border-bottom:1px solid var(--material-panedivider,ThreeDShadow);}",
      "#arxiv-daily-top-splitter:hover,#arxiv-daily-splitter:hover{background:linear-gradient(to bottom,transparent 0,transparent 2px,rgba(76,111,143,.35) 2px,rgba(76,111,143,.35) 4px,transparent 4px)!important;}",
      "#arxiv-daily-project-papers,#arxiv-daily-reports{overflow:hidden;}",
      "#arxiv-daily-project-papers label,#arxiv-daily-reports label{color:var(--fill-primary,CanvasText);user-select:none;}",
      "#arxiv-daily-project-papers tree,#arxiv-daily-reports tree{border:none;margin:0;background:var(--material-sidepane,Canvas);}",
      "#arxiv-daily-project-papers treecol,#arxiv-daily-reports treecol{min-height:0;height:0;max-height:0;border:0;padding:0;}",
      "#arxiv-daily-project-papers treechildren::-moz-tree-row,#arxiv-daily-reports treechildren::-moz-tree-row{min-height:22px;}",
      "#arxiv-daily-project-papers treechildren::-moz-tree-indentation,#arxiv-daily-reports treechildren::-moz-tree-indentation{width:18px;}",
      "#arxiv-daily-project-papers treechildren::-moz-tree-cell-text,#arxiv-daily-reports treechildren::-moz-tree-cell-text{font:message-box;color:var(--fill-primary,CanvasText);}",
      "#arxiv-daily-project-papers treechildren::-moz-tree-cell-text(ari-leaf),#arxiv-daily-reports treechildren::-moz-tree-cell-text(ari-leaf){color:var(--fill-primary,CanvasText);}",
      "#arxiv-daily-project-papers treechildren::-moz-tree-cell(ari-current),#arxiv-daily-reports treechildren::-moz-tree-cell(ari-current){background:var(--fill-quinary,rgba(0,0,0,.08));}",
      "#arxiv-daily-project-papers treechildren::-moz-tree-cell-text(ari-current),#arxiv-daily-reports treechildren::-moz-tree-cell-text(ari-current){color:var(--fill-primary,CanvasText);font-weight:600;}",
      "#arxiv-daily-project-papers treechildren::-moz-tree-image(ari-folder),#arxiv-daily-reports treechildren::-moz-tree-image(ari-folder){list-style-image:url('chrome://zotero/skin/16/universal/folder.svg');width:16px;height:16px;-moz-context-properties:fill,fill-opacity;fill:var(--fill-secondary,GrayText);}",
      "#arxiv-daily-project-papers treechildren::-moz-tree-image(ari-folder-open),#arxiv-daily-reports treechildren::-moz-tree-image(ari-folder-open){list-style-image:url('chrome://zotero/skin/16/universal/folder-open.svg');width:16px;height:16px;-moz-context-properties:fill,fill-opacity;fill:var(--fill-secondary,GrayText);}",
      "#arxiv-daily-project-papers treechildren::-moz-tree-image(ari-collection),#arxiv-daily-reports treechildren::-moz-tree-image(ari-collection){list-style-image:url('chrome://zotero/skin/collection-tree/16/light/collection.svg');width:16px;height:16px;}",
      ".arxiv-daily-folder-open-button{min-width:22px;width:22px;height:22px;padding:0;margin:0 2px;border:1px solid transparent;border-radius:4px;background:transparent;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;-moz-appearance:none;appearance:none;}",
      ".arxiv-daily-folder-open-button:hover{background:rgba(0,0,0,.055);border-color:rgba(0,0,0,.14);}",
      ".arxiv-daily-folder-open-button:active{background:rgba(0,0,0,.10);border-color:rgba(0,0,0,.18);}",
      ".arxiv-daily-pane-close-button{min-width:20px;width:20px;height:20px;padding:0;margin:0 0 0 2px;border:1px solid transparent;background:transparent;color:var(--fill-secondary,GrayText);font:12px message-box,system-ui,sans-serif;cursor:pointer;}",
      ".arxiv-daily-pane-close-button:hover{border-color:ThreeDShadow;background:var(--fill-quinary,rgba(0,0,0,.08));color:var(--fill-primary,CanvasText);}",
      ".arxiv-daily-folder-open-button .toolbarbutton-icon{display:none!important;}",
      ".arxiv-daily-folder-open-button .arxiv-daily-folder-open-icon{width:16px;height:16px;margin:0;display:block;-moz-context-properties:fill,fill-opacity;fill:var(--fill-secondary,GrayText);}",
      ".arxiv-daily-btn[disabled='true']{opacity:.35;cursor:default!important;}"
    ].join("\n");
    var target = doc.head || doc.documentElement;
    target.appendChild(style);
  }

  function pad2(value) {
    return String(value || "").padStart(2, "0");
  }

  function reportMonthLabel(report) {
    return (report.year || "").trim()
      ? report.year + "." + pad2(report.month || "")
      : String(report.date || "").slice(0, 7).replace("-", ".");
  }

  function paperDate(paper) {
    var raw = String(
      paper.date ||
      paper.announcementDate ||
      paper.published ||
      paper.updated ||
      paper.addedAt ||
      paper.createdAt ||
      ""
    );
    var match = raw.match(/\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
    if (typeof paper.addedAt === "number") {
      var d = new Date(paper.addedAt);
      if (Number.isFinite(d.getTime())) {
        return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
      }
    }
    return "未归档日期";
  }

  function baseArxivId(value) {
    return String(value || "")
      .trim()
      .replace(/^arXiv:/i, "")
      .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "")
      .split(/[?#]/)[0]
      .replace(/\s+\[[^\]]+\].*$/, "")
      .split(/\s+/)[0]
      .replace(/\.pdf$/i, "")
      .replace(/v\d+$/i, "");
  }

  function projectPaperURL(paper) {
    var id = baseArxivId(paper && (paper.arxivId || paper.id || paper.paperId));
    if (id) return "https://arxiv.org/abs/" + id;
    return String((paper && (paper.url || paper.link)) || "");
  }

  function projectPaperDragText(paper, url) {
    var title = String((paper && paper.title) || (paper && paper.arxivId) || "Project paper");
    var authors = String((paper && paper.authors) || "");
    var parts = [title];
    if (authors) parts.push(authors);
    if (url) parts.push(url);
    return parts.join("\n");
  }

  function projectPaperNativeMissing(paper) {
    if (!paper) return false;
    if (paper.zoteroItemError || paper.nativeCollectionMissing) return true;
    if (!(paper.zoteroItemID || paper.itemID || paper.zoteroItemId)) return true;
    if (!paper.collectionID) return true;
    return false;
  }

  function setCellProperties(cell, properties) {
    var props = String(properties || "").trim();
    cell.setAttribute("data-base-properties", props);
    cell.setAttribute("properties", props);
  }

  function elementHeight(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return 0;
    return el.getBoundingClientRect().height || 0;
  }

  function splitterStyle() {
    return (
      "box-sizing:border-box;height:" + SPLITTER_HEIGHT + "px;" +
      "min-height:" + SPLITTER_HEIGHT + "px;max-height:" + SPLITTER_HEIGHT + "px;" +
      "display:block;cursor:ns-resize;background:transparent;border-top:1px solid transparent;" +
      "border-bottom:1px solid transparent;flex:0 0 " +
      SPLITTER_HEIGHT + "px;"
    );
  }

  // ------------------------------------------------------------------------
  // Module
  // ------------------------------------------------------------------------

  globalThis.ArxivDailyLeftPane = {
    _win: null,
    _doc: null,
    _topSplitter: null,
    _container: null,
    _projectPane: null,
    _reportPane: null,
    _splitter: null,
    _visible: { reports: true, projects: true },
    _reportHeight: DEFAULT_REPORT_HEIGHT,
    _projectHeight: DEFAULT_PROJECT_HEIGHT,
    _resizeObserver: null,
    _resizeHandler: null,
    _mouseUpHandler: null,
    _pollTimer: null,
    _layoutTimer: null,
    _lastCapacity: 0,
    _topSplitterMouseDown: null,
    _topDragMove: null,
    _topDragEnd: null,
    _topDragState: null,
    _splitterMouseDown: null,
    _dragMove: null,
    _dragEnd: null,
    _dragState: null,
    _previousCursor: "",
    _reportTree: null,
    _projectTree: null,
    _reportTreeChildren: null,
    _projectTreeChildren: null,
    _shortcutHandler: null,

    init: function (win) {
      const doc = win.document;
      if (this._container) {
        log("left-pane already initialized");
        return;
      }

      this._win = win;
      this._doc = doc;
      installStyles(doc);
      this._visible.reports = getPref("showReportPane", true);
      this._visible.projects = getPref("showProjectPane", true);
      this._loadPaneHeights();

      const point = this._findInsertionPoint(doc);
      if (!point.parent) {
        logError("left-pane: no insertion point found");
        return;
      }

      this._topSplitter = createXUL(doc, "hbox");
      this._topSplitter.setAttribute("id", "arxiv-daily-top-splitter");
      this._topSplitter.setAttribute("tooltiptext", ArxivDailyI18n.t("splitter.tooltip"));
      this._topSplitter.style.cssText = splitterStyle();

      this._container = createXUL(doc, "vbox");
      this._container.setAttribute("id", "arxiv-daily-left-panels");
      this._container.setAttribute("flex", "0");
      this._container.style.cssText =
        "box-sizing:border-box;overflow:hidden;min-height:" + MIN_PANEL_HEIGHT + "px;" +
        "display:flex;flex-direction:column;flex:0 0 auto;";

      this._reportPane = this._createPanel(doc, "arxiv-daily-reports", "pane.reports.title", {
        actionsId: "arxiv-daily-reports-actions",
        folderPath: "reports",
        paneKind: "reports",
      });

      this._splitter = createXUL(doc, "hbox");
      this._splitter.setAttribute("id", "arxiv-daily-splitter");
      this._splitter.setAttribute("tooltiptext", ArxivDailyI18n.t("splitter.tooltip"));
      this._splitter.style.cssText = splitterStyle();

      this._projectPane = this._createPanel(doc, "arxiv-daily-project-papers", "pane.projects.title", {
        folderPath: "project-papers",
        paneKind: "projects",
      });

      this._container.appendChild(this._reportPane);
      this._container.appendChild(this._splitter);
      this._container.appendChild(this._projectPane);

      if (point.before) {
        point.parent.insertBefore(this._topSplitter, point.before);
        point.parent.insertBefore(this._container, point.before);
      } else {
        point.parent.appendChild(this._topSplitter);
        point.parent.appendChild(this._container);
      }

      this._installTopSplitterDrag();
      this._installMiddleSplitterDrag();
      this._installShortcut();
      this._installResizeSync(point.parent);
      this.refreshReports();
      this.refreshProjects();
      this._applyVisibility();
      this._queueLayout(false);

      log("left-pane initialized");
    },

    destroy: function () {
      this._savePaneHeights();
      this._removeTopSplitterDrag();
      this._removeMiddleSplitterDrag();
      this._removeShortcut();
      this._removeResizeSync();

      if (this._topSplitter && this._topSplitter.parentNode) {
        this._topSplitter.parentNode.removeChild(this._topSplitter);
      }
      if (this._container && this._container.parentNode) {
        this._container.parentNode.removeChild(this._container);
      }

      this._win = null;
      this._doc = null;
      this._topSplitter = null;
      this._container = null;
      this._projectPane = null;
      this._reportPane = null;
      this._splitter = null;
      this._reportTree = null;
      this._projectTree = null;
      this._reportTreeChildren = null;
      this._projectTreeChildren = null;
      log("left-pane destroyed");
    },

    // ----------------------------------------------------------------------
    // Internal
    // ----------------------------------------------------------------------

    _findInsertionPoint: function (doc) {
      const collectionsPane = doc.getElementById("zotero-collections-pane");
      const tagSplitter = doc.getElementById("zotero-tags-splitter");
      const tagContainer = doc.getElementById("zotero-tag-selector-container");

      if (collectionsPane && tagSplitter && tagSplitter.parentNode === collectionsPane) {
        return { parent: collectionsPane, before: tagSplitter };
      }
      if (collectionsPane && tagContainer && tagContainer.parentNode === collectionsPane) {
        return { parent: collectionsPane, before: tagContainer };
      }
      if (collectionsPane) {
        return { parent: collectionsPane, before: collectionsPane.lastChild };
      }
      return { parent: doc.getElementById("zotero-left-pane"), before: null };
    },

    _createPanel: function (doc, id, titleKey, options) {
      options = options || {};
      const box = createXUL(doc, "vbox");
      box.setAttribute("id", id);
      box.setAttribute("flex", "0");
      box.style.cssText =
        "box-sizing:border-box;overflow:hidden;min-height:32px;" +
        "display:flex;flex-direction:column;flex:0 0 auto;";

      const header = createXUL(doc, "hbox");
      header.setAttribute("id", id + "-header");
      header.setAttribute("align", "center");
      header.style.cssText =
        "box-sizing:border-box;min-height:28px;padding:2px 4px 2px 8px;" +
        "display:flex;align-items:center;gap:4px;flex:0 0 auto;";

      if (typeof ArxivDailyLogo !== "undefined") {
        const logo = ArxivDailyLogo.xul(doc, 14);
        logo.style.marginRight = "2px";
        header.appendChild(logo);
      }

      const label = createXUL(doc, "label");
      label.setAttribute("value", ArxivDailyI18n.t(titleKey));
      label.style.cssText =
        "font-weight:600;font-size:11px;min-width:0;max-width:110px;overflow:hidden;" +
        "text-overflow:ellipsis;white-space:nowrap;";

      header.appendChild(label);

      if (options.folderPath) {
        const folderButton = this._createFolderOpenButton(doc, options.folderPath);
        header.appendChild(folderButton);
      }

      const spacer = createXUL(doc, "spacer");
      spacer.setAttribute("flex", "1");
      header.appendChild(spacer);

      if (options.actionsId) {
        const actions = createXUL(doc, "hbox");
        actions.setAttribute("id", options.actionsId);
        actions.setAttribute("align", "center");
        actions.style.cssText =
          "display:flex;align-items:center;gap:2px;margin-left:auto;min-width:max-content;";
        header.appendChild(actions);
      }

      if (options.paneKind) {
        header.appendChild(this._createPaneCloseButton(doc, options.paneKind));
      }

      const tree = createXUL(doc, "tree");
      tree.setAttribute("flex", "1");
      tree.setAttribute("hidecolumnpicker", "true");
      tree.style.cssText =
        "box-sizing:border-box;min-height:20px;flex:1 1 auto;overflow:hidden;";

      const treecols = createXUL(doc, "treecols");
      treecols.style.cssText = "height:0;min-height:0;max-height:0;overflow:hidden;";
      const treecol = createXUL(doc, "treecol");
      treecol.setAttribute("id", id + "-col");
      treecol.setAttribute("flex", "1");
      treecol.setAttribute("primary", "true");
      treecol.setAttribute("hideheader", "true");
      treecols.appendChild(treecol);

      const treechildren = createXUL(doc, "treechildren");
      tree.appendChild(treecols);
      tree.appendChild(treechildren);
      if (id === "arxiv-daily-reports") {
        this._reportTree = tree;
        this._reportTreeChildren = treechildren;
        tree.addEventListener("click", this._onReportTreeClick.bind(this), true);
        tree.addEventListener("dblclick", this._onReportTreeActivate.bind(this), true);
        tree.addEventListener("keydown", this._onReportTreeKeyDown.bind(this), true);
        tree.addEventListener("contextmenu", this._onReportContextMenu.bind(this));
      } else if (id === "arxiv-daily-project-papers") {
        this._projectTree = tree;
        this._projectTreeChildren = treechildren;
        tree.addEventListener("click", this._onProjectTreeClick.bind(this), true);
        tree.addEventListener("dblclick", this._onProjectTreeActivate.bind(this), true);
        tree.addEventListener("keydown", this._onProjectTreeKeyDown.bind(this), true);
        tree.addEventListener("contextmenu", this._onProjectContextMenu.bind(this));
      }
      box.appendChild(header);
      box.appendChild(tree);

      return box;
    },

    _createPaneCloseButton: function (doc, paneKind) {
      const btn = createXUL(doc, "toolbarbutton");
      btn.setAttribute("class", "arxiv-daily-pane-close-button");
      btn.setAttribute("label", "x");
      btn.setAttribute("tooltiptext", paneKind === "reports" ? "关闭报告框" : "关闭项目论文框");
      btn.style.cssText =
        "display:inline-flex;align-items:center;justify-content:center;min-width:20px;" +
        "width:20px;height:20px;padding:0;margin:0 0 0 2px;border:1px solid transparent;" +
        "background:transparent;color:GrayText;cursor:pointer;";
      btn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (paneKind === "reports") ArxivDailyLeftPane.toggleReports();
        else ArxivDailyLeftPane.toggleProjects();
        if (typeof ArxivDailyMenu !== "undefined") {
          ArxivDailyMenu.updateToggleState("menu-ari-show-report", ArxivDailyLeftPane.isReportsVisible());
          ArxivDailyMenu.updateToggleState("menu-ari-show-project", ArxivDailyLeftPane.isProjectsVisible());
        }
      });
      return btn;
    },

    _createFolderOpenButton: function (doc, relativePath) {
      const btn = createXUL(doc, "toolbarbutton");
      btn.setAttribute("class", "arxiv-daily-folder-open-button");
      btn.setAttribute("orient", "horizontal");
      btn.setAttribute("pack", "center");
      btn.setAttribute("align", "center");
      btn.setAttribute("tooltiptext", "打开文件夹");
      btn.setAttribute("data-folder-path", relativePath || "");
      btn.style.cssText =
        "display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:22px;" +
        "width:22px;height:22px;padding:0;margin:0 2px;border:1px solid transparent;" +
        "border-radius:4px;background:transparent;cursor:pointer;-moz-appearance:none;appearance:none;";
      const icon = createXUL(doc, "image");
      icon.setAttribute("class", "arxiv-daily-folder-open-icon");
      icon.setAttribute("src", "chrome://zotero/skin/16/universal/folder.svg");
      icon.setAttribute("width", "16");
      icon.setAttribute("height", "16");
      icon.style.cssText = "width:16px;height:16px;margin:0;display:block;";
      btn.appendChild(icon);
      btn.addEventListener("mouseenter", function () {
        btn.style.backgroundColor = "rgba(0,0,0,0.055)";
        btn.style.borderColor = "rgba(0,0,0,0.14)";
      });
      btn.addEventListener("mouseleave", function () {
        btn.style.backgroundColor = "transparent";
        btn.style.borderColor = "transparent";
      });
      btn.addEventListener("mousedown", function () {
        btn.style.backgroundColor = "rgba(0,0,0,0.1)";
        btn.style.borderColor = "rgba(0,0,0,0.18)";
      });
      btn.addEventListener("mouseup", function () {
        btn.style.backgroundColor = "rgba(0,0,0,0.055)";
        btn.style.borderColor = "rgba(0,0,0,0.14)";
      });
      btn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        ArxivDailyLeftPane.openDataFolder(relativePath || "");
      });
      return btn;
    },

    openDataFolder: function (relativePath) {
      try {
        if (typeof ArxivDailyDataDir === "undefined") {
          throw new Error("Data directory module not loaded");
        }
        if (!ArxivDailyDataDir.getBasePath || !ArxivDailyDataDir.getBasePath()) {
          if (!ArxivDailyDataDir.init()) throw new Error(ArxivDailyDataDir.getLastError ? ArxivDailyDataDir.getLastError() : "Data directory init failed");
        }
        if (ArxivDailyDataDir.ensureSubDir && !ArxivDailyDataDir.ensureSubDir(relativePath)) {
          throw new Error(ArxivDailyDataDir.getLastError ? ArxivDailyDataDir.getLastError() : "Failed to create folder");
        }
        var path = ArxivDailyDataDir.getSubPath(relativePath || "");
        var dir = ArxivDailyDataDir.makeFile ? ArxivDailyDataDir.makeFile(path) : null;
        if (!dir) throw new Error("Local file API is not available");
        if (!dir.exists()) {
          dir.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o755);
        }
        try {
          if (typeof dir.reveal === "function") {
            dir.reveal();
            return;
          }
        } catch (revealErr) {}
        if (typeof dir.launch === "function") {
          dir.launch();
          return;
        }
        var win = Zotero.getMainWindow();
        if (win) win.alert("文件夹位置:\n" + path);
      } catch (err) {
        logError("open data folder failed: " + (err.message || err));
        var win2 = Zotero.getMainWindow();
        if (win2) win2.alert("无法打开文件夹:\n" + (err.message || err));
      }
    },

    _loadPaneHeights: function () {
      const savedReport = getNumberPref("reportPaneHeight", NaN);
      const savedProject = getNumberPref("projectPaneHeight", NaN);
      const savedContainer = getNumberPref("leftPaneContainerHeight", NaN);
      const savedRatio = getNumberPref("leftPaneReportRatio", NaN);

      if (Number.isFinite(savedReport)) {
        this._reportHeight = Math.max(MIN_PANEL_HEIGHT, Math.round(savedReport));
      }
      if (Number.isFinite(savedProject)) {
        this._projectHeight = Math.max(MIN_PANEL_HEIGHT, Math.round(savedProject));
      }

      if (!Number.isFinite(savedReport) && !Number.isFinite(savedProject) &&
          Number.isFinite(savedContainer) && Number.isFinite(savedRatio)) {
        const available = Math.max(MIN_PANEL_HEIGHT * 2, savedContainer - SPLITTER_HEIGHT);
        this._reportHeight = Math.max(MIN_PANEL_HEIGHT, Math.round(available * savedRatio));
        this._projectHeight = Math.max(MIN_PANEL_HEIGHT, available - this._reportHeight);
      }
    },

    _savePaneHeights: function () {
      const reportHeight = this._visible.reports ? elementHeight(this._reportPane) : this._reportHeight;
      const projectHeight = this._visible.projects ? elementHeight(this._projectPane) : this._projectHeight;

      if (reportHeight > 30) {
        this._reportHeight = Math.round(reportHeight);
        setPref("reportPaneHeight", this._reportHeight);
      }
      if (projectHeight > 30) {
        this._projectHeight = Math.round(projectHeight);
        setPref("projectPaneHeight", this._projectHeight);
      }
      setPref("leftPaneContainerHeight", this._containerHeightFromPanes());
    },

    _containerHeightFromPanes: function () {
      var height = 0;
      if (this._visible.reports) height += this._reportHeight;
      if (this._visible.projects) height += this._projectHeight;
      if (this._visible.reports && this._visible.projects) height += SPLITTER_HEIGHT;
      return Math.max(MIN_PANEL_HEIGHT, height);
    },

    _containerHeightLimit: function () {
      var maxHeight = MAX_CONTAINER_HEIGHT;
      if (this._container && this._container.parentNode) {
        const parentHeight = elementHeight(this._container.parentNode);
        const tagSplitter = this._doc ? this._doc.getElementById("zotero-tags-splitter") : null;
        const tagContainer = this._doc ? this._doc.getElementById("zotero-tag-selector-container") : null;
        const belowHeight = elementHeight(tagSplitter) + elementHeight(tagContainer);
        const topSplitterHeight = this._topSplitter && this._topSplitter.style.display !== "none"
          ? SPLITTER_HEIGHT
          : 0;

        if (parentHeight > 0) {
          maxHeight = parentHeight - belowHeight - topSplitterHeight - MIN_UPPER_AREA_HEIGHT;
        }
      }
      return Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_CONTAINER_HEIGHT, Math.floor(maxHeight)));
    },

    _fitPaneHeights: function (reportHeight, projectHeight, prefer) {
      const bothVisible = this._visible.reports && this._visible.projects;
      const reportVisible = !!this._visible.reports;
      const projectVisible = !!this._visible.projects;
      const maxContainer = this._containerHeightLimit();
      const splitterHeight = bothVisible ? SPLITTER_HEIGHT : 0;
      const maxPanes = Math.max(MIN_PANEL_HEIGHT, maxContainer - splitterHeight);
      const minPane = bothVisible
        ? Math.max(32, Math.min(MIN_PANEL_HEIGHT, Math.floor(maxPanes / 2) - 1))
        : Math.max(32, Math.min(MIN_PANEL_HEIGHT, maxContainer));

      var report = reportVisible
        ? Math.max(minPane, Math.round(reportHeight))
        : this._reportHeight;
      var project = projectVisible
        ? Math.max(minPane, Math.round(projectHeight))
        : this._projectHeight;

      if (bothVisible) {
        if (report + project > maxPanes) {
          if (prefer === "report") {
            report = Math.max(minPane, maxPanes - project);
            if (report + project > maxPanes) {
              project = Math.max(minPane, maxPanes - report);
            }
          } else if (prefer === "project") {
            project = Math.max(minPane, maxPanes - report);
            if (report + project > maxPanes) {
              report = Math.max(minPane, maxPanes - project);
            }
          } else {
            const ratio = report / Math.max(1, report + project);
            report = Math.max(minPane, Math.round(maxPanes * ratio));
            project = Math.max(minPane, maxPanes - report);
            if (report + project > maxPanes) {
              report = Math.max(minPane, maxPanes - project);
            }
          }
        }
      } else if (reportVisible) {
        report = clamp(report, minPane, maxContainer);
      } else if (projectVisible) {
        project = clamp(project, minPane, maxContainer);
      }

      return { report: report, project: project };
    },

    _setContainerHeight: function (height) {
      if (!this._container) return;
      const nextHeight = clamp(
        Math.round(height),
        MIN_PANEL_HEIGHT,
        this._containerHeightLimit()
      );
      const px = nextHeight + "px";
      this._container.setAttribute("flex", "0");
      this._container.setAttribute("height", String(nextHeight));
      this._container.style.flex = "0 0 " + px;
      this._container.style.flexBasis = px;
      this._container.style.height = px;
      this._container.style.minHeight = MIN_PANEL_HEIGHT + "px";
      this._container.style.maxHeight = this._containerHeightLimit() + "px";
    },

    _setPaneHeight: function (pane, height) {
      if (!pane) return;
      const px = Math.max(MIN_PANEL_HEIGHT, Math.round(height)) + "px";
      pane.setAttribute("flex", "0");
      pane.style.flex = "0 0 " + px;
      pane.style.flexBasis = px;
      pane.style.height = px;
      pane.style.minHeight = "32px";
    },

    _setPaneFluid: function (pane) {
      if (!pane) return;
      pane.setAttribute("flex", "1");
      pane.style.flex = "1 1 auto";
      pane.style.flexBasis = "";
      pane.style.height = "";
      pane.style.minHeight = "32px";
    },

    _applyPaneHeights: function (reportHeight, projectHeight, prefer, save) {
      if (!this._container || !this._reportPane || !this._projectPane) return;

      const fitted = this._fitPaneHeights(reportHeight, projectHeight, prefer || "");
      this._reportHeight = fitted.report;
      this._projectHeight = fitted.project;

      if (this._visible.reports) this._setPaneHeight(this._reportPane, this._reportHeight);
      if (this._visible.projects) this._setPaneHeight(this._projectPane, this._projectHeight);

      this._setContainerHeight(this._containerHeightFromPanes());

      if (save) this._savePaneHeights();
    },

    _queueLayout: function (save) {
      if (!this._win) return;
      if (this._layoutTimer) this._win.clearTimeout(this._layoutTimer);

      const self = this;
      this._layoutTimer = this._win.setTimeout(function () {
        self._layoutTimer = null;
        self._applyPaneHeights(self._reportHeight, self._projectHeight, "", !!save);
        self._lastCapacity = self._containerHeightLimit();
      }, 0);
    },

    _installResizeSync: function (parent) {
      if (!this._win) return;
      const self = this;
      const ResizeObserverCtor = this._win.ResizeObserver || globalThis.ResizeObserver;

      if (ResizeObserverCtor) {
        this._resizeObserver = new ResizeObserverCtor(function () {
          self._queueLayout(false);
        });
        if (parent) this._resizeObserver.observe(parent);
        const tagContainer = this._doc ? this._doc.getElementById("zotero-tag-selector-container") : null;
        if (tagContainer) this._resizeObserver.observe(tagContainer);
      }

      this._resizeHandler = function () {
        self._queueLayout(false);
      };
      this._win.addEventListener("resize", this._resizeHandler);

      this._mouseUpHandler = function () {
        self._queueLayout(false);
      };
      this._doc.addEventListener("mouseup", this._mouseUpHandler, true);

      this._pollTimer = this._win.setInterval(function () {
        const capacity = self._containerHeightLimit();
        if (Math.abs(capacity - self._lastCapacity) > 1) {
          self._lastCapacity = capacity;
          self._applyPaneHeights(self._reportHeight, self._projectHeight, "", false);
        }
      }, 500);
    },

    _removeResizeSync: function () {
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      if (this._win && this._resizeHandler) {
        this._win.removeEventListener("resize", this._resizeHandler);
      }
      if (this._doc && this._mouseUpHandler) {
        this._doc.removeEventListener("mouseup", this._mouseUpHandler, true);
      }
      if (this._win && this._pollTimer) {
        this._win.clearInterval(this._pollTimer);
      }
      if (this._win && this._layoutTimer) {
        this._win.clearTimeout(this._layoutTimer);
      }
      this._resizeHandler = null;
      this._mouseUpHandler = null;
      this._pollTimer = null;
      this._layoutTimer = null;
    },

    _installTopSplitterDrag: function () {
      if (!this._topSplitter || !this._doc) return;
      const self = this;

      this._topSplitterMouseDown = function (event) {
        if (!self._visible.reports && !self._visible.projects) return;
        event.preventDefault();
        event.stopPropagation();

        self._topDragState = {
          startY: event.screenY || event.clientY,
          startReportHeight: self._reportHeight,
          startProjectHeight: self._projectHeight,
        };

        self._previousCursor = self._doc.documentElement.style.cursor || "";
        self._doc.documentElement.style.cursor = "ns-resize";
        self._doc.addEventListener("mousemove", self._topDragMove, true);
        self._doc.addEventListener("mouseup", self._topDragEnd, true);
      };

      this._topDragMove = function (event) {
        if (!self._topDragState) return;
        event.preventDefault();
        event.stopPropagation();

        const y = event.screenY || event.clientY;
        const delta = self._topDragState.startY - y;
        const target = self._visible.reports ? "report" : "project";
        const nextReport = self._visible.reports
          ? self._topDragState.startReportHeight + delta
          : self._topDragState.startReportHeight;
        const nextProject = self._visible.reports
          ? self._topDragState.startProjectHeight
          : self._topDragState.startProjectHeight + delta;

        self._applyPaneHeights(nextReport, nextProject, target, false);
      };

      this._topDragEnd = function (event) {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        self._doc.removeEventListener("mousemove", self._topDragMove, true);
        self._doc.removeEventListener("mouseup", self._topDragEnd, true);
        self._doc.documentElement.style.cursor = self._previousCursor;
        self._topDragState = null;
        self._applyPaneHeights(self._reportHeight, self._projectHeight, "", true);
      };

      this._topSplitter.addEventListener("mousedown", this._topSplitterMouseDown, true);
    },

    _removeTopSplitterDrag: function () {
      if (this._topSplitter && this._topSplitterMouseDown) {
        this._topSplitter.removeEventListener("mousedown", this._topSplitterMouseDown, true);
      }
      if (this._doc && this._topDragMove) {
        this._doc.removeEventListener("mousemove", this._topDragMove, true);
      }
      if (this._doc && this._topDragEnd) {
        this._doc.removeEventListener("mouseup", this._topDragEnd, true);
      }
      if (this._doc) this._doc.documentElement.style.cursor = this._previousCursor || "";
      this._topSplitterMouseDown = null;
      this._topDragMove = null;
      this._topDragEnd = null;
      this._topDragState = null;
    },

    _installMiddleSplitterDrag: function () {
      if (!this._splitter || !this._doc) return;
      const self = this;

      this._splitterMouseDown = function (event) {
        if (!self._visible.reports || !self._visible.projects) return;
        event.preventDefault();
        event.stopPropagation();

        self._dragState = {
          startY: event.screenY || event.clientY,
          startReportHeight: self._reportHeight,
          startProjectHeight: self._projectHeight,
        };

        self._previousCursor = self._doc.documentElement.style.cursor || "";
        self._doc.documentElement.style.cursor = "ns-resize";
        self._doc.addEventListener("mousemove", self._dragMove, true);
        self._doc.addEventListener("mouseup", self._dragEnd, true);
      };

      this._dragMove = function (event) {
        if (!self._dragState) return;
        event.preventDefault();
        event.stopPropagation();

        const y = event.screenY || event.clientY;
        const delta = self._dragState.startY - y;
        const nextProject = self._dragState.startProjectHeight + delta;

        self._applyPaneHeights(
          self._dragState.startReportHeight,
          nextProject,
          "project",
          false
        );
      };

      this._dragEnd = function (event) {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        self._doc.removeEventListener("mousemove", self._dragMove, true);
        self._doc.removeEventListener("mouseup", self._dragEnd, true);
        self._doc.documentElement.style.cursor = self._previousCursor;
        self._dragState = null;
        self._applyPaneHeights(self._reportHeight, self._projectHeight, "", true);
      };

      this._splitter.addEventListener("mousedown", this._splitterMouseDown, true);
    },

    _removeMiddleSplitterDrag: function () {
      if (this._splitter && this._splitterMouseDown) {
        this._splitter.removeEventListener("mousedown", this._splitterMouseDown, true);
      }
      if (this._doc && this._dragMove) {
        this._doc.removeEventListener("mousemove", this._dragMove, true);
      }
      if (this._doc && this._dragEnd) {
        this._doc.removeEventListener("mouseup", this._dragEnd, true);
      }
      if (this._doc) this._doc.documentElement.style.cursor = this._previousCursor || "";
      this._splitterMouseDown = null;
      this._dragMove = null;
      this._dragEnd = null;
      this._dragState = null;
    },

    _installShortcut: function () {
      if (!this._doc || this._shortcutHandler) return;
      const self = this;
      this._shortcutHandler = function (event) {
        if (matchesShortcut(event, cfg("shortcuts.toggleSidebar", "Accel+Shift+A"))) {
          event.preventDefault();
          event.stopPropagation();
          self.toggleSidebar();
          return;
        }
        if (matchesShortcut(event, cfg("shortcuts.toggleQA", "Accel+L"))) {
          event.preventDefault();
          event.stopPropagation();
          if (typeof ArxivDailyActions !== "undefined" && ArxivDailyActions.toggleQA) {
            ArxivDailyActions.toggleQA();
          } else if (typeof ArxivDailyQA !== "undefined" && ArxivDailyQA.toggle) {
            ArxivDailyQA.toggle();
          }
        }
      };
      this._doc.addEventListener("keydown", this._shortcutHandler, true);
    },

    _removeShortcut: function () {
      if (this._doc && this._shortcutHandler) {
        this._doc.removeEventListener("keydown", this._shortcutHandler, true);
      }
      this._shortcutHandler = null;
    },

    _applyVisibility: function () {
      const reportsVisible = !!this._visible.reports;
      const projectsVisible = !!this._visible.projects;
      const anyVisible = reportsVisible || projectsVisible;
      const bothVisible = reportsVisible && projectsVisible;

      if (this._container) this._container.style.display = anyVisible ? "flex" : "none";
      if (this._topSplitter) this._topSplitter.style.display = anyVisible ? "block" : "none";
      if (this._reportPane) this._reportPane.style.display = reportsVisible ? "" : "none";
      if (this._projectPane) this._projectPane.style.display = projectsVisible ? "" : "none";
      if (this._splitter) this._splitter.style.display = bothVisible ? "block" : "none";

      if (anyVisible) {
        if (!bothVisible) {
          if (reportsVisible) this._setPaneFluid(this._reportPane);
          if (projectsVisible) this._setPaneFluid(this._projectPane);
        }
        this._queueLayout(false);
      }
    },

    // ----------------------------------------------------------------------
    // Public visibility API
    // ----------------------------------------------------------------------

    toggleReports: function () {
      this._visible.reports = !this._visible.reports;
      setPref("showReportPane", this._visible.reports);
      this._applyVisibility();
      return this._visible.reports;
    },

    toggleProjects: function () {
      this._visible.projects = !this._visible.projects;
      setPref("showProjectPane", this._visible.projects);
      this._applyVisibility();
      return this._visible.projects;
    },

    isReportsVisible: function () {
      return this._visible.reports;
    },

    isProjectsVisible: function () {
      return this._visible.projects;
    },

    toggleSidebar: function () {
      var anyVisible = !!(this._visible.reports || this._visible.projects);
      if (anyVisible) {
        setPref("lastShowReportPane", this._visible.reports);
        setPref("lastShowProjectPane", this._visible.projects);
        this._visible.reports = false;
        this._visible.projects = false;
        setPref("showReportPane", false);
        setPref("showProjectPane", false);
        if (typeof ArxivDailySearch !== "undefined") ArxivDailySearch.hide();
        if (typeof ArxivDailyProgress !== "undefined") ArxivDailyProgress.hidePanel();
        if (typeof ArxivDailyCenterWorkspace !== "undefined") ArxivDailyCenterWorkspace.hideViewer();
      } else {
        var restoreReports = getPref("lastShowReportPane", true);
        var restoreProjects = getPref("lastShowProjectPane", true);
        if (!restoreReports && !restoreProjects) {
          restoreReports = true;
          restoreProjects = true;
        }
        this._visible.reports = !!restoreReports;
        this._visible.projects = !!restoreProjects;
        setPref("showReportPane", this._visible.reports);
        setPref("showProjectPane", this._visible.projects);
      }
      this._applyVisibility();
      if (typeof ArxivDailyMenu !== "undefined") {
        ArxivDailyMenu.updateToggleState("menu-ari-show-report", this._visible.reports);
        ArxivDailyMenu.updateToggleState("menu-ari-show-project", this._visible.projects);
      }
      return !!(this._visible.reports || this._visible.projects);
    },

    refreshReports: function () {
      if (!this._reportTreeChildren || typeof ArxivDailyReportStore === "undefined") return;
      while (this._reportTreeChildren.firstChild) {
        this._reportTreeChildren.removeChild(this._reportTreeChildren.firstChild);
      }
      var doc = this._doc;
      var reports = ArxivDailyReportStore.listReports();
      if (!reports.length) {
        this._reportTreeChildren.appendChild(this._createPlainTreeItem(doc, ArxivDailyI18n.t("pane.reports.empty", "暂无报告")));
        return;
      }

      var byYear = {};
      for (var i = 0; i < reports.length; i++) {
        var year = reports[i].year || String(reports[i].date || "").slice(0, 4) || "未归档年份";
        var month = reportMonthLabel(reports[i]) || "未归档月份";
        if (!byYear[year]) byYear[year] = {};
        if (!byYear[year][month]) byYear[year][month] = [];
        byYear[year][month].push(reports[i]);
      }

      var years = Object.keys(byYear).sort().reverse();
      for (var y = 0; y < years.length; y++) {
        var yearChildren = [];
        var months = Object.keys(byYear[years[y]]).sort().reverse();
        for (var m = 0; m < months.length; m++) {
          var reportChildren = [];
          byYear[years[y]][months[m]].sort(function (a, b) { return b.date.localeCompare(a.date); });
          for (var r = 0; r < byYear[years[y]][months[m]].length; r++) {
            reportChildren.push(this._createReportTreeItem(doc, byYear[years[y]][months[m]][r]));
          }
          yearChildren.push(this._createGroupTreeItem(doc, months[m], reportChildren, "ari-folder-open", {
            "data-report-group": "month",
            "data-report-year": years[y],
            "data-report-month": months[m],
          }));
        }
        this._reportTreeChildren.appendChild(this._createGroupTreeItem(doc, years[y], yearChildren, "ari-folder-open", {
          "data-report-group": "year",
          "data-report-year": years[y],
        }));
      }
    },

    refreshProjects: function () {
      if (!this._projectTreeChildren) return;
      while (this._projectTreeChildren.firstChild) {
        this._projectTreeChildren.removeChild(this._projectTreeChildren.firstChild);
      }
      var doc = this._doc;
      var projects = [];
      try {
        if (typeof ArxivDailyCenterWorkspace !== "undefined" &&
            ArxivDailyCenterWorkspace._pruneDeletedProjectEntriesSync) {
          ArxivDailyCenterWorkspace._pruneDeletedProjectEntriesSync();
        }
        if (typeof ArxivDailyDataDir !== "undefined") {
          projects = ArxivDailyDataDir.readJSON("project-papers/index.json") || [];
        }
      } catch (e) {}
      if (!Array.isArray(projects)) projects = [];
      if (!projects.length) {
        this._projectTreeChildren.appendChild(this._createPlainTreeItem(doc, ArxivDailyI18n.t("pane.projects.empty", "暂无项目论文")));
        return;
      }

      var groups = {};
      for (var i = 0; i < projects.length; i++) {
        var date = paperDate(projects[i]);
        var parts = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        var year = parts ? parts[1] : "未归档年份";
        var month = parts ? parts[1] + "." + parts[2] : "未归档月份";
        var day = parts ? parts[1] + "." + parts[2] + "." + parts[3] : "未归档日期";
        if (!groups[year]) groups[year] = {};
        if (!groups[year][month]) groups[year][month] = {};
        if (!groups[year][month][day]) groups[year][month][day] = [];
        groups[year][month][day].push(projects[i]);
      }
      var years = Object.keys(groups).sort().reverse();
      for (var y = 0; y < years.length; y++) {
        var monthChildren = [];
        var months = Object.keys(groups[years[y]]).sort().reverse();
        for (var m = 0; m < months.length; m++) {
          var dayChildren = [];
          var days = Object.keys(groups[years[y]][months[m]]).sort().reverse();
          for (var d = 0; d < days.length; d++) {
            var paperChildren = [];
            groups[years[y]][months[m]][days[d]].sort(function (a, b) {
              return String(a.title || a.arxivId || "").localeCompare(String(b.title || b.arxivId || ""));
            });
            for (var p = 0; p < groups[years[y]][months[m]][days[d]].length; p++) {
              paperChildren.push(this._createProjectTreeItem(doc, groups[years[y]][months[m]][days[d]][p]));
            }
            dayChildren.push(this._createGroupTreeItem(doc, days[d], paperChildren, "ari-folder-open", {
              "data-project-group": "day",
              "data-project-date": days[d].replace(/\./g, "-"),
            }));
          }
          monthChildren.push(this._createGroupTreeItem(doc, months[m], dayChildren, "ari-folder-open", {
            "data-project-group": "month",
            "data-project-date": months[m].replace(/\./g, "-"),
          }));
        }
        this._projectTreeChildren.appendChild(this._createGroupTreeItem(doc, years[y], monthChildren, "ari-folder-open", {
          "data-project-group": "year",
          "data-project-date": years[y],
        }));
      }
    },

    selectReport: function (dateStr, open) {
      this.refreshReports();
      this._selectTreeItem(this._reportTreeChildren, "data-date", dateStr);
      if (open && typeof ArxivDailyActions !== "undefined") {
        ArxivDailyActions.openReport(dateStr);
      }
    },

    selectProjectPaper: function (paperId, open) {
      this.refreshProjects();
      this._selectTreeItem(this._projectTreeChildren, "data-paper-id", paperId);
      if (open) {
        this._openProjectPaper(paperId);
      }
    },

    selectProjectDate: function (dateStr, openFirst) {
      this.refreshProjects();
      var found = this._selectTreeItem(this._projectTreeChildren, "data-project-date", dateStr);
      if (found && openFirst) {
        var item = this._findTreeItemByAttr(this._projectTreeChildren, "data-project-date", dateStr);
        var paperIds = item ? this._collectDescendantAttrs(item, "data-paper-id") : [];
        if (paperIds.length) this._openProjectPaper(paperIds[0]);
      }
      return found;
    },

    clearCalendarSelection: function () {
      this._clearTreeCurrent(this._reportTreeChildren);
      this._clearTreeCurrent(this._projectTreeChildren);
    },

    locateProjectPaperItem: function (paperId) {
      this._locateProjectPaperItem(paperId);
    },

    _createReportTreeItem: function (doc, report) {
      var item = createXUL(doc, "treeitem");
      item.setAttribute("data-date", report.date || "");
      item.setAttribute("data-file", report.fileName || "");
      var row = createXUL(doc, "treerow");
      var cell = createXUL(doc, "treecell");
      cell.setAttribute("label", (report.date || "") + (report.paperCount ? " (" + report.paperCount + ")" : ""));
      setCellProperties(cell, "ari-leaf");
      row.appendChild(cell);
      item.appendChild(row);
      var open = function () {
        if (typeof ArxivDailyActions !== "undefined") {
          ArxivDailyActions.openReport(report.date);
        }
      };
      item.addEventListener("dblclick", open);
      row.addEventListener("dblclick", open);
      cell.addEventListener("dblclick", open);
      return item;
    },

    _createProjectTreeItem: function (doc, paper) {
      var item = createXUL(doc, "treeitem");
      var id = paper.arxivId || paper.id || paper.paperId || paper.title || "";
      item.setAttribute("data-paper-id", id);
      item.setAttribute("data-arxiv-id", baseArxivId(paper.arxivId || paper.id || paper.paperId));
      item.setAttribute("data-zotero-item-id", paper.zoteroItemID || paper.itemID || paper.zoteroItemId || "");
      item.setAttribute("draggable", "true");
      var row = createXUL(doc, "treerow");
      row.setAttribute("draggable", "true");
      var cell = createXUL(doc, "treecell");
      cell.setAttribute("label", (paper.title || id || "Project paper") + (paperDate(paper) !== "未归档日期" ? "" : ""));
      var nativeMissing = projectPaperNativeMissing(paper);
      if (nativeMissing) {
        cell.setAttribute("label", "(!) " + cell.getAttribute("label"));
        item.setAttribute("tooltiptext", "未添加到原生分类中");
        row.setAttribute("tooltiptext", "未添加到原生分类中");
        cell.setAttribute("tooltiptext", "未添加到原生分类中");
      }
      cell.setAttribute("draggable", "true");
      setCellProperties(cell, "ari-leaf");
      row.appendChild(cell);
      item.appendChild(row);
      var open = function () {
        ArxivDailyLeftPane._openProjectPaper(id);
      };
      var drag = function (event) {
        ArxivDailyLeftPane._onProjectPaperDragStart(event, paper);
      };
      item.addEventListener("dblclick", open);
      row.addEventListener("dblclick", open);
      cell.addEventListener("dblclick", open);
      item.addEventListener("dragstart", drag);
      row.addEventListener("dragstart", drag);
      cell.addEventListener("dragstart", drag);
      return item;
    },

    _createPlainTreeItem: function (doc, labelText) {
      var item = createXUL(doc, "treeitem");
      item.setAttribute("data-empty", "true");
      var row = createXUL(doc, "treerow");
      var cell = createXUL(doc, "treecell");
      cell.setAttribute("label", labelText || "");
      setCellProperties(cell, "disabled");
      row.appendChild(cell);
      item.appendChild(row);
      return item;
    },

    _createGroupTreeItem: function (doc, labelText, children, properties, attrs) {
      var item = createXUL(doc, "treeitem");
      item.setAttribute("container", "true");
      item.setAttribute("open", "true");
      attrs = attrs || {};
      for (var attr in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, attr)) {
          item.setAttribute(attr, attrs[attr]);
        }
      }
      var row = createXUL(doc, "treerow");
      var cell = createXUL(doc, "treecell");
      cell.setAttribute("label", labelText || "");
      setCellProperties(cell, properties || "ari-folder");
      row.appendChild(cell);
      item.appendChild(row);
      var childRoot = createXUL(doc, "treechildren");
      for (var i = 0; i < children.length; i++) childRoot.appendChild(children[i]);
      item.appendChild(childRoot);
      return item;
    },

    _selectTreeItem: function (root, attr, value) {
      if (!root) return false;
      var items = root.querySelectorAll("treeitem");
      var found = false;
      for (var i = 0; i < items.length; i++) {
        var selected = String(items[i].getAttribute(attr) || "") === String(value || "");
        items[i].setAttribute("data-current", selected ? "true" : "false");
        var cell = items[i].querySelector("treecell");
        if (cell) {
          var baseProps = cell.getAttribute("data-base-properties") || "";
          cell.setAttribute("properties", (baseProps + (selected ? " ari-current" : "")).trim());
        }
        if (selected) {
          found = true;
          try { items[i].scrollIntoView({ block: "nearest" }); } catch (e) {}
        }
      }
      return found;
    },

    _findTreeItemByAttr: function (root, attr, value) {
      if (!root) return null;
      var items = root.querySelectorAll("treeitem");
      for (var i = 0; i < items.length; i++) {
        if (String(items[i].getAttribute(attr) || "") === String(value || "")) {
          return items[i];
        }
      }
      return null;
    },

    _clearTreeCurrent: function (root) {
      if (!root) return;
      var items = root.querySelectorAll("treeitem");
      for (var i = 0; i < items.length; i++) {
        items[i].setAttribute("data-current", "false");
        var cell = items[i].querySelector("treecell");
        if (cell) {
          var baseProps = cell.getAttribute("data-base-properties") || "";
          cell.setAttribute("properties", baseProps.trim());
        }
      }
    },

    _flattenVisibleTreeItems: function (root) {
      var items = [];
      function walk(treechildren) {
        if (!treechildren) return;
        for (var node = treechildren.firstElementChild; node; node = node.nextElementSibling) {
          if (node.localName !== "treeitem") continue;
          items.push(node);
          if (node.getAttribute("container") === "true" && node.getAttribute("open") !== "false") {
            for (var child = node.firstElementChild; child; child = child.nextElementSibling) {
              if (child.localName === "treechildren") {
                walk(child);
                break;
              }
            }
          }
        }
      }
      walk(root);
      return items;
    },

    _treeItemFromEvent: function (tree, root, event) {
      var target = event && event.target;
      var item = target && target.closest ? target.closest("treeitem") : null;
      if (item) return item;

      var visibleItems = null;
      function itemAtIndex(index) {
        if (index < 0) return null;
        if (!visibleItems) visibleItems = ArxivDailyLeftPane._flattenVisibleTreeItems(root);
        return visibleItems[index] || null;
      }

      try {
        if (tree && typeof tree.getCellAt === "function" && event && event.clientX !== undefined) {
          var row = {};
          var col = {};
          var child = {};
          tree.getCellAt(event.clientX, event.clientY, row, col, child);
          item = itemAtIndex(row.value);
          if (item) return item;
        }
      } catch (e) {}

      try {
        var treeBox = tree && tree.treeBoxObject;
        if (treeBox && typeof treeBox.getCellAt === "function" && event && event.clientX !== undefined) {
          var boxRow = {};
          var boxCol = {};
          var boxChild = {};
          treeBox.getCellAt(event.clientX, event.clientY, boxRow, boxCol, boxChild);
          item = itemAtIndex(boxRow.value);
          if (item) return item;
        }
      } catch (e) {}

      try {
        if (tree && typeof tree.getRowAt === "function" && event && event.clientX !== undefined) {
          item = itemAtIndex(tree.getRowAt(event.clientX, event.clientY));
          if (item) return item;
        }
      } catch (e) {}

      try {
        var rowTreeBox = tree && tree.treeBoxObject;
        if (rowTreeBox && typeof rowTreeBox.getRowAt === "function" && event && event.clientX !== undefined) {
          item = itemAtIndex(rowTreeBox.getRowAt(event.clientX, event.clientY));
          if (item) return item;
        }
      } catch (e) {}

      try {
        if (tree && tree.currentIndex !== undefined) {
          item = itemAtIndex(tree.currentIndex);
          if (item) return item;
        }
      } catch (e) {}

      try {
        if (tree && tree.view && tree.view.selection) {
          var selected = tree.view.selection.currentIndex;
          item = itemAtIndex(selected);
          if (item) return item;
        }
      } catch (e) {}

      return null;
    },

    _activateReportTreeItem: function (item) {
      if (!item || item.getAttribute("data-empty") === "true") return false;
      var date = item.getAttribute("data-date");
      if (!date) return false;
      if (typeof ArxivDailyActions !== "undefined") {
        ArxivDailyActions.openReport(date);
        return true;
      }
      return false;
    },

    _activateProjectTreeItem: function (item) {
      if (!item || item.getAttribute("data-empty") === "true") return false;
      var paperId = item.getAttribute("data-paper-id") || item.getAttribute("data-arxiv-id");
      if (!paperId) return false;
      this._openProjectPaper(paperId);
      return true;
    },

    _onReportTreeActivate: function (event) {
      var item = this._treeItemFromEvent(this._reportTree, this._reportTreeChildren, event);
      if (this._activateReportTreeItem(item)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },

    _onProjectTreeActivate: function (event) {
      var item = this._treeItemFromEvent(this._projectTree, this._projectTreeChildren, event);
      if (this._activateProjectTreeItem(item)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },

    _onReportTreeClick: function (event) {
      if (!event || event.detail !== 2 || event.button !== 0) return;
      this._onReportTreeActivate(event);
    },

    _onProjectTreeClick: function (event) {
      if (!event || event.detail !== 2 || event.button !== 0) return;
      this._onProjectTreeActivate(event);
    },

    _onReportTreeKeyDown: function (event) {
      if (!event || event.key !== "Enter") return;
      var item = this._treeItemFromEvent(this._reportTree, this._reportTreeChildren, event);
      if (this._activateReportTreeItem(item)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },

    _onProjectTreeKeyDown: function (event) {
      if (!event || event.key !== "Enter") return;
      var item = this._treeItemFromEvent(this._projectTree, this._projectTreeChildren, event);
      if (this._activateProjectTreeItem(item)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },

    _onProjectPaperDragStart: function (event, paper) {
      try {
        var dt = event && event.dataTransfer;
        if (!dt || !paper) return;
        var zoteroItemID = parseInt(paper.zoteroItemID || paper.itemID || paper.zoteroItemId || 0, 10);
        if (zoteroItemID && typeof Zotero !== "undefined" &&
            Zotero.Utilities && Zotero.Utilities.Internal &&
            typeof Zotero.Utilities.Internal.onDragItems === "function") {
          try {
            Zotero.Utilities.Internal.onDragItems(event, [zoteroItemID]);
          } catch (nativeDragErr) {
            logError("native Zotero drag failed, using fallback payload: " + (nativeDragErr.message || nativeDragErr));
          }
        }
        var url = projectPaperURL(paper);
        var text = projectPaperDragText(paper, url);
        dt.effectAllowed = "copy";
        if (url) {
          dt.setData("text/uri-list", url);
          dt.setData("text/x-moz-url", url + "\n" + (paper.title || url));
        }
        dt.setData("text/plain", text);
        dt.setData("application/x-arxiv-daily-project-paper", JSON.stringify({
          arxivId: baseArxivId(paper.arxivId || paper.id || paper.paperId),
          title: paper.title || "",
          authors: paper.authors || "",
          primaryCategory: paper.primaryCategory || "",
          reportDate: paper.reportDate || paper.date || "",
          zoteroItemID: zoteroItemID || "",
          url: url,
        }));
      } catch (e) {
        logError("project paper drag failed: " + (e.message || e));
      }
    },

    _openProjectPaper: function (paperId) {
      try {
        var arxivId = baseArxivId(paperId);
        var entry = null;
        if (typeof ArxivDailyDataDir !== "undefined") {
          var index = ArxivDailyDataDir.readJSON("project-papers/index.json");
          if (Array.isArray(index)) {
            var base = baseArxivId(paperId);
            for (var i = 0; i < index.length; i++) {
              var candidateBase = baseArxivId(index[i].arxivId || index[i].id || index[i].paperId);
              if (candidateBase && candidateBase === base) {
                entry = index[i];
                arxivId = candidateBase;
                break;
              }
            }
          }
        }
        if (entry && !(entry.zoteroItemID || entry.itemID || entry.zoteroItemId) &&
            typeof ArxivDailyCenterWorkspace !== "undefined" &&
            ArxivDailyCenterWorkspace._createZoteroItemFromProjectEntry) {
          ArxivDailyCenterWorkspace._createZoteroItemFromProjectEntry(entry, function (patch) {
            try {
              var itemID = patch && (patch.zoteroItemID || patch.itemID || patch);
              if (!itemID) return;
              var latest = ArxivDailyDataDir.readJSON("project-papers/index.json");
              if (!Array.isArray(latest)) return;
              var base = baseArxivId(entry.arxivId || entry.id || entry.paperId);
              for (var j = 0; j < latest.length; j++) {
                if (baseArxivId(latest[j].arxivId || latest[j].id || latest[j].paperId) === base) {
                  latest[j].zoteroItemID = itemID;
                  latest[j].itemID = itemID;
                  break;
                }
              }
              ArxivDailyDataDir.writeJSON("project-papers/index.json", latest);
              ArxivDailyLeftPane.refreshProjects();
            } catch (err) {
              logError("save backfilled project item failed: " + (err.message || err));
            }
          });
        }
        if (entry && typeof ArxivDailyCenterWorkspace !== "undefined" && ArxivDailyCenterWorkspace.showProjectPaper) {
          ArxivDailyCenterWorkspace.showProjectPaper(entry);
          return;
        }
        if (arxivId && typeof ArxivDailyCenterWorkspace !== "undefined" && ArxivDailyCenterWorkspace.showProjectPaper) {
          ArxivDailyCenterWorkspace.showProjectPaper({ arxivId: arxivId, title: arxivId });
        }
      } catch (e) {
        logError("open project paper failed: " + (e.message || e));
      }
    },

    _locateProjectPaperItem: function (paperId) {
      (async function () {
        try {
          var entry = ArxivDailyLeftPane._findProjectEntry(paperId);
          if (!entry && /^\d+$/.test(String(paperId || ""))) entry = { zoteroItemID: paperId };
          var target = entry && (entry.zoteroItemID || entry.itemID || entry.zoteroItemId);
          if (!/^\d+$/.test(String(target || ""))) {
            if (entry && typeof ArxivDailyCenterWorkspace !== "undefined" &&
                ArxivDailyCenterWorkspace._createZoteroItemFromProjectEntry) {
              ArxivDailyCenterWorkspace._createZoteroItemFromProjectEntry(entry, function (patch) {
                var itemID = patch && (patch.zoteroItemID || patch.itemID || patch);
                if (itemID) {
                  if (entry.arxivId) ArxivDailyLeftPane._updateProjectEntry(entry.arxivId, patch);
                  ArxivDailyLeftPane._locateProjectPaperItem(String(itemID));
                }
              });
            }
            return;
          }

          var numericID = parseInt(target, 10);
          var collectionID = entry && entry.collectionID ? parseInt(entry.collectionID, 10) : 0;
          if (entry && typeof ArxivDailyCenterWorkspace !== "undefined" &&
              ArxivDailyCenterWorkspace._ensureProjectPaperCollectionInfo) {
            try {
              var info = await ArxivDailyCenterWorkspace._ensureProjectPaperCollectionInfo(entry);
              if (info && info.collectionID) {
                collectionID = parseInt(info.collectionID, 10);
                entry.collectionID = collectionID;
                entry.collectionPath = info.path || entry.collectionPath || "";
                if (ArxivDailyCenterWorkspace._fillProjectZoteroItem && typeof Zotero !== "undefined" && Zotero.Items) {
                  var item = Zotero.Items.getAsync ? await Zotero.Items.getAsync(numericID) : Zotero.Items.get(numericID);
                  if (item && !item.deleted) {
                    ArxivDailyCenterWorkspace._fillProjectZoteroItem(item, entry, collectionID);
                    if (item.saveTx) await item.saveTx();
                    if (ArxivDailyCenterWorkspace._attachFeedbackNoteToItem && (entry.feedback || entry.recommendation)) {
                      var noteID = await ArxivDailyCenterWorkspace._attachFeedbackNoteToItem(numericID, entry);
                      if (noteID) entry.noteID = noteID;
                    }
                  }
                }
                ArxivDailyLeftPane._updateProjectEntry(entry.arxivId || paperId, {
                  collectionID: collectionID,
                  collectionPath: entry.collectionPath || "",
                  noteID: entry.noteID || "",
                });
              }
            } catch (ensureErr) {
              logError("ensure project collection before locate failed: " + (ensureErr.message || ensureErr));
            }
          }

          var win = Zotero.getMainWindow();
          try {
            if (typeof ArxivDailyCenterWorkspace !== "undefined") ArxivDailyCenterWorkspace.hideViewer();
          } catch (e0) {}
          try {
            if (win && win.Zotero_Tabs && typeof win.Zotero_Tabs.select === "function") {
              win.Zotero_Tabs.select("zotero-pane");
            }
          } catch (tabErr) {}
          var pane = (win && win.ZoteroPane) || (typeof ZoteroPane !== "undefined" ? ZoteroPane : null);
          if (pane && pane.collectionsView && collectionID) {
            try {
              var selectedCollection = null;
              if (typeof pane.collectionsView.selectCollection === "function") {
                selectedCollection = pane.collectionsView.selectCollection(collectionID);
              } else if (typeof pane.collectionsView.selectByID === "function") {
                selectedCollection = pane.collectionsView.selectByID("C" + collectionID);
              } else if (typeof pane.collectionsView.selectItem === "function") {
                selectedCollection = pane.collectionsView.selectItem("C" + collectionID);
              }
              if (selectedCollection && typeof selectedCollection.then === "function") await selectedCollection;
              await new Promise(function (resolve) {
                (win && win.setTimeout ? win.setTimeout : setTimeout)(resolve, 80);
              });
            } catch (collectionErr) {
              logError("select project collection failed: " + (collectionErr.message || collectionErr));
            }
          }
          if (pane && pane.selectItem) {
            var selected = pane.selectItem(numericID);
            if (selected && typeof selected.then === "function") await selected;
          }
        } catch (e) {
          logError("locate project paper item failed: " + (e.message || e));
        }
      })();
    },

    _collectDescendantAttrs: function (item, attr) {
      var values = [];
      var seen = {};
      if (!item || !attr || !item.querySelectorAll) return values;
      var nodes = item.querySelectorAll("treeitem[" + attr + "]");
      for (var i = 0; i < nodes.length; i++) {
        var value = nodes[i].getAttribute(attr);
        if (value && !seen[value]) {
          seen[value] = true;
          values.push(value);
        }
      }
      return values;
    },

    _confirm: function (message) {
      try {
        var win = Zotero.getMainWindow();
        return !win || !win.confirm || win.confirm(message);
      } catch (e) {
        return true;
      }
    },

    _onReportContextMenu: function (event) {
      var item = this._treeItemFromEvent(this._reportTree, this._reportTreeChildren, event);
      if (!item) return;
      var date = item.getAttribute("data-date");
      var dates = date ? [date] : this._collectDescendantAttrs(item, "data-date");
      if (!date && !dates.length) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        var doc = this._doc || (event.target && event.target.ownerDocument);
        if (!doc) return;
        var popupset = doc.querySelector("popupset") || doc.documentElement;
        var popup = createXUL(doc, "menupopup");
        popup.addEventListener("popuphidden", function () {
          if (popup.parentNode) popup.parentNode.removeChild(popup);
        });
        function addItem(label, handler) {
          var menuitem = createXUL(doc, "menuitem");
          menuitem.setAttribute("label", label);
          menuitem.addEventListener("command", function (cmdEvent) {
            cmdEvent.preventDefault();
            cmdEvent.stopPropagation();
            handler();
          });
          popup.appendChild(menuitem);
        }
        if (date) {
          addItem("在阅读区打开", function () {
            if (typeof ArxivDailyActions !== "undefined") ArxivDailyActions.openReport(date);
          });
          addItem("在新标签页打开", function () {
            if (typeof ArxivDailyActions !== "undefined" && ArxivDailyActions.openReportInNewTab) {
              ArxivDailyActions.openReportInNewTab(date);
            } else if (typeof ArxivDailyActions !== "undefined") {
              ArxivDailyActions.openReportInNewWindow(date);
            }
          });
          addItem("在新窗口打开", function () {
            if (typeof ArxivDailyActions !== "undefined") ArxivDailyActions.openReportInNewWindow(date);
          });
        }
        var sep = createXUL(doc, "menuseparator");
        popup.appendChild(sep);
        addItem(date ? "删除报告" : "删除该报告文件夹", function () {
          if (!ArxivDailyLeftPane._confirm((date ? "删除该报告" : "删除该文件夹下 " + dates.length + " 个报告") +
              "？\n\n这会同步移除这些报告中已加入项目论文库的论文和对应 Zotero 条目。")) {
            return;
          }
          (async function () {
            try {
              if (typeof ArxivDailyCenterWorkspace !== "undefined" &&
                  ArxivDailyCenterWorkspace.deleteReportsByDates) {
                await ArxivDailyCenterWorkspace.deleteReportsByDates(dates, { deleteZoteroItems: true });
              } else if (typeof ArxivDailyReportStore !== "undefined") {
                for (var i = 0; i < dates.length; i++) ArxivDailyReportStore.deleteReport(dates[i]);
              }
              ArxivDailyLeftPane.refreshReports();
              ArxivDailyLeftPane.refreshProjects();
            } catch (deleteErr) {
              var win = Zotero.getMainWindow();
              if (win && win.alert) win.alert("删除报告失败:\n" + (deleteErr.message || deleteErr));
            }
          })();
        });
        addItem("打开报告文件夹", function () {
          ArxivDailyLeftPane.openDataFolder("reports");
        });
        popupset.appendChild(popup);
        popup.openPopupAtScreen(event.screenX || 0, event.screenY || 0, true);
      } catch (e) {
        logError("report context menu failed: " + (e.message || e));
        if (date && typeof ArxivDailyActions !== "undefined") ArxivDailyActions.openReportInNewTab(date);
      }
    },

    _onProjectContextMenu: function (event) {
      var item = this._treeItemFromEvent(this._projectTree, this._projectTreeChildren, event);
      if (!item) return;
      var paperId = item.getAttribute("data-paper-id") || item.getAttribute("data-arxiv-id");
      var paperIds = paperId ? [paperId] : this._collectDescendantAttrs(item, "data-paper-id");
      if (!paperId && !paperIds.length) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        var doc = this._doc || (event.target && event.target.ownerDocument);
        if (!doc) return;
        var popupset = doc.querySelector("popupset") || doc.documentElement;
        var popup = createXUL(doc, "menupopup");
        popup.addEventListener("popuphidden", function () {
          if (popup.parentNode) popup.parentNode.removeChild(popup);
        });
        function addItem(label, handler) {
          var menuitem = createXUL(doc, "menuitem");
          menuitem.setAttribute("label", label);
          menuitem.addEventListener("command", function (cmdEvent) {
            cmdEvent.preventDefault();
            cmdEvent.stopPropagation();
            handler();
          });
          popup.appendChild(menuitem);
        }
        if (paperId) {
          addItem("打开项目论文", function () {
            ArxivDailyLeftPane._openProjectPaper(paperId);
          });
          addItem("定位到 Zotero 条目", function () {
            ArxivDailyLeftPane._locateProjectPaperItem(paperId);
          });
          addItem("打开 arXiv 页面", function () {
            var id = baseArxivId(paperId);
            if (id && typeof Zotero !== "undefined" && Zotero.launchURL) {
              Zotero.launchURL("https://arxiv.org/abs/" + id);
            }
          });
        }
        addItem(paperId ? "删除项目论文" : "删除该项目论文文件夹", function () {
          if (!ArxivDailyLeftPane._confirm((paperId ? "删除该项目论文" : "删除该文件夹下 " + paperIds.length + " 篇项目论文") +
              "？\n\n这会同步移除插件项目论文库中的记录，并将插件创建/关联的 Zotero 条目移入回收站。")) {
            return;
          }
          (async function () {
            try {
              if (typeof ArxivDailyCenterWorkspace !== "undefined") {
                if (paperId && ArxivDailyCenterWorkspace._removeProjectPaper) {
                  ArxivDailyCenterWorkspace._removeProjectPaper(paperId, { deleteZoteroItems: true });
                } else if (ArxivDailyCenterWorkspace.deleteProjectPapersByIds) {
                  await ArxivDailyCenterWorkspace.deleteProjectPapersByIds(paperIds, { deleteZoteroItems: true });
                }
              }
              ArxivDailyLeftPane.refreshProjects();
            } catch (deleteErr) {
              var win = Zotero.getMainWindow();
              if (win && win.alert) win.alert("删除项目论文失败:\n" + (deleteErr.message || deleteErr));
            }
          })();
        });
        var sep = createXUL(doc, "menuseparator");
        popup.appendChild(sep);
        addItem("打开项目论文文件夹", function () {
          ArxivDailyLeftPane.openDataFolder("project-papers");
        });
        popupset.appendChild(popup);
        popup.openPopupAtScreen(event.screenX || 0, event.screenY || 0, true);
      } catch (e) {
        logError("project context menu failed: " + (e.message || e));
        if (paperId) this._openProjectPaper(paperId);
      }
    },

    _findProjectEntry: function (paperId) {
      try {
        if (typeof ArxivDailyDataDir === "undefined") return null;
        var index = ArxivDailyDataDir.readJSON("project-papers/index.json");
        if (!Array.isArray(index)) return null;
        var base = baseArxivId(paperId);
        for (var i = 0; i < index.length; i++) {
          if (baseArxivId(index[i].arxivId || index[i].id || index[i].paperId) === base) return index[i];
        }
      } catch (e) {}
      return null;
    },

    _updateProjectEntry: function (paperId, patch) {
      try {
        if (typeof ArxivDailyDataDir === "undefined" || !patch) return false;
        var index = ArxivDailyDataDir.readJSON("project-papers/index.json");
        if (!Array.isArray(index)) return false;
        var base = baseArxivId(paperId);
        var changed = false;
        for (var i = 0; i < index.length; i++) {
          if (baseArxivId(index[i].arxivId || index[i].id || index[i].paperId) !== base) continue;
          for (var key in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined && patch[key] !== null) {
              index[i][key] = patch[key];
              changed = true;
            }
          }
          break;
        }
        if (changed) {
          ArxivDailyDataDir.writeJSON("project-papers/index.json", index);
          this.refreshProjects();
        }
        return changed;
      } catch (e) {
        logError("update project entry failed: " + (e.message || e));
      }
      return false;
    },
  };
})();
