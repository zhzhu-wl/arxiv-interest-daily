/* ==========================================================================
 * ui/platform-shortcuts.js - Platform-aware shortcut helpers
 * ========================================================================== */

"use strict";

(function () {
  function isMac() {
    try {
      if (typeof Services !== "undefined" && Services.appinfo) {
        return String(Services.appinfo.OS || "").toLowerCase() === "darwin";
      }
    } catch (e) {}
    try {
      if (typeof navigator !== "undefined") {
        return /mac|darwin/i.test(String(navigator.platform || navigator.userAgent || ""));
      }
    } catch (e2) {}
    return false;
  }

  function parseShortcut(shortcut) {
    var raw = String(shortcut || "").trim();
    if (/^ctrl\+(shift\+)?(a|l|enter)$/i.test(raw)) {
      raw = raw.replace(/^ctrl\+/i, "Accel+");
    }
    if (!raw) return { key: "", ctrl: false, meta: false, shift: false, alt: false, accel: false };
    var parts = raw.split("+").map(function (part) {
      return String(part || "").trim();
    }).filter(function (part) {
      return !!part;
    });
    var key = parts.length ? parts[parts.length - 1] : "";
    var parsed = { key: key, ctrl: false, meta: false, shift: false, alt: false, accel: false };
    for (var i = 0; i < Math.max(0, parts.length - 1); i++) {
      var p = parts[i].toLowerCase();
      if (p === "ctrl" || p === "control") parsed.ctrl = true;
      else if (p === "cmd" || p === "command" || p === "meta") parsed.meta = true;
      else if (p === "shift") parsed.shift = true;
      else if (p === "alt" || p === "option") parsed.alt = true;
      else if (p === "accel" || p === "mod") parsed.accel = true;
    }
    return parsed;
  }

  function normalizeEventKey(key) {
    var value = String(key || "").toLowerCase();
    if (value === "return") return "enter";
    if (value === "esc") return "escape";
    if (value === "spacebar") return " ";
    return value;
  }

  function eventMatchesShortcut(event, shortcut) {
    if (!event || !shortcut) return false;
    var parsed = parseShortcut(shortcut);
    var key = normalizeEventKey(parsed.key);
    var eventKey = normalizeEventKey(event.key);
    if (!key || !eventKey) return false;
    if (key.length === 1) {
      if (eventKey !== key) return false;
    } else if (eventKey !== key) {
      return false;
    }

    var mac = isMac();
    var wantsCtrl = parsed.ctrl || (parsed.accel && !mac);
    var wantsMeta = parsed.meta || (parsed.accel && mac);
    return (!!event.ctrlKey === !!wantsCtrl) &&
      (!!event.metaKey === !!wantsMeta) &&
      (!!event.shiftKey === !!parsed.shift) &&
      (!!event.altKey === !!parsed.alt);
  }

  function formatShortcut(shortcut, options) {
    options = options || {};
    var parsed = parseShortcut(shortcut);
    if (!parsed.key) return "";
    var mac = isMac();
    var parts = [];
    var wantsCtrl = parsed.ctrl || (parsed.accel && !mac);
    var wantsMeta = parsed.meta || (parsed.accel && mac);
    if (options.words) {
      if (wantsMeta) parts.push(mac ? "Command" : "Meta");
      if (wantsCtrl) parts.push("Ctrl");
      if (parsed.alt) parts.push(mac ? "Option" : "Alt");
      if (parsed.shift) parts.push("Shift");
    } else if (mac) {
      if (wantsMeta) parts.push("Command");
      if (wantsCtrl) parts.push("Control");
      if (parsed.alt) parts.push("Option");
      if (parsed.shift) parts.push("Shift");
    } else {
      if (wantsCtrl) parts.push("Ctrl");
      if (wantsMeta) parts.push("Meta");
      if (parsed.alt) parts.push("Alt");
      if (parsed.shift) parts.push("Shift");
    }
    var key = parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key.charAt(0).toUpperCase() + parsed.key.slice(1);
    parts.push(key);
    return parts.join("+");
  }

  function defaultShortcut(shortcut) {
    return String(shortcut || "").replace(/\bCtrl\+/g, "Accel+");
  }

  globalThis.ArxivDailyShortcuts = {
    isMac: isMac,
    parse: parseShortcut,
    matches: eventMatchesShortcut,
    format: formatShortcut,
    defaultShortcut: defaultShortcut,
  };
})();
