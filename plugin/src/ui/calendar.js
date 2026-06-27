/* ==========================================================================
 * ui/calendar.js - Lightweight anchored date picker for reports
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

  function createEl(doc, name, className, text) {
    var el = doc.createElement(name);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function todayStr() {
    var now = new Date();
    return now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
  }

  function isWeekend(year, month, day) {
    var dow = new Date(year, month, day).getDay();
    return dow === 0 || dow === 6;
  }

  function reportDateMap() {
    var map = {};
    try {
      if (typeof ArxivDailyReportStore !== "undefined") {
        var reports = ArxivDailyReportStore.listReports();
        for (var i = 0; i < reports.length; i++) {
          if (reports[i].date) map[reports[i].date] = reports[i];
        }
      }
    } catch (e) {}
    return map;
  }

  function installStyles(doc) {
    if (doc.getElementById("arxiv-daily-calendar-style")) return;
    var style = createEl(doc, "style");
    style.id = "arxiv-daily-calendar-style";
    style.textContent = [
      ".ari-calendar-popover{position:fixed;z-index:2147483646;box-sizing:border-box;width:330px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;background:Canvas;color:CanvasText;border:1px solid ThreeDShadow;border-radius:5px;box-shadow:0 8px 24px rgba(0,0,0,.22);font:13px message-box,system-ui,sans-serif;}",
      ".ari-calendar-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid ThreeDShadow;}",
      ".ari-calendar-title{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".ari-calendar-close{width:24px;height:22px;padding:0;border:1px solid transparent;background:transparent;color:GrayText;border-radius:4px;cursor:pointer;}",
      ".ari-calendar-close:hover{background:rgba(0,0,0,.055);border-color:rgba(0,0,0,.14);color:CanvasText;}",
      ".ari-calendar-body{padding:10px;}",
      ".ari-calendar-month{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;}",
      ".ari-calendar-month button,.ari-calendar-action{padding:4px 9px;border:1px solid transparent;border-radius:4px;background:transparent;color:CanvasText;cursor:pointer;font:12px message-box,system-ui,sans-serif;}",
      ".ari-calendar-month button:hover,.ari-calendar-action:hover{background:rgba(0,0,0,.055);border-color:rgba(0,0,0,.14);}",
      ".ari-calendar-month-label{font-weight:600;}",
      ".ari-calendar-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center;font-size:12px;}",
      ".ari-calendar-week{font-weight:600;color:GrayText;padding:4px 0;}",
      ".ari-calendar-day{padding:5px 0;border:1px solid transparent;border-radius:4px;color:GrayText;}",
      ".ari-calendar-day.has-report{cursor:pointer;color:-moz-HyperlinkText;background:rgba(56,117,215,.12);border-color:rgba(56,117,215,.28);}",
      ".ari-calendar-day.has-report:hover{background:Highlight;color:HighlightText;border-color:Highlight;}",
      ".ari-calendar-day.missing-report{cursor:pointer;color:CanvasText;}",
      ".ari-calendar-day.missing-report:hover{background:rgba(0,0,0,.055);border-color:rgba(0,0,0,.14);}",
      ".ari-calendar-day.future{cursor:default;color:GrayText;opacity:.5;}",
      ".ari-calendar-footer{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px;color:GrayText;font-size:12px;}",
    ].join("\n");
    doc.documentElement.appendChild(style);
  }

  globalThis.ArxivDailyCalendar = {
    _panel: null,
    _filterDate: null,
    _year: null,
    _month: null,
    _title: "按日历查找或生成报告",
    _outsideHandler: null,
    _keyHandler: null,
    _resizeHandler: null,

    open: function (parentWin, anchor, options) {
      try {
        options = options || {};
        var win = parentWin || Zotero.getMainWindow();
        if (!win || !win.document) return;
        if (this._panel && this._panel.parentNode) {
          this.close();
          return;
        }
        var now = new Date();
        this._year = this._year === null ? now.getFullYear() : this._year;
        this._month = this._month === null ? now.getMonth() : this._month;
        this._title = options.title || "按日历查找或生成报告";
        installStyles(win.document);
        this._panel = createEl(win.document, "div", "ari-calendar-popover");
        this._panel.setAttribute("role", "dialog");
        this._panel.setAttribute("aria-label", this._title);
        (win.document.documentElement || win.document.body).appendChild(this._panel);
        this._render(win, anchor);
        this._position(win, anchor);
        this._installDismissHandlers(win, anchor);
        log("calendar popover opened");
      } catch (err) {
        logError("open calendar failed: " + (err.message || err));
        if (parentWin && parentWin.alert) parentWin.alert("打开日历失败:\n" + (err.message || err));
      }
    },

    _render: function (win, anchor) {
      var doc = win.document;
      var panel = this._panel;
      if (!panel) return;
      while (panel.firstChild) panel.removeChild(panel.firstChild);

      var head = createEl(doc, "div", "ari-calendar-head");
      head.appendChild(createEl(doc, "div", "ari-calendar-title", this._title || "按日历查找或生成报告"));
      var close = createEl(doc, "button", "ari-calendar-close", "x");
      close.type = "button";
      close.title = "关闭";
      close.addEventListener("click", this.close.bind(this));
      head.appendChild(close);
      panel.appendChild(head);

      var body = createEl(doc, "div", "ari-calendar-body");
      var monthRow = createEl(doc, "div", "ari-calendar-month");
      var prev = createEl(doc, "button", null, "<");
      prev.type = "button";
      var label = createEl(doc, "div", "ari-calendar-month-label", this._year + "年" + (this._month + 1) + "月");
      var next = createEl(doc, "button", null, ">");
      next.type = "button";
      var self = this;
      prev.addEventListener("click", function () {
        self._month--;
        if (self._month < 0) { self._month = 11; self._year--; }
        self._render(win, anchor);
        self._position(win, anchor);
      });
      next.addEventListener("click", function () {
        self._month++;
        if (self._month > 11) { self._month = 0; self._year++; }
        self._render(win, anchor);
        self._position(win, anchor);
      });
      monthRow.appendChild(prev);
      monthRow.appendChild(label);
      monthRow.appendChild(next);
      body.appendChild(monthRow);

      var grid = createEl(doc, "div", "ari-calendar-grid");
      ["日", "一", "二", "三", "四", "五", "六"].forEach(function (name) {
        grid.appendChild(createEl(doc, "div", "ari-calendar-week", name));
      });

      var reports = reportDateMap();
      var today = todayStr();
      var daysInMonth = new Date(this._year, this._month + 1, 0).getDate();
      var firstDay = new Date(this._year, this._month, 1).getDay();
      for (var p = 0; p < firstDay; p++) grid.appendChild(createEl(doc, "div"));

      for (var day = 1; day <= daysInMonth; day++) {
        var dateStr = this._year + "-" + pad2(this._month + 1) + "-" + pad2(day);
        var hasReport = !!reports[dateStr];
        var future = dateStr > today;
        var missingReport = !hasReport && !future;
        var cell = createEl(
          doc,
          "div",
          "ari-calendar-day" +
            (hasReport ? " has-report" : "") +
            (missingReport ? " missing-report" : "") +
            (future ? " future" : ""),
          String(day)
        );
        if (hasReport) {
          cell.title = "打开 " + dateStr + " 的报告";
          cell.addEventListener("click", function (date) {
            return function () {
              self._filterDate = date;
              self.close();
              if (typeof ArxivDailyLeftPane !== "undefined" && ArxivDailyLeftPane.selectReport) {
                ArxivDailyLeftPane.selectReport(date, false);
              }
              if (typeof ArxivDailyLeftPane !== "undefined" && ArxivDailyLeftPane.selectProjectDate) {
                ArxivDailyLeftPane.selectProjectDate(date, false);
              }
              if (typeof ArxivDailyActions !== "undefined" && ArxivDailyActions.openReport) {
                ArxivDailyActions.openReport(date);
              }
            };
          }(dateStr));
        } else if (missingReport) {
          cell.title = isWeekend(this._year, this._month, day)
            ? "生成该日报告（该日无论文）"
            : "生成该日报告";
          cell.addEventListener("click", function (date) {
            return function () {
              self.close();
              if (typeof ArxivDailyActions !== "undefined" && ArxivDailyActions.generatePastReport) {
                ArxivDailyActions.generatePastReport(date);
              } else if (typeof ArxivDailyActions !== "undefined" && ArxivDailyActions.generateReport) {
                ArxivDailyActions.generateReport(null, null, {
                  dateStr: date,
                  openAfterGenerate: true,
                });
              }
            };
          }(dateStr));
        }
        grid.appendChild(cell);
      }
      body.appendChild(grid);

      var footer = createEl(doc, "div", "ari-calendar-footer");
      footer.appendChild(createEl(doc, "span", null, "有报告的日期会高亮；无报告的过去日期可点击生成。"));
      var clear = createEl(doc, "button", "ari-calendar-action", "退出日期筛选");
      clear.type = "button";
      clear.addEventListener("click", function () {
        self._filterDate = null;
        if (typeof ArxivDailyLeftPane !== "undefined" && ArxivDailyLeftPane.clearCalendarSelection) {
          ArxivDailyLeftPane.clearCalendarSelection();
        }
        self.close();
      });
      footer.appendChild(clear);
      body.appendChild(footer);
      panel.appendChild(body);
    },

    _position: function (win, anchor) {
      if (!this._panel) return;
      var rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
      var width = this._panel.offsetWidth || 330;
      var height = this._panel.offsetHeight || 360;
      var vw = win.innerWidth || 900;
      var vh = win.innerHeight || 700;
      var left = rect ? rect.right - width : vw - width - 12;
      var top = rect ? rect.bottom + 4 : 48;
      if (left < 8) left = rect ? rect.left : 8;
      if (left + width > vw - 8) left = Math.max(8, vw - width - 8);
      if (top + height > vh - 8 && rect) top = Math.max(8, rect.top - height - 4);
      if (top + height > vh - 8) top = Math.max(8, vh - height - 8);
      this._panel.style.left = Math.round(left) + "px";
      this._panel.style.top = Math.round(top) + "px";
    },

    _installDismissHandlers: function (win, anchor) {
      var self = this;
      this._outsideHandler = function (event) {
        if (!self._panel) return;
        if (self._panel.contains(event.target)) return;
        if (anchor && (event.target === anchor || (anchor.contains && anchor.contains(event.target)))) return;
        self.close();
      };
      this._keyHandler = function (event) {
        if (event.key === "Escape") self.close();
      };
      this._resizeHandler = function () {
        self.close();
      };
      win.setTimeout(function () {
        try {
          win.document.addEventListener("mousedown", self._outsideHandler, true);
          win.document.addEventListener("keydown", self._keyHandler, true);
          win.addEventListener("resize", self._resizeHandler);
          win.addEventListener("scroll", self._resizeHandler, true);
        } catch (e) {}
      }, 0);
    },

    close: function () {
      var win = this._panel && this._panel.ownerDocument && this._panel.ownerDocument.defaultView;
      if (win) {
        try {
          if (this._outsideHandler) win.document.removeEventListener("mousedown", this._outsideHandler, true);
          if (this._keyHandler) win.document.removeEventListener("keydown", this._keyHandler, true);
          if (this._resizeHandler) {
            win.removeEventListener("resize", this._resizeHandler);
            win.removeEventListener("scroll", this._resizeHandler, true);
          }
        } catch (e) {}
      }
      if (this._panel && this._panel.parentNode) this._panel.parentNode.removeChild(this._panel);
      this._panel = null;
      this._outsideHandler = null;
      this._keyHandler = null;
      this._resizeHandler = null;
    },

    getFilterDate: function () {
      return this._filterDate;
    },

    clearFilter: function () {
      this._filterDate = null;
    },

    destroy: function () {
      this.close();
    },
  };
})();
