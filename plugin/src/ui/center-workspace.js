/* ==========================================================================
 * ui/center-workspace.js - Shared central reader and bottom dock
 *
 * Keeps report reading, search, and progress in Zotero's central area.
 * Search and progress share one bottom dock and can be split horizontally.
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";
  const PREFS_PREFIX = "extensions.arxiv-interest-daily.";
  const DEFAULT_DOCK_HEIGHT = 240;
  const MIN_DOCK_HEIGHT = 130;
  const MAX_DOCK_HEIGHT = 560;
  const DEFAULT_SPLIT_RATIO = 0.48;

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

  function setPref(key, val) {
    try {
      Zotero.Prefs.set(PREFS_PREFIX + key, val);
    } catch (e) {}
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function pointerInScroller(scroller, event) {
    if (!scroller || !event || !scroller.getBoundingClientRect) {
      return { x: 0, y: 0 };
    }
    var rect = scroller.getBoundingClientRect();
    return {
      x: clamp((event.clientX || rect.left) - rect.left, 0, rect.width || 0),
      y: clamp((event.clientY || rect.top) - rect.top, 0, rect.height || 0),
    };
  }

  function refreshReaderZoomLater(doc) {
    var win = doc && doc.defaultView;
    if (!win || typeof ArxivDailyCenterWorkspace === "undefined" ||
        typeof ArxivDailyCenterWorkspace._applyReaderZoom !== "function") {
      return;
    }
    win.setTimeout(function () {
      try { ArxivDailyCenterWorkspace._applyReaderZoom(); } catch (e) {}
    }, 0);
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
      .replace(/[\uD800-\uDFFF]/g, "\uFFFD")
      .replace(/\r\n?/g, "\n");
  }

  function safeTitle(text, fallback) {
    var title = cleanText(text || "").replace(/\s+/g, " ").trim();
    return title || fallback || "Report";
  }

  function romanNumeral(num) {
    var n = Math.max(1, Math.min(3999, parseInt(num, 10) || 1));
    var map = [
      [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
      [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
      [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
    ];
    var out = "";
    for (var i = 0; i < map.length; i++) {
      while (n >= map[i][0]) {
        out += map[i][1];
        n -= map[i][0];
      }
    }
    return out;
  }

  function stripSectionPrefix(title) {
    return String(title || "").trim().replace(/^[IVXLCDM]+\.\s*/i, "");
  }

  function sectionStartsWith(title, names) {
    var clean = stripSectionPrefix(title).replace(/\s+/g, " ").trim();
    for (var i = 0; i < names.length; i++) {
      if (clean.indexOf(names[i]) === 0) return true;
    }
    return false;
  }

  function shouldCollapseReportSection(title) {
    var clean = stripSectionPrefix(title).replace(/\s+/g, " ").trim();
    return sectionStartsWith(clean, [
      "弱相关论文速读",
      "弱相关论文速度",
      "LLM 通过但未进入",
      "其他论文",
      "其余论文",
    ]);
  }

  function escapeHTML(text) {
    return cleanText(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function createLogo(doc, size) {
    var px = Math.max(12, parseInt(size, 10) || 16);
    if (typeof ArxivDailyLogo !== "undefined") return ArxivDailyLogo.html(doc, size || 16);
    var svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "width:" + px + "px;height:" + px + "px;min-width:" + px + "px;flex:0 0 auto;";
    var path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M4.2 21 10.2 5.4c.7-1.8 2.9-1.8 3.6 0L19.8 21h-4.1l-1.1-3.1H9.4L8.3 21H4.2Zm6.3-6.3h3L12 10.2l-1.5 4.5Z");
    path.setAttribute("fill", "#f01824");
    svg.appendChild(path);
    return svg;
  }

  function createSelectionLogo(doc, size) {
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

  function elementHeight(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return 0;
    return el.getBoundingClientRect().height || 0;
  }

  function findCenterHost(doc) {
    var toolbar = doc.getElementById("zotero-items-toolbar") ||
      doc.querySelector("#zotero-items-toolbar, .zotero-items-toolbar");
    var tree = doc.getElementById("zotero-items-tree");
    if (toolbar && tree) {
      var node = tree.parentNode;
      while (node && node !== doc.documentElement) {
        if (node.contains(toolbar) && node.contains(tree) &&
            node.getBoundingClientRect && node.getBoundingClientRect().width > 240) {
          return node;
        }
        node = node.parentNode;
      }
    }

    var selectors = [
      "#zotero-items-pane",
      "#zotero-items-pane-content",
      "#zotero-view-tabbox",
      "#zotero-content-box",
      "#zotero-content",
      "#zotero-items-tree",
      ".zotero-content-pane",
      "main"
    ];

    for (var i = 0; i < selectors.length; i++) {
      var el = doc.querySelector(selectors[i]);
      if (el && el.getBoundingClientRect && el.getBoundingClientRect().width > 240) {
        return el;
      }
    }

    var left = doc.getElementById("zotero-left-pane");
    var right = doc.getElementById("zotero-item-pane") || doc.getElementById("zotero-editpane");
    var candidates = Array.prototype.slice.call(doc.querySelectorAll("vbox, box, div"));
    var best = null;
    var bestScore = 0;
    for (var c = 0; c < candidates.length; c++) {
      var node = candidates[c];
      if (node === left || node === right || (left && left.contains(node)) || (right && right.contains(node))) {
        continue;
      }
      var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
      if (!rect || rect.width < 260 || rect.height < 180) continue;
      var score = rect.width * rect.height;
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    return best;
  }

  function promoteCenterHost(el) {
    if (!el || !el.closest) return el;
    var broad = el.closest("#zotero-items-pane, #zotero-items-pane-content, #zotero-content-box, #zotero-content");
    return broad || el;
  }

  function baseArxivId(value) {
    return String(value || "")
      .trim()
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\/10\.48550\/arXiv\./i, "")
      .replace(/^doi:\s*10\.48550\/arXiv\./i, "")
      .replace(/^10\.48550\/arXiv\./i, "")
      .replace(/^arXiv:/i, "")
      .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "")
      .split(/[?#]/)[0]
      .replace(/\s+\[[^\]]+\].*$/, "")
      .split(/\s+/)[0]
      .replace(/\.pdf$/i, "")
      .replace(/v\d+$/i, "");
  }

  function pad2(value) {
    return String(value || "").padStart(2, "0");
  }

  function projectPaperDate(entry) {
    var raw = String(
      (entry && (entry.reportDate || entry.date || entry.announcementDate || entry.published || entry.updated || entry.createdAt)) ||
      ""
    );
    var match = raw.match(/\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
    if (entry && typeof entry.addedAt === "number") {
      var added = new Date(entry.addedAt);
      if (Number.isFinite(added.getTime())) {
        return added.getFullYear() + "-" + pad2(added.getMonth() + 1) + "-" + pad2(added.getDate());
      }
    }
    var now = new Date();
    return now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
  }

  function projectCollectionLabels(entry) {
    var date = projectPaperDate(entry);
    var parts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
    var year = parts[1] || String(new Date().getFullYear());
    var month = year + "." + (parts[2] || pad2(new Date().getMonth() + 1));
    var day = month + "." + (parts[3] || pad2(new Date().getDate()));
    return {
      root: "arXiv Interest Daily",
      project: "项目论文",
      year: year,
      month: month,
      day: day,
      path: ["arXiv Interest Daily", "项目论文", year, month, day].join(" / "),
    };
  }

  function getItemField(item, field) {
    try {
      return item && item.getField ? String(item.getField(field) || "") : "";
    } catch (e) {
      return "";
    }
  }

  function setItemFieldSafe(item, field, value) {
    if (!item || !item.setField || value === undefined || value === null || value === "") return false;
    try {
      item.setField(field, value);
      return true;
    } catch (e) {
      logError("skip invalid Zotero field '" + field + "': " + (e.message || e));
      return false;
    }
  }

  function itemLooksLikeProjectPaper(item, arxivId) {
    if (!item || item.deleted) return false;
    var id = baseArxivId(arxivId);
    var extra = getItemField(item, "extra");
    var archiveID = getItemField(item, "archiveID");
    var url = getItemField(item, "url");
    if (/arXiv Interest Daily:\s*project-paper/i.test(extra)) return !id || itemHasArxivId(item, id);
    if (!id) return false;
    return /arxiv-interest-daily-project-paper/i.test(extra) && itemHasArxivId(item, id);
  }

  function itemHasArxivId(item, arxivId) {
    if (!item || !arxivId) return false;
    var id = baseArxivId(arxivId);
    var archiveID = getItemField(item, "archiveID");
    var url = getItemField(item, "url");
    var doi = getItemField(item, "DOI");
    var extra = getItemField(item, "extra");
    if (baseArxivId(archiveID) === id) return true;
    if (baseArxivId(url) === id) return true;
    if (baseArxivId(doi) === id) return true;
    if (baseArxivId((extra.match(/arXiv(?:\s+Interest\s+Daily)?(?:\s+arXiv\s+ID)?\s*[:：]\s*([^\s]+)/i) || [])[1]) === id) return true;
    if (extra.indexOf("arXiv:" + id) >= 0 || extra.indexOf("arxiv.org/abs/" + id) >= 0) return true;
    return false;
  }

  function extractArxivIdsFromMarkdown(markdown) {
    var seen = {};
    var ids = [];
    var text = cleanText(markdown || "");
    var re = /(?:arXiv:\s*|arxiv\.org\/(?:abs|pdf)\/)([0-9]{4}\.[0-9]{4,5}(?:v\d+)?|[a-z-]+\/[0-9]{7}(?:v\d+)?)/ig;
    var match;
    while ((match = re.exec(text))) {
      var id = baseArxivId(match[1]);
      if (id && !seen[id]) {
        seen[id] = true;
        ids.push(id);
      }
    }
    return ids;
  }

  function cleanHeadingTitle(value) {
    return String(value || "")
      .replace(/^\s*[IVXLCDM]+\.\s*\d+\.\s*/i, "")
      .replace(/^\s*\d+\.\s*/, "")
      .replace(/\s*\[(?:评分|Score):\s*\d+\/5\]\s*$/i, "")
      .trim();
  }

  function looksLikePaperHeading(lines, index, heading) {
    if (/^[IVXLCDM]+\.\s*\d+\.\s+\S/i.test(heading || "")) return true;
    if (/^\d+\.\s+\S/.test(heading || "")) return true;
    if (/\[(?:评分|Score):\s*\d+\/5\]/i.test(heading || "")) return true;

    for (var i = index + 1; i < Math.min(lines.length, index + 10); i++) {
      var next = cleanText(lines[i] || "").trim();
      if (!next) continue;
      if (/^#{1,2}\s+/.test(next)) return false;
      if (/^###\s+/.test(next)) return false;
      if (/^\*\*arXiv\*\*\s*[:：]/i.test(next)) return true;
      if (/^\*\*(作者|分类|推荐理由|猜你喜欢理由|摘要)\*\*\s*[:：]/.test(next)) return true;
    }
    return false;
  }

  function normalizeNestedPaperLine(line) {
    return cleanText(line || "").trim().replace(/^#{2,6}\s+/, "");
  }

  function looksLikeReportSection(title) {
    return sectionStartsWith(title, [
      "今日概览",
      "今日主题",
      "猜你喜欢",
      "最相关论文",
      "论文详细列表",
      "其他相关文章速览",
      "交叉方向推荐",
      "弱相关论文速读",
      "弱相关论文速度",
      "LLM 通过但未进入",
      "其他论文",
      "其余论文",
    ]);
  }

  function scoreStars(score) {
    var n = parseInt(score, 10);
    if (!Number.isFinite(n) || n <= 0) return "";
    n = clamp(n, 1, 5);
    var out = "";
    for (var i = 1; i <= 5; i++) out += i <= n ? "★" : "☆";
    return out;
  }

  function feedbackLabel(rating) {
    if (rating === "like") return "喜欢";
    if (rating === "neutral") return "一般";
    if (rating === "dislike") return "不喜欢";
    return "";
  }

  function feedbackPhrase(entry) {
    if (!entry || !entry.rating) return "未评价";
    return entry.label || feedbackLabel(entry.rating) || entry.rating;
  }

  function shortPaperKey(arxivId, title) {
    var id = baseArxivId(arxivId);
    return id || hashText(title || "");
  }

  function textAfterHeading(heading) {
    var lines = [heading ? heading.textContent || "" : ""];
    var node = heading ? heading.nextElementSibling : null;
    while (node && node.tagName && !/^H[123]$/i.test(node.tagName)) {
      lines.push(node.textContent || "");
      node = node.nextElementSibling;
    }
    return lines.join("\n");
  }

  function extractLineValue(text, label) {
    var re = new RegExp(label + "\\s*[:：]\\s*([^\\n]+)", "i");
    var match = String(text || "").match(re);
    return match ? match[1].trim() : "";
  }

  function parseInlineLink(value) {
    var text = cleanText(value || "");
    var match = text.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
    if (match) return { label: match[1], url: match[2] };
    match = text.match(/(https?:\/\/\S+)/);
    if (match) return { label: match[1], url: match[1] };
    return { label: text, url: "" };
  }

  function parseReportMarkdown(markdown) {
    var lines = cleanText(markdown || "").split("\n");
    var report = {
      title: "",
      note: "",
      summary: [],
      sections: [],
    };
    var section = null;
    var paper = null;
    var activeField = "";

    function ensureSection(title) {
      if (!section) {
        section = { title: title || "论文", intro: [], papers: [] };
        report.sections.push(section);
      }
      return section;
    }

    function finishPaper() {
      paper = null;
      activeField = "";
    }

    for (var i = 0; i < lines.length; i++) {
      var raw = cleanText(lines[i] || "");
      var line = raw.trim();
      if (!line) continue;
      if (/^\s*---+\s*$/.test(line)) {
        finishPaper();
        continue;
      }
      if (/^#\s+/.test(line)) {
        finishPaper();
        report.title = line.replace(/^#\s+/, "").trim();
        continue;
      }
      if (/^>\s*/.test(line)) {
        report.note = line.replace(/^>\s*/, "").trim();
        continue;
      }
      if (/^##\s+/.test(line)) {
        var sectionTitle = line.replace(/^##\s+/, "").trim();
        if (paper && !looksLikeReportSection(sectionTitle)) {
          if (activeField && /^(长导读|交叉导读|摘要|猜你喜欢理由|推荐理由)$/i.test(activeField)) {
            paper.fields[activeField] = (paper.fields[activeField] ? paper.fields[activeField] + "\n" : "") + normalizeNestedPaperLine(line);
          } else {
            paper.abstract.push(normalizeNestedPaperLine(line));
          }
          continue;
        }
        finishPaper();
        section = { title: sectionTitle, intro: [], papers: [] };
        report.sections.push(section);
        continue;
      }
      if (/^###\s+/.test(line)) {
        var heading = line.replace(/^###\s+/, "").trim();
        if (!looksLikePaperHeading(lines, i, heading)) {
          if (paper) {
            var nested = normalizeNestedPaperLine(line);
            if (activeField && /^(长导读|交叉导读|摘要|猜你喜欢理由|推荐理由)$/i.test(activeField)) {
              paper.fields[activeField] = (paper.fields[activeField] ? paper.fields[activeField] + "\n" : "") + nested;
            } else {
              paper.abstract.push(nested);
            }
          } else {
            ensureSection().intro.push(normalizeNestedPaperLine(line));
          }
          continue;
        }
        var scoreMatch = heading.match(/\[(?:评分|Score):\s*([0-9]+)\/5\]/i);
        paper = {
          heading: heading,
          title: cleanHeadingTitle(heading),
          score: scoreMatch ? scoreMatch[1] : "",
          fields: {},
          tags: [],
          abstract: [],
        };
        activeField = "";
        ensureSection().papers.push(paper);
        continue;
      }

      var field = line.match(/^\*\*([^*]+)\*\*\s*[:：]\s*(.*)$/);
      if (field) {
        var key = field[1].trim();
        var value = field[2].trim();
        if (paper) {
          paper.fields[key] = value;
          activeField = key;
          if (key === "标签") {
            paper.tags = value.split(/[,，;；、]/).map(function (tag) { return tag.trim(); }).filter(Boolean);
          }
        } else {
          report.summary.push({ key: key, value: value });
        }
        continue;
      }

      if (paper) {
        if (activeField && /^(长导读|交叉导读|摘要|猜你喜欢理由|推荐理由)$/i.test(activeField)) {
          paper.fields[activeField] = (paper.fields[activeField] ? paper.fields[activeField] + "\n" : "") + normalizeNestedPaperLine(line);
        } else {
          paper.abstract.push(normalizeNestedPaperLine(line));
        }
      } else {
        ensureSection().intro.push(line);
      }
    }
    return report;
  }

  function setText(el, text) {
    el.textContent = cleanText(text || "");
    return el;
  }

  function createButton(doc, label, title, onClick) {
    var btn = doc.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.title = title || label;
    btn.style.cssText =
      "padding:3px 8px;border:1px solid ThreeDShadow;background:ButtonFace;color:ButtonText;" +
      "border-radius:3px;font:12px message-box,system-ui,sans-serif;cursor:pointer;white-space:nowrap;";
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onClick === "function") onClick(event);
    });
    return btn;
  }

  function createIconButton(doc, label, title, onClick, active) {
    var btn = doc.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.title = title || "";
    btn.setAttribute("aria-label", title || label);
    btn.style.cssText =
      "display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;" +
      "padding:0;border:1px solid ThreeDShadow;border-radius:3px;" +
      "background:" + (active ? "Highlight" : "ButtonFace") + ";" +
      "color:" + (active ? "HighlightText" : "ButtonText") + ";" +
      "font:700 13px message-box,system-ui,sans-serif;cursor:pointer;line-height:1;user-select:none;";
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onClick === "function") onClick(event, btn);
    });
    return btn;
  }

  function createInlineIconButton(doc, label, title, onClick, active) {
    var btn = createIconButton(doc, label, title, onClick, active);
    btn.style.width = "22px";
    btn.style.height = "22px";
    btn.style.borderColor = active ? "Highlight" : "ThreeDShadow";
    btn.style.borderRadius = "3px";
    btn.style.fontSize = "12px";
    btn.style.flex = "0 0 auto";
    return btn;
  }

  function createFeedbackButton(doc, label, title, active, onClick) {
    var btn = doc.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.title = title || label;
    btn.setAttribute("aria-label", title || label);
    btn.style.cssText =
      "display:inline-flex;align-items:center;justify-content:center;height:22px;" +
      "padding:0 7px;border:1px solid " + (active ? "Highlight" : "ThreeDShadow") + ";" +
      "border-radius:3px;background:" + (active ? "Highlight" : "ButtonFace") + ";" +
      "color:" + (active ? "HighlightText" : "ButtonText") + ";" +
      "font:12px message-box,system-ui,sans-serif;cursor:pointer;user-select:none;";
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onClick === "function") onClick(event, btn);
    });
    return btn;
  }

  function locateIcon(doc) {
    var span = doc.createElement("span");
    span.textContent = "⌖";
    span.style.cssText = "font-size:15px;line-height:1;";
    return span;
  }

  function nativeMissingIcon(doc, title) {
    var span = doc.createElement("span");
    span.textContent = "!";
    span.title = title || "未添加到原生分类中";
    span.setAttribute("aria-label", span.title);
    span.style.cssText =
      "display:inline-flex;align-items:center;justify-content:center;" +
      "width:15px;height:15px;min-width:15px;border:1px solid GrayText;" +
      "border-radius:50%;color:GrayText;background:transparent;" +
      "font:700 10px message-box,system-ui,sans-serif;line-height:1;" +
      "margin-top:3px;";
    return span;
  }

  function hashText(text) {
    var str = cleanText(text || "");
    var hash = 2166136261;
    for (var i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }

  function getConfigValue(path, fallback) {
    try {
      if (typeof ArxivDailyConfig !== "undefined") {
        var val = ArxivDailyConfig.get(path);
        return val !== undefined && val !== null && val !== "" ? val : fallback;
      }
    } catch (e) {}
    return fallback;
  }

  function selectionAskMode() {
    var mode = String(getConfigValue("ui.selectionAskMode", "") || "").trim();
    if (mode) return mode;
    return getConfigValue("ui.selectionAskPopup", true) === false ? "off" : "global";
  }

  function readJSON(relativePath, fallback) {
    try {
      if (typeof ArxivDailyDataDir !== "undefined") {
        var data = ArxivDailyDataDir.readJSON(relativePath);
        return data || fallback;
      }
    } catch (e) {}
    return fallback;
  }

  function saveJSON(relativePath, data) {
    try {
      return typeof ArxivDailyDataDir !== "undefined" &&
        ArxivDailyDataDir.writeJSON(relativePath, data);
    } catch (e) {
      return false;
    }
  }

  function getTextNodes(root, includeExistingHighlights) {
    var nodes = [];
    if (!root || !root.ownerDocument) return nodes;
    var doc = root.ownerDocument;
    var walker = doc.createTreeWalker(root, 4, {
      acceptNode: function (node) {
        var parent = node && node.parentNode;
        if (!parent || !node.nodeValue) return 2;
        if (parent.closest) {
          if (parent.closest("button,input,select,textarea")) return 2;
          if (!includeExistingHighlights && parent.closest(".ari-text-highlight")) return 2;
        }
        return 1;
      },
    });
    var current = walker.nextNode();
    while (current) {
      nodes.push(current);
      current = walker.nextNode();
    }
    return nodes;
  }

  function rangeIntersectsNode(range, node) {
    try {
      return range && node && range.intersectsNode(node);
    } catch (e) {
      return false;
    }
  }

  function closestHighlightBlock(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentNode;
    while (el) {
      if (el.getAttribute && el.getAttribute("data-ari-highlightable") === "true") return el;
      el = el.parentNode;
    }
    return null;
  }

  function countOccurrencesBefore(text, needle) {
    var haystack = String(text || "");
    var target = String(needle || "");
    if (!target) return 0;
    var count = 0;
    var pos = 0;
    while (true) {
      var found = haystack.indexOf(target, pos);
      if (found < 0) break;
      count++;
      pos = found + Math.max(1, target.length);
    }
    return count;
  }

  function nthIndexOf(text, needle, occurrence) {
    var haystack = String(text || "");
    var target = String(needle || "");
    var nth = Math.max(0, parseInt(occurrence, 10) || 0);
    if (!target) return -1;
    var pos = 0;
    for (var i = 0; i <= nth; i++) {
      var found = haystack.indexOf(target, pos);
      if (found < 0) return -1;
      if (i === nth) return found;
      pos = found + Math.max(1, target.length);
    }
    return -1;
  }

  function highlightSpanStyle() {
    return "background:rgba(255,224,92,.72);border-radius:2px;box-decoration-break:clone;-webkit-box-decoration-break:clone;";
  }

  function wrapTextNodeRange(doc, node, start, end, id) {
    if (!node || !node.parentNode || end <= start) return null;
    if (node.parentNode.closest && node.parentNode.closest(".ari-text-highlight")) return null;
    var len = node.nodeValue.length;
    start = clamp(start, 0, len);
    end = clamp(end, 0, len);
    if (end <= start) return null;
    var target = node;
    if (end < target.nodeValue.length) target.splitText(end);
    if (start > 0) target = target.splitText(start);
    var span = doc.createElement("span");
    span.setAttribute("class", "ari-text-highlight");
    span.setAttribute("data-ari-text-highlight-id", id || "");
    span.style.cssText = highlightSpanStyle();
    target.parentNode.insertBefore(span, target);
    span.appendChild(target);
    return span;
  }

  function wrapBlockOffsets(doc, block, start, end, id) {
    if (!block || end <= start) return false;
    var nodes = getTextNodes(block, true);
    var pos = 0;
    var wrapped = false;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var len = node.nodeValue.length;
      var nodeStart = pos;
      var nodeEnd = pos + len;
      pos = nodeEnd;
      if (nodeEnd <= start || nodeStart >= end) continue;
      if (node.parentNode && node.parentNode.closest && node.parentNode.closest(".ari-text-highlight")) continue;
      var localStart = Math.max(0, start - nodeStart);
      var localEnd = Math.min(len, end - nodeStart);
      if (wrapTextNodeRange(doc, node, localStart, localEnd, id)) wrapped = true;
    }
    return wrapped;
  }

  function copyText(text) {
    var value = cleanText(text || "");
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value);
        return true;
      }
    } catch (e) {}
    try {
      if (typeof Components !== "undefined" &&
          Components.classes &&
          Components.classes["@mozilla.org/widget/clipboardhelper;1"]) {
        Components.classes["@mozilla.org/widget/clipboardhelper;1"]
          .getService(Components.interfaces.nsIClipboardHelper)
          .copyString(value);
        return true;
      }
    } catch (e2) {}
    return false;
  }

  function findPaperSection(markdown, paperIdOrTitle) {
    var target = String(paperIdOrTitle || "").toLowerCase();
    if (!target) return markdown;
    var lines = String(markdown || "").split(/\r?\n/);
    var sections = [];
    var current = null;
    var currentSectionTitle = "";

    for (var i = 0; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i])) {
        currentSectionTitle = stripSectionPrefix(lines[i].replace(/^##\s+/, "").trim());
        if (current) {
          sections.push(current);
          current = null;
        }
      } else if (/^###\s+/.test(lines[i])) {
        if (current) sections.push(current);
        current = { title: lines[i], sectionTitle: currentSectionTitle, lines: [lines[i]] };
      } else if (current) {
        current.lines.push(lines[i]);
      }
    }
    if (current) sections.push(current);

    for (var s = 0; s < sections.length; s++) {
      var text = sections[s].lines.join("\n");
      if (text.toLowerCase().indexOf(target) >= 0 ||
          baseArxivId(text).toLowerCase().indexOf(target) >= 0) {
        if (sections[s].sectionTitle) {
          var selected = sections[s].lines.slice();
          selected.splice(1, 0, "", "**所在板块**: " + sections[s].sectionTitle);
          return selected.join("\n");
        }
        return text;
      }
    }
    return markdown;
  }

  function findPaperSectionTitle(markdown, paperIdOrTitle) {
    var target = String(paperIdOrTitle || "").toLowerCase();
    if (!target) return "";
    var lines = String(markdown || "").split(/\r?\n/);
    var currentSectionTitle = "";
    var current = null;

    function matches(block) {
      if (!block) return false;
      var text = block.lines.join("\n");
      return text.toLowerCase().indexOf(target) >= 0 ||
        baseArxivId(text).toLowerCase().indexOf(target) >= 0;
    }

    for (var i = 0; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i])) {
        if (matches(current)) return current.sectionTitle || "";
        currentSectionTitle = stripSectionPrefix(lines[i].replace(/^##\s+/, "").trim());
        current = null;
      } else if (/^###\s+/.test(lines[i])) {
        if (matches(current)) return current.sectionTitle || "";
        current = { sectionTitle: currentSectionTitle, lines: [lines[i]] };
      } else if (current) {
        current.lines.push(lines[i]);
      }
    }
    return matches(current) ? (current.sectionTitle || "") : "";
  }

  function appendLabeledText(doc, parent, labelText, bodyText, options) {
    var text = cleanText(bodyText || "").trim();
    if (!text) return null;
    options = options || {};
    var block = doc.createElement(options.inline ? "p" : "div");
    block.style.cssText =
      (options.inline ? "margin:4px 0;" : "margin:10px 0;") +
      "white-space:pre-wrap;word-break:break-word;color:CanvasText;" +
      (options.guide ? "line-height:1.62;" : "");
    var label = doc.createElement("strong");
    label.textContent = labelText + (options.inline ? "：" : "");
    if (options.inline) {
      block.appendChild(label);
      block.appendChild(doc.createTextNode(text));
    } else {
      var header = doc.createElement("div");
      header.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:3px;";
      header.appendChild(label);
      var body = doc.createElement("div");
      body.style.cssText = "margin-top:3px;";
      var bodyContent = doc.createElement("div");
      bodyContent.textContent = text;
      bodyContent.style.cssText = "white-space:pre-wrap;word-break:break-word;";
      body.appendChild(bodyContent);
      if (options.collapsible) {
        var toggle = doc.createElement("button");
        toggle.type = "button";
        var bottom = doc.createElement("button");
        bottom.type = "button";
        var hint = doc.createElement("span");
        hint.style.cssText = "color:GrayText;font-size:11px;";
        function styleToggle(btn) {
          btn.style.cssText =
            "height:21px;padding:0 7px;border:1px solid ThreeDShadow;border-radius:4px;" +
            "background:ButtonFace;color:ButtonText;font:11px message-box,system-ui,sans-serif;cursor:pointer;white-space:nowrap;";
        }
        function setCollapsed(collapsed) {
          body.style.display = collapsed ? "none" : "block";
          toggle.textContent = collapsed ? "▸ 展开" : "▾ 收起";
          toggle.title = collapsed ? "展开查看" + labelText : "收起" + labelText;
          bottom.textContent = "收起" + labelText;
          bottom.title = "收起" + labelText;
          hint.textContent = collapsed ? "已收起" : "";
          hint.style.display = collapsed ? "inline" : "none";
          refreshReaderZoomLater(doc);
        }
        styleToggle(toggle);
        styleToggle(bottom);
        bottom.style.marginTop = "8px";
        toggle.addEventListener("click", function (event) {
          event.preventDefault();
          setCollapsed(body.style.display !== "none");
        });
        bottom.addEventListener("click", function (event) {
          event.preventDefault();
          setCollapsed(true);
          if (header && header.scrollIntoView) header.scrollIntoView({ block: "nearest" });
        });
        body.appendChild(bottom);
        setCollapsed(!!options.collapsed);
        header.appendChild(toggle);
        header.appendChild(hint);
      }
      block.appendChild(header);
      block.appendChild(body);
    }
    parent.appendChild(block);
    return block;
  }

  function paperKeysFromReport(markdown) {
    var report = parseReportMarkdown(markdown || "");
    var keys = {};
    for (var s = 0; s < report.sections.length; s++) {
      var papers = report.sections[s].papers || [];
      for (var p = 0; p < papers.length; p++) {
        var arxiv = parseInlineLink(papers[p].fields.arXiv || "");
        var arxivId = baseArxivId(arxiv.label || arxiv.url);
        var key = shortPaperKey(arxivId, papers[p].title || papers[p].heading);
        if (key) keys[key] = true;
      }
    }
    return keys;
  }

  globalThis.ArxivDailyCenterWorkspace = {
    _win: null,
    _doc: null,
    _host: null,
    _hostOldPosition: "",
    _viewer: null,
    _viewerBackButton: null,
    _viewerTitle: null,
    _viewerContent: null,
    _viewerOutline: null,
    _viewerOutlineResizer: null,
    _viewerBody: null,
    _feedbackStatus: null,
    _feedbackFlashTimer: null,
    _dock: null,
    _dockResize: null,
    _splitter: null,
    _panes: {},
    _visiblePanels: {},
    _dockHeight: DEFAULT_DOCK_HEIGHT,
    _splitRatio: DEFAULT_SPLIT_RATIO,
    _heightDrag: null,
    _splitDrag: null,
    _currentTitle: "",
    _currentMarkdown: "",
    _currentMeta: null,
    _currentTopText: "",
    _selectionAskEnabled: true,
    _selectionAskPopup: null,
    _selectionAskContext: "",
    _currentReportDate: "",
    _currentReportText: "",
    _viewerHistory: [],
    _suppressHistoryPush: false,
    _readerFontSize: 13,
    _readerFontFamily: "message-box, system-ui, sans-serif",
    _readerZoom: 1,
    _highlightIndex: null,
    _feedbackIndex: null,
    _reportSectionCollapseState: {},
    _nativeRestoreHandler: null,
    _suppressNativeRestoreUntil: 0,
    _docSelectionAskHandler: null,
    _projectObserverID: null,
    _projectSyncTimer: null,
    _suppressProjectObserver: false,
    _projectItemCreation: {},
    _projectItemCancelled: {},
    _readerOutlineWidth: 210,
    _outlineTargets: [],
    _outlineScrollHandler: null,

    init: function (win) {
      if (this._host) return;
      this._win = win;
      this._doc = win.document;
      this._dockHeight = clamp(
        parseInt(getPref("centerDockHeight", DEFAULT_DOCK_HEIGHT), 10) || DEFAULT_DOCK_HEIGHT,
        MIN_DOCK_HEIGHT,
        MAX_DOCK_HEIGHT
      );
      this._splitRatio = clamp(
        parseFloat(getPref("centerDockSplitRatio", DEFAULT_SPLIT_RATIO)) || DEFAULT_SPLIT_RATIO,
        0.25,
        0.75
      );
      this._readerFontSize = clamp(parseInt(getPref("readerFontSize", getConfigValue("ui.readerFontSize", 13)), 10) || 13, 11, 20);
      this._readerFontFamily = getPref("readerFontFamily", getConfigValue("ui.readerFontFamily", "message-box, system-ui, sans-serif"));
      this._readerZoom = clamp(parseFloat(getPref("readerZoom", 1)) || 1, 0.7, 1.8);
      this._readerOutlineWidth = clamp(parseInt(getPref("readerOutlineWidth", 210), 10) || 210, 140, 360);
      this._selectionAskEnabled = selectionAskMode() !== "off";

      this._host = promoteCenterHost(findCenterHost(this._doc));
      if (!this._host) {
        logError("center workspace: host not found");
        return;
      }
      this._hostOldPosition = this._host.style.position || "";
      var pos = "";
      try { pos = win.getComputedStyle(this._host).position; } catch (e) {}
      if (!pos || pos === "static") this._host.style.position = "relative";

      this._createViewer();
      this._createDock();
      this._host.appendChild(this._viewer);
      this._host.appendChild(this._dock);
      this._installNativeRestoreHooks();
      this._installDocumentSelectionAskHooks();
      this._registerProjectPaperObserver();
      this._updateLayout();
      log("center workspace initialized");
    },

    destroy: function () {
      this._removeDragHandlers();
      this._removeNativeRestoreHooks();
      this._removeDocumentSelectionAskHooks();
      this._unregisterProjectPaperObserver();
      this._removeSelectionAskPopup();
      this._removeEl(this._viewer);
      this._removeEl(this._dock);
      if (this._host) this._host.style.position = this._hostOldPosition || "";
      this._host = null;
      this._viewer = null;
      this._viewerTitle = null;
      this._viewerContent = null;
      this._viewerOutline = null;
      this._viewerOutlineResizer = null;
      this._viewerBody = null;
      this._selectionAskPopup = null;
      this._selectionAskContext = "";
      this._docSelectionAskHandler = null;
      this._dock = null;
      this._panes = {};
      this._visiblePanels = {};
      this._currentTitle = "";
      this._currentMarkdown = "";
      this._currentMeta = null;
    },

    mountPanel: function (id, title, node, side) {
      if (!this._host) {
        var win = Zotero.getMainWindow();
        if (win) this.init(win);
      }
      if (!this._dock || !node) return null;
      if (!this._panes[id]) {
        var pane = this._doc.createElement("div");
        pane.setAttribute("data-ari-panel", id);
        pane.setAttribute("data-ari-side", side || "left");
        pane.style.cssText =
          "display:none;min-width:0;height:100%;box-sizing:border-box;" +
          "overflow:hidden;background:Canvas;color:CanvasText;";
        this._panes[id] = pane;
        this._dock.appendChild(pane);
      }
      var target = this._panes[id];
      if (node.parentNode !== target) {
        target.appendChild(node);
      }
      node.style.display = "flex";
      node.style.position = "static";
      node.style.left = "";
      node.style.right = "";
      node.style.bottom = "";
      node.style.width = "100%";
      node.style.height = "100%";
      node.style.boxShadow = "none";
      return target;
    },

    showPanel: function (id) {
      this._visiblePanels[id] = true;
      this._updateLayout();
    },

    hidePanel: function (id) {
      delete this._visiblePanels[id];
      this._updateLayout();
    },

    isPanelVisible: function (id) {
      return !!this._visiblePanels[id];
    },

    showReport: function (dateStr, options) {
      options = options || {};
      var markdown = "";
      var title = dateStr || "Report";
      if (typeof ArxivDailyReportStore !== "undefined" && dateStr) {
        markdown = ArxivDailyReportStore.loadReport(dateStr) || "";
        var reports = ArxivDailyReportStore.listReports();
        for (var i = 0; i < reports.length; i++) {
          if (reports[i].date === dateStr && reports[i].fileName) {
            title = reports[i].fileName;
            break;
          }
        }
      }
      var fullMarkdown = markdown || "";
      if (options.paperId || options.title) {
        markdown = findPaperSection(markdown, options.paperId || options.title);
      }
      this.showMarkdown(title, markdown || "Report not found.", {
        date: dateStr,
        paperId: options.paperId || "",
        fullMarkdown: fullMarkdown,
      });
    },

    showProjectPaper: function (paper) {
      paper = paper || {};
      var id = baseArxivId(paper.arxivId || paper.id || paper.paperId);
      var sectionTitle = paper.sectionTitle || paper.reportSection || paper.recommendationSection || "";
      if (!sectionTitle && (paper.reportDate || paper.date) && typeof ArxivDailyReportStore !== "undefined") {
        try {
          var reportText = ArxivDailyReportStore.loadReport(paper.reportDate || paper.date) || "";
          sectionTitle = findPaperSectionTitle(reportText, id || paper.title || "");
        } catch (e) {}
      }
      var lines = [
        "# 项目论文",
        "",
        "### " + (paper.title || id || "Project paper"),
        "",
      ];
      if (paper.authors) lines.push("**作者**: " + paper.authors);
      if (id) lines.push("**arXiv**: [" + id + "](https://arxiv.org/abs/" + id + ")");
      if (paper.primaryCategory) lines.push("**分类**: " + paper.primaryCategory);
      if (paper.reportDate) lines.push("**来源报告**: " + paper.reportDate);
      if (sectionTitle) lines.push("**所在板块**: " + sectionTitle);
      if (paper.recommendation) lines.push("**推荐理由**: " + paper.recommendation);
      if (paper.abstract) {
        lines.push("");
        lines.push(paper.abstract);
      }
      this.showMarkdown(paper.title || id || "项目论文", lines.join("\n"), {
        projectPaper: true,
        paperId: id,
        date: paper.reportDate || paper.date || "",
      });
    },

    showMarkdown: function (title, markdown, meta, options) {
      options = options || {};
      if (!this._viewer) {
        var win = Zotero.getMainWindow();
        if (win) this.init(win);
      }
      if (!this._viewer) return;
      if (!options.noHistory) this._pushViewerHistory();
      this._currentTitle = safeTitle(title, "Report");
      this._currentMarkdown = cleanText(markdown || "");
      this._currentMeta = meta || {};
      this._currentTopText = this._currentMarkdown;
      this._removeSelectionAskPopup();
      if (this._currentMeta && this._currentMeta.date && !this._currentMeta.projectPaper) {
        this._currentReportDate = String(this._currentMeta.date || "");
        this._currentReportText = cleanText(this._currentMeta.fullMarkdown || this._currentMarkdown || "");
      }
      this._viewerTitle.textContent = this._currentTitle;
      try {
        this._renderMarkdownReport(this._currentMarkdown, this._currentMeta);
      } catch (renderErr) {
        logError("showMarkdown render failed: " + (renderErr.message || renderErr));
        this._renderPlainMarkdown(this._currentMarkdown || "Report not found.");
      }
      this._viewer.style.display = "flex";
      this._viewer.setAttribute("data-ari-top-readable", "true");
      this._updateViewerNav();
      this._updateLayout();
    },

    hideViewer: function (options) {
      options = options || {};
      this._removeSelectionAskPopup();
      if (!options.keepHistory) this._viewerHistory = [];
      if (this._viewer) {
        this._viewer.style.display = "none";
        this._viewer.removeAttribute("data-ari-top-readable");
      }
      this._currentTopText = "";
      this._updateViewerNav();
    },

    _pushViewerHistory: function () {
      if (!this._viewer || this._viewer.style.display === "none") return;
      if (!this._currentMarkdown) return;
      var state = {
        title: this._currentTitle,
        markdown: this._currentMarkdown,
        meta: this._currentMeta || {},
      };
      var last = this._viewerHistory[this._viewerHistory.length - 1];
      if (last && last.title === state.title && last.markdown === state.markdown) return;
      this._viewerHistory.push(state);
      if (this._viewerHistory.length > 30) this._viewerHistory.shift();
    },

    _goBack: function () {
      if (!this._viewerHistory.length) return false;
      var state = this._viewerHistory.pop();
      this.showMarkdown(state.title, state.markdown, state.meta || {}, { noHistory: true });
      return true;
    },

    _closeViewer: function () {
      this._viewerHistory = [];
      this._currentReportDate = "";
      this._currentReportText = "";
      this._currentTitle = "";
      this._currentMarkdown = "";
      this._currentMeta = null;
      this._currentTopText = "";
      this.hideViewer();
      if (this._viewerTitle) this._viewerTitle.textContent = "";
      if (this._viewerBody) {
        while (this._viewerBody.firstChild) this._viewerBody.removeChild(this._viewerBody.firstChild);
      }
      if (this._viewerOutline) {
        while (this._viewerOutline.firstChild) this._viewerOutline.removeChild(this._viewerOutline.firstChild);
      }
      this._scheduleNativeItemPaneRestore();
    },

    _scheduleNativeItemPaneRestore: function () {
      var self = this;
      var win = this._win || (typeof Zotero !== "undefined" && Zotero.getMainWindow ? Zotero.getMainWindow() : null);
      if (!win || !win.setTimeout) return;
      [0, 80, 240].forEach(function (delay) {
        win.setTimeout(function () {
          try { self._restoreNativeItemPane(); } catch (e) {}
        }, delay);
      });
    },

    _restoreNativeItemPane: function () {
      var win = this._win || (typeof Zotero !== "undefined" && Zotero.getMainWindow ? Zotero.getMainWindow() : null);
      var doc = this._doc || (win && win.document);
      if (!win || !doc) return;
      try {
        if (win.Zotero_Tabs && win.Zotero_Tabs.selectedType && win.Zotero_Tabs.parseTabType) {
          var tab = win.Zotero_Tabs.parseTabType(win.Zotero_Tabs.selectedType);
          if (tab && tab.tabContentType && tab.tabContentType !== "library") return;
        }
      } catch (tabErr) {}

      var pane = win.ZoteroPane || (typeof ZoteroPane !== "undefined" ? ZoteroPane : null);
      if (!pane) return;
      var items = [];
      try {
        if (pane.getSelectedItems) items = pane.getSelectedItems() || [];
      } catch (itemsErr) {}
      if (!items || !items.length) return;

      var itemPane = doc.getElementById("zotero-item-pane") || doc.getElementById("zotero-editpane");
      if (itemPane) {
        try {
          var wasClosed = itemPane.getAttribute("collapsed") === "true" ||
            itemPane.getAttribute("hidden") === "true";
          itemPane.removeAttribute("hidden");
          itemPane.removeAttribute("collapsed");
          if (typeof itemPane.collapsed !== "undefined") itemPane.collapsed = false;
          if (wasClosed && itemPane.getBoundingClientRect &&
              (itemPane.getBoundingClientRect().width || 0) < 220) {
            itemPane.setAttribute("width", "320");
            itemPane.style.width = "320px";
          }
        } catch (paneErr) {}
      }
      var splitter = doc.getElementById("zotero-items-splitter");
      if (splitter) {
        try {
          splitter.removeAttribute("hidden");
          if (splitter.getAttribute("state") === "collapsed") splitter.setAttribute("state", "open");
        } catch (splitErr) {}
      }

      var first = items[0] || {};
      var itemID = first.id || first.itemID || first.key || null;
      try {
        if (pane.itemPane) {
          if (typeof pane.itemPane.setItems === "function") pane.itemPane.setItems(items);
          if (typeof pane.itemPane.render === "function") pane.itemPane.render();
          if (typeof pane.itemPane.refresh === "function") pane.itemPane.refresh();
        }
      } catch (itemPaneErr) {}
      try {
        if (pane.itemsView && typeof pane.itemsView.onSelect === "function") pane.itemsView.onSelect();
      } catch (selectErr) {}
      try {
        if (typeof pane.updateItemPane === "function") pane.updateItemPane();
      } catch (updateErr) {}
      try {
        if (itemID && typeof pane.selectItem === "function") {
          var selected = pane.selectItem(itemID);
          if (selected && typeof selected.catch === "function") selected.catch(function () {});
        }
      } catch (reselectErr) {}
    },

    _updateViewerNav: function () {
      if (!this._viewerBackButton) return;
      var enabled = !!(this._viewerHistory && this._viewerHistory.length);
      if (enabled) {
        this._viewerBackButton.removeAttribute("disabled");
        this._viewerBackButton.style.opacity = "1";
        this._viewerBackButton.style.cursor = "pointer";
      } else {
        this._viewerBackButton.setAttribute("disabled", "true");
        this._viewerBackButton.style.opacity = ".45";
        this._viewerBackButton.style.cursor = "default";
      }
    },

    _reportSectionCollapseKey: function (meta, sectionTitle, sectionIndex) {
      var date = meta && meta.date ? meta.date : (this._currentReportDate || this._currentTitle || "");
      return [date, sectionIndex, sectionTitle || ""].join("|");
    },

    _getReportSectionCollapsed: function (key, defaultValue) {
      if (!key || !this._reportSectionCollapseState) return !!defaultValue;
      if (Object.prototype.hasOwnProperty.call(this._reportSectionCollapseState, key)) {
        return !!this._reportSectionCollapseState[key];
      }
      return !!defaultValue;
    },

    _setReportSectionCollapsed: function (key, collapsed) {
      if (!key) return;
      if (!this._reportSectionCollapseState) this._reportSectionCollapseState = {};
      this._reportSectionCollapseState[key] = !!collapsed;
    },

    suppressNativeRestore: function (durationMs) {
      var until = Date.now() + Math.max(0, parseInt(durationMs, 10) || 900);
      if (until > (this._suppressNativeRestoreUntil || 0)) {
        this._suppressNativeRestoreUntil = until;
      }
    },

    _installNativeRestoreHooks: function () {
      var doc = this._doc;
      if (!doc || this._nativeRestoreHandler) return;
      function pluginOwnedTarget(event) {
        try {
          var nodes = [];
          if (event && typeof event.composedPath === "function") {
            try { nodes = event.composedPath() || []; } catch (pathErr) { nodes = []; }
          }
          if (!nodes.length && event && event.target) {
            var node = event.target;
            for (var depth = 0; node && depth < 14; depth++) {
              nodes.push(node);
              node = node.parentNode || node.parentElement;
            }
          }
          for (var i = 0; i < nodes.length; i++) {
            var item = nodes[i];
            if (!item || item.nodeType !== 1) continue;
            if (item.closest && item.closest(
              "#arxiv-daily-center-viewer,#arxiv-daily-center-dock,#arxiv-daily-left-panels," +
              "#arxiv-daily-qa-sidebar,#arxiv-daily-qa-tab-btn,.ari-qa-selection-popup," +
              "[id^='arxiv-daily-'],[id^='ari-btn-'],[id^='menu-ari-'],.arxiv-daily-btn"
            )) {
              return true;
            }
            var id = String(item.id || "");
            var cls = "";
            try {
              cls = typeof item.className === "string"
                ? item.className
                : item.className && item.className.baseVal || "";
            } catch (classErr) {}
            if (/^(arxiv-daily|ari-btn|menu-ari)-/i.test(id) || /\barxiv-daily-/.test(String(cls || ""))) {
              return true;
            }
          }
        } catch (e) {}
        return false;
      }
      function nativeLibraryTarget(event) {
        try {
          if (pluginOwnedTarget(event)) return false;
          var nodes = [];
          if (event && typeof event.composedPath === "function") {
            try { nodes = event.composedPath() || []; } catch (pathErr) { nodes = []; }
          }
          if (!nodes.length && event && event.target) {
            var node = event.target;
            for (var depth = 0; node && depth < 14; depth++) {
              nodes.push(node);
              node = node.parentNode || node.parentElement;
            }
          }
          for (var i = 0; i < nodes.length; i++) {
            var item = nodes[i];
            if (!item || item.nodeType !== 1) continue;
            if (item.closest && (item.closest("#arxiv-daily-center-viewer") ||
                item.closest("#arxiv-daily-center-dock") ||
                item.closest("#arxiv-daily-left-panels"))) {
              return false;
            }
            var id = String(item.id || "").toLowerCase();
            var cls = "";
            try {
              cls = typeof item.className === "string"
                ? item.className
                : item.className && item.className.baseVal || "";
            } catch (classErr) {}
            var role = String(item.getAttribute && item.getAttribute("role") || "").toLowerCase();
            var text = id + " " + String(cls || "").toLowerCase() + " " + role;
            if (/zotero-(collections|items|tabs)|collection-tree|items-tree|tab-bar|tabs-toolbar|title-bar/.test(text) ||
                role === "tree" || role === "treeitem" || role === "tab" || role === "tablist") {
              return true;
            }
          }
        } catch (e) {}
        return false;
      }
      this._nativeRestoreHandler = function (event) {
        try {
          if (!ArxivDailyCenterWorkspace._viewer ||
              ArxivDailyCenterWorkspace._viewer.style.display === "none") return;
          if ((ArxivDailyCenterWorkspace._suppressNativeRestoreUntil || 0) > Date.now()) return;
          if (pluginOwnedTarget(event)) {
            if (event && event.type === "mousedown" &&
                typeof ArxivDailyCenterWorkspace.suppressNativeRestore === "function") {
              ArxivDailyCenterWorkspace.suppressNativeRestore(1400);
            }
            return;
          }
          var target = event.target;
          if (!target || !target.closest) return;
          if (target.closest("#arxiv-daily-center-viewer") ||
              target.closest("#arxiv-daily-center-dock") ||
              target.closest("#arxiv-daily-left-panels")) {
            return;
          }
          if (nativeLibraryTarget(event) ||
              target.closest("#zotero-items-tree") ||
              target.closest("#zotero-collections-tree") ||
              target.closest("#zotero-items-toolbar") ||
              target.closest("#zotero-collections-pane") ||
              target.closest("#zotero-items-pane") ||
              target.closest("tab") ||
              target.closest("#zotero-tabs-toolbar") ||
              target.closest("#zotero-title-bar") ||
              target.closest("#tab-bar-container") ||
              target.closest("#zotero-tabs-wrapper")) {
            ArxivDailyCenterWorkspace._closeViewer();
          }
        } catch (e) {}
      };
      doc.addEventListener("mousedown", this._nativeRestoreHandler, true);
      doc.addEventListener("command", this._nativeRestoreHandler, true);
      doc.addEventListener("TabSelect", this._nativeRestoreHandler, true);
      doc.addEventListener("select", this._nativeRestoreHandler, true);
    },

    _removeNativeRestoreHooks: function () {
      if (!this._doc || !this._nativeRestoreHandler) return;
      this._doc.removeEventListener("mousedown", this._nativeRestoreHandler, true);
      this._doc.removeEventListener("command", this._nativeRestoreHandler, true);
      this._doc.removeEventListener("TabSelect", this._nativeRestoreHandler, true);
      this._doc.removeEventListener("select", this._nativeRestoreHandler, true);
      this._nativeRestoreHandler = null;
    },

    _installDocumentSelectionAskHooks: function () {
      var doc = this._doc;
      if (!doc || this._docSelectionAskHandler) return;
      var self = this;
      this._docSelectionAskHandler = function (event) {
        try {
          if (!self._viewer || self._viewer.style.display === "none") return;
          if (event && event.target && event.target.closest &&
              event.target.closest("#arxiv-daily-qa-sidebar,.ari-qa-selection-popup,button,input,textarea,select")) {
            return;
          }
          setTimeout(function () { self._maybeShowSelectionAsk(event); }, 0);
        } catch (e) {}
      };
      doc.addEventListener("mouseup", this._docSelectionAskHandler, true);
      doc.addEventListener("keyup", this._docSelectionAskHandler, true);
    },

    _removeDocumentSelectionAskHooks: function () {
      if (!this._doc || !this._docSelectionAskHandler) return;
      this._doc.removeEventListener("mouseup", this._docSelectionAskHandler, true);
      this._doc.removeEventListener("keyup", this._docSelectionAskHandler, true);
      this._docSelectionAskHandler = null;
    },

    _registerProjectPaperObserver: function () {
      if (this._projectObserverID || typeof Zotero === "undefined" || !Zotero.Notifier) return;
      try {
        this._projectObserverID = Zotero.Notifier.registerObserver({
          notify: function (event, type, ids) {
            if (ArxivDailyCenterWorkspace._suppressProjectObserver) return;
            if (type === "item") {
              if (!/^(trash|delete|erase|modify)$/i.test(String(event || ""))) return;
              ArxivDailyCenterWorkspace._scheduleProjectPaperSync(ids || [], event);
              return;
            }
            if (type === "collection") {
              if (!/^(trash|delete|erase|modify|remove)$/i.test(String(event || ""))) return;
              ArxivDailyCenterWorkspace._scheduleProjectPaperCollectionSync(ids || [], event);
            }
          },
        }, ["item", "collection"], "arxiv-interest-daily-project-paper-sync", 100);
      } catch (err) {
        logError("register project paper observer failed: " + (err.message || err));
      }
    },

    _unregisterProjectPaperObserver: function () {
      if (!this._projectObserverID || typeof Zotero === "undefined" || !Zotero.Notifier) return;
      try { Zotero.Notifier.unregisterObserver(this._projectObserverID); } catch (e) {}
      this._projectObserverID = null;
    },

    _scheduleProjectPaperSync: function (ids, event) {
      var self = this;
      if (this._projectSyncTimer) clearTimeout(this._projectSyncTimer);
      this._projectSyncTimer = setTimeout(function () {
        self._projectSyncTimer = null;
        self._syncProjectPapersAfterItemEvent(ids || [], event || "");
      }, 120);
    },

    _scheduleProjectPaperCollectionSync: function (ids, event) {
      var self = this;
      if (this._projectSyncTimer) clearTimeout(this._projectSyncTimer);
      this._projectSyncTimer = setTimeout(function () {
        self._projectSyncTimer = null;
        self._syncProjectPapersAfterCollectionEvent(ids || [], event || "");
      }, 160);
    },

    _syncProjectPapersAfterCollectionEvent: function (ids, event) {
      try {
        var changed = this._pruneDeletedProjectEntriesSync({ pruneMissingCollections: true });
        if (changed) this._refreshProjectStateViews();
      } catch (err) {
        logError("sync project papers after collection event failed: " + (err.message || err));
      }
    },

    _syncProjectPapersAfterItemEvent: function (ids, event) {
      if (typeof ArxivDailyDataDir === "undefined") return;
      try {
        ids = (ids || []).map(function (id) { return parseInt(id, 10); }).filter(Boolean);
        if (!ids.length) return;
        var idSet = {};
        for (var x = 0; x < ids.length; x++) idSet[ids[x]] = true;
        var eventArxivIDs = {};
        for (var ev = 0; ev < ids.length; ev++) {
          try {
            var eventItem = Zotero.Items && Zotero.Items.get ? Zotero.Items.get(ids[ev]) : null;
            if (!eventItem) continue;
            var eventExtra = getItemField(eventItem, "extra");
            var eventID = baseArxivId(getItemField(eventItem, "archiveID")) ||
              baseArxivId(getItemField(eventItem, "url")) ||
              baseArxivId(getItemField(eventItem, "DOI")) ||
              baseArxivId((eventExtra.match(/arXiv(?:\s+Interest\s+Daily)?(?:\s+arXiv\s+ID)?\s*[:：]\s*([^\s]+)/i) || [])[1]);
            var eventLooksManaged = /arXiv Interest Daily:\s*project-paper/i.test(eventExtra) ||
              /arxiv-interest-daily-project-paper/i.test(eventExtra) ||
              itemLooksLikeProjectPaper(eventItem, eventID) ||
              this._itemInArxivDailyProjectCollection(eventItem);
            if (eventID && eventLooksManaged) {
              eventArxivIDs[eventID] = true;
            }
          } catch (eventItemErr) {}
        }
        var index = ArxivDailyDataDir.readJSON("project-papers/index.json");
        if (!Array.isArray(index) || !index.length) return;
        var next = [];
        var removed = [];
        for (var i = 0; i < index.length; i++) {
          var entry = index[i];
          var mainID = parseInt(entry.zoteroItemID || entry.itemID || entry.zoteroItemId || 0, 10);
          var entryArxivID = baseArxivId(entry.arxivId || entry.id || entry.paperId);
          var shouldRemove = false;
          if (mainID && idSet[mainID]) {
            if (/^(trash|delete|erase)$/i.test(String(event || ""))) {
              shouldRemove = true;
            } else {
              var item = null;
              try {
                item = Zotero.Items && Zotero.Items.get ? Zotero.Items.get(mainID) : null;
              } catch (e) {}
              shouldRemove = !item || !!item.deleted;
            }
          }
          if (!shouldRemove && entryArxivID && eventArxivIDs[entryArxivID] &&
              /^(trash|delete|erase)$/i.test(String(event || ""))) {
            shouldRemove = true;
          }
          if (shouldRemove) removed.push(entry);
          else next.push(entry);
        }
        if (!removed.length) {
          if (this._pruneDeletedProjectEntriesSync()) this._refreshProjectStateViews();
          return;
        }
        ArxivDailyDataDir.writeJSON("project-papers/index.json", next);
        this._refreshProjectStateViews();
      } catch (err) {
        logError("sync project papers after Zotero item event failed: " + (err.message || err));
      }
    },

    _pruneDeletedProjectEntriesSync: function () {
      var options = {};
      if (arguments.length && typeof arguments[0] === "object") options = arguments[0] || {};
      if (typeof ArxivDailyDataDir === "undefined" || typeof Zotero === "undefined" || !Zotero.Items) return 0;
      try {
        var index = ArxivDailyDataDir.readJSON("project-papers/index.json");
        if (!Array.isArray(index) || !index.length) return 0;
        var next = [];
        var removed = 0;
        for (var i = 0; i < index.length; i++) {
          var entry = index[i] || {};
          var mainID = parseInt(entry.zoteroItemID || entry.itemID || entry.zoteroItemId || 0, 10);
          var collectionID = parseInt(entry.collectionID || 0, 10);
          if (collectionID && !this._collectionExists(collectionID)) {
            removed++;
            continue;
          }
          if (!mainID) {
            next.push(entry);
            continue;
          }
          var item = null;
          try {
            item = Zotero.Items.get ? Zotero.Items.get(mainID) : null;
          } catch (e) {}
          if (!item || item.deleted) {
            removed++;
          } else {
            if (collectionID && options.pruneMissingCollections) {
              var collections = [];
              try { collections = item.getCollections ? (item.getCollections() || []) : []; } catch (collectionErr) {}
              var inCollection = false;
              for (var c = 0; c < collections.length; c++) {
                if (parseInt(collections[c], 10) === collectionID) {
                  inCollection = true;
                  break;
                }
              }
              if (!inCollection) {
                removed++;
                continue;
              }
            } else if (!collectionID && options.pruneMissingCollections &&
                itemLooksLikeProjectPaper(item, baseArxivId(entry.arxivId || entry.id || entry.paperId)) &&
                !this._itemInArxivDailyProjectCollection(item)) {
              removed++;
              continue;
            }
            next.push(entry);
          }
        }
        if (removed) ArxivDailyDataDir.writeJSON("project-papers/index.json", next);
        return removed;
      } catch (err) {
        logError("prune deleted project entries failed: " + (err.message || err));
      }
      return 0;
    },

    _refreshProjectStateViews: function () {
      try {
        if (typeof ArxivDailyLeftPane !== "undefined") ArxivDailyLeftPane.refreshProjects();
      } catch (e) {}
      try {
        if (this._currentMarkdown && this._viewer && this._viewer.style.display !== "none") {
          this._rerenderCurrentMarkdownPreservingScroll();
        }
      } catch (renderErr) {
        logError("refresh project state views failed: " + (renderErr.message || renderErr));
      }
    },

    _rerenderCurrentMarkdownPreservingScroll: function () {
      if (!this._viewerBody || !this._currentMarkdown) {
        this._renderMarkdownReport(this._currentMarkdown, this._currentMeta || {});
        return;
      }
      var scrollTop = this._viewerBody.scrollTop || 0;
      var scrollLeft = this._viewerBody.scrollLeft || 0;
      this._renderMarkdownReport(this._currentMarkdown, this._currentMeta || {});
      this._viewerBody.scrollTop = Math.min(scrollTop, Math.max(0, this._viewerBody.scrollHeight - this._viewerBody.clientHeight));
      this._viewerBody.scrollLeft = scrollLeft;
    },

    openReportInNewWindow: function (dateStr) {
      var win = Zotero.getMainWindow();
      if (!win || typeof ArxivDailyReportStore === "undefined") return;
      var markdown = ArxivDailyReportStore.loadReport(dateStr) || "";
      var dialog = win.openDialog("about:blank", "arxiv-daily-report-" + dateStr,
        "chrome,centerscreen,resizable,width=900,height=760");
      if (!dialog) return;
      dialog.addEventListener("load", function () {
        dialog.document.open();
        dialog.document.write("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>" +
          escapeHTML(dateStr) + "</title></head><body></body></html>");
        dialog.document.close();
        var style = dialog.document.createElement("style");
        style.textContent = "body{margin:0;background:Canvas;color:CanvasText;font:14px system-ui,sans-serif;line-height:1.55;}header{display:flex;align-items:center;gap:8px;padding:10px 18px;border-bottom:1px solid ThreeDShadow;}header img{width:18px;height:18px;object-fit:contain;}header div{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}main{max-width:980px;margin:0 auto;padding:22px;}h1,h2,h3{line-height:1.25;}a{color:-moz-HyperlinkText;}.paper{border:1px solid ThreeDShadow;border-radius:6px;padding:12px;margin:12px 0;background:Canvas;}.meta{display:flex;gap:8px;flex-wrap:wrap;color:GrayText}.tag{border:1px solid ThreeDShadow;border-radius:3px;padding:1px 5px;color:GrayText}.abstract{white-space:pre-wrap}";
        dialog.document.head.appendChild(style);
        var header = dialog.document.createElement("header");
        header.appendChild(createLogo(dialog.document, 18));
        header.appendChild(dialog.document.createElement("div"));
        header.lastChild.textContent = dateStr || "Report";
        dialog.document.body.appendChild(header);
        var main = dialog.document.createElement("main");
        dialog.document.body.appendChild(main);
        try {
          ArxivDailyCenterWorkspace._renderMarkdownInto(dialog.document, main, markdown, { readonly: true });
        } catch (e) {
          var pre = dialog.document.createElement("pre");
          pre.textContent = cleanText(markdown);
          main.appendChild(pre);
        }
      }, { once: true });
    },

    openReportInNewTab: function (dateStr) {
      try {
        var win = Zotero.getMainWindow();
        if (!win || !win.Zotero_Tabs || typeof ArxivDailyReportStore === "undefined") {
          this.openReportInNewWindow(dateStr);
          return;
        }
        var markdown = ArxivDailyReportStore.loadReport(dateStr) || "";
        var title = safeTitle(dateStr + " arXiv 兴趣报告", "arXiv 兴趣报告");
        var tab = win.Zotero_Tabs.add({
          type: "arxiv-daily-report",
          title: title,
          data: { date: dateStr, arxivDailyReport: true },
          select: true,
          onClose: function () {},
        });
        var container = tab && tab.container;
        if (!container) {
          this.openReportInNewWindow(dateStr);
          return;
        }
        container.style.cssText = "display:flex;flex-direction:column;background:Canvas;color:CanvasText;overflow:hidden;";
        var wrapper = win.document.createElement("div");
        wrapper.style.cssText = "flex:1 1 auto;overflow:auto;padding:18px 26px;box-sizing:border-box;font:13px/1.55 message-box,system-ui,sans-serif;";
        container.appendChild(wrapper);
        this._renderMarkdownInto(win.document, wrapper, markdown, { date: dateStr, readonly: true });
      } catch (err) {
        logError("open report in tab failed: " + (err.message || err));
        this.openReportInNewWindow(dateStr);
      }
    },

    _createViewer: function () {
      var doc = this._doc;
      this._viewer = doc.createElement("div");
      this._viewer.setAttribute("id", "arxiv-daily-center-viewer");
      this._viewer.style.cssText =
        "display:none;position:absolute;z-index:200;top:0;left:0;right:0;bottom:0;" +
        "box-sizing:border-box;background:Canvas;color:CanvasText;flex-direction:column;" +
        "border:0;overflow:hidden;";

      var header = doc.createElement("div");
      header.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:7px 10px;" +
        "border-bottom:1px solid ThreeDShadow;box-sizing:border-box;";

      this._viewerTitle = doc.createElement("div");
      this._viewerTitle.style.cssText =
        "flex:1;min-width:0;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

      var fontSelect = doc.createElement("select");
      fontSelect.title = "阅读字体";
      fontSelect.style.cssText =
        "height:24px;max-width:120px;border:1px solid ThreeDShadow;background:Field;color:FieldText;" +
        "font:12px message-box,system-ui,sans-serif;cursor:pointer;";
      [
        ["message-box, system-ui, sans-serif", "系统"],
        ["Arial, Helvetica, sans-serif", "Arial"],
        ["Georgia, 'Times New Roman', serif", "Serif"],
        ["Consolas, 'Courier New', monospace", "Mono"],
      ].forEach(function (opt) {
        var option = doc.createElement("option");
        option.value = opt[0];
        option.textContent = opt[1];
        fontSelect.appendChild(option);
      });
      fontSelect.value = this._readerFontFamily;
      fontSelect.addEventListener("change", function () {
        ArxivDailyCenterWorkspace._readerFontFamily = fontSelect.value;
        setPref("readerFontFamily", fontSelect.value);
        ArxivDailyCenterWorkspace._applyReaderTypography();
      });

      var sizeInput = doc.createElement("input");
      sizeInput.type = "range";
      sizeInput.min = "11";
      sizeInput.max = "20";
      sizeInput.step = "1";
      sizeInput.value = String(this._readerFontSize);
      sizeInput.title = "阅读字号";
      sizeInput.style.cssText = "width:70px;cursor:pointer;";
      sizeInput.addEventListener("input", function () {
        ArxivDailyCenterWorkspace._readerFontSize = clamp(parseInt(sizeInput.value, 10) || 13, 11, 20);
        setPref("readerFontSize", ArxivDailyCenterWorkspace._readerFontSize);
        ArxivDailyCenterWorkspace._applyReaderTypography();
      });

      var highlight = createIconButton(doc, "H", "高亮选中文字并自动保存", function () {
        ArxivDailyCenterWorkspace._highlightCurrentSelection();
      });

      var back = createIconButton(doc, "‹", "返回上一个阅读界面", function () {
        ArxivDailyCenterWorkspace._goBack();
      });
      this._viewerBackButton = back;

      var feedbackStatus = doc.createElement("span");
      feedbackStatus.style.cssText = "font:12px message-box,system-ui,sans-serif;color:GrayText;white-space:nowrap;";
      feedbackStatus.title = "今日评价统计";
      this._feedbackStatus = feedbackStatus;

      var submitFeedback = doc.createElement("button");
      submitFeedback.type = "button";
      submitFeedback.textContent = "提交今日评价";
      submitFeedback.title = "提交今日评价；可重复提交，会覆盖本日报当前评价状态";
      submitFeedback.style.cssText =
        "height:24px;padding:0 8px;border:1px solid ThreeDShadow;background:ButtonFace;color:ButtonText;" +
        "border-radius:3px;font:12px message-box,system-ui,sans-serif;cursor:pointer;white-space:nowrap;";
      submitFeedback.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        ArxivDailyCenterWorkspace._submitTodayFeedback();
      });

      var revokeFeedback = createIconButton(doc, "↶", "撤回评价", function () {
        ArxivDailyCenterWorkspace._revokeTodayFeedback();
      });

      var close = doc.createElement("button");
      close.type = "button";
      close.textContent = "x";
      close.title = "关闭所有阅读界面";
      close.style.cssText =
        "width:24px;height:22px;padding:0;border:1px solid ThreeDShadow;" +
        "background:ButtonFace;color:ButtonText;border-radius:3px;cursor:pointer;";
      close.addEventListener("click", this._closeViewer.bind(this));

      header.appendChild(createLogo(doc, 16));
      header.appendChild(back);
      header.appendChild(this._viewerTitle);
      header.appendChild(feedbackStatus);
      header.appendChild(submitFeedback);
      header.appendChild(revokeFeedback);
      header.appendChild(fontSelect);
      header.appendChild(sizeInput);
      header.appendChild(highlight);
      header.appendChild(close);

      this._viewerContent = doc.createElement("div");
      this._viewerContent.style.cssText =
        "flex:1 1 auto;min-height:0;display:flex;overflow:hidden;background:Canvas;color:CanvasText;";

      this._viewerOutline = doc.createElement("nav");
      this._viewerOutline.setAttribute("aria-label", "报告目录");
      this._viewerOutline.style.cssText =
        "flex:0 0 " + this._readerOutlineWidth + "px;width:" + this._readerOutlineWidth + "px;" +
        "display:none;box-sizing:border-box;border-right:1px solid ThreeDShadow;" +
        "background:var(--material-sidepane,Canvas);overflow:auto;padding:8px 6px;" +
        "font:12px message-box,system-ui,sans-serif;color:CanvasText;";

      this._viewerOutlineResizer = doc.createElement("div");
      this._viewerOutlineResizer.title = "拖动调整目录宽度";
      this._viewerOutlineResizer.style.cssText =
        "display:none;flex:0 0 5px;width:5px;cursor:col-resize;background:transparent;border-right:1px solid ThreeDShadow;";
      this._viewerOutlineResizer.addEventListener("mouseenter", function () {
        this.style.background = "rgba(76,111,143,.22)";
      });
      this._viewerOutlineResizer.addEventListener("mouseleave", function () {
        this.style.background = "transparent";
      });
      this._viewerOutlineResizer.addEventListener("mousedown", function (event) {
        event.preventDefault();
        var startX = event.clientX;
        var startWidth = ArxivDailyCenterWorkspace._readerOutlineWidth || 210;
        function onMove(moveEvent) {
          var next = clamp(startWidth + moveEvent.clientX - startX, 140, 380);
          ArxivDailyCenterWorkspace._readerOutlineWidth = next;
          setPref("readerOutlineWidth", next);
          if (ArxivDailyCenterWorkspace._viewerOutline) {
            ArxivDailyCenterWorkspace._viewerOutline.style.flexBasis = next + "px";
            ArxivDailyCenterWorkspace._viewerOutline.style.width = next + "px";
          }
        }
        function onUp() {
          doc.removeEventListener("mousemove", onMove, true);
          doc.removeEventListener("mouseup", onUp, true);
        }
        doc.addEventListener("mousemove", onMove, true);
        doc.addEventListener("mouseup", onUp, true);
      });

      this._viewerBody = doc.createElement("article");
      this._viewerBody.style.cssText =
        "flex:1 1 auto;overflow:auto;padding:0;font:13px/1.55 message-box,system-ui,sans-serif;" +
        "box-sizing:border-box;max-width:none;background:Canvas;color:CanvasText;" +
        "user-select:text;-moz-user-select:text;";
      this._viewerBody.addEventListener("click", function (event) {
        if (ArxivDailyCenterWorkspace._selectionAskPopup &&
            !ArxivDailyCenterWorkspace._selectionAskPopup.contains(event.target)) {
          ArxivDailyCenterWorkspace._removeSelectionAskPopup();
        }
        var link = event.target && event.target.closest ? event.target.closest("a") : null;
        if (!link) return;
        var href = link.getAttribute("href") || "";
        if (!href) return;
        event.preventDefault();
        if (/^arxiv-daily-report:\/\//i.test(href)) {
          var path = href.replace(/^arxiv-daily-report:\/\//i, "");
          var parts = path.split("/");
          var date = parts[0] || "";
          var paperId = parts.slice(1).join("/") || "";
          if (date) ArxivDailyCenterWorkspace.showReport(date, paperId ? { paperId: paperId } : {});
          return;
        }
        try {
          Zotero.launchURL(href);
        } catch (e) {}
      });
      this._viewerBody.addEventListener("wheel", function (event) {
        if (!event.ctrlKey) ArxivDailyCenterWorkspace._removeSelectionAskPopup();
        if (!event.ctrlKey) return;
        event.preventDefault();
        var delta = event.deltaY > 0 ? -0.06 : 0.06;
        ArxivDailyCenterWorkspace._setReaderZoom(ArxivDailyCenterWorkspace._readerZoom + delta, event);
      }, { passive: false });
      this._viewerBody.addEventListener("mouseup", function (event) {
        ArxivDailyCenterWorkspace._maybeShowSelectionAsk(event);
      });
      this._viewerBody.addEventListener("keyup", function (event) {
        ArxivDailyCenterWorkspace._maybeShowSelectionAsk(event);
      });
      this._viewerBody.addEventListener("scroll", function () {
        ArxivDailyCenterWorkspace._removeSelectionAskPopup();
      });

      this._viewerContent.appendChild(this._viewerOutline);
      this._viewerContent.appendChild(this._viewerOutlineResizer);
      this._viewerContent.appendChild(this._viewerBody);
      this._viewer.appendChild(header);
      this._viewer.appendChild(this._viewerContent);
      this._applyReaderTypography();
    },

    _applyReaderTypography: function () {
      if (!this._viewerBody) return;
      this._viewerBody.style.fontFamily = this._readerFontFamily || "message-box, system-ui, sans-serif";
      this._viewerBody.style.fontSize = clamp(this._readerFontSize || 13, 11, 20) + "px";
      this._viewerBody.style.lineHeight = "1.58";
      this._applyReaderZoom();
    },

    _setReaderZoom: function (value, anchorEvent) {
      var oldZoom = clamp(this._readerZoom || 1, 0.7, 1.8);
      var nextZoom = clamp(value, 0.7, 1.8);
      var scroller = this._viewerBody;
      var layer = this._getReaderZoomLayer();
      var clientX = anchorEvent && typeof anchorEvent.clientX === "number" ? anchorEvent.clientX : 0;
      var clientY = anchorEvent && typeof anchorEvent.clientY === "number" ? anchorEvent.clientY : 0;
      var contentX = 0;
      var contentY = 0;
      if (scroller && layer && anchorEvent && layer.getBoundingClientRect) {
        var layerRect = layer.getBoundingClientRect();
        contentX = (clientX - layerRect.left) / oldZoom;
        contentY = (clientY - layerRect.top) / oldZoom;
      } else {
        var anchor = pointerInScroller(scroller, anchorEvent);
        contentX = scroller ? (scroller.scrollLeft + anchor.x) / oldZoom : 0;
        contentY = scroller ? (scroller.scrollTop + anchor.y) / oldZoom : 0;
      }

      this._readerZoom = nextZoom;
      setPref("readerZoom", this._readerZoom);
      this._applyReaderZoom();

      if (scroller && anchorEvent && oldZoom !== nextZoom) {
        layer = this._getReaderZoomLayer();
        if (layer && layer.getBoundingClientRect) {
          var nextRect = layer.getBoundingClientRect();
          scroller.scrollLeft = Math.max(0, scroller.scrollLeft + nextRect.left + contentX * nextZoom - clientX);
          scroller.scrollTop = Math.max(0, scroller.scrollTop + nextRect.top + contentY * nextZoom - clientY);
        }
      }
    },

    _getReaderZoomLayer: function () {
      if (!this._viewerBody) return null;
      return this._viewerBody.querySelector("[data-ari-reader-shell='true']");
    },

    _appendReaderVisualCanvas: function (container, shell) {
      if (!container || container !== this._viewerBody) {
        container.appendChild(shell);
        return;
      }
      var doc = container.ownerDocument;
      var canvas = doc.createElement("div");
      canvas.setAttribute("data-ari-reader-canvas", "true");
      canvas.style.cssText =
        "position:relative;overflow:visible;box-sizing:border-box;margin:0 auto;" +
        "min-width:0;min-height:0;";
      shell.style.transformOrigin = "top left";
      canvas.appendChild(shell);
      container.appendChild(canvas);
    },

    _applyReaderZoom: function () {
      if (!this._viewerBody) return;
      var shell = this._viewerBody.querySelector("[data-ari-reader-shell='true']");
      if (!shell) return;
      var canvas = this._viewerBody.querySelector("[data-ari-reader-canvas='true']");
      var zoom = clamp(this._readerZoom || 1, 0.7, 1.8);
      if (canvas) {
        var baseWidth = parseFloat(canvas.getAttribute("data-ari-base-width") || "0");
        if (!baseWidth) {
          shell.style.transform = "none";
          baseWidth = Math.max(1, shell.offsetWidth || 0);
          shell.style.width = baseWidth + "px";
          shell.style.maxWidth = "none";
          shell.style.margin = "0";
          canvas.setAttribute("data-ari-base-width", String(baseWidth));
        }
        var visualWidth = Math.max(baseWidth, shell.scrollWidth || 0, shell.offsetWidth || 0);
        var baseHeight = Math.max(1, shell.scrollHeight || 0, shell.offsetHeight || 0);
        shell.style.transform = "scale(" + zoom + ")";
        shell.style.transformOrigin = "top left";
        canvas.style.width = Math.ceil(visualWidth * zoom) + "px";
        canvas.style.height = Math.ceil(baseHeight * zoom) + "px";
        return;
      }
      shell.style.transform = "scale(" + zoom + ")";
      shell.style.transformOrigin = "top left";
    },

    getTopReadableContext: function () {
      if (!this._viewer || this._viewer.style.display === "none") return null;
      var text = cleanText(this._currentTopText || this._currentMarkdown || "");
      if (!text) return null;
      return {
        title: this._currentTitle || "arXiv Interest Daily",
        date: this._currentMeta && this._currentMeta.date ? String(this._currentMeta.date) : "",
        text: text,
        kind: this._currentMeta && this._currentMeta.projectPaper ? "project-paper" : "report",
      };
    },

    _removeSelectionAskPopup: function () {
      if (this._selectionAskPopup && this._selectionAskPopup.parentNode) {
        this._selectionAskPopup.parentNode.removeChild(this._selectionAskPopup);
      }
      this._selectionAskPopup = null;
      this._selectionAskContext = "";
    },

    _maybeShowSelectionAsk: function (event) {
      this._selectionAskEnabled = selectionAskMode() !== "off";
      if (!this._selectionAskEnabled || !this._viewerBody || !this._viewer ||
          this._viewer.style.display === "none") return;
      var win = this._doc ? this._doc.defaultView : null;
      if (!win || !win.getSelection) return;
      var sel = win.getSelection();
      if (!sel || sel.isCollapsed) {
        this._removeSelectionAskPopup();
        return;
      }
      var text = cleanText(sel.toString() || "").trim();
      if (text.length < 2) {
        this._removeSelectionAskPopup();
        return;
      }
      var range = sel.rangeCount ? sel.getRangeAt(0) : null;
      if (!range || !this._viewerBody.contains(range.commonAncestorContainer)) {
        this._removeSelectionAskPopup();
        return;
      }
      this._showSelectionAskPopup(text, range, event);
    },

    _showSelectionAskPopup: function (text, range, event) {
      this._removeSelectionAskPopup();
      var doc = this._doc;
      var popup = doc.createElement("button");
      popup.type = "button";
      popup.title = "向 LLM 提问选中部分";
      popup.style.cssText =
        "position:fixed;z-index:10000;display:inline-flex;align-items:center;gap:5px;" +
        "max-width:220px;height:28px;padding:0 9px;border:1px solid ThreeDShadow;border-radius:4px;" +
        "background:ButtonFace;color:ButtonText;font:12px message-box,system-ui,sans-serif;" +
        "box-shadow:0 2px 8px rgba(0,0,0,.22);cursor:pointer;";
      popup.appendChild(createSelectionLogo(doc, 14));
      popup.appendChild(doc.createTextNode("向LLM提问选中部分"));
      var rect = null;
      try {
        var rects = range && range.getClientRects ? Array.prototype.slice.call(range.getClientRects()) : [];
        for (var i = rects.length - 1; i >= 0; i--) {
          if ((rects[i].width || 0) > 1 && (rects[i].height || 0) > 1) {
            rect = rects[i];
            break;
          }
        }
        if (!rect && range && range.getBoundingClientRect) rect = range.getBoundingClientRect();
      } catch (rectErr) {}
      var x = rect && Number.isFinite(rect.right) ? rect.right : (event && event.clientX ? event.clientX : 160);
      var y = rect && Number.isFinite(rect.top) ? rect.top : (event && event.clientY ? event.clientY : 160);
      var vw = doc.defaultView.innerWidth || 900;
      popup.style.left = Math.max(8, Math.min(x + 8, vw - 230)) + "px";
      popup.style.top = Math.max(8, y - 34) + "px";
      popup.addEventListener("mousedown", function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
      popup.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof ArxivDailyQA !== "undefined" && ArxivDailyQA.askAboutSelection) {
          ArxivDailyQA.askAboutSelection(text);
        }
        ArxivDailyCenterWorkspace._removeSelectionAskPopup();
      });
      doc.documentElement.appendChild(popup);
      this._selectionAskPopup = popup;
      this._selectionAskContext = [
        this._currentTitle || "",
        this._currentReportDate || "",
        this._currentMeta && this._currentMeta.paperId || "",
        String(text || "").slice(0, 80),
      ].join("|");
    },

    _clearReaderOutline: function () {
      if (this._outlineScrollHandler && this._viewerBody) {
        try { this._viewerBody.removeEventListener("scroll", this._outlineScrollHandler); } catch (e) {}
      }
      this._outlineScrollHandler = null;
      this._outlineTargets = [];
      if (this._viewerOutline) {
        while (this._viewerOutline.firstChild) this._viewerOutline.removeChild(this._viewerOutline.firstChild);
        this._viewerOutline.style.display = "none";
      }
      if (this._viewerOutlineResizer) this._viewerOutlineResizer.style.display = "none";
    },

    _scrollReaderTo: function (target) {
      if (!target || !this._viewerBody) return;
      var bodyRect = this._viewerBody.getBoundingClientRect();
      var targetRect = target.getBoundingClientRect();
      var top = this._viewerBody.scrollTop + targetRect.top - bodyRect.top - 10;
      this._viewerBody.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    },

    _installReaderOutline: function (outline) {
      this._clearReaderOutline();
      if (!this._viewerOutline || !this._viewerBody || !outline || !outline.length) return;

      var doc = this._doc;
      var title = doc.createElement("div");
      title.textContent = "目录";
      title.style.cssText = "font-weight:600;margin:0 0 6px;padding:0 4px;color:CanvasText;";
      this._viewerOutline.appendChild(title);

      var targets = [];
      for (var i = 0; i < outline.length; i++) {
        var section = outline[i];
        var details = doc.createElement("details");
        details.open = false;
        details.style.cssText = "margin:2px 0;";
        var summary = doc.createElement("summary");
        summary.textContent = section.label + ". " + section.title;
        summary.title = "跳转到 " + section.title;
        summary.style.cssText =
          "cursor:pointer;list-style-position:inside;padding:3px 4px;border-radius:3px;" +
          "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        summary.addEventListener("click", function (event) {
          var willOpen = !(event.currentTarget.parentNode && event.currentTarget.parentNode.open);
          if (!willOpen) return;
          var id = event.currentTarget.getAttribute("data-target-id");
          var target = id ? doc.getElementById(id) : null;
          setTimeout(function () {
            ArxivDailyCenterWorkspace._scrollReaderTo(target);
          }, 0);
        });
        summary.setAttribute("data-target-id", section.id);
        details.appendChild(summary);
        targets.push({ id: section.id, element: section.element, node: summary, summary: summary, section: details });

        var list = doc.createElement("div");
        list.style.cssText = "margin-left:13px;border-left:1px solid ThreeDShadow;padding-left:5px;";
        for (var p = 0; p < (section.papers || []).length; p++) {
          var paper = section.papers[p];
          var btn = doc.createElement("button");
          btn.type = "button";
          btn.textContent = paper.label + "." + paper.title;
          btn.title = paper.label + ". " + paper.title;
          btn.setAttribute("data-target-id", paper.id);
          btn.style.cssText =
            "display:block;width:100%;box-sizing:border-box;border:0;background:transparent;color:CanvasText;" +
            "text-align:left;cursor:pointer;padding:3px 4px;border-radius:3px;font:12px message-box,system-ui,sans-serif;" +
            "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
          btn.addEventListener("click", function (event) {
            var id = event.currentTarget.getAttribute("data-target-id");
            ArxivDailyCenterWorkspace._scrollReaderTo(id ? doc.getElementById(id) : null);
          });
          list.appendChild(btn);
          targets.push({ id: paper.id, element: paper.element, node: btn, summary: summary, section: details });
        }
        details.appendChild(list);
        this._viewerOutline.appendChild(details);
      }

      this._viewerOutline.style.display = "block";
      if (this._viewerOutlineResizer) this._viewerOutlineResizer.style.display = "block";
      this._outlineTargets = targets;
      this._outlineScrollHandler = this._syncReaderOutline.bind(this);
      this._viewerBody.addEventListener("scroll", this._outlineScrollHandler);
      this._syncReaderOutline();
    },

    _syncReaderOutline: function () {
      if (!this._viewerBody || !this._outlineTargets || !this._outlineTargets.length) return;
      var bodyRect = this._viewerBody.getBoundingClientRect();
      var active = this._outlineTargets[0];
      for (var i = 0; i < this._outlineTargets.length; i++) {
        var target = this._outlineTargets[i];
        if (!target.element || !target.element.getBoundingClientRect) continue;
        var top = target.element.getBoundingClientRect().top - bodyRect.top;
        if (top <= 64) active = target;
        else break;
      }
      for (var j = 0; j < this._outlineTargets.length; j++) {
        var node = this._outlineTargets[j].node;
        if (!node) continue;
        node.style.background = "transparent";
        node.style.color = "CanvasText";
      }
      var activeNode = active && active.node;
      if (active && active.section && !active.section.open && active.summary) activeNode = active.summary;
      if (activeNode) {
        activeNode.style.background = "Highlight";
        activeNode.style.color = "HighlightText";
      }
    },

    _loadHighlightIndex: function () {
      if (!this._highlightIndex) {
        this._highlightIndex = readJSON("annotations/report-highlights.json", {});
      }
      return this._highlightIndex || {};
    },

    _saveHighlightIndex: function () {
      if (!this._highlightIndex) return false;
      return saveJSON("annotations/report-highlights.json", this._highlightIndex);
    },

    _loadFeedbackIndex: function () {
      if (!this._feedbackIndex) {
        this._feedbackIndex = readJSON("feedback/paper_feedback.json", {});
      }
      if (!this._feedbackIndex || typeof this._feedbackIndex !== "object" || Array.isArray(this._feedbackIndex)) {
        this._feedbackIndex = {};
      }
      return this._feedbackIndex;
    },

    _saveFeedbackIndex: function () {
      if (!this._feedbackIndex) return false;
      return saveJSON("feedback/paper_feedback.json", this._feedbackIndex);
    },

    _getPaperFeedback: function (paperKey) {
      if (!paperKey) return "";
      var index = this._loadFeedbackIndex();
      var entry = index[paperKey];
      return entry && entry.rating ? entry.rating : "";
    },

    _getFeedbackEntry: function (paperKey) {
      if (!paperKey) return null;
      var index = this._loadFeedbackIndex();
      return index[paperKey] || null;
    },

    _setPaperFeedback: function (paperKey, rating, paper, meta) {
      if (!paperKey) return false;
      var index = this._loadFeedbackIndex();
      var current = index[paperKey] && index[paperKey].rating;
      if (current === rating) {
        delete index[paperKey];
      } else {
        index[paperKey] = {
          rating: rating,
          label: feedbackLabel(rating),
          arxivId: paper && paper.arxivId ? paper.arxivId : "",
          title: paper && paper.title ? paper.title : "",
          reportDate: meta && meta.date ? meta.date : "",
          updatedAt: new Date().toISOString(),
        };
      }
      return this._saveFeedbackIndex();
    },

    _feedbackStatsForCurrentReport: function () {
      var keys = paperKeysFromReport(this._currentMarkdown || "");
      var index = this._loadFeedbackIndex();
      var total = Object.keys(keys).length;
      var rated = 0;
      for (var key in keys) {
        if (index[key] && index[key].rating) rated++;
      }
      var date = this._currentMeta && this._currentMeta.date ? String(this._currentMeta.date) : "";
      var submission = date && index.__submissions ? index.__submissions[date] : null;
      return { rated: rated, total: total, submitted: !!submission, submittedAt: submission && submission.submittedAt };
    },

    _updateFeedbackHeader: function () {
      if (!this._feedbackStatus) return;
      var stats = this._feedbackStatsForCurrentReport();
      this._feedbackStatus.textContent = (stats.submitted ? "已提交" : "未提交") + " · 已评价 " + stats.rated + "/" + stats.total;
      this._feedbackStatus.title = "可重复提交今日评价；当前报告中已有 " + stats.rated + " 篇完成评价，共 " + stats.total + " 篇。" +
        (stats.submittedAt ? " 最近提交: " + stats.submittedAt : "");
    },

    _flashFeedbackStatus: function (message) {
      if (!this._feedbackStatus) return;
      if (this._feedbackFlashTimer) {
        clearTimeout(this._feedbackFlashTimer);
        this._feedbackFlashTimer = null;
      }
      this._feedbackStatus.textContent = "";
      var node = this._feedbackStatus;
      try { node.getBoundingClientRect(); } catch (e) {}
      var self = this;
      this._feedbackFlashTimer = setTimeout(function () {
        node.textContent = message || "";
        self._feedbackFlashTimer = setTimeout(function () {
          self._feedbackFlashTimer = null;
          self._updateFeedbackHeader();
        }, 1200);
      }, 120);
    },

    _submitTodayFeedback: function () {
      var stats = this._feedbackStatsForCurrentReport();
      var date = this._currentMeta && this._currentMeta.date ? String(this._currentMeta.date) : "";
      var index = this._loadFeedbackIndex();
      if (date) {
        if (!index.__submissions || typeof index.__submissions !== "object") index.__submissions = {};
        index.__submissions[date] = {
          rated: stats.rated,
          total: stats.total,
          submittedAt: new Date().toISOString(),
        };
        this._saveFeedbackIndex();
      }
      this._flashFeedbackStatus("今日评价已提交");
      return true;
    },

    _revokeTodayFeedback: function () {
      var date = this._currentMeta && this._currentMeta.date ? String(this._currentMeta.date) : "";
      if (!date) return false;
      var keys = paperKeysFromReport(this._currentMarkdown || "");
      var index = this._loadFeedbackIndex();
      for (var key in keys) {
        delete index[key];
      }
      if (index.__submissions) delete index.__submissions[date];
      this._saveFeedbackIndex();
      this._renderMarkdownReport(this._currentMarkdown, this._currentMeta || {});
      this._flashFeedbackStatus("今日评价已撤回");
      return true;
    },

    _highlightKeyForElement: function (el) {
      if (!el) return "";
      var existing = el.getAttribute("data-ari-highlight-key");
      if (existing) return existing;
      var key = hashText(el.textContent || "");
      el.setAttribute("data-ari-highlight-key", key);
      return key;
    },

    _makeHighlightable: function (el) {
      if (!el) return el;
      el.setAttribute("data-ari-highlightable", "true");
      this._highlightKeyForElement(el);
      el.style.userSelect = "text";
      el.style.MozUserSelect = "text";
      return el;
    },

    _applySavedHighlights: function (container, meta) {
      var date = meta && meta.date ? String(meta.date) : "";
      if (!date || !container) return;
      var highlights = this._loadHighlightIndex()[date] || {};
      var doc = container.ownerDocument || this._doc;
      var legacyNodes = container.querySelectorAll("[data-ari-highlightable='true']");
      for (var i = 0; i < legacyNodes.length; i++) {
        var legacyKey = this._highlightKeyForElement(legacyNodes[i]);
        var legacy = highlights[legacyKey];
        if (legacy && !legacy.text) {
          legacyNodes[i].style.background = "rgba(255, 232, 122, 0.25)";
          legacyNodes[i].style.boxShadow = "inset 3px 0 0 rgba(196, 151, 28, 0.55)";
        }
      }
      var items = Array.isArray(highlights.items) ? highlights.items.slice() : [];
      items.sort(function (a, b) {
        return String(b.blockKey || "").localeCompare(String(a.blockKey || "")) ||
          ((b.start || 0) - (a.start || 0));
      });
      for (var h = 0; h < items.length; h++) {
        var item = items[h];
        if (!item || !item.blockKey || !item.text) continue;
        var selectorKey = String(item.blockKey).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
        var block = container.querySelector("[data-ari-highlight-key=\"" + selectorKey + "\"]");
        if (!block) continue;
        var start = Number.isFinite(parseInt(item.start, 10)) ? parseInt(item.start, 10) : -1;
        var fullText = cleanText(block.textContent || "");
        if (start < 0 || fullText.slice(start, start + item.text.length) !== item.text) {
          start = nthIndexOf(fullText, item.text, item.occurrence || 0);
        }
        if (start >= 0) {
          wrapBlockOffsets(doc, block, start, start + item.text.length, item.id || "");
        }
      }
    },

    _highlightCurrentSelection: function () {
      var win = this._doc ? this._doc.defaultView : null;
      if (!win || !win.getSelection || !this._currentMeta || !this._currentMeta.date) return false;
      var sel = win.getSelection();
      if (!sel || sel.isCollapsed) return false;
      var range = sel.rangeCount ? sel.getRangeAt(0) : null;
      if (!range) return false;
      var date = String(this._currentMeta.date);
      var index = this._loadHighlightIndex();
      if (!index[date] || Array.isArray(index[date])) index[date] = {};
      if (!Array.isArray(index[date].items)) index[date].items = [];
      var blocks = Array.prototype.slice.call(this._viewerBody.querySelectorAll("[data-ari-highlightable='true']"));
      var pending = [];

      for (var i = 0; i < blocks.length; i++) {
        var target = blocks[i];
        if (!rangeIntersectsNode(range, target)) continue;
        var fullText = cleanText(target.textContent || "");
        if (!fullText) continue;

        var start = 0;
        if (target.contains(range.startContainer)) {
          var prefixRange = range.cloneRange();
          prefixRange.selectNodeContents(target);
          prefixRange.setEnd(range.startContainer, range.startOffset);
          start = cleanText(prefixRange.toString() || "").length;
        }

        var end = fullText.length;
        if (target.contains(range.endContainer)) {
          var endRange = range.cloneRange();
          endRange.selectNodeContents(target);
          endRange.setEnd(range.endContainer, range.endOffset);
          end = cleanText(endRange.toString() || "").length;
        }

        start = clamp(start, 0, fullText.length);
        end = clamp(end, start, fullText.length);
        var selectedText = fullText.slice(start, end);
        if (!selectedText.trim()) continue;
        var key = this._highlightKeyForElement(target);
        pending.push({
          block: target,
          item: {
            id: Date.now().toString(36) + "-" + i + "-" + Math.floor(Math.random() * 100000).toString(36),
            blockKey: key,
            start: start,
            text: selectedText,
            occurrence: countOccurrencesBefore(fullText.slice(0, start), selectedText),
            savedAt: new Date().toISOString(),
          },
        });
      }

      if (!pending.length) return false;
      pending.sort(function (a, b) {
        return String(b.item.blockKey || "").localeCompare(String(a.item.blockKey || "")) ||
          (b.item.start - a.item.start);
      });
      for (var p = 0; p < pending.length; p++) {
        index[date].items.push(pending[p].item);
        wrapBlockOffsets(
          this._doc,
          pending[p].block,
          pending[p].item.start,
          pending[p].item.start + pending[p].item.text.length,
          pending[p].item.id
        );
      }
      this._saveHighlightIndex();
      try { sel.removeAllRanges(); } catch (e) {}
      return true;
    },

    _renderPlainMarkdown: function (markdown) {
      this._clearReaderOutline();
      while (this._viewerBody.firstChild) this._viewerBody.removeChild(this._viewerBody.firstChild);
      var canvas = this._doc.createElement("div");
      canvas.setAttribute("data-ari-reader-canvas", "true");
      canvas.style.cssText =
        "position:relative;overflow:visible;box-sizing:border-box;margin:0 auto;" +
        "min-width:0;min-height:0;";
      var pre = this._doc.createElement("pre");
      pre.setAttribute("data-ari-reader-shell", "true");
      pre.textContent = cleanText(markdown || "");
      pre.style.cssText =
        "margin:0;padding:18px 24px;white-space:pre-wrap;word-break:break-word;" +
        "font:12px/1.55 Consolas,'Courier New',monospace;color:CanvasText;" +
        "box-sizing:border-box;transform-origin:top left;";
      canvas.appendChild(pre);
      this._viewerBody.appendChild(canvas);
      this._applyReaderZoom();
    },

    _renderMarkdownReport: function (markdown, meta) {
      this._clearReaderOutline();
      while (this._viewerBody.firstChild) this._viewerBody.removeChild(this._viewerBody.firstChild);
      this._renderMarkdownInto(this._doc, this._viewerBody, markdown, meta || {});
    },

    _renderMarkdownInto: function (doc, container, markdown, meta) {
      var readonly = meta && meta.readonly;
      var report = parseReportMarkdown(markdown);
      var shell = doc.createElement("div");
      shell.setAttribute("data-ari-reader-shell", "true");
      shell.setAttribute("contenteditable", "false");
      shell.style.cssText =
        "max-width:980px;margin:0 auto;padding:18px 24px 28px;box-sizing:border-box;" +
        "user-select:text;-moz-user-select:text;";

      var h1 = doc.createElement("h1");
      setText(h1, report.title || this._currentTitle || "arXiv 兴趣报告");
      h1.style.cssText = "font-size:22px;line-height:1.25;margin:0 0 8px;font-weight:650;";
      this._makeHighlightable(h1);
      shell.appendChild(h1);

      var actionRow = doc.createElement("div");
      actionRow.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:8px 0 12px;";
      var dateForReport = (meta && meta.date) || "";
      actionRow.appendChild(createIconButton(doc, "⧉", "复制当前报告 Markdown", function () {
        copyText(markdown || "");
      }));
      if (!readonly && dateForReport) {
        if (meta && meta.paperId) {
          actionRow.appendChild(createIconButton(doc, "▤", "跳转到这篇论文所在的完整日报", function () {
            ArxivDailyCenterWorkspace.showReport(dateForReport);
          }));
        }
        actionRow.appendChild(createIconButton(doc, "↗", "在新标签页打开报告", function () {
          ArxivDailyCenterWorkspace.openReportInNewTab(dateForReport);
        }));
        actionRow.appendChild(createIconButton(doc, "▣", "打开报告文件夹", function () {
          if (typeof ArxivDailyLeftPane !== "undefined") ArxivDailyLeftPane.openDataFolder("reports");
        }));
      }
      shell.appendChild(actionRow);

      if (report.note) {
        var note = doc.createElement("div");
        setText(note, report.note);
        note.style.cssText =
          "border-left:3px solid #4c6f8f;background:rgba(76,111,143,.08);" +
          "padding:6px 10px;margin:8px 0 12px;color:CanvasText;";
        this._makeHighlightable(note);
        shell.appendChild(note);
      }

      if (report.summary.length) {
        var summary = doc.createElement("div");
        summary.style.cssText =
          "display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;" +
          "margin:10px 0 18px;";
        for (var s = 0; s < report.summary.length; s++) {
          var tile = doc.createElement("div");
          tile.style.cssText = "border:1px solid ThreeDShadow;border-radius:6px;padding:7px 9px;background:Canvas;";
          var key = doc.createElement("div");
          setText(key, report.summary[s].key);
          key.style.cssText = "font-size:11px;color:GrayText;margin-bottom:2px;";
          var value = doc.createElement("div");
          setText(value, report.summary[s].value);
          value.style.cssText = "font-weight:600;";
          tile.appendChild(key);
          tile.appendChild(value);
          this._makeHighlightable(tile);
          summary.appendChild(tile);
        }
        shell.appendChild(summary);
      }

      var outline = [];
      var paperSectionCount = 0;
      for (var i = 0; i < report.sections.length; i++) {
        var section = report.sections[i];
        var existingLabel = (String(section.title || "").match(/^([IVXLCDM]+)\.\s*/i) || [])[1] || "";
        var hasPapers = !!(section.papers && section.papers.length);
        var sectionLabel = "";
        if (hasPapers) {
          paperSectionCount++;
          sectionLabel = existingLabel || romanNumeral(paperSectionCount);
        }
        var sectionTitle = stripSectionPrefix(section.title);
        var collapseWholeSection = shouldCollapseReportSection(sectionTitle);
        var sectionCollapseKey = collapseWholeSection ? this._reportSectionCollapseKey(meta || {}, sectionTitle, i) : "";
        var initiallyCollapsed = collapseWholeSection ? this._getReportSectionCollapsed(sectionCollapseKey, true) : false;
        var sectionId = "ari-report-section-" + i;
        var h2 = doc.createElement("h2");
        h2.id = sectionId;
        h2.setAttribute("data-ari-outline-target", sectionId);
        h2.style.cssText =
          "font-size:16px;margin:18px 0 8px;padding-bottom:4px;border-bottom:1px solid ThreeDShadow;" +
          (collapseWholeSection
            ? "display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid ThreeDShadow;" +
              "border-left:3px solid #6b7f93;border-radius:4px;background:Canvas;" +
              "position:sticky;top:0;z-index:5;box-shadow:0 1px 0 rgba(128,128,128,.22);"
            : "");
        if (collapseWholeSection) {
          var h2Text = doc.createElement("span");
          h2Text.style.cssText = "flex:1;min-width:0;";
          setText(h2Text, sectionLabel ? (sectionLabel + ". " + sectionTitle) : sectionTitle);
          h2.appendChild(h2Text);
          this._makeHighlightable(h2Text);
          if (section.papers && section.papers.length) {
            var sectionCount = doc.createElement("span");
            setText(sectionCount, section.papers.length + " 篇");
            sectionCount.style.cssText =
              "font-size:11px;font-weight:400;color:GrayText;white-space:nowrap;";
            h2.appendChild(sectionCount);
          }
        } else {
          setText(h2, sectionLabel ? (sectionLabel + ". " + sectionTitle) : sectionTitle);
          this._makeHighlightable(h2);
        }
        shell.appendChild(h2);
        var sectionParent = shell;
        var sectionBody = null;
        var sectionBottomRow = null;
        if (collapseWholeSection) {
          sectionBody = doc.createElement("div");
          sectionBody.style.cssText = "display:none;";
          var sectionToggle = doc.createElement("button");
          sectionToggle.type = "button";
          sectionToggle.style.cssText =
            "height:24px;padding:0 9px;border:1px solid ThreeDShadow;border-radius:4px;" +
            "background:ButtonFace;color:ButtonText;font:12px message-box,system-ui,sans-serif;cursor:pointer;white-space:nowrap;";
          h2.appendChild(sectionToggle);

          var collapsedHint = doc.createElement("div");
          collapsedHint.style.cssText =
            "display:none;margin:-2px 0 8px;padding:6px 8px;border-left:3px solid #6b7f93;" +
            "background:rgba(76,111,143,.045);color:GrayText;font-size:12px;";
          setText(collapsedHint, "本板块默认收起。点击标题右侧按钮可展开查看论文。");
          shell.appendChild(collapsedHint);

          var stickyRow = doc.createElement("div");
          stickyRow.style.cssText =
            "position:sticky;top:34px;z-index:4;display:flex;justify-content:flex-end;" +
            "padding:5px 0;margin:0 0 6px;background:Canvas;border-bottom:1px solid rgba(128,128,128,.22);";
          var stickyCollapse = doc.createElement("button");
          stickyCollapse.type = "button";
          stickyCollapse.textContent = "收起本板块";
          stickyCollapse.title = "收起" + sectionTitle;
          stickyCollapse.style.cssText = sectionToggle.style.cssText;
          stickyRow.appendChild(stickyCollapse);
          sectionBody.appendChild(stickyRow);

          sectionBottomRow = doc.createElement("div");
          sectionBottomRow.style.cssText = "display:flex;justify-content:flex-end;margin:12px 0 4px;";
          var bottomCollapse = doc.createElement("button");
          bottomCollapse.type = "button";
          bottomCollapse.textContent = "收起本板块";
          bottomCollapse.title = "收起" + sectionTitle;
          bottomCollapse.style.cssText = sectionToggle.style.cssText;
          sectionBottomRow.appendChild(bottomCollapse);

          (function (body, toggle, sticky, bottom, anchor, title, hint, collapseKey, initialCollapsed) {
            function setCollapsed(collapsed, remember) {
              body.style.display = collapsed ? "none" : "block";
              if (hint) hint.style.display = collapsed ? "block" : "none";
              toggle.textContent = collapsed ? "▸ 展开" : "▾ 收起";
              toggle.title = collapsed ? "展开" + title : "收起" + title;
              if (remember !== false && typeof ArxivDailyCenterWorkspace !== "undefined") {
                ArxivDailyCenterWorkspace._setReportSectionCollapsed(collapseKey, collapsed);
              }
              refreshReaderZoomLater(doc);
            }
            toggle.addEventListener("click", function (event) {
              event.preventDefault();
              event.stopPropagation();
              setCollapsed(body.style.display !== "none", true);
            });
            [sticky, bottom].forEach(function (btn) {
              btn.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                setCollapsed(true, true);
                if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ block: "nearest" });
              });
            });
            setCollapsed(initialCollapsed, false);
          })(sectionBody, sectionToggle, stickyCollapse, bottomCollapse, h2, sectionTitle, collapsedHint, sectionCollapseKey, initiallyCollapsed);
          shell.appendChild(sectionBody);
          sectionParent = sectionBody;
        }
        var outlineSection = hasPapers ? {
          id: sectionId,
          label: sectionLabel,
          title: sectionTitle,
          element: h2,
          papers: [],
        } : null;
        for (var intro = 0; intro < section.intro.length; intro++) {
          var introP = doc.createElement("p");
          setText(introP, section.intro[intro]);
          introP.style.cssText = "margin:6px 0;color:GrayText;";
          this._makeHighlightable(introP);
          sectionParent.appendChild(introP);
        }
        for (var p = 0; p < section.papers.length; p++) {
          var paper = section.papers[p];
          var paperId = "ari-report-paper-" + i + "-" + p;
          paper._outlineId = paperId;
          paper._outlineLabel = (sectionLabel || romanNumeral(paperSectionCount || 1)) + "." + (p + 1);
          paper._sectionTitle = sectionTitle;
          var card = this._createPaperCard(doc, paper, meta || {});
          sectionParent.appendChild(card);
          if (outlineSection) outlineSection.papers.push({
            id: paperId,
            label: paper._outlineLabel,
            title: paper.title || paper.heading || "",
            element: card,
          });
        }
        if (sectionBottomRow) sectionParent.appendChild(sectionBottomRow);
        if (outlineSection) outline.push(outlineSection);
      }

      this._appendReaderVisualCanvas(container, shell);
      this._installReaderOutline(outline);
      this._applySavedHighlights(shell, meta || {});
      this._applyReaderTypography();
      this._updateFeedbackHeader();
    },

    _createPaperCard: function (doc, paper, meta) {
      var card = doc.createElement("section");
      card.setAttribute("data-arxiv-daily-paper-section", "true");
      if (paper._outlineId) {
        card.id = paper._outlineId;
        card.setAttribute("data-ari-outline-target", paper._outlineId);
      }
      var arxiv = parseInlineLink(paper.fields.arXiv || "");
      var arxivId = baseArxivId(arxiv.label || arxiv.url);
      var arxivUrl = arxiv.url || (arxivId ? "https://arxiv.org/abs/" + arxivId : "");
      var projectStatus = arxivId ? this._projectNativeStatus(arxivId) : { inProject: false, nativeReady: false };
      var inProject = !!projectStatus.inProject;
      var nativeReady = !!projectStatus.nativeReady;
      if (inProject && !nativeReady && projectStatus.entry && !this._projectItemCreation[arxivId]) {
        this._createZoteroItemFromProjectEntry(projectStatus.entry, this._projectItemSavedCallback(arxivId));
      }
      var paperKey = shortPaperKey(arxivId, paper.title || paper.heading);
      var currentFeedback = this._getPaperFeedback(paperKey);
      var isOtherPaper = stripSectionPrefix(paper._sectionTitle || "") === "其他论文";
      var identifier = isOtherPaper ? "" : (paper.fields["标识符"] || paper.fields["DOI"] || (arxivId ? "arXiv:" + arxivId : ""));
      card.setAttribute("data-arxiv-id", arxivId || "");
      card.setAttribute("data-ari-paper-key", paperKey || "");
      card.style.cssText =
        "border-top:1px solid ThreeDShadow;padding:14px 0 12px;margin:14px 0 0;" +
        "user-select:text;-moz-user-select:text;";

      var top = doc.createElement("div");
      top.style.cssText = "display:flex;align-items:flex-start;gap:8px;";
      var title = doc.createElement("h3");
      var titleText = paper.title || paper.heading;
      if (paper._outlineLabel && titleText && titleText.indexOf(paper._outlineLabel + ".") !== 0) {
        titleText = paper._outlineLabel + ". " + titleText;
      }
      setText(title, titleText);
      title.style.cssText = "flex:1;margin:0;font-size:15px;line-height:1.35;font-weight:650;";
      this._makeHighlightable(title);
      top.appendChild(title);
      var priorReport = parseInlineLink(paper.fields["曾见日报"] || paper.fields["既往日报"] || "");
      var priorDateMatch = String(priorReport.label || priorReport.url || "").match(/\d{4}-\d{2}-\d{2}/);
      var priorDate = priorDateMatch ? priorDateMatch[0] : "";
      if (priorDate && priorDate !== String((meta && meta.date) || "")) {
        top.appendChild(createInlineIconButton(doc, "↩", "这篇论文已在 " + priorDate + " 日报出现；点击跳转到首次报告", function () {
          ArxivDailyCenterWorkspace.showReport(priorDate, arxivId ? { paperId: arxivId } : {});
        }));
      }
      if (nativeReady && !meta.readonly) {
        var locateBtn = createInlineIconButton(doc, "", "定位到 Zotero 项目论文条目", function () {
          if (typeof ArxivDailyLeftPane !== "undefined" && ArxivDailyLeftPane.locateProjectPaperItem) {
            ArxivDailyLeftPane.locateProjectPaperItem(arxivId);
          } else if (typeof ArxivDailyLeftPane !== "undefined" && ArxivDailyLeftPane._locateProjectPaperItem) {
            ArxivDailyLeftPane._locateProjectPaperItem(arxivId);
          }
        }, true);
        locateBtn.appendChild(locateIcon(doc));
        top.appendChild(locateBtn);
      }
      if (inProject && !nativeReady) {
        top.appendChild(nativeMissingIcon(doc, "未添加到原生分类中"));
      }
      if (paper.score) {
        var score = doc.createElement("span");
        setText(score, scoreStars(paper.score) || (paper.score + "/5"));
        score.title = "相关性评分";
        score.style.cssText =
          "flex:0 0 auto;color:CanvasText;font-size:12px;white-space:nowrap;margin-top:1px;";
        top.appendChild(score);
      }
      card.appendChild(top);

      var metaLine = doc.createElement("div");
      metaLine.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 4px;color:GrayText;font-size:12px;";
      if (paper.fields["所在板块"]) {
        var sectionSpan = doc.createElement("span");
        setText(sectionSpan, "所在板块: " + paper.fields["所在板块"]);
        metaLine.appendChild(sectionSpan);
      }
      var authors = paper.fields["作者"] || "";
      if (authors) {
        var authorSpan = doc.createElement("span");
        setText(authorSpan, authors);
        metaLine.appendChild(authorSpan);
      }
      if (paper.fields["分类"]) {
        var cat = doc.createElement("span");
        setText(cat, paper.fields["分类"]);
        metaLine.appendChild(cat);
      }
      if (identifier) {
        var idSpan = doc.createElement("span");
        setText(idSpan, identifier);
        metaLine.appendChild(idSpan);
      }
      if (paper.fields["关键词分数"]) {
        var kw = doc.createElement("span");
        setText(kw, "关键词 " + paper.fields["关键词分数"]);
        metaLine.appendChild(kw);
      }
      if (metaLine.childNodes.length) card.appendChild(metaLine);

      if (arxivUrl) {
        var urlLine = doc.createElement("div");
        urlLine.style.cssText = "margin:4px 0 8px;font-size:12px;word-break:break-all;";
        var link = doc.createElement("a");
        link.href = arxivUrl;
        link.textContent = arxivUrl;
        link.title = "打开 arXiv 页面";
        link.style.cssText = "color:-moz-HyperlinkText;cursor:pointer;";
        urlLine.appendChild(link);
        card.appendChild(urlLine);
      }

      if (paper.tags && paper.tags.length) {
        var tags = doc.createElement("div");
        tags.style.cssText = "display:flex;gap:5px;flex-wrap:wrap;margin:7px 0;";
        for (var t = 0; t < paper.tags.length; t++) {
          var tag = doc.createElement("span");
          setText(tag, paper.tags[t]);
          tag.style.cssText =
            "border:1px solid ThreeDShadow;border-radius:3px;padding:1px 5px;color:GrayText;font-size:11px;";
          tags.appendChild(tag);
        }
        card.appendChild(tags);
      }

      var fieldOrder = ["猜你喜欢理由", "推荐理由", "摘要", "长导读", "交叉导读"];
      for (var f = 0; f < fieldOrder.length; f++) {
        var fieldName = fieldOrder[f];
        var fieldValue = paper.fields[fieldName];
        if (!fieldValue) continue;
        var block = appendLabeledText(doc, card, fieldName, fieldValue, {
          guide: fieldName === "长导读" || fieldName === "交叉导读",
          collapsible: isOtherPaper || fieldName === "长导读" || fieldName === "交叉导读",
          collapsed: isOtherPaper || fieldName === "长导读" || fieldName === "交叉导读",
        });
        this._makeHighlightable(block);
      }

      if (!paper.fields["摘要"] && paper.abstract.length) {
        var abs = appendLabeledText(doc, card, "摘要", paper.abstract.join("\n\n"), {
          collapsible: isOtherPaper,
          collapsed: isOtherPaper,
        });
        this._makeHighlightable(abs);
      }

      var actions = doc.createElement("div");
      actions.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;";
      actions.appendChild(createInlineIconButton(doc, "⧉", "复制论文信息", function () {
        copyText((paper.title || "") + "\n" + authors + "\n" + arxivUrl);
      }));
      if (!meta.readonly) {
        var feedbackPaper = {
          arxivId: arxivId,
          title: paper.title || paper.heading || "",
        };
        [
          ["like", "喜欢", "标记为喜欢；再次点击取消"],
          ["neutral", "一般", "标记为一般；再次点击取消"],
          ["dislike", "不喜欢", "标记为不喜欢；再次点击取消"],
        ].forEach(function (item) {
          actions.appendChild(createFeedbackButton(
            doc,
            item[1],
            item[2],
            currentFeedback === item[0],
            function () {
              ArxivDailyCenterWorkspace._setPaperFeedback(paperKey, item[0], feedbackPaper, meta || {});
              ArxivDailyCenterWorkspace._renderMarkdownReport(
                ArxivDailyCenterWorkspace._currentMarkdown,
                ArxivDailyCenterWorkspace._currentMeta || {}
              );
            }
          ));
        });
        var feedbackHint = doc.createElement("span");
        feedbackHint.textContent = "评价结果只用于训练“猜你喜欢”推荐版块，不影响日报正文";
        feedbackHint.style.cssText = "font-size:11px;color:GrayText;margin-left:2px;line-height:22px;";
        actions.appendChild(feedbackHint);
      }
      if (arxivId && !meta.readonly) {
        actions.appendChild(createInlineIconButton(
          doc,
          inProject ? "✓" : "+",
          inProject ? "已添加入项目论文库；点击将移除" : "加入项目论文库",
          function () {
            if (ArxivDailyCenterWorkspace._isPaperInProject(arxivId)) {
              ArxivDailyCenterWorkspace._removeProjectPaper(arxivId);
            } else {
              ArxivDailyCenterWorkspace._addProjectPaper({
                arxivId: arxivId,
                title: paper.title || arxivId,
                reportDate: meta.date || "",
                authors: authors,
                primaryCategory: paper.fields["分类"] || "",
                recommendation: paper.fields["推荐理由"] || paper.fields["猜你喜欢理由"] || "",
                abstract: paper.fields["摘要"] || paper.abstract.join("\n\n") || "",
                identifier: identifier,
                doi: paper.fields["DOI"] || "",
                journalRef: paper.fields["Journal ref"] || "",
              });
            }
            ArxivDailyCenterWorkspace._renderMarkdownReport(ArxivDailyCenterWorkspace._currentMarkdown, ArxivDailyCenterWorkspace._currentMeta || {});
          },
          inProject
        ));
        if (inProject) {
          var status = doc.createElement("span");
          status.textContent = "已添加入项目论文库";
          status.style.cssText =
            "font-size:11px;color:Highlight;background:rgba(76,111,143,.08);" +
            "border:1px solid ThreeDShadow;border-radius:3px;padding:2px 6px;";
          actions.appendChild(status);
        }
      }
      card.appendChild(actions);
      return card;
    },

    _decorateViewerLinks: function (meta) {
      // The structured renderer owns project-paper buttons. This method remains
      // only as a compatibility no-op for older call sites after index updates.
    },

    _projectNativeStatus: function (arxivId) {
      var status = {
        inProject: false,
        nativeReady: false,
        entry: null,
        error: "",
      };
      if (!arxivId || typeof ArxivDailyDataDir === "undefined") return status;
      try {
        var index = ArxivDailyDataDir.readJSON("project-papers/index.json");
        if (!Array.isArray(index)) return status;
        var id = baseArxivId(arxivId);
        for (var i = 0; i < index.length; i++) {
          var entry = index[i] || {};
          if (baseArxivId(entry.arxivId || entry.id || entry.paperId) !== id) continue;
          status.inProject = true;
          status.entry = entry;
          status.error = entry.zoteroItemError || "";
          var collectionID = parseInt(entry.collectionID || 0, 10);
          var mainID = parseInt(entry.zoteroItemID || entry.itemID || entry.zoteroItemId || 0, 10);
          if (!collectionID || !mainID || status.error || entry.nativeCollectionMissing) return status;
          if (!this._collectionExists(collectionID)) {
            status.error = "Project collection is missing";
            return status;
          }
          if (typeof Zotero !== "undefined" && Zotero.Items) {
            var item = Zotero.Items.get ? Zotero.Items.get(mainID) : null;
            if (!item || item.deleted) {
              status.error = "Zotero item is missing";
              return status;
            }
            status.nativeReady = this._itemInCollection(item, collectionID);
            if (!status.nativeReady) status.error = "Zotero item is not in the project collection";
          } else {
            status.nativeReady = true;
          }
          return status;
        }
      } catch (e) {
        status.error = e.message || String(e);
      }
      return status;
    },

    _isPaperInProject: function (arxivId) {
      return !!this._projectNativeStatus(arxivId).inProject;
    },

    _readProjectIndex: function () {
      if (typeof ArxivDailyDataDir === "undefined") return [];
      var index = ArxivDailyDataDir.readJSON("project-papers/index.json");
      return Array.isArray(index) ? index : [];
    },

    _projectEntryStillExists: function (arxivId) {
      var id = baseArxivId(arxivId);
      if (!id) return false;
      var index = this._readProjectIndex();
      for (var i = 0; i < index.length; i++) {
        if (baseArxivId(index[i] && (index[i].arxivId || index[i].id || index[i].paperId)) === id) {
          return true;
        }
      }
      return false;
    },

    _markProjectItemCancelled: function (arxivId) {
      var id = baseArxivId(arxivId);
      if (id) this._projectItemCancelled[id] = Date.now();
    },

    _clearProjectItemCancelled: function (arxivId) {
      var id = baseArxivId(arxivId);
      if (id && this._projectItemCancelled[id]) delete this._projectItemCancelled[id];
    },

    _projectItemCreationShouldStop: function (arxivId) {
      var id = baseArxivId(arxivId);
      if (!id) return false;
      return !!this._projectItemCancelled[id] || !this._projectEntryStillExists(id);
    },

    _projectItemCreationCancelledError: function (arxivId) {
      var err = new Error("cancelled");
      err.cancelled = true;
      err.arxivId = baseArxivId(arxivId);
      return err;
    },

    _writeProjectIndex: function (index) {
      if (typeof ArxivDailyDataDir === "undefined") return false;
      return ArxivDailyDataDir.writeJSON("project-papers/index.json", Array.isArray(index) ? index : []);
    },

    _projectEntryMatchesGroup: function (entry, group) {
      group = group || {};
      var date = projectPaperDate(entry || {});
      if (group.day) return date === group.day;
      if (group.month) return date.indexOf(group.month) === 0;
      if (group.year) return date.indexOf(group.year) === 0;
      return false;
    },

    _removeProjectEntries: async function (predicate, options) {
      options = options || {};
      if (options.deleteZoteroItems === undefined) options.deleteZoteroItems = true;
      var index = this._readProjectIndex();
      var next = [];
      var removed = [];
      for (var i = 0; i < index.length; i++) {
        if (predicate(index[i])) removed.push(index[i]);
        else next.push(index[i]);
      }
      if (!removed.length) return 0;
      for (var r = 0; r < removed.length; r++) {
        this._markProjectItemCancelled(removed[r] && (removed[r].arxivId || removed[r].id || removed[r].paperId));
      }
      if (!this._writeProjectIndex(next)) throw new Error("Failed to write project-papers/index.json");
      if (options.deleteZoteroItems) await this._deleteProjectZoteroItemsAsync(removed);
      this._refreshProjectStateViews();
      return removed.length;
    },

    deleteProjectPapersByIds: async function (paperIds, options) {
      var ids = {};
      for (var i = 0; i < (paperIds || []).length; i++) {
        var id = baseArxivId(paperIds[i]);
        if (id) ids[id] = true;
      }
      return this._removeProjectEntries(function (entry) {
        return !!ids[baseArxivId(entry && (entry.arxivId || entry.id || entry.paperId))];
      }, options || {});
    },

    deleteProjectPapersByGroup: async function (group, options) {
      var self = this;
      return this._removeProjectEntries(function (entry) {
        return self._projectEntryMatchesGroup(entry, group || {});
      }, options || {});
    },

    deleteReportCascade: async function (dateStr, options) {
      options = options || {};
      if (!dateStr || typeof ArxivDailyReportStore === "undefined") return false;
      var markdown = ArxivDailyReportStore.loadReport(dateStr) || "";
      var ids = extractArxivIdsFromMarkdown(markdown);
      if (ids.length) {
        await this.deleteProjectPapersByIds(ids, { deleteZoteroItems: options.deleteZoteroItems !== false });
      }
      var deleted = ArxivDailyReportStore.deleteReport(dateStr);
      try {
        if (typeof ArxivDailyLeftPane !== "undefined") {
          ArxivDailyLeftPane.refreshReports();
          ArxivDailyLeftPane.refreshProjects();
        }
      } catch (e) {}
      try {
        if (typeof ArxivDailyReminder !== "undefined" && ArxivDailyReminder.refresh) {
          ArxivDailyReminder.refresh();
        }
      } catch (reminderErr) {}
      if (this._currentMeta && this._currentMeta.date === dateStr) {
        this._closeViewer();
      }
      return deleted;
    },

    deleteReportsByDates: async function (dates, options) {
      var count = 0;
      for (var i = 0; i < (dates || []).length; i++) {
        if (await this.deleteReportCascade(dates[i], options || {})) count++;
      }
      return count;
    },

    _addProjectPaper: function (paper) {
      if (!paper || !paper.arxivId || typeof ArxivDailyDataDir === "undefined") return false;
      try {
        this._pruneDeletedProjectEntriesSync({ pruneMissingCollections: true });
        var index = ArxivDailyDataDir.readJSON("project-papers/index.json");
        if (!Array.isArray(index)) index = [];
        var id = baseArxivId(paper.arxivId);
        this._clearProjectItemCancelled(id);
        for (var i = 0; i < index.length; i++) {
          if (baseArxivId(index[i].arxivId || index[i].id || index[i].paperId) === id) {
            index[i].title = index[i].title || paper.title || id;
            index[i].authors = index[i].authors || paper.authors || "";
            index[i].primaryCategory = index[i].primaryCategory || paper.primaryCategory || "";
            index[i].recommendation = paper.recommendation || index[i].recommendation || "";
            index[i].abstract = index[i].abstract || paper.abstract || "";
            index[i].reportDate = index[i].reportDate || paper.reportDate || "";
            index[i].date = index[i].date || paper.reportDate || "";
            index[i].identifier = index[i].identifier || paper.identifier || paper.doi || ("arXiv:" + id);
            index[i].doi = index[i].doi || paper.doi || "";
            index[i].journalRef = index[i].journalRef || paper.journalRef || "";
            try {
              var existingFeedback = this._getFeedbackEntry(id) || this._getFeedbackEntry(shortPaperKey(id, index[i].title));
              if (existingFeedback && existingFeedback.rating) index[i].feedback = existingFeedback;
            } catch (existingFeedbackErr) {}
            ArxivDailyDataDir.writeJSON("project-papers/index.json", index);
            if (this._createZoteroItemFromProjectEntry) {
              this._createZoteroItemFromProjectEntry(index[i], this._projectItemSavedCallback(id));
            }
            if (typeof ArxivDailyLeftPane !== "undefined") {
              ArxivDailyLeftPane.selectProjectPaper(id, false);
            }
            return true;
          }
        }
        var entry = {
          arxivId: id,
          title: paper.title || id,
          authors: paper.authors || "",
          primaryCategory: paper.primaryCategory || "",
          recommendation: paper.recommendation || "",
          abstract: paper.abstract || "",
          reportDate: paper.reportDate || "",
          date: paper.reportDate || "",
          addedAt: Date.now(),
          source: "report",
          identifier: paper.identifier || paper.doi || ("arXiv:" + id),
          doi: paper.doi || "",
          journalRef: paper.journalRef || "",
          url: "https://arxiv.org/abs/" + id,
          itemType: "journalArticle",
        };
        try {
          var feedback = this._getFeedbackEntry(id) || this._getFeedbackEntry(shortPaperKey(id, entry.title));
          if (feedback && feedback.rating) {
            entry.feedback = feedback;
          }
        } catch (feedbackErr) {}
        index.push(entry);
        if (!ArxivDailyDataDir.writeJSON("project-papers/index.json", index)) {
          throw new Error("Failed to write project-papers/index.json");
        }
        if (typeof ArxivDailyLeftPane !== "undefined") {
          ArxivDailyLeftPane.refreshProjects();
          ArxivDailyLeftPane.selectProjectPaper(id, false);
        }
        try {
          if (this._createZoteroItemFromProjectEntry) {
            this._createZoteroItemFromProjectEntry(entry, this._projectItemSavedCallback(id));
          }
        } catch (itemErr) {
          entry.zoteroItemError = itemErr.message || String(itemErr);
          logError("create Zotero item failed: " + entry.zoteroItemError);
        }
        return true;
      } catch (err) {
        logError("add project paper failed: " + (err.message || err));
        var win = Zotero.getMainWindow();
        if (win) win.alert("加入项目论文库失败:\n" + (err.message || err));
        return false;
      }
    },

    _projectItemSavedCallback: function (arxivId) {
      var id = baseArxivId(arxivId);
      return function (result) {
        if (!result) return;
        var patch = typeof result === "object" ? result : { zoteroItemID: result, itemID: result };
        if (patch.zoteroItemError) {
          patch.nativeCollectionMissing = true;
        } else if (patch.zoteroItemID || patch.itemID) {
          patch.zoteroItemError = "";
          patch.nativeCollectionMissing = false;
        }
        try {
          var latest = ArxivDailyDataDir.readJSON("project-papers/index.json");
          if (!Array.isArray(latest)) return;
          for (var j = 0; j < latest.length; j++) {
            if (baseArxivId(latest[j].arxivId || latest[j].id || latest[j].paperId) === id) {
              for (var key in patch) {
                if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined && patch[key] !== null) {
                  latest[j][key] = patch[key];
                }
              }
              if (patch.zoteroItemID && !latest[j].itemID) latest[j].itemID = patch.zoteroItemID;
              break;
            }
          }
          ArxivDailyDataDir.writeJSON("project-papers/index.json", latest);
          if (typeof ArxivDailyLeftPane !== "undefined") ArxivDailyLeftPane.refreshProjects();
          if (typeof ArxivDailyCenterWorkspace !== "undefined") {
            ArxivDailyCenterWorkspace._refreshProjectStateViews();
            var win = ArxivDailyCenterWorkspace._win || (typeof Zotero !== "undefined" && Zotero.getMainWindow ? Zotero.getMainWindow() : null);
            if (win && win.setTimeout) {
              win.setTimeout(function () { try { ArxivDailyCenterWorkspace._refreshProjectStateViews(); } catch (e) {} }, 250);
              win.setTimeout(function () { try { ArxivDailyCenterWorkspace._refreshProjectStateViews(); } catch (e) {} }, 900);
            }
          }
        } catch (updateErr) {
          logError("update project paper zotero item id failed: " + (updateErr.message || updateErr));
        }
      };
    },

    _createZoteroItemFromProjectEntry: function (entry, onSaved) {
      if (!entry || !entry.arxivId || typeof Zotero === "undefined" || !Zotero.Item) return null;
      var self = this;
      var arxivId = baseArxivId(entry.arxivId);
      if (!arxivId) return null;
      function notifySaved(patch) {
        if (typeof onSaved !== "function" || !patch) return;
        try { onSaved(Object.assign({}, patch)); } catch (notifyErr) {}
      }
      if (this._projectItemCreation[arxivId]) {
        this._projectItemCreation[arxivId].then(function (patch) {
          if (patch) notifySaved(patch);
        }).catch(function (err) {
          if (err && err.cancelled) return;
          notifySaved({ zoteroItemError: err.message || String(err) });
        });
        return null;
      }
      this._projectItemCreation[arxivId] = (async function () {
        var patch = {};
        var itemID = 0;
        var collectionID = 0;
        var shouldTrashOnCancel = false;
        async function ensureActive() {
          if (!self._projectItemCreationShouldStop(arxivId)) return;
          try {
            if (itemID && shouldTrashOnCancel) {
              await self._trashZoteroItemIDs([itemID]);
            }
          } catch (cleanupErr) {
            logError("cleanup cancelled project item failed: " + (cleanupErr.message || cleanupErr));
          }
          throw self._projectItemCreationCancelledError(arxivId);
        }
        try {
          await ensureActive();
          var collectionInfo = await self._ensureProjectPaperCollectionInfo(entry);
          collectionID = collectionInfo && collectionInfo.collectionID ? collectionInfo.collectionID : null;
          if (!collectionID || !self._collectionExists(collectionID)) {
            throw new Error("Project paper collection could not be created or is not visible");
          }
          await ensureActive();
          var existing = await self._findExistingProjectZoteroItem(entry);
          var lookedUp = false;
          if (!existing) {
            await ensureActive();
            existing = await self._lookupProjectItemByIdentifier(entry, collectionID);
            lookedUp = !!existing;
          }
          var item = existing || new Zotero.Item("journalArticle");
          if (!existing) item.libraryID = self._userLibraryID();
          shouldTrashOnCancel = !existing || lookedUp;
          await ensureActive();
          self._fillProjectZoteroItem(item, entry, collectionID);
          var saved = await item.saveTx();
          itemID = item.id || saved || entry.zoteroItemID || null;
          if (itemID) {
            await self._ensureItemInCollection(itemID, collectionID, entry);
          }
          patch.zoteroItemID = itemID;
          patch.itemID = itemID;
          patch.collectionID = collectionID || "";
          patch.zoteroItemError = "";
          patch.nativeCollectionMissing = false;
          if (collectionInfo && collectionInfo.path) patch.collectionPath = collectionInfo.path;
          await ensureActive();
          notifySaved(patch);
          if (itemID && (entry.feedback || entry.recommendation)) {
            var noteID = await self._attachFeedbackNoteToItem(itemID, entry);
            if (noteID) patch.noteID = noteID;
          }
          await ensureActive();
          if (itemID) {
            var attachmentID = await self._attachProjectPdfToItem(itemID, entry);
            if (attachmentID) patch.pdfAttachmentID = attachmentID;
            await ensureActive();
            await self._dedupeProjectZoteroItems(entry, itemID, collectionID);
          }
          return patch;
        } catch (err) {
          if ((err && err.cancelled) || self._projectItemCreationShouldStop(arxivId)) {
            throw self._projectItemCreationCancelledError(arxivId);
          }
          logError("async Zotero item save failed: " + (err.message || err));
          throw err;
        }
      })();
      this._projectItemCreation[arxivId].then(function (patch) {
        if (patch) notifySaved(patch);
      }).catch(function (err) {
        if (err && err.cancelled) return;
        notifySaved({ zoteroItemError: err.message || String(err) });
      }).then(function () {
        delete self._projectItemCreation[arxivId];
      });
      return null;
    },

    _identifierCandidatesForProjectEntry: function (entry) {
      var id = baseArxivId(entry && entry.arxivId);
      var candidates = [];
      function push(value) {
        value = String(value || "").trim();
        if (value && candidates.indexOf(value) < 0) candidates.push(value);
      }
      if (id) {
        push("arXiv:" + id);
        push("https://doi.org/10.48550/arXiv." + id);
        push("10.48550/arXiv." + id);
        push(id);
        push("https://arxiv.org/abs/" + id);
      }
      push(entry && entry.identifier);
      if (entry && entry.doi) push(entry.doi);
      if (entry && entry.url) push(entry.url);
      return candidates;
    },

    _identifierObject: function (raw, entry) {
      raw = String(raw || "").trim();
      var id = baseArxivId(raw || (entry && entry.arxivId));
      try {
        if (Zotero.Utilities && Zotero.Utilities.extractIdentifiers) {
          var extracted = Zotero.Utilities.extractIdentifiers(raw);
          if (extracted && extracted.length) return extracted[0];
        }
      } catch (e) {}
      var doi = raw.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
      if (doi) return { DOI: doi[0] };
      if (id && /10\.48550\/arXiv\./i.test(raw)) return { DOI: "10.48550/arXiv." + id };
      if (id) return { arXiv: id };
      return null;
    },

    _lookupProjectItemByIdentifier: async function (entry, collectionID) {
      if (typeof Zotero === "undefined" || !Zotero.Translate || !Zotero.Translate.Search) return null;
      var candidates = this._identifierCandidatesForProjectEntry(entry);
      for (var i = 0; i < candidates.length; i++) {
        var identifier = this._identifierObject(candidates[i], entry);
        if (!identifier) continue;
        try {
          var translate = new Zotero.Translate.Search();
          translate.setIdentifier(identifier);
          var translators = await translate.getTranslators();
          if (!translators || !translators.length) continue;
          translate.setTranslator(translators);
          var items = await translate.translate({
            libraryID: this._userLibraryID(),
            collections: collectionID ? [collectionID] : false,
            saveAttachments: true,
          });
          if (items && items.length) {
            log("created project paper item through Zotero identifier lookup: " + candidates[i]);
            var primary = this._pickProjectTranslatedItem(items, entry);
            await this._trashTranslatedProjectDuplicates(items, primary);
            return primary;
          }
        } catch (err) {
          logError("project paper identifier lookup failed for " + candidates[i] + ": " + (err.message || err));
        }
      }
      return null;
    },

    _pickProjectTranslatedItem: function (items, entry) {
      var id = baseArxivId(entry && entry.arxivId);
      if (!items || !items.length) return null;
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item || item.isAttachment && item.isAttachment()) continue;
        if (!id) return item;
        if (baseArxivId(getItemField(item, "archiveID")) === id ||
            baseArxivId(getItemField(item, "url")) === id ||
            baseArxivId(getItemField(item, "DOI")) === id ||
            getItemField(item, "extra").indexOf(id) >= 0) {
          return item;
        }
      }
      for (var j = 0; j < items.length; j++) {
        if (items[j] && !(items[j].isAttachment && items[j].isAttachment())) return items[j];
      }
      return items[0] || null;
    },

    _trashTranslatedProjectDuplicates: async function (items, primary) {
      if (!items || items.length < 2 || typeof Zotero === "undefined" || !Zotero.Items) return;
      var keepID = primary && (primary.id || primary.itemID);
      var trash = [];
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var id = item && (item.id || item.itemID);
        if (!id || id === keepID) continue;
        if (item.isAttachment && item.isAttachment()) continue;
        if (item.isNote && item.isNote()) continue;
        if (trash.indexOf(id) < 0) trash.push(id);
      }
      if (trash.length) await this._trashZoteroItemIDs(trash);
    },

    _userLibraryID: function () {
      try {
        if (Zotero.Libraries && Zotero.Libraries.userLibraryID) return Zotero.Libraries.userLibraryID;
      } catch (e) {}
      return 1;
    },

    _ensureProjectPaperCollection: async function (entry) {
      var info = await this._ensureProjectPaperCollectionInfo(entry);
      return info && info.collectionID ? info.collectionID : null;
    },

    _ensureProjectPaperCollectionInfo: async function (entry) {
      if (typeof Zotero === "undefined" || !Zotero.Collections || !Zotero.Collection) return null;
      var libraryID = this._userLibraryID();
      var labels = projectCollectionLabels(entry || {});
      var collections = [];
      try {
        if (Zotero.Collections.getByLibrary) {
          collections = await Zotero.Collections.getByLibrary(libraryID, true);
        }
        collections = collections || [];
      } catch (e) {}

      function collectionIsUsable(collection) {
        if (!collection) return false;
        if (collection.deleted || collection.parentDeleted) return false;
        try {
          if (collection.isDeleted && collection.isDeleted()) return false;
        } catch (e0) {}
        try {
          if (collection.libraryID && parseInt(collection.libraryID, 10) !== parseInt(libraryID, 10)) return false;
        } catch (e1) {}
        return true;
      }

      function parentMatches(candidate, parent) {
        if (!parent) return !candidate.parentID && !candidate.parentKey;
        return candidate.parentID === parent.id || candidate.parentKey === parent.key;
      }

      async function findOrCreate(name, parent) {
        for (var i = 0; i < collections.length; i++) {
          var candidate = collections[i];
          if (!collectionIsUsable(candidate)) continue;
          if (!candidate || (candidate.name || "") !== name) continue;
          if (parentMatches(candidate, parent)) return candidate;
        }
        var created = new Zotero.Collection();
        created.libraryID = libraryID;
        created.name = name;
        if (parent) {
          try { created.parentID = parent.id; } catch (parentErr) {}
        }
        await created.saveTx();
        collections.push(created);
        return created;
      }

      var root = await findOrCreate(labels.root, null);
      var project = await findOrCreate(labels.project, root);
      var year = await findOrCreate(labels.year, project);
      var month = await findOrCreate(labels.month, year);
      var day = await findOrCreate(labels.day, month);
      return {
        rootID: root && root.id,
        projectID: project && project.id,
        yearID: year && year.id,
        monthID: month && month.id,
        dayID: day && day.id,
        collectionID: day && day.id,
        path: labels.path,
      };
    },

    _findExistingProjectZoteroItem: async function (entry) {
      if (!entry || typeof Zotero === "undefined" || !Zotero.Items) return null;
      var candidates = [entry.zoteroItemID, entry.itemID, entry.zoteroItemId].filter(Boolean);
      for (var i = 0; i < candidates.length; i++) {
        try {
          var item = Zotero.Items.getAsync
            ? await Zotero.Items.getAsync(candidates[i])
            : Zotero.Items.get(candidates[i]);
          if (item && !item.deleted) return item;
        } catch (e) {}
      }
      try {
        var projectItems = await this._findProjectZoteroItemsByArxivId(entry.arxivId);
        if (projectItems.length) return projectItems[0];
      } catch (searchErr) {}
      try {
        var anyItems = await this._findAnyZoteroItemsByArxivId(entry.arxivId);
        if (anyItems.length) return anyItems[0];
      } catch (broadSearchErr) {}
      return null;
    },

    _findAnyZoteroItemsByArxivId: async function (arxivId) {
      var id = baseArxivId(arxivId);
      if (!id || typeof Zotero === "undefined" || !Zotero.Search || !Zotero.Items) return [];
      var found = [];
      var seen = {};
      var self = this;

      async function addSearchResults(query) {
        var search = new Zotero.Search();
        search.libraryID = self._userLibraryID();
        search.addCondition("field", "contains", query);
        var ids = await search.search();
        ids = ids || [];
        for (var i = 0; i < ids.length; i++) {
          if (seen[ids[i]]) continue;
          seen[ids[i]] = true;
          var item = Zotero.Items.getAsync ? await Zotero.Items.getAsync(ids[i]) : Zotero.Items.get(ids[i]);
          if (!item || item.deleted) continue;
          if (item.isAttachment && item.isAttachment()) continue;
          if (item.isNote && item.isNote()) continue;
          if (itemHasArxivId(item, id)) found.push(item);
        }
      }

      try { await addSearchResults("arXiv Interest Daily arXiv ID: " + id); } catch (e0) {}
      try { await addSearchResults("arXiv:" + id); } catch (e1) {}
      try { await addSearchResults("10.48550/arXiv." + id); } catch (e2) {}
      try { await addSearchResults(id); } catch (e3) {}
      found.sort(function (a, b) {
        return (a.id || 0) - (b.id || 0);
      });
      return found;
    },

    _findProjectZoteroItemsByArxivId: async function (arxivId) {
      var id = baseArxivId(arxivId);
      var items = await this._findAnyZoteroItemsByArxivId(id);
      var managed = [];
      for (var i = 0; i < items.length; i++) {
        if (itemLooksLikeProjectPaper(items[i], id) || this._itemInArxivDailyProjectCollection(items[i])) {
          managed.push(items[i]);
        }
      }
      return managed;
    },

    _itemInArxivDailyProjectCollection: function (item) {
      if (!item || !item.getCollections) return false;
      try {
        var collections = item.getCollections() || [];
        for (var i = 0; i < collections.length; i++) {
          if (!this._collectionExists(collections[i])) continue;
          if (this._isArxivDailyProjectCollection(collections[i])) return true;
        }
      } catch (e) {}
      return false;
    },

    _itemInCollection: function (item, collectionID) {
      if (!item || !collectionID || !item.getCollections) return false;
      try {
        var target = parseInt(collectionID, 10);
        var collections = item.getCollections() || [];
        for (var i = 0; i < collections.length; i++) {
          if (parseInt(collections[i], 10) === target && this._collectionExists(collections[i])) return true;
        }
      } catch (e) {}
      return false;
    },

    _collectionExists: function (collectionID) {
      if (!collectionID || typeof Zotero === "undefined" || !Zotero.Collections) return false;
      try {
        var col = Zotero.Collections.get ? Zotero.Collections.get(collectionID) : null;
        if (!col || col.deleted || col.parentDeleted) return false;
        try {
          if (col.isDeleted && col.isDeleted()) return false;
        } catch (e0) {}
        return true;
      } catch (e) {
        return false;
      }
    },

    _dedupeProjectZoteroItems: async function (entry, keepItemID, collectionID) {
      if (!entry || !entry.arxivId || !keepItemID || typeof Zotero === "undefined") return;
      try {
        var items = await this._findProjectZoteroItemsByArxivId(entry.arxivId);
        var trash = [];
        for (var i = 0; i < items.length; i++) {
          var id = items[i] && (items[i].id || items[i].itemID);
          if (!id || parseInt(id, 10) === parseInt(keepItemID, 10)) continue;
          if (trash.indexOf(id) < 0) trash.push(id);
        }
        if (trash.length) await this._trashZoteroItemIDs(trash);
      } catch (err) {
        logError("dedupe project Zotero items failed: " + (err.message || err));
      }
      try {
        if (collectionID) {
          var keep = Zotero.Items.getAsync ? await Zotero.Items.getAsync(keepItemID) : Zotero.Items.get(keepItemID);
          if (keep && !keep.deleted) {
            await this._ensureItemInCollection(keepItemID, collectionID, entry);
          }
        }
      } catch (saveErr) {
        logError("refresh canonical project item collection failed: " + (saveErr.message || saveErr));
      }
    },

    _ensureItemInCollection: async function (itemID, collectionID, entry) {
      if (!itemID || !collectionID || typeof Zotero === "undefined" || !Zotero.Items) return false;
      if (!this._collectionExists(collectionID)) {
        throw new Error("Project collection is not visible: " + collectionID);
      }
      var item = Zotero.Items.getAsync ? await Zotero.Items.getAsync(itemID) : Zotero.Items.get(itemID);
      if (!item || item.deleted) throw new Error("Project paper item is missing or deleted: " + itemID);
      if (item.isAttachment && item.isAttachment()) {
        throw new Error("Project paper canonical item resolved to an attachment: " + itemID);
      }
      if (item.isNote && item.isNote()) {
        throw new Error("Project paper canonical item resolved to a note: " + itemID);
      }

      this._fillProjectZoteroItem(item, entry || {}, collectionID);
      if (item.saveTx) await item.saveTx();

      var collection = Zotero.Collections && Zotero.Collections.get ? Zotero.Collections.get(collectionID) : null;
      if (collection && collection.addItem) {
        try {
          var added = collection.addItem(itemID);
          if (added && typeof added.then === "function") await added;
        } catch (addErr) {
          logError("collection.addItem failed: " + (addErr.message || addErr));
        }
      }
      if (collection && collection.addItems) {
        try {
          var addedMany = collection.addItems([itemID]);
          if (addedMany && typeof addedMany.then === "function") await addedMany;
        } catch (addManyErr) {
          logError("collection.addItems failed: " + (addManyErr.message || addManyErr));
        }
      }
      if (collection && collection.saveTx) {
        try {
          var savedCollection = collection.saveTx();
          if (savedCollection && typeof savedCollection.then === "function") await savedCollection;
        } catch (collectionSaveErr) {}
      }

      var fresh = Zotero.Items.getAsync ? await Zotero.Items.getAsync(itemID) : Zotero.Items.get(itemID);
      if (fresh && !this._itemInCollection(fresh, collectionID)) {
        try {
          var freshCollections = fresh.getCollections ? (fresh.getCollections() || []) : [];
          var hasTarget = false;
          for (var i = 0; i < freshCollections.length; i++) {
            if (parseInt(freshCollections[i], 10) === parseInt(collectionID, 10)) {
              hasTarget = true;
              break;
            }
          }
          if (!hasTarget) freshCollections.push(collectionID);
          if (fresh.setCollections) fresh.setCollections(freshCollections);
          if (fresh.saveTx) await fresh.saveTx();
        } catch (finalSetErr) {
          logError("final setCollections failed: " + (finalSetErr.message || finalSetErr));
        }
      }

      fresh = Zotero.Items.getAsync ? await Zotero.Items.getAsync(itemID) : Zotero.Items.get(itemID);
      if (!fresh || !this._itemInCollection(fresh, collectionID)) {
        throw new Error("Project paper item was saved but Zotero did not attach it to collection " + collectionID);
      }
      return true;
    },

    _splitProjectAuthors: function (authors) {
      if (Array.isArray(authors)) return authors.filter(Boolean);
      var text = String(authors || "").replace(/\bet\s+al\.?/ig, "").trim();
      if (!text) return [];
      if (text.indexOf(";") >= 0 || text.indexOf("；") >= 0) {
        return text.split(/\s*[;；]\s*/).filter(Boolean);
      }
      if (/\s+and\s+/i.test(text)) {
        return text.split(/\s+and\s+/i).filter(Boolean);
      }
      if (text.indexOf("、") >= 0) return text.split(/\s*、\s*/).filter(Boolean);
      var commaParts = text.split(/\s*,\s*/).filter(Boolean);
      if (commaParts.length > 1 && commaParts.length <= 18) return commaParts;
      return [text];
    },

    _fillProjectZoteroItem: function (item, entry, collectionID) {
      var arxivId = baseArxivId(entry && entry.arxivId);
      setItemFieldSafe(item, "title", entry.title || arxivId || entry.arxivId);
      setItemFieldSafe(item, "abstractNote", entry.abstract);
      setItemFieldSafe(item, "archiveLocation", entry.primaryCategory);
      setItemFieldSafe(item, "url", entry.url || (arxivId ? "https://arxiv.org/abs/" + arxivId : ""));
      setItemFieldSafe(item, "archive", "arXiv");
      setItemFieldSafe(item, "DOI", entry.doi || (arxivId ? "10.48550/arXiv." + arxivId : ""));
      setItemFieldSafe(item, "publicationTitle", entry.journalRef);
      setItemFieldSafe(item, "date", entry.reportDate);
      try {
        var creators = this._splitProjectAuthors(entry.authors);
        for (var i = 0; i < creators.length; i++) {
          if (item.setCreator) item.setCreator(i, { lastName: creators[i], creatorType: "author" });
        }
      } catch (creatorErr) {}
      try {
        var extraLines = [];
        extraLines.push("arXiv Interest Daily: project-paper");
        if (arxivId) {
          extraLines.push("arXiv Interest Daily arXiv ID: " + arxivId);
          extraLines.push("arXiv: " + arxivId);
          extraLines.push("arXiv DOI: https://doi.org/10.48550/arXiv." + arxivId);
        }
        extraLines.push("arXiv Interest Daily 标识符: " + (entry.identifier || ("arXiv:" + entry.arxivId)));
        if (entry.recommendation) extraLines.push("arXiv Interest Daily 推荐理由: " + entry.recommendation);
        if (entry.feedback && entry.feedback.label) extraLines.push("用户评价: " + feedbackPhrase(entry.feedback));
        setItemFieldSafe(item, "extra", extraLines.filter(Boolean).join("\n"));
      } catch (extraErr) {}
      try {
        if (item.addTag) item.addTag("arxiv-interest-daily-project-paper");
        else if (item.setTags) item.setTags([{ tag: "arxiv-interest-daily-project-paper" }]);
      } catch (tagErr) {}
      try {
        if (collectionID && item.setCollections) {
          var collections = item.getCollections ? item.getCollections() : [];
          collections = collections || [];
          collections = collections.filter(function (id) {
            if (!ArxivDailyCenterWorkspace._collectionExists(id)) return false;
            return parseInt(id, 10) === parseInt(collectionID, 10) ||
              !ArxivDailyCenterWorkspace._isArxivDailyProjectCollection(id);
          });
          var hasTarget = false;
          for (var ci = 0; ci < collections.length; ci++) {
            if (parseInt(collections[ci], 10) === parseInt(collectionID, 10)) {
              hasTarget = true;
              break;
            }
          }
          if (!hasTarget) collections.push(collectionID);
          item.setCollections(collections);
        }
        else if (collectionID && item.addToCollection) item.addToCollection(collectionID);
      } catch (collectionErr) {}
    },

    _isArxivDailyProjectCollection: function (collectionID) {
      if (!collectionID || typeof Zotero === "undefined" || !Zotero.Collections) return false;
      try {
        var col = Zotero.Collections.get ? Zotero.Collections.get(collectionID) : null;
        var guard = 0;
        while (col && guard++ < 12) {
          if (col.deleted || col.parentDeleted) return false;
          try {
            if (col.isDeleted && col.isDeleted()) return false;
          } catch (deletedErr) {}
          if ((col.name || "") === "arXiv Interest Daily") return true;
          var parentID = col.parentID || null;
          if (!parentID) break;
          col = Zotero.Collections.get ? Zotero.Collections.get(parentID) : null;
        }
      } catch (e) {}
      return false;
    },

    _attachProjectPdfToItem: async function (itemID, entry) {
      if (!itemID || !entry || !entry.arxivId || typeof Zotero === "undefined" || !Zotero.Attachments) return null;
      try {
        var parent = Zotero.Items && Zotero.Items.getAsync
          ? await Zotero.Items.getAsync(itemID)
          : (Zotero.Items && Zotero.Items.get ? Zotero.Items.get(itemID) : null);
        var attachmentIDs = parent && parent.getAttachments ? parent.getAttachments() : [];
        if (attachmentIDs && attachmentIDs.length) {
          for (var i = 0; i < attachmentIDs.length; i++) {
            var att = Zotero.Items.getAsync ? await Zotero.Items.getAsync(attachmentIDs[i]) : Zotero.Items.get(attachmentIDs[i]);
            var title = att && att.getField ? String(att.getField("title") || "") : "";
            var url = att && att.getField ? String(att.getField("url") || "") : "";
            if (/arxiv/i.test(title) || /arxiv\.org\/pdf/i.test(url)) return attachmentIDs[i];
          }
        }
      } catch (existingErr) {}
      if (!Zotero.Attachments.importFromURL) return null;
      var pdfURL = "https://arxiv.org/pdf/" + entry.arxivId + ".pdf";
      try {
        var imported = await Zotero.Attachments.importFromURL({
          libraryID: this._userLibraryID(),
          parentItemID: itemID,
          url: pdfURL,
          title: "arXiv " + entry.arxivId + " PDF",
          contentType: "application/pdf",
          saveOptions: {},
        });
        return imported && (imported.id || imported.itemID || imported);
      } catch (err) {
        logError("import project paper PDF failed: " + (err.message || err));
        return null;
      }
    },

    _attachFeedbackNoteToItem: async function (itemID, entry) {
      if (!itemID || typeof Zotero === "undefined" || !Zotero.Item) return null;
      var note = null;
      var duplicateNoteIDs = [];
      try {
        var parent = Zotero.Items && Zotero.Items.getAsync
          ? await Zotero.Items.getAsync(itemID)
          : (Zotero.Items && Zotero.Items.get ? Zotero.Items.get(itemID) : null);
        var noteIDs = parent && parent.getNotes ? (parent.getNotes(true) || []) : [];
        for (var i = 0; i < noteIDs.length; i++) {
          var candidate = Zotero.Items.getAsync ? await Zotero.Items.getAsync(noteIDs[i]) : Zotero.Items.get(noteIDs[i]);
          var htmlText = candidate && candidate.getNote ? String(candidate.getNote() || "") : String((candidate && candidate.note) || "");
          var isFeedbackNote = htmlText.indexOf("data-arxiv-interest-daily-feedback") >= 0 ||
            (htmlText.indexOf("arXiv Interest Daily 评价") >= 0 && htmlText.indexOf(baseArxivId(entry && entry.arxivId)) >= 0);
          if (!isFeedbackNote) continue;
          if (!note) note = candidate;
          else duplicateNoteIDs.push(candidate.id || noteIDs[i]);
        }
      } catch (findErr) {
        logError("find existing feedback note failed: " + (findErr.message || findErr));
      }
      if (!note) {
        note = new Zotero.Item("note");
        note.parentID = itemID;
      }
      var userFeedback = entry.feedback && (entry.feedback.label || entry.feedback.rating)
        ? "<p><b>用户评价：</b>" + escapeHTML(feedbackPhrase(entry.feedback)) + "</p>"
        : "";
      var html = [
        '<p data-arxiv-interest-daily-feedback="true" style="display:none">arXiv Interest Daily feedback note</p>',
        "<h2>arXiv Interest Daily 评价</h2>",
        entry.arxivId ? "<p><b>arXiv ID：</b>" + escapeHTML(baseArxivId(entry.arxivId)) + "</p>" : "",
        userFeedback,
        entry.recommendation ? "<p><b>推荐理由：</b>" + escapeHTML(entry.recommendation) + "</p>" : "",
        entry.reportDate ? "<p><b>来源日报：</b>" + escapeHTML(entry.reportDate) + "</p>" : "",
        entry.url ? "<p><b>arXiv：</b>" + escapeHTML(entry.url) + "</p>" : "",
      ].filter(Boolean).join("");
      if (typeof note.setNote === "function") note.setNote(html);
      else note.note = html;
      if (typeof note.saveTx === "function") {
        var saved = await note.saveTx();
        if (duplicateNoteIDs.length) await this._trashZoteroItemIDs(duplicateNoteIDs);
        return note.id || saved || null;
      }
      return null;
    },

    _removeProjectPaper: function (arxivId, options) {
      if (!arxivId || typeof ArxivDailyDataDir === "undefined") return false;
      options = options || {};
      if (options.deleteZoteroItems === undefined) options.deleteZoteroItems = true;
      try {
        var id = baseArxivId(arxivId);
        var index = ArxivDailyDataDir.readJSON("project-papers/index.json");
        if (!Array.isArray(index)) index = [];
        var next = [];
        var removed = [];
        for (var i = 0; i < index.length; i++) {
          if (baseArxivId(index[i].arxivId || index[i].id || index[i].paperId) !== id) {
            next.push(index[i]);
          } else {
            removed.push(index[i]);
          }
        }
        if (next.length === index.length) return false;
        for (var r = 0; r < removed.length; r++) {
          this._markProjectItemCancelled(removed[r] && (removed[r].arxivId || removed[r].id || removed[r].paperId));
        }
        if (!ArxivDailyDataDir.writeJSON("project-papers/index.json", next)) {
          throw new Error("Failed to write project-papers/index.json");
        }
        if (options.deleteZoteroItems) this._deleteProjectZoteroItems(removed);
        this._refreshProjectStateViews();
        return true;
      } catch (err) {
        logError("remove project paper failed: " + (err.message || err));
        return false;
      }
    },

    _deleteProjectZoteroItems: function (entries) {
      if (!entries || !entries.length || typeof Zotero === "undefined" || !Zotero.Items) return;
      var self = this;
      (async function () {
        await self._deleteProjectZoteroItemsAsync(entries);
      })();
    },

    _deleteProjectZoteroItemsAsync: async function (entries) {
      if (!entries || !entries.length || typeof Zotero === "undefined" || !Zotero.Items) return;
      var ids = [];
      var self = this;
      function pushID(value) {
        value = parseInt(value || 0, 10);
        if (value && ids.indexOf(value) < 0) ids.push(value);
      }
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i] || {};
        var mainID = parseInt(entry.zoteroItemID || entry.itemID || entry.zoteroItemId || 0, 10);
        pushID(mainID);
        try {
          if (entry.arxivId) {
            var projectItems = await self._findProjectZoteroItemsByArxivId(entry.arxivId);
            for (var f = 0; f < projectItems.length; f++) {
              pushID(projectItems[f] && (projectItems[f].id || projectItems[f].itemID));
            }
          }
        } catch (findErr) {}
      }
      var topLevelIDs = ids.slice();
      for (var t = 0; t < topLevelIDs.length; t++) {
        try {
          var item = Zotero.Items.getAsync ? await Zotero.Items.getAsync(topLevelIDs[t]) : Zotero.Items.get(topLevelIDs[t]);
          if (item && item.getAttachments) {
            var attachmentIDs = item.getAttachments(true) || [];
            for (var a = 0; a < attachmentIDs.length; a++) pushID(attachmentIDs[a]);
          }
          if (item && item.getNotes) {
            var noteIDs = item.getNotes(true) || [];
            for (var n = 0; n < noteIDs.length; n++) pushID(noteIDs[n]);
          }
        } catch (e) {}
      }
      if (!ids.length) return;
      try {
        this._suppressProjectObserver = true;
        await this._trashZoteroItemIDs(ids);
      } catch (err) {
        logError("delete project Zotero items failed: " + (err.message || err));
      } finally {
        this._suppressProjectObserver = false;
      }
    },

    _trashZoteroItemIDs: async function (ids) {
      if (!ids || !ids.length || typeof Zotero === "undefined" || !Zotero.Items) return;
      var unique = [];
      for (var i = 0; i < ids.length; i++) {
        var id = parseInt(ids[i] || 0, 10);
        if (id && unique.indexOf(id) < 0) unique.push(id);
      }
      if (!unique.length) return;
      if (Zotero.Items.trashTx) {
        try {
          await Zotero.Items.trashTx(unique);
          return;
        } catch (arrayErr) {
          logError("trashTx array failed, retrying one by one: " + (arrayErr.message || arrayErr));
          for (var a = 0; a < unique.length; a++) {
            var trashed = false;
            try {
              await Zotero.Items.trashTx([unique[a]]);
              trashed = true;
            } catch (singleArrayErr) {
              try {
                await Zotero.Items.trashTx(unique[a]);
                trashed = true;
              } catch (singleErr) {
                logError("trashTx item " + unique[a] + " failed: " + (singleErr.message || singleErr));
              }
            }
            if (!trashed) {
              var item = Zotero.Items.getAsync ? await Zotero.Items.getAsync(unique[a]) : Zotero.Items.get(unique[a]);
              if (item) {
                item.deleted = true;
                if (item.saveTx) await item.saveTx();
              }
            }
          }
          return;
        }
      }
      for (var j = 0; j < unique.length; j++) {
        var trashItem = Zotero.Items.getAsync ? await Zotero.Items.getAsync(unique[j]) : Zotero.Items.get(unique[j]);
        if (trashItem) {
          trashItem.deleted = true;
          if (trashItem.saveTx) await trashItem.saveTx();
        }
      }
    },

    _miniIconStyle: function () {
      return "display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;" +
        "margin-left:5px;padding:0;border:1px solid ThreeDShadow;border-radius:3px;" +
        "background:ButtonFace;color:ButtonText;font:10px message-box,system-ui,sans-serif;cursor:pointer;";
    },

    _createDock: function () {
      var doc = this._doc;
      this._dock = doc.createElement("div");
      this._dock.setAttribute("id", "arxiv-daily-center-dock");
      this._dock.style.cssText =
        "display:none;position:absolute;z-index:90;left:0;right:0;bottom:0;" +
        "height:" + this._dockHeight + "px;box-sizing:border-box;background:Canvas;color:CanvasText;" +
        "border-top:1px solid ThreeDShadow;box-shadow:0 -2px 8px rgba(0,0,0,0.14);" +
        "overflow:hidden;";

      this._dockResize = doc.createElement("div");
      this._dockResize.style.cssText =
        "position:absolute;left:0;right:0;top:0;height:6px;cursor:ns-resize;z-index:2;background:transparent;";
      this._dockResize.addEventListener("mouseenter", function () {
        this.style.background = "linear-gradient(to bottom,rgba(76,111,143,.35),rgba(76,111,143,.35) 2px,transparent 2px)";
      });
      this._dockResize.addEventListener("mouseleave", function () {
        this.style.background = "transparent";
      });
      this._dock.appendChild(this._dockResize);

      this._splitter = doc.createElement("div");
      this._splitter.setAttribute("id", "arxiv-daily-center-dock-splitter");
      this._splitter.style.cssText =
        "display:none;position:absolute;top:6px;bottom:0;width:6px;cursor:ew-resize;" +
        "background:transparent;z-index:3;";
      this._splitter.addEventListener("mouseenter", function () {
        this.style.background = "linear-gradient(to right,transparent,rgba(76,111,143,.35),transparent)";
      });
      this._splitter.addEventListener("mouseleave", function () {
        this.style.background = "transparent";
      });
      this._dock.appendChild(this._splitter);

      this._installDockDrag();
    },

    _installDockDrag: function () {
      var self = this;
      this._dockResize.addEventListener("mousedown", function (event) {
        event.preventDefault();
        event.stopPropagation();
        self._heightDrag = {
          startY: event.screenY || event.clientY,
          startHeight: self._dockHeight,
        };
        self._doc.documentElement.style.cursor = "ns-resize";
        self._doc.addEventListener("mousemove", self._onHeightDrag, true);
        self._doc.addEventListener("mouseup", self._onHeightEnd, true);
      }, true);

      this._onHeightDrag = function (event) {
        if (!self._heightDrag) return;
        event.preventDefault();
        event.stopPropagation();
        var y = event.screenY || event.clientY;
        self._dockHeight = self._heightDrag.startHeight + (self._heightDrag.startY - y);
        self._updateLayout();
      };

      this._onHeightEnd = function (event) {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        self._doc.removeEventListener("mousemove", self._onHeightDrag, true);
        self._doc.removeEventListener("mouseup", self._onHeightEnd, true);
        self._doc.documentElement.style.cursor = "";
        self._heightDrag = null;
        setPref("centerDockHeight", Math.round(self._dockHeight));
      };

      this._splitter.addEventListener("mousedown", function (event) {
        event.preventDefault();
        event.stopPropagation();
        var rect = self._dock.getBoundingClientRect();
        self._splitDrag = { left: rect.left, width: Math.max(1, rect.width) };
        self._doc.documentElement.style.cursor = "ew-resize";
        self._doc.addEventListener("mousemove", self._onSplitDrag, true);
        self._doc.addEventListener("mouseup", self._onSplitEnd, true);
      }, true);

      this._onSplitDrag = function (event) {
        if (!self._splitDrag) return;
        event.preventDefault();
        event.stopPropagation();
        var x = event.clientX || event.screenX;
        self._splitRatio = clamp((x - self._splitDrag.left) / self._splitDrag.width, 0.25, 0.75);
        self._updateLayout();
      };

      this._onSplitEnd = function (event) {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        self._doc.removeEventListener("mousemove", self._onSplitDrag, true);
        self._doc.removeEventListener("mouseup", self._onSplitEnd, true);
        self._doc.documentElement.style.cursor = "";
        self._splitDrag = null;
        setPref("centerDockSplitRatio", self._splitRatio);
      };
    },

    _removeDragHandlers: function () {
      if (!this._doc) return;
      this._doc.removeEventListener("mousemove", this._onHeightDrag, true);
      this._doc.removeEventListener("mouseup", this._onHeightEnd, true);
      this._doc.removeEventListener("mousemove", this._onSplitDrag, true);
      this._doc.removeEventListener("mouseup", this._onSplitEnd, true);
      this._doc.documentElement.style.cursor = "";
    },

    _updateLayout: function () {
      if (!this._dock) return;
      var visible = [];
      for (var id in this._panes) {
        if (this._visiblePanels[id]) visible.push(id);
      }
      var hasDock = visible.length > 0;
      var hostHeight = elementHeight(this._host);
      var maxHeight = hostHeight > 0
        ? clamp(Math.floor(hostHeight * 0.72), MIN_DOCK_HEIGHT, MAX_DOCK_HEIGHT)
        : MAX_DOCK_HEIGHT;
      this._dockHeight = clamp(this._dockHeight, MIN_DOCK_HEIGHT, maxHeight);
      this._dock.style.display = hasDock ? "block" : "none";
      this._dock.style.height = this._dockHeight + "px";
      if (this._viewer) this._viewer.style.bottom = hasDock ? this._dockHeight + "px" : "0";

      for (var paneId in this._panes) {
        this._panes[paneId].style.display = this._visiblePanels[paneId] ? "block" : "none";
      }
      if (!hasDock) return;

      var leftId = null;
      var rightId = null;
      for (var i = 0; i < visible.length; i++) {
        var side = this._panes[visible[i]].getAttribute("data-ari-side");
        if (side === "right") rightId = visible[i];
        else leftId = visible[i];
      }
      if (!leftId && visible.length) leftId = visible[0];
      if (!rightId && visible.length > 1) rightId = visible[1] === leftId ? visible[0] : visible[1];

      var top = 6;
      var height = "calc(100% - " + top + "px)";
      if (leftId && rightId && leftId !== rightId) {
        var pct = Math.round(this._splitRatio * 10000) / 100;
        this._panes[leftId].style.cssText += "";
        this._panes[leftId].style.position = "absolute";
        this._panes[leftId].style.left = "0";
        this._panes[leftId].style.top = top + "px";
        this._panes[leftId].style.bottom = "0";
        this._panes[leftId].style.width = "calc(" + pct + "% - 3px)";
        this._panes[leftId].style.height = height;
        this._panes[rightId].style.position = "absolute";
        this._panes[rightId].style.left = "calc(" + pct + "% + 3px)";
        this._panes[rightId].style.right = "0";
        this._panes[rightId].style.top = top + "px";
        this._panes[rightId].style.bottom = "0";
        this._panes[rightId].style.width = "auto";
        this._panes[rightId].style.height = height;
        this._splitter.style.display = "block";
        this._splitter.style.left = "calc(" + pct + "% - 3px)";
      } else {
        var onlyId = leftId || rightId;
        this._splitter.style.display = "none";
        if (onlyId) {
          this._panes[onlyId].style.position = "absolute";
          this._panes[onlyId].style.left = "0";
          this._panes[onlyId].style.right = "0";
          this._panes[onlyId].style.top = top + "px";
          this._panes[onlyId].style.bottom = "0";
          this._panes[onlyId].style.width = "auto";
          this._panes[onlyId].style.height = height;
        }
      }
    },

    _removeEl: function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    },
  };
})();
