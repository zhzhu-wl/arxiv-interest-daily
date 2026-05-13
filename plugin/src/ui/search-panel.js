/* ==========================================================================
 * ui/search-panel.js - Search panel in the shared central bottom dock
 *
 * Search stays in Zotero's central area. Results are compact paper/report
 * entries, and details open in the central reader instead of new tabs.
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";
  const PREFS_PREFIX = "extensions.arxiv-interest-daily.";

  function log(msg) {
    const text = "[" + LOG_PREFIX + "] " + msg;
    if (typeof Zotero.debug === "function") Zotero.debug(text);
    else if (typeof Zotero.log === "function") Zotero.log(text);
  }

  function logError(msg) {
    if (typeof Zotero.logError === "function") Zotero.logError(msg);
    else log("ERROR: " + msg);
  }

  function clearNode(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function createLongLogo(doc, width, height) {
    if (typeof ArxivDailyLogo !== "undefined" && typeof ArxivDailyLogo.longHtml === "function") {
      return ArxivDailyLogo.longHtml(doc, width || 86, height || 24);
    }
    var img = doc.createElement("img");
    img.alt = "";
    img.style.cssText = "width:" + (width || 86) + "px;height:" + (height || 24) + "px;min-width:" + (width || 86) + "px;object-fit:contain;";
    return img;
  }

  function getPref(key, def) {
    try {
      var val = Zotero.Prefs.get(PREFS_PREFIX + key);
      return val !== undefined ? val : def;
    } catch (e) {
      return def;
    }
  }

  function setPref(key, value) {
    try { Zotero.Prefs.set(PREFS_PREFIX + key, value); } catch (e) {}
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

  function baseArxivId(value) {
    return String(value || "")
      .trim()
      .replace(/^arXiv:/i, "")
      .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "")
      .split(/[?#]/)[0]
      .replace(/\.pdf$/i, "")
      .replace(/v\d+$/i, "");
  }

  function isPaperInProject(arxivId) {
    if (!arxivId || typeof ArxivDailyDataDir === "undefined") return false;
    try {
      var index = ArxivDailyDataDir.readJSON("project-papers/index.json");
      if (!Array.isArray(index)) return false;
      var id = baseArxivId(arxivId);
      for (var i = 0; i < index.length; i++) {
        if (baseArxivId(index[i].arxivId || index[i].id || index[i].paperId) === id) {
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  function makeIconButton(doc, label, title) {
    var btn = doc.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.title = title || "";
    btn.style.cssText =
      "display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;" +
      "padding:0;border:1px solid ThreeDShadow;border-radius:3px;background:ButtonFace;" +
      "color:ButtonText;font:11px message-box,system-ui,sans-serif;cursor:pointer;flex:0 0 auto;";
    return btn;
  }

  function extractPaperSections(markdown, report) {
    var lines = String(markdown || "").split(/\r?\n/);
    var sections = [];
    var current = null;
    for (var i = 0; i < lines.length; i++) {
      if (/^###\s+/.test(lines[i])) {
        if (current) sections.push(current);
        current = { report: report, title: lines[i].replace(/^###\s+/, ""), lines: [lines[i]], arxivId: "" };
      } else if (current) {
        current.lines.push(lines[i]);
      }
    }
    if (current) sections.push(current);

    for (var s = 0; s < sections.length; s++) {
      var text = sections[s].lines.join("\n");
      var match = text.match(/arXiv\*\*:\s*\[([^\]]+)\]/i) ||
        text.match(/arXiv\s*:\s*([0-9]{4}\.[0-9]{4,5}|[a-z-]+\/[0-9]{7})/i);
      sections[s].arxivId = match ? baseArxivId(match[1]) : "";
      sections[s].authors = extractField(text, ["作者", "Authors", "Author"]);
      sections[s].tags = extractField(text, ["标签", "Tags", "Keywords"]);
      sections[s].abstract = extractField(text, ["摘要", "Abstract"]);
      sections[s].recommendation = extractField(text, ["推荐理由", "推荐", "Recommendation", "Reason", "Rationale"]);
      sections[s].guide = extractBlock(text, ["导读", "深度导读", "解读", "Guide", "Deep read", "Reading guide"]);
      sections[s].summary = buildSummary(text);
      sections[s].text = text;
    }
    return sections;
  }

  function escapeRegExp(text) {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function extractField(text, labels) {
    var lines = String(text || "").split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var clean = lines[i].replace(/\*\*/g, "").replace(/^[-*]\s*/, "").trim();
      for (var j = 0; j < labels.length; j++) {
        var re = new RegExp("^" + escapeRegExp(labels[j]) + "\\s*[:：]\\s*(.+)$", "i");
        var match = clean.match(re);
        if (match && match[1]) return cleanText(match[1]);
      }
    }
    return "";
  }

  function extractBlock(text, labels) {
    var lines = String(text || "").split(/\r?\n/);
    var out = [];
    var collecting = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var clean = line.replace(/\*\*/g, "").replace(/^[-*]\s*/, "").trim();
      if (!collecting) {
        for (var j = 0; j < labels.length; j++) {
          var re = new RegExp("^" + escapeRegExp(labels[j]) + "\\s*[:：]?\\s*(.*)$", "i");
          var match = clean.match(re);
          if (match) {
            collecting = true;
            if (match[1]) out.push(match[1]);
            break;
          }
        }
        continue;
      }
      if (/^(arXiv|分类|作者|标签|推荐理由|摘要|###|---|Authors|Tags|Abstract|Recommendation|Reason)\b/i.test(clean)) break;
      if (clean) out.push(clean);
      if (out.join(" ").length > 1200) break;
    }
    return cleanText(out.join(" "));
  }

  function buildSummary(text) {
    var lines = String(text || "").split(/\r?\n/);
    var picked = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\*\*/g, "").trim();
      if (!line || /^###/.test(line) || /^---/.test(line)) continue;
      if (/^(arXiv|分类|作者|推荐理由|标签)/i.test(line) || picked.length === 0) {
        picked.push(line);
      }
      if (picked.join(" ").length > 150) break;
    }
    return picked.join(" ").slice(0, 180);
  }

  function normalizeToken(token) {
    var t = cleanText(token).toLowerCase()
      .replace(/[“”‘’"'`´]/g, "")
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!t) return "";
    if (/^[a-z][a-z-]{4,}$/i.test(t)) {
      t = t.replace(/ies$/, "y")
        .replace(/(ing|edly|edly|ed|es|s)$/i, "");
    }
    return t;
  }

  var SEMANTIC_ALIASES = {
    "拓扑": ["拓扑相", "拓扑超导", "topology", "topological", "topological superconductivity"],
    "马约拉纳": ["majorana", "mzm", "zero mode", "零能模"],
    "约瑟夫森": ["josephson", "junction", "tunneling", "隧穿"],
    "mzm": ["majorana", "zero", "mode", "零能", "马约拉纳"],
    "majorana": ["mzm", "zero mode", "zero-bias", "马约拉纳"],
    "topological": ["topology", "topological", "拓扑", "拓扑超导"],
    "topology": ["topological", "拓扑", "拓扑相"],
    "superconduct": ["superconductor", "superconductivity", "pairing", "超导", "配对"],
    "josephson": ["junction", "tunneling", "约瑟夫森", "隧穿"],
    "qsh": ["quantum spin hall", "edge", "helical", "量子自旋霍尔", "边缘态"],
    "qah": ["quantum anomalous hall", "chiral", "量子反常霍尔"],
    "edge": ["boundary", "helical", "chiral", "边缘", "边界"],
    "vortex": ["涡旋", "磁通"],
    "stm": ["sts", "jstm", "scanning tunneling", "扫描隧道"],
    "sts": ["stm", "spectroscopy", "隧道谱"],
    "kagome": ["kagome", "笼目"],
    "nematic": ["nematicity", "向列"],
    "2deg": ["two-dimensional electron gas", "二维电子气"],
  };

  var QUERY_CORRECTIONS = [
    ["拓普", "拓扑"],
    ["拓普超导", "拓扑超导"],
    ["马约拉那", "马约拉纳"],
    ["马拉约纳", "马约拉纳"],
    ["约瑟夫生", "约瑟夫森"],
    ["toplogy", "topology"],
    ["topolgy", "topology"],
    ["toplogie", "topology"],
    ["toplogical", "topological"],
    ["topologic", "topological"],
    ["superconduting", "superconducting"],
    ["supercondutor", "superconductor"],
    ["majrorana", "majorana"],
    ["majoranna", "majorana"],
  ];

  function inferSearchQuery(query) {
    var original = cleanText(query);
    var corrected = original;
    var reasons = [];
    for (var i = 0; i < QUERY_CORRECTIONS.length; i++) {
      var from = QUERY_CORRECTIONS[i][0];
      var to = QUERY_CORRECTIONS[i][1];
      var re = new RegExp(escapeRegExp(from), "ig");
      if (re.test(corrected)) {
        corrected = corrected.replace(re, to);
        reasons.push(from + " -> " + to);
      }
    }

    // English token-level rescue for common typo distance. This stays local
    // and conservative, so normal technical spellings are not rewritten.
    var canonical = ["topology", "topological", "superconducting", "superconductor", "majorana", "josephson"];
    corrected = corrected.replace(/\b[a-z][a-z-]{4,}\b/gi, function (token) {
      var lower = token.toLowerCase();
      for (var c = 0; c < canonical.length; c++) {
        var target = canonical[c];
        if (lower === target) return token;
        var sim = tokenSimilarity(lower, target);
        if (sim >= 0.78 && Math.abs(lower.length - target.length) <= 3) {
          reasons.push(token + " -> " + target);
          return target;
        }
      }
      return token;
    });

    corrected = cleanText(corrected);
    if (!corrected || corrected === original) {
      return {
        originalQuery: original,
        query: original,
        corrected: false,
        reason: "",
      };
    }
    return {
      originalQuery: original,
      query: corrected,
      corrected: true,
      reason: unique(reasons).join(", "),
    };
  }

  function expandToken(token) {
    var t = normalizeToken(token);
    if (!t) return [];
    var out = [t];
    var aliases = SEMANTIC_ALIASES[t] || [];
    for (var i = 0; i < aliases.length; i++) {
      var aliasParts = tokenizeText(aliases[i]);
      for (var a = 0; a < aliasParts.length; a++) out.push(aliasParts[a]);
    }
    return unique(out);
  }

  function unique(items) {
    var seen = {};
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var item = normalizeToken(items[i]);
      if (!item || seen[item]) continue;
      seen[item] = true;
      out.push(item);
    }
    return out;
  }

  function tokenizeText(text) {
    var raw = cleanText(text).toLowerCase();
    var tokens = [];
    var matches = raw.match(/[\p{L}\p{N}][\p{L}\p{N}._+-]*/gu) || [];
    for (var i = 0; i < matches.length; i++) {
      var t = normalizeToken(matches[i]);
      if (t && t.length >= 2) tokens.push(t);
    }
    var cjk = raw.match(/[\u4e00-\u9fff]{2,}/g) || [];
    for (var c = 0; c < cjk.length; c++) {
      var chunk = cjk[c];
      tokens.push(chunk);
      for (var j = 0; j < chunk.length - 1; j++) {
        tokens.push(chunk.slice(j, j + 2));
      }
    }
    return unique(tokens);
  }

  function levenshtein(a, b) {
    a = normalizeToken(a);
    b = normalizeToken(b);
    if (!a || !b) return 99;
    if (a === b) return 0;
    var prev = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var cur = [i];
      for (var k = 1; k <= b.length; k++) {
        var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
        cur[k] = Math.min(cur[k - 1] + 1, prev[k] + 1, prev[k - 1] + cost);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function tokenSimilarity(a, b) {
    a = normalizeToken(a);
    b = normalizeToken(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length >= 3 && b.indexOf(a) >= 0) return 0.86;
    if (b.length >= 3 && a.indexOf(b) >= 0) return 0.82;
    var maxLen = Math.max(a.length, b.length);
    if (maxLen < 4) return 0;
    var dist = levenshtein(a, b);
    return Math.max(0, 1 - dist / maxLen);
  }

  function fieldScore(queryTokens, fieldText, weight) {
    var field = cleanText(fieldText).toLowerCase();
    if (!field) return { score: 0, hits: [] };
    var tokens = tokenizeText(field);
    var score = 0;
    var hits = [];
    for (var q = 0; q < queryTokens.length; q++) {
      var variants = expandToken(queryTokens[q]);
      var best = 0;
      var bestHit = "";
      for (var v = 0; v < variants.length; v++) {
        var variant = variants[v];
        if (field.indexOf(variant) >= 0) {
          best = Math.max(best, variant === normalizeToken(queryTokens[q]) ? 1 : 0.78);
          bestHit = variant;
          continue;
        }
        for (var t = 0; t < tokens.length; t++) {
          var sim = tokenSimilarity(variant, tokens[t]);
          if (sim > best) {
            best = sim;
            bestHit = tokens[t];
          }
        }
      }
      if (best >= 0.72) {
        score += best * weight;
        if (bestHit) hits.push(bestHit);
      }
    }
    return { score: score, hits: unique(hits) };
  }

  function fieldTextForKey(section, key) {
    if (key === "title") return section.title || "";
    if (key === "authors") return section.authors || "";
    if (key === "tags") return section.tags || "";
    if (key === "abstract") return section.abstract || "";
    if (key === "recommendation") return section.recommendation || "";
    if (key === "guide") return section.guide || "";
    if (key === "fulltext") return section.text || "";
    return "";
  }

  function buildSearchText(section, activeFields) {
    var fields = activeFields && activeFields.length ? activeFields : ["title", "authors", "tags", "abstract", "recommendation", "guide", "fulltext"];
    var parts = [];
    for (var i = 0; i < fields.length; i++) {
      var text = fieldTextForKey(section, fields[i]);
      if (text) parts.push(text);
    }
    return cleanText(parts.join("\n"));
  }

  function fuzzySemanticScore(query, section, activeFields) {
    var normalizedQuery = cleanText(query).toLowerCase();
    var queryTokens = tokenizeText(normalizedQuery);
    if (!queryTokens.length) return { score: 0, reason: "" };
    var score = 0;
    var hits = [];
    var arxiv = baseArxivId(normalizedQuery);
    if (arxiv && section.arxivId && baseArxivId(section.arxivId).indexOf(arxiv) >= 0) {
      score += 100;
      hits.push(section.arxivId);
    }
    var weights = {
      title: 8,
      authors: 6,
      tags: 6,
      abstract: 5,
      recommendation: 6,
      guide: 5,
      fulltext: 2,
    };
    var fields = activeFields && activeFields.length ? activeFields : Object.keys(weights);
    for (var f = 0; f < fields.length; f++) {
      var scored = fieldScore(queryTokens, fieldTextForKey(section, fields[f]), weights[fields[f]] || 2);
      score += scored.score;
      hits = hits.concat(scored.hits);
    }
    var haystack = cleanText([buildSearchText(section, fields), section.arxivId].join(" ")).toLowerCase();
    if (normalizedQuery.length >= 3 && haystack.indexOf(normalizedQuery) >= 0) {
      score += 18;
      hits.unshift(normalizedQuery);
    }
    var coverage = Math.min(1, unique(hits).length / Math.max(1, queryTokens.length));
    score += coverage * 8;
    return {
      score: score,
      reason: unique(hits).slice(0, 5).join(", "),
    };
  }

  function getCfg(path, fallback) {
    try {
      if (typeof ArxivDailyConfig !== "undefined") {
        var val = ArxivDailyConfig.get(path);
        return val !== undefined && val !== null ? val : fallback;
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
    if (key.length === 1 && eventKey !== key) return false;
    if (key.length > 1 && eventKey !== key) return false;
    return (!!event.ctrlKey === (parts.indexOf("ctrl") >= 0)) &&
      (!!event.metaKey === (parts.indexOf("meta") >= 0 || parts.indexOf("cmd") >= 0 || parts.indexOf("command") >= 0)) &&
      (!!event.shiftKey === (parts.indexOf("shift") >= 0)) &&
      (!!event.altKey === (parts.indexOf("alt") >= 0));
  }

  function shortcutLabel(shortcut) {
    if (typeof ArxivDailyShortcuts !== "undefined" && ArxivDailyShortcuts.format) {
      return ArxivDailyShortcuts.format(shortcut);
    }
    return shortcut || "";
  }

  function stripJSONFence(text) {
    return String(text || "").trim()
      .replace(/^```(?:json|JSON)?\s*/, "")
      .replace(/\s*```$/, "")
      .trim();
  }

  function parseLLMSearchResponse(text) {
    var raw = stripJSONFence(text);
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      var start = raw.indexOf("[");
      var end = raw.lastIndexOf("]");
      if (start < 0 || end <= start) throw e;
      parsed = JSON.parse(raw.slice(start, end + 1));
    }
    if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
      parsed = parsed.results || parsed.items || parsed.papers;
    }
    if (!Array.isArray(parsed)) throw new Error("LLM 搜索结果不是 JSON 数组");
    return parsed.filter(function (item) { return item && typeof item === "object"; });
  }

  function buildLLMSearchPrompt(query, sections) {
    var entries = sections.map(function (section, index) {
      return [
        "Result " + (index + 1) + ":",
        "  idx: " + (index + 1),
        "  report_date: " + (section.report.date || ""),
        "  arxiv_id: " + (section.arxivId || ""),
        "  title: " + (section.title || ""),
        "  text: " + String(section.searchText || section.text || "").slice(0, getCfg("search.excerptChars", 1400)),
      ].join("\n");
    }).join("\n\n---\n\n");
    return [
      "用户正在搜索历史 arXiv 日报推荐。",
      "请根据语义相关性排序，不要求字面关键词完全匹配。",
      "查询: " + query,
      "",
      "只返回 JSON 数组，不要 Markdown，不要额外说明。schema:",
      '[{"idx":1,"score":5,"reason":"简短中文理由"}]',
      "",
      entries,
    ].join("\n");
  }

  globalThis.ArxivDailySearch = {
    _panel: null,
    _input: null,
    _dateFrom: null,
    _dateTo: null,
    _fieldChecks: null,
    _results: null,
    _resultsCanvas: null,
    _resultsContent: null,
    _status: null,
    _visible: false,
    _fontSize: 12,
    _zoom: 1,
    _searchModelRef: "",

    init: function (win) {
      var doc = win.document;
      if (this._panel) return;
      this._fontSize = parseInt(getPref("searchFontSize", 12), 10) || 12;
      this._zoom = Math.max(0.7, Math.min(1.8, parseFloat(getPref("searchZoom", 1)) || 1));

      this._panel = doc.createElement("div");
      this._panel.setAttribute("id", "arxiv-daily-search-panel");
      this._panel.style.cssText =
        "display:flex;width:100%;height:100%;box-sizing:border-box;" +
        "flex-direction:column;background:Canvas;color:CanvasText;overflow:hidden;";

      var header = doc.createElement("div");
      header.style.cssText =
        "display:flex;align-items:center;padding:5px 8px;border-bottom:1px solid ThreeDShadow;" +
        "font-size:12px;gap:6px;box-sizing:border-box;";

      this._input = doc.createElement("input");
      this._input.setAttribute("type", "text");
      this._input.setAttribute("placeholder", "关键词、arXiv ID、作者");
      this._input.style.cssText =
        "flex:1;min-width:0;padding:4px 7px;border:1px solid ThreeDShadow;" +
        "border-radius:3px;background:Field;color:FieldText;font:12px message-box,system-ui,sans-serif;";

      var searchBtn = doc.createElement("button");
      searchBtn.textContent = "关键词";
      searchBtn.title = "关键词 / 模糊语义搜索（" + shortcutLabel(getCfg("shortcuts.searchKeyword", "Enter")) + "）";
      searchBtn.style.cssText =
        "padding:4px 10px;font-size:12px;border:1px solid ThreeDShadow;" +
        "border-radius:3px;background:ButtonFace;color:ButtonText;cursor:pointer;";
      searchBtn.addEventListener("click", function () {
        if (typeof ArxivDailySearch !== "undefined") ArxivDailySearch.runSearch("keyword");
      });

      var llmBtn = doc.createElement("button");
      llmBtn.textContent = "LLM";
      llmBtn.title = "使用已配置模型进行语义搜索，会消耗 API token（" + shortcutLabel(getCfg("shortcuts.searchLLM", "Accel+Enter")) + "）";
      llmBtn.style.cssText =
        "padding:4px 10px;font-size:12px;border:1px solid ThreeDShadow;" +
        "border-radius:3px;background:ButtonFace;color:ButtonText;cursor:pointer;";
      llmBtn.addEventListener("click", function () {
        if (typeof ArxivDailySearch !== "undefined") ArxivDailySearch.runSearch("llm");
      });
      var llmMenuBtn = doc.createElement("button");
      llmMenuBtn.type = "button";
      llmMenuBtn.textContent = "▾";
      llmMenuBtn.title = "选择 LLM 搜索模型";
      llmMenuBtn.style.cssText =
        "width:18px;min-width:18px;padding:4px 0;font-size:10px;border:1px solid ThreeDShadow;" +
        "border-radius:3px;background:ButtonFace;color:ButtonText;cursor:pointer;";
      llmMenuBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        ArxivDailySearch._chooseSearchModel(llmMenuBtn);
      });
      this._input.addEventListener("keydown", function (event) {
        if (typeof ArxivDailySearch !== "undefined" &&
            matchesShortcut(event, getCfg("shortcuts.searchLLM", "Accel+Enter"))) {
          event.preventDefault();
          ArxivDailySearch.runSearch("llm");
        } else if (typeof ArxivDailySearch !== "undefined" &&
            matchesShortcut(event, getCfg("shortcuts.searchKeyword", "Enter"))) {
          event.preventDefault();
          ArxivDailySearch.runSearch("keyword");
        }
      });

      var fontRange = doc.createElement("input");
      fontRange.type = "range";
      fontRange.min = "10";
      fontRange.max = "18";
      fontRange.step = "1";
      fontRange.value = String(this._fontSize);
      fontRange.title = "搜索结果字号";
      fontRange.style.cssText = "width:58px;cursor:pointer;";
      fontRange.addEventListener("input", function () {
        ArxivDailySearch._fontSize = parseInt(fontRange.value, 10) || 12;
        setPref("searchFontSize", ArxivDailySearch._fontSize);
        ArxivDailySearch._applyDisplayPrefs();
      });

      var closeBtn = makeIconButton(doc, "x", "关闭搜索");
      closeBtn.addEventListener("click", function () {
        if (typeof ArxivDailySearch !== "undefined") ArxivDailySearch.hide();
      });

      header.appendChild(createLongLogo(doc, 88, 24));
      header.appendChild(this._input);
      header.appendChild(searchBtn);
      header.appendChild(llmBtn);
      header.appendChild(llmMenuBtn);
      header.appendChild(fontRange);
      header.appendChild(closeBtn);
      this._panel.appendChild(header);

      var filters = doc.createElement("div");
      filters.style.cssText =
        "display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 8px;" +
        "border-bottom:1px solid ThreeDShadow;font-size:11px;color:GrayText;";
      var fromLabel = doc.createElement("label");
      fromLabel.textContent = "从";
      this._dateFrom = doc.createElement("input");
      this._dateFrom.type = "date";
      this._dateFrom.title = "开始日期";
      this._dateFrom.style.cssText = "font:11px message-box,system-ui,sans-serif;min-height:22px;";
      fromLabel.appendChild(this._dateFrom);
      var toLabel = doc.createElement("label");
      toLabel.textContent = "到";
      this._dateTo = doc.createElement("input");
      this._dateTo.type = "date";
      this._dateTo.title = "结束日期";
      this._dateTo.style.cssText = "font:11px message-box,system-ui,sans-serif;min-height:22px;";
      toLabel.appendChild(this._dateTo);
      filters.appendChild(fromLabel);
      filters.appendChild(toLabel);

      var fieldDefs = [
        ["title", "标题"],
        ["authors", "作者"],
        ["tags", "标签"],
        ["abstract", "摘要"],
        ["recommendation", "推荐理由"],
        ["guide", "导读"],
        ["fulltext", "全文"],
      ];
      this._fieldChecks = {};
      for (var fd = 0; fd < fieldDefs.length; fd++) {
        var label = doc.createElement("label");
        label.style.cssText = "display:inline-flex;align-items:center;gap:2px;white-space:nowrap;";
        var check = doc.createElement("input");
        check.type = "checkbox";
        check.checked = true;
        check.setAttribute("data-search-field", fieldDefs[fd][0]);
        check.style.cssText = "margin:0;";
        this._fieldChecks[fieldDefs[fd][0]] = check;
        label.appendChild(check);
        label.appendChild(doc.createTextNode(fieldDefs[fd][1]));
        filters.appendChild(label);
      }
      var clearFilters = makeIconButton(doc, "↺", "清除日期和字段筛选");
      clearFilters.addEventListener("click", function () {
        if (ArxivDailySearch._dateFrom) ArxivDailySearch._dateFrom.value = "";
        if (ArxivDailySearch._dateTo) ArxivDailySearch._dateTo.value = "";
        var checks = ArxivDailySearch._fieldChecks || {};
        Object.keys(checks).forEach(function (key) { checks[key].checked = true; });
      });
      filters.appendChild(clearFilters);
      this._panel.appendChild(filters);

      this._status = doc.createElement("div");
      this._status.style.cssText =
        "padding:4px 8px;color:GrayText;font-size:11px;border-bottom:1px solid ThreeDShadow;";
      this._status.textContent = "输入关键词开始搜索";
      this._panel.appendChild(this._status);

      this._results = doc.createElement("div");
      this._results.setAttribute("id", "arxiv-daily-search-results");
      this._results.style.cssText =
        "flex:1 1 auto;min-height:0;overflow:auto;padding:0;font-size:12px;position:relative;";
      this._resultsCanvas = doc.createElement("div");
      this._resultsCanvas.setAttribute("data-ari-search-canvas", "true");
      this._resultsCanvas.style.cssText =
        "position:relative;overflow:visible;box-sizing:border-box;min-width:0;min-height:0;";
      this._resultsContent = doc.createElement("div");
      this._resultsContent.setAttribute("data-ari-search-content", "true");
      this._resultsContent.style.cssText =
        "box-sizing:border-box;padding:4px 6px;transform-origin:top left;";
      this._resultsCanvas.appendChild(this._resultsContent);
      this._results.appendChild(this._resultsCanvas);
      this._results.addEventListener("wheel", function (event) {
        if (!event.ctrlKey) return;
        event.preventDefault();
        var delta = event.deltaY > 0 ? -0.06 : 0.06;
        ArxivDailySearch._setZoom(ArxivDailySearch._zoom + delta, event);
      }, { passive: false });
      this._panel.appendChild(this._results);
      this._applyDisplayPrefs();

      if (typeof ArxivDailyCenterWorkspace !== "undefined") {
        ArxivDailyCenterWorkspace.mountPanel("search", "Search", this._panel, "left");
      }

      log("search panel initialized");
    },

    _setZoom: function (value, anchorEvent) {
      var oldZoom = clamp(this._zoom || 1, 0.7, 1.8);
      var nextZoom = clamp(value, 0.7, 1.8);
      var scroller = this._results;
      var layer = this._resultsContent;
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

      this._zoom = nextZoom;
      setPref("searchZoom", this._zoom);
      this._applyDisplayPrefs();

      if (scroller && anchorEvent && oldZoom !== nextZoom) {
        layer = this._resultsContent;
        if (layer && layer.getBoundingClientRect) {
          var nextRect = layer.getBoundingClientRect();
          scroller.scrollLeft = Math.max(0, scroller.scrollLeft + nextRect.left + contentX * nextZoom - clientX);
          scroller.scrollTop = Math.max(0, scroller.scrollTop + nextRect.top + contentY * nextZoom - clientY);
        }
      }
    },

    destroy: function () {
      if (this._panel && this._panel.parentNode) this._panel.parentNode.removeChild(this._panel);
      this._panel = null;
      this._input = null;
      this._dateFrom = null;
      this._dateTo = null;
      this._fieldChecks = null;
      this._results = null;
      this._resultsCanvas = null;
      this._resultsContent = null;
      this._status = null;
      this._visible = false;
    },

    show: function () {
      if (typeof ArxivDailyCenterWorkspace !== "undefined") {
        ArxivDailyCenterWorkspace.showPanel("search");
      }
      this._visible = true;
      if (this._input) this._input.focus();
    },

    hide: function () {
      if (typeof ArxivDailyCenterWorkspace !== "undefined") {
        ArxivDailyCenterWorkspace.hidePanel("search");
      }
      this._visible = false;
    },

    toggle: function () {
      if (this._visible) this.hide();
      else this.show();
    },

    _applyDisplayPrefs: function () {
      if (this._resultsContent) {
        this._resultsContent.style.fontSize = (this._fontSize || 12) + "px";
        this._updateResultsCanvas();
      }
      if (this._status) this._status.style.fontSize = Math.max(10, (this._fontSize || 12) - 1) + "px";
    },

    _clearResults: function () {
      clearNode(this._resultsContent || this._results);
      if (this._resultsCanvas) this._resultsCanvas.removeAttribute("data-ari-base-width");
      this._updateResultsCanvas();
    },

    _appendResult: function (node) {
      (this._resultsContent || this._results).appendChild(node);
      this._updateResultsCanvas();
    },

    _updateResultsCanvas: function () {
      if (!this._results || !this._resultsCanvas || !this._resultsContent) return;
      var zoom = clamp(this._zoom || 1, 0.7, 1.8);
      var baseWidth = parseFloat(this._resultsCanvas.getAttribute("data-ari-base-width") || "0");
      if (!baseWidth) {
        this._resultsContent.style.transform = "none";
        baseWidth = Math.max(1, this._results.clientWidth || this._resultsContent.offsetWidth || 0);
        this._resultsContent.style.width = baseWidth + "px";
        this._resultsCanvas.setAttribute("data-ari-base-width", String(baseWidth));
      }
      var baseHeight = Math.max(1, this._resultsContent.scrollHeight || this._resultsContent.offsetHeight || 0);
      var visualWidth = Math.max(baseWidth, this._resultsContent.scrollWidth || 0, this._resultsContent.offsetWidth || 0);
      this._resultsContent.style.transform = "scale(" + zoom + ")";
      this._resultsContent.style.transformOrigin = "top left";
      this._resultsCanvas.style.width = Math.ceil(visualWidth * zoom) + "px";
      this._resultsCanvas.style.height = Math.ceil(baseHeight * zoom) + "px";
    },

    _setStatus: function (message, action) {
      if (!this._status) return;
      clearNode(this._status);
      this._status.appendChild(this._status.ownerDocument.createTextNode(message || ""));
      if (action && action.label && typeof action.onClick === "function") {
        var btn = this._status.ownerDocument.createElement("button");
        btn.type = "button";
        btn.textContent = action.label;
        btn.title = action.title || action.label;
        btn.style.cssText =
          "margin-left:8px;padding:1px 7px;border:1px solid ThreeDShadow;border-radius:3px;" +
          "background:ButtonFace;color:ButtonText;font:11px message-box,system-ui,sans-serif;cursor:pointer;";
        btn.addEventListener("click", action.onClick);
        this._status.appendChild(btn);
      }
    },

    _chooseSearchModel: function () {
      var win = this._panel ? this._panel.ownerDocument.defaultView : null;
      var models = [];
      try {
        if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.getAvailableModels) {
          models = ArxivDailyLLM.getAvailableModels();
        }
      } catch (e) {}
      if (!win || !win.openDialog) return;
      var dialog = win.openDialog("about:blank", "arxiv-daily-search-model",
        "chrome,centerscreen,resizable,width=420,height=220");
      if (!dialog) return;
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        try { dialog.close(); } catch (e) {}
      }
      function render() {
        if (done || dialog.closed) return;
        var doc = dialog.document;
        doc.open();
        doc.write("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>选择搜索模型</title></head><body></body></html>");
        doc.close();
        var style = doc.createElement("style");
        style.textContent = "html,body{width:100%;height:100%;margin:0}body{box-sizing:border-box;background:Canvas;color:CanvasText;font:13px message-box,system-ui,sans-serif}.wrap{height:100%;box-sizing:border-box;padding:16px;display:flex;flex-direction:column;gap:12px}select{width:100%;min-height:28px}.actions{margin-top:auto;display:flex;justify-content:flex-end;gap:8px}button{min-width:72px;padding:5px 12px}";
        doc.head.appendChild(style);
        var root = doc.createElement("main");
        root.className = "wrap";
        var title = doc.createElement("strong");
        title.textContent = "LLM 搜索模型";
        var select = doc.createElement("select");
        for (var i = 0; i < models.length; i++) {
          var opt = doc.createElement("option");
          opt.value = models[i].ref;
          opt.textContent = models[i].label;
          select.appendChild(opt);
        }
        var current = "";
        try { current = ArxivDailyLLM.getUsageModelRef("search") || ""; } catch (e2) {}
        select.value = current || (models[0] ? models[0].ref : "");
        var hint = doc.createElement("div");
        hint.textContent = models.length ? "保存后 LLM 搜索按钮会直接使用该模型。" : "当前没有已配置可用模型。";
        hint.style.cssText = "color:GrayText;font-size:12px;";
        var actions = doc.createElement("div");
        actions.className = "actions";
        var cancel = doc.createElement("button");
        cancel.textContent = "取消";
        cancel.type = "button";
        cancel.addEventListener("click", finish);
        var ok = doc.createElement("button");
        ok.textContent = "保存";
        ok.type = "button";
        ok.disabled = !models.length;
        ok.addEventListener("click", function () {
          var value = select.value || "";
          ArxivDailySearch._searchModelRef = value;
          if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.setUsageModelRef) {
            ArxivDailyLLM.setUsageModelRef("search", value);
          }
          finish();
        });
        actions.appendChild(cancel);
        actions.appendChild(ok);
        root.appendChild(title);
        root.appendChild(select);
        root.appendChild(hint);
        root.appendChild(actions);
        doc.body.appendChild(root);
      }
      win.setTimeout(render, 0);
      dialog.addEventListener("load", render, { once: true });
      dialog.addEventListener("unload", finish, { once: true });
    },

    runSearch: function (mode, options) {
      options = options || {};
      var rawQuery = this._input ? this._input.value.trim() : "";
      if (!rawQuery) return;
      mode = mode || "keyword";
      var queryInfo = options.forceOriginal
        ? { originalQuery: rawQuery, query: rawQuery, corrected: false, reason: "" }
        : inferSearchQuery(rawQuery);
      queryInfo.mode = mode;
      var query = queryInfo.query;

      log("searching: " + query + " mode=" + mode + (queryInfo.corrected ? " original=" + rawQuery : ""));
      this.show();
      this._setStatus("搜索中...");
      this._clearResults();

      if (typeof ArxivDailyReportStore === "undefined") {
        this._setStatus("报告存储尚未初始化");
        return;
      }

      var filters = this._currentFilters();
      var sections = this._collectSections(filters);
      if (mode === "llm") {
        this._runLLMSearch(query, sections, queryInfo);
        return;
      }

      var results = [];
      for (var s = 0; s < sections.length; s++) {
        var scored = fuzzySemanticScore(query, sections[s], filters.fields);
        if (scored.score > 0) {
          var result = Object.assign({}, sections[s]);
          result.searchText = buildSearchText(sections[s], filters.fields);
          result.fuzzyScore = scored.score;
          result.fuzzyReason = scored.reason;
          results.push(result);
        }
      }
      results.sort(function (a, b) { return (b.fuzzyScore || 0) - (a.fuzzyScore || 0); });
      var minScore = results.length > 10 ? Math.max(4, results[0].fuzzyScore * 0.18) : 1;
      results = results.filter(function (item) { return (item.fuzzyScore || 0) >= minScore; }).slice(0, 50);

      this._displayResults(results, query, queryInfo);
    },

    _currentFilters: function () {
      var fields = [];
      var checks = this._fieldChecks || {};
      Object.keys(checks).forEach(function (key) {
        if (checks[key].checked) fields.push(key);
      });
      if (!fields.length) fields = ["title", "authors", "tags", "abstract", "recommendation", "guide", "fulltext"];
      return {
        from: this._dateFrom ? this._dateFrom.value || "" : "",
        to: this._dateTo ? this._dateTo.value || "" : "",
        fields: fields,
      };
    },

    _dateAllowed: function (date, filters) {
      date = String(date || "");
      if (filters.from && date && date < filters.from) return false;
      if (filters.to && date && date > filters.to) return false;
      return true;
    },

    _collectSections: function (filters) {
      filters = filters || this._currentFilters();
      var index = ArxivDailyReportStore.listReports();
      var sections = [];
      var maxSections = Math.max(100, parseInt(getCfg("search.maxLocalSections", 1200), 10) || 1200);
      for (var i = 0; i < index.length; i++) {
        var report = index[i];
        if (!this._dateAllowed(report.date, filters)) continue;
        var content = ArxivDailyReportStore.loadReport(report.date) || "";
        var reportSections = extractPaperSections(content, report);
        for (var s = 0; s < reportSections.length; s++) {
          reportSections[s].searchText = buildSearchText(reportSections[s], filters.fields);
          sections.push(reportSections[s]);
          if (sections.length >= maxSections) return sections;
        }
      }
      return sections;
    },

    _runLLMSearch: function (query, sections, queryInfo) {
      var self = this;
      var searchModelRef = self._searchModelRef ||
        (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.getUsageModelRef ? ArxivDailyLLM.getUsageModelRef("search") : "");
      if (typeof ArxivDailyLLM === "undefined" ||
          !ArxivDailyLLM.isConfigured({ kind: "search", modelRef: searchModelRef })) {
        this._setStatus("LLM 尚未配置，无法语义搜索");
        return;
      }
      if (!sections.length) {
        this._setStatus("暂无可搜索报告");
        return;
      }
      var maxCandidates = Math.max(5, parseInt(getCfg("search.llmCandidates", 20), 10) || 20);
      var returnCount = Math.max(1, parseInt(getCfg("search.returnCount", 10), 10) || 10);
      var filters = this._currentFilters();
      var scoredCandidates = sections.map(function (section) {
        var copy = Object.assign({}, section);
        var score = fuzzySemanticScore(query, section, filters.fields);
        copy.localScore = score.score;
        copy.localReason = score.reason;
        copy.searchText = buildSearchText(section, filters.fields);
        return copy;
      });
      scoredCandidates.sort(function (a, b) { return (b.localScore || 0) - (a.localScore || 0); });
      var candidates = scoredCandidates.filter(function (section) { return (section.localScore || 0) > 0; }).slice(0, maxCandidates);
      if (!candidates.length) candidates = scoredCandidates.slice(0, maxCandidates);
      this._clearResults();
      this._setStatus("LLM 语义搜索已加入任务进度");

      var runner = async function (token, onProgress) {
        onProgress("收集搜索候选: " + candidates.length + " 条", 15);
        var prompt = buildLLMSearchPrompt(query, candidates);
        onProgress("LLM 语义搜索请求中", 45);
        var response = await ArxivDailyLLM.complete(
          "你是论文推荐搜索助手。只返回严格 JSON。",
          prompt,
          token,
          { kind: "search", modelRef: searchModelRef }
        );
        if (token.cancelled) return;
        onProgress("解析 LLM 搜索结果", 80);
        var parsed = parseLLMSearchResponse(response);
        var results = [];
        for (var i = 0; i < parsed.length; i++) {
          var idx = parseInt(parsed[i].idx || parsed[i].id || parsed[i].index, 10);
          if (!Number.isFinite(idx) || idx < 1 || idx > candidates.length) continue;
          var section = candidates[idx - 1];
          section.summary = (parsed[i].reason || section.summary || "") + (section.arxivId ? " | " + section.arxivId : "");
          section.llmScore = parsed[i].score || "";
          results.push(section);
        }
        results = results.slice(0, returnCount);
        var win = self._panel ? self._panel.ownerDocument.defaultView : null;
        if (win) {
          win.setTimeout(function () {
            self._displayResults(results, query, queryInfo);
          }, 0);
        }
        onProgress("LLM 搜索完成: " + results.length + " 个结果", 100);
      };

      if (typeof ArxivDailyTaskManager !== "undefined") {
        ArxivDailyTaskManager.start("searchReports", "LLM 语义搜索", runner);
      } else {
        runner({ cancelled: false }, function () {}).catch(function (err) {
          self._setStatus("LLM 搜索失败: " + (err.message || err));
        });
      }
    },

    _displayResults: function (results, query, queryInfo) {
      var doc = (this._resultsContent || this._results).ownerDocument;
      this._clearResults();
      var self = this;
      var correctionAction = null;
      if (queryInfo && queryInfo.corrected) {
        correctionAction = {
          label: "保持原输入搜索",
          title: "改用原输入 “" + queryInfo.originalQuery + "” 重新搜索",
          onClick: function () {
            self.runSearch(queryInfo.mode || "keyword", { forceOriginal: true });
          },
        };
      }

      if (results.length === 0) {
        var emptyMsg = "未找到匹配结果";
        if (queryInfo && queryInfo.corrected) {
          emptyMsg = "正在以“" + queryInfo.query + "”搜索，未找到匹配结果；原输入为“" + queryInfo.originalQuery + "”。";
        }
        this._setStatus(emptyMsg, correctionAction);
        return;
      }

      var status = "找到 " + results.length + " 个结果" + (query ? "（关键词已启用模糊语义匹配）" : "");
      if (queryInfo && queryInfo.corrected) {
        status = "正在以“" + queryInfo.query + "”搜索，找到 " + results.length +
          " 个结果；原输入为“" + queryInfo.originalQuery + "”。";
      }
      this._setStatus(status, correctionAction);
      for (var i = 0; i < results.length; i++) {
        this._appendResult(this._createResultItem(doc, results[i]));
      }
    },

    _createResultItem: function (doc, result) {
      var item = doc.createElement("div");
      item.style.cssText =
        "padding:6px 6px;margin:2px 0;border-radius:4px;cursor:pointer;" +
        "border:1px solid transparent;box-sizing:border-box;";

      item.addEventListener("mouseenter", function () {
        this.style.background = "SelectedItem";
        this.style.color = "SelectedItemText";
      });
      item.addEventListener("mouseleave", function () {
        this.style.background = "transparent";
        this.style.color = "";
      });
      item.addEventListener("click", function () {
        if (typeof ArxivDailyCenterWorkspace !== "undefined") {
          ArxivDailyCenterWorkspace.showReport(result.report.date, {
            paperId: result.arxivId,
            title: result.title,
          });
        }
      });

      var head = doc.createElement("div");
      head.style.cssText = "display:flex;align-items:center;gap:5px;min-width:0;";

      var locateReport = makeIconButton(doc, "A", "在左侧报告框中定位报告");
      locateReport.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof ArxivDailyLeftPane !== "undefined") {
          ArxivDailyLeftPane.selectReport(result.report.date, false);
        }
      });
      head.appendChild(locateReport);

      var title = doc.createElement("div");
      title.textContent = result.title || result.report.date;
      title.style.cssText =
        "flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      head.appendChild(title);

      if (isPaperInProject(result.arxivId)) {
        var locateProject = makeIconButton(doc, "B", "定位并打开项目论文");
        locateProject.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          if (typeof ArxivDailyLeftPane !== "undefined") {
            ArxivDailyLeftPane.selectProjectPaper(result.arxivId || result.title, true);
          }
        });
        head.appendChild(locateProject);
      }

      var summary = doc.createElement("div");
      summary.textContent = result.report.date + (result.arxivId ? " | " + result.arxivId : "") +
        (result.fuzzyReason ? " | 命中: " + result.fuzzyReason : "") +
        (result.summary ? " | " + result.summary : "");
      summary.style.cssText =
        "margin-top:3px;color:GrayText;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

      item.appendChild(head);
      item.appendChild(summary);
      return item;
    },
  };
  globalThis.ArxivDailySearch._chooseSearchModel = function (anchor) {
    var win = (anchor && anchor.ownerDocument && anchor.ownerDocument.defaultView) ||
      (this._panel ? this._panel.ownerDocument.defaultView : null);
    var models = [];
    try {
      if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.getAvailableModels) {
        models = ArxivDailyLLM.getAvailableModels();
      }
    } catch (e) {}
    if (!win || !win.document) return;
    var doc = win.document;
    var old = doc.getElementById("arxiv-daily-search-model-menu");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var menu = doc.createElement("div");
    menu.id = "arxiv-daily-search-model-menu";
    menu.style.cssText =
      "position:fixed;z-index:2147483647;min-width:220px;max-width:360px;max-height:300px;overflow:auto;" +
      "box-sizing:border-box;padding:4px;background:Canvas;color:CanvasText;border:1px solid ThreeDShadow;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.22);font:12px message-box,system-ui,sans-serif;";
    function finish() {
      var node = doc.getElementById("arxiv-daily-search-model-menu");
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }
    for (var i = 0; i < models.length; i++) {
      (function (model) {
        var item = doc.createElement("button");
        item.type = "button";
        item.textContent = model.label;
        item.style.cssText =
          "display:block;width:100%;box-sizing:border-box;text-align:left;padding:5px 8px;border:0;" +
          "background:transparent;color:CanvasText;font:12px message-box,system-ui,sans-serif;cursor:pointer;";
        item.addEventListener("mouseenter", function () {
          item.style.background = "SelectedItem";
          item.style.color = "SelectedItemText";
        });
        item.addEventListener("mouseleave", function () {
          item.style.background = "transparent";
          item.style.color = "CanvasText";
        });
        item.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          ArxivDailySearch._searchModelRef = model.ref || "";
          if (typeof ArxivDailyLLM !== "undefined" && ArxivDailyLLM.setUsageModelRef) {
            ArxivDailyLLM.setUsageModelRef("search", model.ref || "");
          }
          finish();
        });
        menu.appendChild(item);
      })(models[i]);
    }
    if (!models.length) {
      var hint = doc.createElement("div");
      hint.textContent = "当前没有已配置可用模型";
      hint.style.cssText = "padding:5px 8px;color:GrayText;";
      menu.appendChild(hint);
    }
    (doc.documentElement || doc.body).appendChild(menu);
    var rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 12, bottom: 80 };
    var width = Math.max(220, Math.min(360, menu.offsetWidth || 240));
    var left = Math.max(8, Math.min(rect.left || 12, (win.innerWidth || 900) - width - 8));
    var top = Math.max(8, Math.min((rect.bottom || 80) + 4, (win.innerHeight || 700) - (menu.offsetHeight || 200) - 8));
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
    win.setTimeout(function () {
      doc.addEventListener("mousedown", function onDocMouseDown(event) {
        if (!menu.contains(event.target)) {
          doc.removeEventListener("mousedown", onDocMouseDown, true);
          finish();
        }
      }, true);
    }, 0);
  };
})();
