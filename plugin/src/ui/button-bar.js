/* ==========================================================================
 * button-bar.js — Report panel button bar
 *
 * Top row: Settings, Interests, Generate/Stop, Profile, QA.
 * Report title row: Search, Calendar. Icons are monochrome SVGs to match Zotero UI.
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";
  const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

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
    return doc.createElementNS(XUL_NS, name);
  }

  function getRootURI() {
    return globalThis.__ArxivDailyRootURI || "";
  }

  // ── Button definitions ────────────────────────────────────────────────────

  const TOP_BUTTONS = [
    { id: "ari-btn-settings",     labelKey: "button.settings",    icon: "settings",   action: "openSettings" },
    { id: "ari-btn-interests",    labelKey: "button.profile",     icon: "user",       action: "configureInterests" },
    { id: "ari-btn-generate",     labelKey: "button.generate",    icon: "play",       action: "generateReport",
      altId: "ari-btn-stop",      altLabelKey: "button.stop",     altIcon: "stop" },
    { id: "ari-btn-qa",           labelKey: "button.qa",          icon: "message",    action: "openQA" },
  ];

  const REPORT_BUTTONS = [
    { id: "ari-btn-search",       labelKey: "button.search",      icon: "search",     action: "searchReports" },
    { id: "ari-btn-calendar",     labelKey: "button.calendar",    icon: "calendar",   action: "openCalendar" },
  ];

  const ICON_COLOR = "#5f6368";
  const ICONS = {
    settings:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + ICON_COLOR + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.04.04a2 2 0 0 1-2.83 2.83l-.04-.04a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 0 1-4 0v-.06A1.7 1.7 0 0 0 8.96 19.4a1.7 1.7 0 0 0-1.88.34l-.04.04a2 2 0 0 1-2.83-2.83l.04-.04a1.7 1.7 0 0 0 .34-1.88A1.7 1.7 0 0 0 3.06 14H3a2 2 0 0 1 0-4h.06a1.7 1.7 0 0 0 1.54-1.04 1.7 1.7 0 0 0-.34-1.88l-.04-.04a2 2 0 0 1 2.83-2.83l.04.04a1.7 1.7 0 0 0 1.88.34H9A1.7 1.7 0 0 0 10 3.06V3a2 2 0 0 1 4 0v.06a1.7 1.7 0 0 0 1.04 1.54 1.7 1.7 0 0 0 1.88-.34l.04-.04a2 2 0 0 1 2.83 2.83l-.04.04a1.7 1.7 0 0 0-.34 1.88V9c.27.61.88 1 1.55 1H21a2 2 0 0 1 0 4h-.06A1.7 1.7 0 0 0 19.4 15z"/></svg>',
    sliders:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + ICON_COLOR + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h8"/><path d="M16 6h4"/><circle cx="14" cy="6" r="2"/><path d="M4 12h4"/><path d="M12 12h8"/><circle cx="10" cy="12" r="2"/><path d="M4 18h10"/><path d="M18 18h2"/><circle cx="16" cy="18" r="2"/></svg>',
    play:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + ICON_COLOR + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5v14l11-7z"/></svg>',
    stop:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + ICON_COLOR + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',
    search:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + ICON_COLOR + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
    user:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + ICON_COLOR + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
    message:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + ICON_COLOR + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16v10.5H8.5L4 20.5z"/><path d="M9 9h6"/><path d="M9 12.5h4"/></svg>',
    calendar:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + ICON_COLOR + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M4 10h16"/></svg>',
  };

  function iconURI(name) {
    const svg = ICONS[name] || ICONS.settings;
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }

  function shortcutForButton(id) {
    try {
      if (typeof ArxivDailyConfig === "undefined") return "";
      if (id === "ari-btn-qa") return ArxivDailyConfig.get("shortcuts.toggleQA") || "Accel+L";
    } catch (e) {}
    return "";
  }

  function shortcutLabel(shortcut) {
    if (!shortcut) return "";
    if (typeof ArxivDailyShortcuts !== "undefined" && ArxivDailyShortcuts.format) {
      return ArxivDailyShortcuts.format(shortcut);
    }
    return shortcut;
  }

  // ── Module ────────────────────────────────────────────────────────────────

  globalThis.ArxivDailyButtonBar = {
    _toolbar: null,
    _brand: null,
    _buttonGroup: null,
    _reportActionBox: null,
    _buttons: {},
    _generateMenuButton: null,

    init: function (win, parentEl) {
      const doc = win.document;
      if (this._toolbar) {
        log("button-bar already initialized");
        return;
      }

      this._toolbar = createXUL(doc, "hbox");
      this._toolbar.setAttribute("id", "arxiv-daily-button-bar");
      this._toolbar.style.cssText =
        "box-sizing:border-box;width:100%;padding:4px 5px 3px 5px;" +
        "display:flex;flex-wrap:nowrap;gap:3px;align-items:center;" +
        "justify-content:flex-start;border-bottom:1px solid rgba(0,0,0,0.12);" +
        "background:transparent;overflow:hidden;";

      this._brand = this._createBrand(doc);
      this._toolbar.appendChild(this._brand);

      this._buttonGroup = createXUL(doc, "hbox");
      this._buttonGroup.setAttribute("id", "arxiv-daily-button-group");
      this._buttonGroup.style.cssText =
        "display:flex;flex-wrap:nowrap;gap:1px;align-items:center;justify-content:flex-end;" +
        "min-width:122px;flex:1 0 auto;overflow:visible;";

      for (const btnDef of TOP_BUTTONS) {
        const btn = this._createButton(doc, btnDef, "top");
        this._buttonGroup.appendChild(btn);
        this._buttons[btnDef.id] = btn;
        if (btnDef.id === "ari-btn-generate") {
          const menuBtn = this._createGenerateMenuButton(doc);
          this._buttonGroup.appendChild(menuBtn);
          this._generateMenuButton = menuBtn;
        }

        // If this button has an alternate (generate/stop), create hidden alt
        if (btnDef.altId) {
          const altBtn = this._createButton(doc, {
            id: btnDef.altId,
            labelKey: btnDef.altLabelKey,
            icon: btnDef.altIcon,
            action: btnDef.action, // same action, toggles back
          }, "top");
          altBtn.style.display = "none";
          this._buttonGroup.appendChild(altBtn);
          this._buttons[btnDef.altId] = altBtn;
        }
      }

      this._toolbar.appendChild(this._buttonGroup);

      if (parentEl) {
        parentEl.insertBefore(this._toolbar, parentEl.firstChild);
      }

      this._reportActionBox = doc.getElementById("arxiv-daily-reports-actions");
      if (this._reportActionBox) {
        for (const btnDef of REPORT_BUTTONS) {
          const btn = this._createButton(doc, btnDef, "title");
          this._reportActionBox.appendChild(btn);
          this._buttons[btnDef.id] = btn;
        }
      } else {
        logError("button-bar: report title action box not found");
      }

      log("button-bar initialized");
    },

    destroy: function () {
      if (this._toolbar && this._toolbar.parentNode) {
        this._toolbar.parentNode.removeChild(this._toolbar);
      }
      if (this._reportActionBox) {
        while (this._reportActionBox.firstChild) {
          this._reportActionBox.removeChild(this._reportActionBox.firstChild);
        }
      }
      this._toolbar = null;
      this._brand = null;
      this._buttonGroup = null;
      this._reportActionBox = null;
      this._buttons = {};
      this._generateMenuButton = null;
      log("button-bar destroyed");
    },

    // Toggle between generate and stop button
    setGenerating: function (isGenerating) {
      const genBtn = this._buttons["ari-btn-generate"];
      const stopBtn = this._buttons["ari-btn-stop"];
      if (genBtn) genBtn.style.display = isGenerating ? "none" : "";
      if (this._generateMenuButton) this._generateMenuButton.style.display = isGenerating ? "none" : "";
      if (stopBtn) stopBtn.style.display = isGenerating ? "" : "none";
    },

    updateReadiness: function (ready, reason) {
      const ids = ["ari-btn-interests", "ari-btn-generate", "ari-btn-qa"];
      for (let i = 0; i < ids.length; i++) {
        const btn = this._buttons[ids[i]];
        if (!btn) continue;
        const enabled = typeof ready === "object" ? !!ready[ids[i]] : !!ready;
        const disabledReason = typeof reason === "object" ? reason[ids[i]] : reason;
        if (enabled) {
          btn.removeAttribute("disabled");
          btn.style.opacity = "1";
          btn.style.filter = "";
          btn.style.cursor = "pointer";
          btn.style.backgroundColor = "transparent";
          btn.style.borderColor = "transparent";
          btn.setAttribute("tooltiptext", btn.getAttribute("data-original-tooltip") || btn.getAttribute("tooltiptext") || "");
        } else {
          btn.setAttribute("disabled", "true");
          btn.style.opacity = "0.45";
          btn.style.filter = "grayscale(1)";
          btn.style.cursor = "default";
          btn.style.backgroundColor = "ButtonFace";
          btn.style.borderColor = "ThreeDShadow";
          if (disabledReason) btn.setAttribute("tooltiptext", disabledReason);
        }
      }
    },

    disable: function (buttonId, reason) {
      const btn = this._buttons[buttonId];
      if (btn) {
        btn.setAttribute("disabled", "true");
        if (reason) btn.setAttribute("tooltiptext", reason);
      }
    },

    enable: function (buttonId) {
      const btn = this._buttons[buttonId];
      if (btn) {
        btn.removeAttribute("disabled");
        // Restore original tooltip
      }
    },

    // ── Internal ──────────────────────────────────────────────────────────

    _createBrand: function (doc) {
      const brand = createXUL(doc, "hbox");
      brand.setAttribute("id", "ari-btn-brand");
      brand.setAttribute("aria-label", "AID");
      brand.setAttribute("class", "arxiv-daily-brand");
      brand.style.cssText =
        "-moz-appearance:none;appearance:none;box-sizing:border-box;" +
        "-moz-box-align:center;-moz-box-pack:center;display:flex;" +
        "align-items:center;justify-content:center;" +
        "height:26px;width:28px;min-width:22px;max-width:28px;flex:0 1 28px;margin:0;padding:1px 2px;" +
        "border:0;background-color:transparent;overflow:hidden;";

      const image = typeof ArxivDailyLogo !== "undefined"
        ? ArxivDailyLogo.xul(doc, 22)
        : createXUL(doc, "image");
      if (typeof ArxivDailyLogo === "undefined") {
        image.setAttribute("src", getRootURI() + "content/icons/app_icon_new.png");
        image.style.cssText =
          "width:22px;height:22px;min-width:22px;max-width:22px;object-fit:contain;";
      }
      brand.appendChild(image);

      return brand;
    },

    _createButton: function (doc, def, placement) {
      const size = placement === "title"
        ? { width: 24, height: 22, icon: 15, radius: 4 }
        : { width: 26, height: 26, icon: 16, radius: 4 };
      const uri = iconURI(def.icon);
      const btn = createXUL(doc, "toolbarbutton");
      btn.setAttribute("id", def.id);
      btn.setAttribute("label", "");
      const shortcut = shortcutLabel(shortcutForButton(def.id));
      const tooltip = ArxivDailyI18n.t(def.labelKey) + (shortcut ? "（" + shortcut + "）" : "");
      btn.setAttribute("tooltiptext", tooltip);
      btn.setAttribute("data-original-tooltip", tooltip);
      btn.setAttribute("aria-label", ArxivDailyI18n.t(def.labelKey));
      btn.setAttribute("class", "arxiv-daily-btn");
      btn.style.cssText =
        "-moz-appearance:none;appearance:none;box-sizing:border-box;" +
        "-moz-box-align:center;-moz-box-pack:center;display:flex;" +
        "align-items:center;justify-content:center;text-align:center;" +
        "cursor:pointer;margin:0;padding:0;border:1px solid transparent;" +
        "border-radius:" + size.radius + "px;width:" + size.width + "px;" +
        "height:" + size.height + "px;min-width:" + size.width + "px;" +
        "max-width:" + size.width + "px;background-color:transparent;" +
        "background-image:url('" + uri + "');background-position:center center;" +
        "background-repeat:no-repeat;background-size:" + size.icon + "px " + size.icon + "px;" +
        "list-style-image:none;";

      // Hover and disabled states
      btn.addEventListener("mouseenter", function () {
        if (!btn.hasAttribute("disabled")) {
          btn.style.backgroundColor = "rgba(0,0,0,0.055)";
          btn.style.borderColor = "rgba(0,0,0,0.14)";
        }
      });
      btn.addEventListener("mouseleave", function () {
        btn.style.backgroundColor = "transparent";
        btn.style.borderColor = "transparent";
      });
      btn.addEventListener("mousedown", function () {
        if (!btn.hasAttribute("disabled")) {
          btn.style.backgroundColor = "rgba(0,0,0,0.1)";
        }
      });
      btn.addEventListener("mouseup", function () {
        if (!btn.hasAttribute("disabled")) {
          btn.style.backgroundColor = "rgba(0,0,0,0.055)";
        }
      });

      if (def.action) {
        let lastActionAt = 0;
        const runAction = function (event) {
          const now = Date.now();
          if (now - lastActionAt < 250) return;
          lastActionAt = now;
          if (btn.hasAttribute("disabled")) return;
          if (typeof globalThis.ArxivDailyActions !== "undefined" &&
              typeof globalThis.ArxivDailyActions[def.action] === "function") {
            globalThis.ArxivDailyActions[def.action](btn, def.id, event || null);
          }
        };
        btn.addEventListener("command", runAction);
        btn.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          runAction(event);
        });
      }

      return btn;
    },

    _createGenerateMenuButton: function (doc) {
      const btn = createXUL(doc, "toolbarbutton");
      btn.setAttribute("id", "ari-btn-generate-model");
      btn.setAttribute("label", "");
      btn.setAttribute("tooltiptext", "选择报告生成模型");
      btn.setAttribute("aria-label", "选择报告生成模型");
      btn.style.cssText =
        "-moz-appearance:none;appearance:none;box-sizing:border-box;" +
        "-moz-box-align:center;-moz-box-pack:center;display:flex;" +
        "align-items:center;justify-content:center;text-align:center;" +
        "cursor:pointer;margin:0 2px 0 -3px;padding:0;border:1px solid transparent;" +
        "border-radius:4px;width:16px;height:26px;min-width:16px;max-width:16px;" +
        "background-color:transparent;font:10px message-box,system-ui,sans-serif;color:" + ICON_COLOR + ";";
      btn.textContent = "▾";
      btn.addEventListener("mouseenter", function () {
        if (!btn.hasAttribute("disabled")) {
          btn.style.backgroundColor = "rgba(0,0,0,0.055)";
          btn.style.borderColor = "rgba(0,0,0,0.14)";
        }
      });
      btn.addEventListener("mouseleave", function () {
        btn.style.backgroundColor = "transparent";
        btn.style.borderColor = "transparent";
      });
      btn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof globalThis.ArxivDailyActions !== "undefined" &&
            typeof globalThis.ArxivDailyActions.chooseReportModel === "function") {
          globalThis.ArxivDailyActions.chooseReportModel(btn);
        }
      });
      return btn;
    },
  };
})();
