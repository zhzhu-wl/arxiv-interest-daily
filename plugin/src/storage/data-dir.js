/* ==========================================================================
 * data-dir.js - Cross-platform plugin data directory management
 *
 * All public relative paths use "/" internally. Native filesystem paths are
 * produced through nsIFile.append(), so Windows, macOS, and Linux are handled
 * by the platform instead of by string concatenation.
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";

  function log(msg) {
    const text = "[" + LOG_PREFIX + "] " + msg;
    if (typeof Zotero !== "undefined" && typeof Zotero.debug === "function") Zotero.debug(text);
    else if (typeof Zotero !== "undefined" && typeof Zotero.log === "function") Zotero.log(text);
  }

  function logError(msg) {
    if (typeof Zotero !== "undefined" && typeof Zotero.logError === "function") Zotero.logError(msg);
    else log("ERROR: " + msg);
  }

  const SUBDIRS = [
    "reports",
    "project-papers",
    "cache",
    "cache/arxiv",
    "cache/pdf",
    "cache/text",
    "cache/llm",
    "chat",
    "feedback",
    "tasks",
    "annotations",
    "exports",
    "logs",
  ];

  let gLastError = "";

  function setLastError(message) {
    gLastError = String(message || "");
  }

  function getCi() {
    return Components.interfaces;
  }

  function cloneFile(file) {
    return file.clone().QueryInterface(getCi().nsIFile);
  }

  function makeFile(path) {
    const file = Components.classes["@mozilla.org/file/local;1"]
      .createInstance(getCi().nsIFile);
    file.initWithPath(String(path || ""));
    return file;
  }

  function getProfileFile() {
    try {
      if (typeof Zotero !== "undefined" && Zotero.ProfileDirectory) {
        if (typeof Zotero.ProfileDirectory === "string") return makeFile(Zotero.ProfileDirectory);
        if (typeof Zotero.ProfileDirectory.QueryInterface === "function") {
          return cloneFile(Zotero.ProfileDirectory.QueryInterface(getCi().nsIFile));
        }
        if (Zotero.ProfileDirectory.path) return makeFile(Zotero.ProfileDirectory.path);
      }
    } catch (e) {}

    try {
      if (typeof Services !== "undefined" && Services.dirsvc) {
        return Services.dirsvc.get("ProfD", getCi().nsIFile);
      }
    } catch (e2) {}

    try {
      if (typeof Zotero !== "undefined" && Zotero.DataDirectory && Zotero.DataDirectory.dir) {
        var dir = Zotero.DataDirectory.dir;
        if (typeof dir === "string") return makeFile(dir);
        if (typeof dir.QueryInterface === "function") return cloneFile(dir.QueryInterface(getCi().nsIFile));
        if (dir.path) return makeFile(dir.path);
      }
    } catch (e3) {}

    return null;
  }

  function normalizeRelativePath(relativePath) {
    var raw = String(relativePath || "").trim();
    if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(raw)) {
      throw new Error("Absolute paths are not allowed: " + relativePath);
    }
    raw = raw.replace(/[\\]+/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
    if (!raw) return "";

    var parts = raw.split("/");
    var safe = [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part || part === ".") continue;
      if (part === "..") {
        throw new Error("Parent path segments are not allowed: " + relativePath);
      }
      if (/^[a-zA-Z]:$/.test(part) || part.indexOf(":") >= 0) {
        throw new Error("Absolute or drive-qualified paths are not allowed: " + relativePath);
      }
      safe.push(part);
    }
    return safe.join("/");
  }

  function fileForRelativePath(baseFile, relativePath) {
    var normalized = normalizeRelativePath(relativePath);
    var file = cloneFile(baseFile);
    if (!normalized) return file;
    var parts = normalized.split("/");
    for (var i = 0; i < parts.length; i++) {
      file.append(parts[i]);
    }
    return file;
  }

  function ensureDirFile(file) {
    try {
      if (file.exists()) return file.isDirectory();
      if (file.parent && !file.parent.exists()) {
        if (!ensureDirFile(file.parent)) return false;
      }
      file.create(getCi().nsIFile.DIRECTORY_TYPE, 0o755);
      return true;
    } catch (e) {
      try {
        if (typeof IOUtils !== "undefined" && typeof IOUtils.createDirectory === "function") {
          IOUtils.createDirectory(file.path, { createAncestors: true });
          return true;
        }
      } catch (e2) {
        setLastError("mkdir failed: " + file.path + ": " + (e2.message || e2));
        logError(gLastError);
        return false;
      }
      setLastError("mkdir failed: " + file.path + ": " + (e.message || e));
      logError(gLastError);
      return false;
    }
  }

  function writeStringToFile(file, content) {
    const text = content === undefined || content === null ? "" : String(content);

    try {
      if (typeof Zotero !== "undefined" &&
          Zotero.File &&
          typeof Zotero.File.putContents === "function") {
        Zotero.File.putContents(file, text);
        return true;
      }
    } catch (e) {
      setLastError("Zotero.File.putContents failed for " + file.path + ": " + (e.message || e));
      logError(gLastError);
    }

    var fstream = null;
    var cstream = null;
    try {
      fstream = Components.classes["@mozilla.org/network/file-output-stream;1"]
        .createInstance(getCi().nsIFileOutputStream);
      cstream = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
        .createInstance(getCi().nsIConverterOutputStream);
      fstream.init(file, 0x02 | 0x08 | 0x20, 0o644, 0);
      cstream.init(fstream, "UTF-8");
      cstream.writeString(text);
      cstream.close();
      fstream = null;
      return true;
    } catch (e2) {
      setLastError("fallback file write failed for " + file.path + ": " + (e2.message || e2));
      logError(gLastError);
      try { if (cstream) cstream.close(); } catch (closeErr) {}
      try { if (fstream) fstream.close(); } catch (closeErr2) {}
      return false;
    }
  }

  async function writeStringToFileAsync(file, content) {
    const text = content === undefined || content === null ? "" : String(content);
    const errors = [];

    try {
      if (typeof Zotero !== "undefined" &&
          Zotero.File &&
          typeof Zotero.File.putContentsAsync === "function") {
        await Zotero.File.putContentsAsync(file, text);
        return true;
      }
    } catch (e) {
      errors.push("Zotero.File.putContentsAsync: " + (e.message || e));
    }

    try {
      if (typeof IOUtils !== "undefined" && typeof IOUtils.writeUTF8 === "function") {
        await IOUtils.writeUTF8(file.path, text, { tmpPath: file.path + ".tmp" });
        return true;
      }
    } catch (e2) {
      errors.push("IOUtils.writeUTF8: " + (e2.message || e2));
    }

    try {
      if (typeof IOUtils !== "undefined" && typeof IOUtils.write === "function" &&
          typeof TextEncoder !== "undefined") {
        await IOUtils.write(file.path, new TextEncoder().encode(text), { tmpPath: file.path + ".tmp" });
        return true;
      }
    } catch (e3) {
      errors.push("IOUtils.write: " + (e3.message || e3));
    }

    if (writeStringToFile(file, text)) return true;
    if (errors.length) {
      setLastError("async write failed for " + file.path + ": " + errors.join(" | "));
      logError(gLastError);
    }
    return false;
  }

  globalThis.ArxivDailyDataDir = {
    _baseFile: null,
    _basePath: null,

    init: function () {
      if (this._baseFile && this._basePath) return true;
      gLastError = "";
      try {
        const profileDir = getProfileFile();
        if (!profileDir) throw new Error("ProfileDirectory not available");

        const baseFile = cloneFile(profileDir);
        baseFile.append("arxiv-interest-daily");
        if (!ensureDirFile(baseFile)) {
          throw new Error(gLastError || "failed to create base data directory");
        }

        this._baseFile = baseFile;
        this._basePath = baseFile.path;

        for (const sub of SUBDIRS) {
          this.ensureSubDir(sub);
        }

        this._ensureFile("config.json", "{}");
        this._ensureFile("preferences.json", "{}");

        log("data-dir: " + this._basePath);
        return true;
      } catch (err) {
        setLastError("data-dir init failed: " + (err.message || err));
        logError(gLastError);
        return false;
      }
    },

    getBasePath: function () {
      return this._basePath;
    },

    getSubPath: function (relativePath) {
      if (!this._baseFile && !this.init()) return "";
      return this.getFile(relativePath).path;
    },

    getFile: function (relativePath) {
      if (!this._baseFile && !this.init()) {
        throw new Error("Data directory is not available");
      }
      return fileForRelativePath(this._baseFile, relativePath);
    },

    normalizeRelativePath: normalizeRelativePath,

    makeFile: makeFile,

    getLastError: function () {
      return gLastError;
    },

    ensureSubDir: function (relativePath) {
      if (!this._baseFile && !this.init()) return false;
      gLastError = "";
      try {
        return ensureDirFile(fileForRelativePath(this._baseFile, relativePath));
      } catch (e) {
        setLastError("ensureSubDir " + relativePath + " failed: " + (e.message || e));
        logError(gLastError);
        return false;
      }
    },

    readFile: function (relativePath) {
      if (!this._baseFile && !this.init()) return null;
      try {
        const file = fileForRelativePath(this._baseFile, relativePath);
        if (!file.exists()) return null;
        return Zotero.File.getContents(file);
      } catch (e) {
        setLastError("read " + relativePath + " failed: " + (e.message || e));
        logError(gLastError);
        return null;
      }
    },

    writeFile: function (relativePath, content) {
      if (!this._baseFile && !this.init()) return false;
      gLastError = "";
      try {
        const file = fileForRelativePath(this._baseFile, relativePath);
        if (file.parent && !file.parent.exists() && !ensureDirFile(file.parent)) {
          setLastError("failed to create parent directory: " + file.parent.path);
          return false;
        }
        return writeStringToFile(file, content);
      } catch (e) {
        setLastError("write " + relativePath + " failed: " + (e.message || e));
        logError(gLastError);
        return false;
      }
    },

    writeFileAsync: async function (relativePath, content) {
      if (!this._baseFile && !this.init()) {
        throw new Error("Data directory is not available");
      }
      gLastError = "";
      const file = fileForRelativePath(this._baseFile, relativePath);
      try {
        if (file.parent && !file.parent.exists() && !ensureDirFile(file.parent)) {
          throw new Error("failed to create parent directory: " + file.parent.path);
        }
      } catch (parentErr) {
        throw new Error("Failed to prepare parent directory for " + file.path + ": " + (parentErr.message || parentErr));
      }
      const ok = await writeStringToFileAsync(file, content);
      if (!ok) throw new Error("Failed to write " + relativePath + " at " + file.path);
      return true;
    },

    readJSON: function (relativePath) {
      const text = this.readFile(relativePath);
      if (!text) return null;
      try { return JSON.parse(text); }
      catch (e) { return null; }
    },

    writeJSON: function (relativePath, data) {
      return this.writeFile(relativePath, JSON.stringify(data, null, 2));
    },

    deleteFile: function (relativePath) {
      if (!this._baseFile && !this.init()) return false;
      gLastError = "";
      try {
        const file = fileForRelativePath(this._baseFile, relativePath);
        if (!file.exists()) return true;
        file.remove(false);
        return true;
      } catch (e) {
        try {
          const fallbackFile = fileForRelativePath(this._baseFile, relativePath);
          if (typeof IOUtils !== "undefined" && typeof IOUtils.remove === "function") {
            IOUtils.remove(fallbackFile.path, { ignoreAbsent: true });
            return true;
          }
        } catch (e2) {
          setLastError("delete " + relativePath + " failed: " + (e2.message || e2));
          logError(gLastError);
          return false;
        }
        setLastError("delete " + relativePath + " failed: " + (e.message || e));
        logError(gLastError);
        return false;
      }
    },

    _ensureFile: function (relativePath, defaultContent) {
      try {
        const file = fileForRelativePath(this._baseFile, relativePath);
        if (!file.exists()) {
          if (file.parent && !file.parent.exists()) ensureDirFile(file.parent);
          writeStringToFile(file, defaultContent);
        }
      } catch (e) {
        setLastError("ensure file " + relativePath + " failed: " + (e.message || e));
      }
    },
  };
})();
