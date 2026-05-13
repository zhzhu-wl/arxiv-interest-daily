/* ==========================================================================
 * ui/logo.js - Shared project logo helpers
 * ========================================================================== */

"use strict";

(function () {
  const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
  const LOGO_PATH = "content/icons/app_icon_new.png";
  const LONG_LOGO_PATH = "content/icons/new_long_logo.png";

  function rootURI() {
    return globalThis.__ArxivDailyRootURI || "";
  }

  function logoURI() {
    return rootURI() + LOGO_PATH;
  }

  function longLogoURI() {
    return rootURI() + LONG_LOGO_PATH;
  }

  function createXUL(doc, name) {
    if (typeof doc.createXULElement === "function") return doc.createXULElement(name);
    return doc.createElementNS(XUL_NS, name);
  }

  function baseStyle(size) {
    var px = Math.max(12, parseInt(size, 10) || 16);
    return "width:" + px + "px;height:" + px + "px;min-width:" + px + "px;" +
      "max-width:" + px + "px;object-fit:contain;flex:0 0 auto;";
  }

  globalThis.ArxivDailyLogo = {
    uri: logoURI,
    longUri: longLogoURI,

    html: function (doc, size, className) {
      var img = doc.createElement("img");
      img.src = logoURI();
      img.alt = "";
      if (className) img.className = className;
      img.style.cssText = baseStyle(size);
      return img;
    },

    longHtml: function (doc, width, height, className) {
      var img = doc.createElement("img");
      var w = Math.max(48, parseInt(width, 10) || 76);
      var h = Math.max(16, parseInt(height, 10) || 24);
      img.src = longLogoURI();
      img.alt = "";
      if (className) img.className = className;
      img.style.cssText =
        "width:" + w + "px;height:" + h + "px;min-width:" + w + "px;" +
        "max-width:" + w + "px;object-fit:contain;flex:0 0 auto;";
      return img;
    },

    xul: function (doc, size) {
      var img = createXUL(doc, "image");
      img.setAttribute("src", logoURI());
      img.style.cssText = baseStyle(size);
      return img;
    },

    longXul: function (doc, width, height) {
      var img = createXUL(doc, "image");
      var w = Math.max(48, parseInt(width, 10) || 76);
      var h = Math.max(16, parseInt(height, 10) || 24);
      img.setAttribute("src", longLogoURI());
      img.style.cssText =
        "width:" + w + "px;height:" + h + "px;min-width:" + w + "px;" +
        "max-width:" + w + "px;object-fit:contain;flex:0 0 auto;";
      return img;
    },
  };
})();
