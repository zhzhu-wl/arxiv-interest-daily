/* ==========================================================================
 * menu.js — Top-level menu "每日 arXiv"
 *
 * Inserts after helpMenu (or appends to menubar).
 * All menu items delegate to main.js handlers via globalThis.ArxivDailyActions.
 * Report/Project panel toggles show a checkmark.
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

  function createXUL(doc, name) {
    if (typeof doc.createXULElement === "function") return doc.createXULElement(name);
    return doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", name);
  }

  // ── Menu items definition ────────────────────────────────────────────────

  // Each item: { id, labelKey, [action], [type], [checked], [separator] }
  // action is called when the menu item is clicked.
  // If action is a string, it calls ArxivDailyActions[action]().

  globalThis.ArxivDailyMenu = {
    _menu: null,
    _menubar: null,
    _menuItems: [],

    init: function (win) {
      const doc = win.document;
      if (this._menu) {
        log("menu already initialized");
        return;
      }

      const menubar =
        doc.getElementById("main-menubar") ||
        doc.querySelector("menubar");

      if (!menubar) {
        logError("menu: no menubar found");
        return false;
      }
      this._menubar = menubar;

      const menu = createXUL(doc, "menu");
      menu.setAttribute("id", "menu-arxiv-interest-daily");
      menu.setAttribute("label", ArxivDailyI18n.t("menu.label"));

      const popup = createXUL(doc, "menupopup");
      popup.setAttribute("id", "menu-arxiv-popup");

      // Build menu items
      const items = [
        { id: "menu-ari-setup", labelKey: "menu.settings", action: "openSettings" },
        { separator: true },
        { id: "menu-ari-interests", labelKey: "menu.interests", action: "configureInterests" },
        { separator: true },
        { id: "menu-ari-generate", labelKey: "menu.generate", action: "generateReport" },
        { id: "menu-ari-progress", labelKey: "menu.progress", labelFallback: "任务进度", action: "openProgressPanel" },
        { separator: true },
        { id: "menu-ari-search", labelKey: "menu.search", action: "searchReports" },
        { id: "menu-ari-qa", labelKey: "menu.qa", action: "openQA" },
        { id: "menu-ari-calendar", labelKey: "menu.calendar", action: "openCalendar" },
        { separator: true },
        { id: "menu-ari-open-data-dir", labelKey: "menu.open_data_dir", labelFallback: "打开插件数据目录", action: "openProjectDirectory" },
        {
          id: "menu-ari-clear-paper-cache",
          labelKey: "menu.clear_paper_cache",
          labelFallback: "清除论文缓存",
          tooltipKey: "menu.clear_paper_cache.tooltip",
          tooltipFallback: "清除从 arXiv 抓取并用于生成报告的论文信息缓存",
          action: "clearPaperCache"
        },
        { id: "menu-ari-export-diagnostics", labelKey: "menu.export_diagnostics", labelFallback: "导出诊断日志", action: "exportDiagnostics" },
        { separator: true },
        { id: "menu-ari-show-report", labelKey: "menu.show.report", type: "checkbox", checked: true, action: "toggleReportPane" },
        { id: "menu-ari-show-project", labelKey: "menu.show.project", type: "checkbox", checked: true, action: "toggleProjectPane" },
        { separator: true },
        { id: "menu-ari-guide", labelKey: "menu.guide", labelFallback: "使用教程", action: "openUserGuide" },
      ];

      for (const itemDef of items) {
        if (itemDef.separator) {
          const sep = createXUL(doc, "menuseparator");
          popup.appendChild(sep);
          continue;
        }

        const menuitem = createXUL(doc, "menuitem");
        menuitem.setAttribute("id", itemDef.id);
        menuitem.setAttribute("label", ArxivDailyI18n.t(itemDef.labelKey, itemDef.labelFallback || itemDef.labelKey));
        if (itemDef.tooltipKey) {
          menuitem.setAttribute("tooltiptext", ArxivDailyI18n.t(itemDef.tooltipKey, itemDef.tooltipFallback || itemDef.tooltipKey));
        }

        if (itemDef.type === "checkbox") {
          menuitem.setAttribute("type", "checkbox");
          menuitem.setAttribute("checked", itemDef.checked ? "true" : "false");
        }

        if (itemDef.action) {
          menuitem.addEventListener("command", function () {
            if (typeof globalThis.ArxivDailyActions !== "undefined" &&
                typeof globalThis.ArxivDailyActions[itemDef.action] === "function") {
              globalThis.ArxivDailyActions[itemDef.action](menuitem, itemDef.id);
            }
          });
        }

        this._menuItems.push({ id: itemDef.id, el: menuitem, def: itemDef });
        popup.appendChild(menuitem);
      }

      menu.appendChild(popup);

      const helpMenu = doc.getElementById("helpMenu");
      if (helpMenu && helpMenu.parentNode === menubar) {
        menubar.insertBefore(menu, helpMenu.nextSibling);
        log("menu inserted after helpMenu");
      } else {
        menubar.appendChild(menu);
        log("menu appended to menubar");
      }

      this._menu = menu;
      log("menu initialized");
      return true;
    },

    destroy: function () {
      if (this._menu && this._menu.parentNode) {
        this._menu.parentNode.removeChild(this._menu);
      }
      this._menu = null;
      this._menuItems = [];
      log("menu destroyed");
    },

    // Update checkbox states for toggle items
    updateToggleState: function (itemId, checked) {
      for (const item of this._menuItems) {
        if (item.id === itemId) {
          item.el.setAttribute("checked", checked ? "true" : "false");
          break;
        }
      }
    },

    updateReadiness: function (ready, reason) {
      const ids = ["menu-ari-interests", "menu-ari-generate", "menu-ari-qa"];
      for (const id of ids) {
        for (const item of this._menuItems) {
          if (item.id !== id) continue;
          const enabled = typeof ready === "object" ? !!ready[id] : !!ready;
          const disabledReason = typeof reason === "object" ? reason[id] : reason;
          if (enabled) {
            item.el.removeAttribute("disabled");
            item.el.removeAttribute("tooltiptext");
          } else {
            item.el.setAttribute("disabled", "true");
            if (disabledReason) item.el.setAttribute("tooltiptext", disabledReason);
          }
          break;
        }
      }
    },

    // Update menu labels (after locale change)
    refreshLabels: function () {
      for (const item of this._menuItems) {
        if (item.def && item.def.labelKey) {
          item.el.setAttribute("label", ArxivDailyI18n.t(item.def.labelKey, item.def.labelFallback || item.def.labelKey));
          if (item.def.tooltipKey) {
            item.el.setAttribute("tooltiptext", ArxivDailyI18n.t(item.def.tooltipKey, item.def.tooltipFallback || item.def.tooltipKey));
          }
        }
      }
      if (this._menu) {
        this._menu.setAttribute("label", ArxivDailyI18n.t("menu.label"));
      }
    },
  };
})();
