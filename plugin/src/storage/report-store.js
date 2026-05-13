/* ==========================================================================
 * storage/report-store.js — Report persistence
 *
 * Saves/loads reports as Markdown + JSON index.
 * Directory structure: reports/年/年.月/年-月-日-report.md
 * Index: reports/index.json
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

  function dataDirError() {
    try {
      if (typeof ArxivDailyDataDir !== "undefined" && ArxivDailyDataDir.getLastError) {
        return ArxivDailyDataDir.getLastError() || "";
      }
    } catch (e) {}
    return "";
  }

  globalThis.ArxivDailyReportStore = {

    // Save a report: markdown + JSON index update
    saveReport: function (dateStr, markdown, metadata) {
      // dateStr: "2026-05-08"
      if (typeof ArxivDailyDataDir === "undefined") {
        throw new Error("Report save failed: data directory module is not loaded");
      }
      if (!ArxivDailyDataDir.getBasePath || !ArxivDailyDataDir.getBasePath()) {
        var initOk = ArxivDailyDataDir.init ? ArxivDailyDataDir.init() : false;
        if (!initOk) {
          var initErr = dataDirError();
          throw new Error("Report save failed: data directory init failed" +
            (initErr ? "; " + initErr : ""));
        }
      }

      var parts = dateStr.split("-");
      var year = parts[0];
      var month = parts[1];
      var monthDir = year + "." + month;
      var reportDir = "reports/" + year + "/" + monthDir;

      // Ensure subdirectory exists
      if (ArxivDailyDataDir.ensureSubDir && !ArxivDailyDataDir.ensureSubDir(reportDir)) {
        var dirErr = dataDirError();
        throw new Error("Report save failed: cannot create report directory " + reportDir +
          (dirErr ? "; " + dirErr : ""));
      }

      // Save Markdown report
      var fileName = year + "年" + month + "月" + parts[2] + "日" + " arXiv 兴趣报告.md";
      var filePath = reportDir + "/" + fileName;
      var ok = ArxivDailyDataDir.writeFile(filePath, markdown);
      if (!ok) {
        var mdErr = dataDirError();
        logError("saveReport: failed to write " + filePath + (mdErr ? ": " + mdErr : ""));
        throw new Error("Report save failed: markdown write failed at " + filePath +
          (mdErr ? "; " + mdErr : ""));
      }

      // Update index
      var index = this.getIndex();
      var existing = -1;
      for (var i = 0; i < index.length; i++) {
        if (index[i].date === dateStr) { existing = i; break; }
      }

      var entry = {
        date: dateStr,
        year: year,
        month: month,
        filePath: filePath,
        fileName: fileName,
        paperCount: metadata ? metadata.paperCount || 0 : 0,
        generatedAt: Date.now(),
        metadata: metadata || {},
      };

      if (existing >= 0) {
        index[existing] = entry;
      } else {
        index.push(entry);
      }

      if (!ArxivDailyDataDir.writeJSON("reports/index.json", index)) {
        var indexErr = dataDirError();
        logError("saveReport: failed to write reports/index.json" + (indexErr ? ": " + indexErr : ""));
        throw new Error("Report save failed: index write failed at reports/index.json" +
          (indexErr ? "; " + indexErr : ""));
      }
      log("report saved: " + dateStr);
      return true;
    },

    // Load a report's Markdown content
    loadReport: function (dateStr) {
      var index = this.getIndex();
      for (var i = 0; i < index.length; i++) {
        if (index[i].date === dateStr) {
          var content = ArxivDailyDataDir.readFile(index[i].filePath);
          return content;
        }
      }
      return null;
    },

    hasReport: function (dateStr) {
      var index = this.getIndex();
      for (var i = 0; i < index.length; i++) {
        if (index[i].date === dateStr) return true;
      }
      return false;
    },

    deleteReport: function (dateStr) {
      if (typeof ArxivDailyDataDir === "undefined") return false;
      var index = this.getIndex();
      var next = [];
      var removed = [];
      for (var i = 0; i < index.length; i++) {
        if (index[i].date === dateStr) removed.push(index[i]);
        else next.push(index[i]);
      }
      if (!removed.length) return false;
      for (var r = 0; r < removed.length; r++) {
        if (removed[r].filePath && ArxivDailyDataDir.deleteFile) {
          ArxivDailyDataDir.deleteFile(removed[r].filePath);
        }
      }
      if (!ArxivDailyDataDir.writeJSON("reports/index.json", next)) {
        var indexErr = dataDirError();
        logError("deleteReport: failed to write reports/index.json" + (indexErr ? ": " + indexErr : ""));
        throw new Error("Report delete failed: index write failed" + (indexErr ? "; " + indexErr : ""));
      }
      log("report deleted: " + dateStr);
      return true;
    },

    // Get report index
    getIndex: function () {
      var data = ArxivDailyDataDir.readJSON("reports/index.json");
      return Array.isArray(data) ? data : [];
    },

    // List report dates sorted descending
    listReports: function () {
      var index = this.getIndex();
      index.sort(function (a, b) { return b.date.localeCompare(a.date); });
      return index;
    },

    // List reports grouped by year, then month (for tree view)
    listGrouped: function () {
      var index = this.getIndex();
      var grouped = {};

      for (var i = 0; i < index.length; i++) {
        var entry = index[i];
        if (!grouped[entry.year]) grouped[entry.year] = { year: entry.year, months: {} };
        var ym = entry.year + "." + entry.month;
        if (!grouped[entry.year].months[ym]) grouped[entry.year].months[ym] = { label: ym, reports: [] };
        grouped[entry.year].months[ym].reports.push(entry);
      }

      return grouped;
    },
  };
})();
