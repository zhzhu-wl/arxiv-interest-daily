/* ==========================================================================
 * storage/cache.js - arXiv / PDF / text / LLM cache
 *
 * Simple key-value file cache with TTL. Expired entries are kept on disk so
 * fetchers can use them as stale fallbacks when a remote service is down.
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

  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h = ((h << 5) - h) + c;
      h = h & h;
    }
    return (h >>> 0).toString(16).padStart(8, "0") + "_" + str.length;
  }

  globalThis.ArxivDailyCache = {
    _retentionDays: 30,

    init: function () {
      if (typeof ArxivDailyConfig !== "undefined") {
        this._retentionDays = ArxivDailyConfig.get("cache.retentionDays") || 30;
      }
      log("cache initialized, retention: " + this._retentionDays + " days");
    },

    set: function (subDir, key, data, ttlDays) {
      if (typeof ArxivDailyDataDir === "undefined") return false;
      var cacheKey = hash(key);
      var meta = {
        key: key,
        cached: Date.now(),
        ttlDays: ttlDays || this._retentionDays,
      };
      var filePath = "cache/" + subDir + "/" + cacheKey + ".json";
      var payload = JSON.stringify({ meta: meta, data: data });
      return ArxivDailyDataDir.writeFile(filePath, payload);
    },

    get: function (subDir, key) {
      var obj = this._readObject(subDir, key);
      if (!obj || !obj.meta) return null;

      var ageMs = Date.now() - obj.meta.cached;
      var ttlMs = (obj.meta.ttlDays || this._retentionDays) * 86400000;
      if (ageMs > ttlMs) return null;
      return obj.data;
    },

    getStale: function (subDir, key) {
      var obj = this._readObject(subDir, key);
      if (!obj || !obj.meta) return null;
      return obj.data;
    },

    clear: function (subDir) {
      var cachePath = typeof ArxivDailyDataDir !== "undefined"
        ? ArxivDailyDataDir.getSubPath("cache/" + subDir)
        : "";
      if (!cachePath) return;
      try {
        var dir = ArxivDailyDataDir.makeFile
          ? ArxivDailyDataDir.makeFile(cachePath)
          : null;
        if (!dir) return;
        if (dir.exists() && dir.isDirectory()) {
          var entries = dir.directoryEntries;
          while (entries.hasMoreElements()) {
            var entry = entries.nextFile;
            try { entry.remove(false); } catch (e) {}
          }
        }
      } catch (e) {
        logError("cache clear failed: " + subDir);
      }
    },

    setRaw: function (subDir, key, data, ext) {
      if (typeof ArxivDailyDataDir === "undefined") return false;
      var cacheKey = hash(key);
      ext = ext || ".bin";
      var filePath = "cache/" + subDir + "/" + cacheKey + ext;
      return ArxivDailyDataDir.writeFile(filePath, data);
    },

    getRaw: function (subDir, key, ext) {
      if (typeof ArxivDailyDataDir === "undefined") return null;
      var cacheKey = hash(key);
      ext = ext || ".bin";
      var filePath = "cache/" + subDir + "/" + cacheKey + ext;
      return ArxivDailyDataDir.readFile(filePath);
    },

    _readObject: function (subDir, key) {
      if (typeof ArxivDailyDataDir === "undefined") return null;
      var cacheKey = hash(key);
      var filePath = "cache/" + subDir + "/" + cacheKey + ".json";
      var payload = ArxivDailyDataDir.readFile(filePath);
      if (!payload) return null;

      try {
        return JSON.parse(payload);
      } catch (e) {
        return null;
      }
    },
  };
})();
