/* ==========================================================================
 * arxiv/fetcher.js - arXiv announcement and API fetching
 *
 * Primary strategy follows the desktop Python project:
 *   1. Read /list/{category}/new?skip=0&show=N announcement pages for today.
 *   2. Read /catchup?subject={category}&date=YYYY-MM-DD for past reports.
 *   3. Keep the nearest arXiv publication date and requested sections.
 *   4. Fetch full metadata from the arXiv API by ID list.
 *
 * If announcement pages fail or parse to zero papers, fall back to the arXiv
 * API submittedDate query so report generation does not stop at an empty page.
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";
  const ARXIV_SITE = "https://arxiv.org";
  const ARXIV_API = "https://export.arxiv.org/api/query";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_RETRY_WAIT_SECONDS = [30, 60, 120, 240, 480];

  function log(msg) {
    const text = "[" + LOG_PREFIX + "] " + msg;
    if (typeof Zotero.debug === "function") Zotero.debug(text);
    else if (typeof Zotero.log === "function") Zotero.log(text);
  }

  function logError(msg) {
    if (typeof Zotero.logError === "function") Zotero.logError(msg);
    else log("ERROR: " + msg);
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function sleepCancellable(ms, cancelToken) {
    var end = Date.now() + Math.max(0, ms);
    while (Date.now() < end) {
      if (cancelToken && cancelToken.cancelled) throw new Error("cancelled");
      await sleep(Math.min(1000, end - Date.now()));
    }
  }

  function notifyProgress(callback, step, pct) {
    if (typeof callback !== "function" || !step) return;
    try {
      callback(step, pct);
    } catch (e) {}
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

  function getNumberCfg(path, fallback, min, max) {
    var val = parseFloat(getCfg(path, fallback));
    if (!Number.isFinite(val)) val = fallback;
    if (Number.isFinite(min)) val = Math.max(min, val);
    if (Number.isFinite(max)) val = Math.min(max, val);
    return val;
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function getBoolCfg(path, fallback) {
    var val = getCfg(path, fallback);
    if (val === "false") return false;
    if (val === "true") return true;
    return !!val;
  }

  function parseRetryWaitSeconds(raw) {
    var values = [];
    if (Array.isArray(raw)) {
      values = raw;
    } else if (typeof raw === "string") {
      values = raw.split(/[,\s]+/);
    } else if (raw !== undefined && raw !== null) {
      values = [raw];
    }

    values = values.map(function (val) {
      return parseFloat(val);
    }).filter(function (val) {
      return Number.isFinite(val) && val > 0;
    });

    return values.length > 0 ? values : DEFAULT_RETRY_WAIT_SECONDS.slice();
  }

  function retryWaitsMs(retryMax) {
    var waits = parseRetryWaitSeconds(getCfg("arxiv.retryWaitSeconds", DEFAULT_RETRY_WAIT_SECONDS));
    var retryCount = Math.round(retryMax);
    if (!Number.isFinite(retryCount)) retryCount = 3;
    retryCount = clamp(retryCount, 0, 10);

    while (waits.length < retryCount) {
      waits.push(Math.min(waits[waits.length - 1] * 2, 600));
    }

    return waits.slice(0, retryCount).map(function (seconds) {
      return clamp(seconds * 1000, 1000, 600000);
    });
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch (e) {
      return value;
    }
  }

  function decodeEntities(text) {
    if (!text) return "";
    var named = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    };
    return String(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (m, code) {
      var lower = code.toLowerCase();
      if (named[lower]) return named[lower];
      if (lower.charAt(0) === "#") {
        var num = lower.charAt(1) === "x"
          ? parseInt(lower.slice(2), 16)
          : parseInt(lower.slice(1), 10);
        if (Number.isFinite(num)) return String.fromCharCode(num);
      }
      return m;
    });
  }

  function cleanText(value) {
    return decodeEntities(String(value || "").replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripDescriptor(text, label) {
    var out = cleanText(text || "");
    if (label) {
      out = out.replace(new RegExp("^" + label + "\\s*:?\\s*", "i"), "");
    }
    return out.trim();
  }

  function extractClassBlock(html, className) {
    var re = new RegExp(
      "<div\\b[^>]*class\\s*=\\s*[\"'][^\"']*\\b" + className + "\\b[^\"']*[\"'][^>]*>([\\s\\S]*?)<\\/div>",
      "i"
    );
    var match = String(html || "").match(re);
    return match ? match[1] : "";
  }

  function extractClassField(html, className, label) {
    var block = extractClassBlock(html, className);
    if (!block) return "";
    block = block.replace(/<span\b[^>]*class\s*=\s*["'][^"']*\bdescriptor\b[^"']*["'][^>]*>[\s\S]*?<\/span>/i, " ");
    return stripDescriptor(block, label);
  }

  function extractFirstParagraph(html) {
    var match = String(html || "").match(/<p\b[^>]*class\s*=\s*["'][^"']*\bmathjax\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    return match ? cleanText(match[1]) : "";
  }

  function baseArxivId(value) {
    var id = safeDecodeURIComponent(String(value || "").trim());
    id = id.replace(/^arXiv:/i, "");
    id = id.replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "");
    id = id.split(/[?#]/)[0].replace(/\.pdf$/i, "").trim();
    return id.replace(/v\d+$/i, "");
  }

  function cacheEnabled() {
    return getBoolCfg("arxiv.cacheEnabled", true);
  }

  function cacheTtlDays() {
    var hours = getNumberCfg("arxiv.cacheMaxAgeHours", 6, 0.1, 24 * 30);
    return hours / 24;
  }

  function cacheGetFresh(key) {
    if (!cacheEnabled() || typeof ArxivDailyCache === "undefined") return null;
    var cached = ArxivDailyCache.get("arxiv", key);
    return cached && cached.text ? cached.text : null;
  }

  function cacheGetStale(key) {
    if (!cacheEnabled() || typeof ArxivDailyCache === "undefined") return null;
    var cached = ArxivDailyCache.getStale("arxiv", key);
    return cached && cached.text ? cached.text : null;
  }

  function cacheSet(key, text) {
    if (!cacheEnabled() || typeof ArxivDailyCache === "undefined") return;
    ArxivDailyCache.set("arxiv", key, {
      text: text,
      cachedAt: Date.now(),
    }, cacheTtlDays());
  }

  function retryAfterMs(retryAfter) {
    if (retryAfter) {
      var seconds = parseInt(retryAfter, 10);
      if (Number.isFinite(seconds) && seconds > 0) {
        return seconds * 1000;
      }

      var dateMs = Date.parse(retryAfter);
      if (Number.isFinite(dateMs)) {
        return Math.max(0, dateMs - Date.now());
      }
    }

    return 0;
  }

  function retryDelayMs(attempt, status, retryWaits, retryAfter) {
    var configured = retryWaits[Math.min(attempt, retryWaits.length - 1)] || 30000;
    var wait = Math.max(configured, retryAfterMs(retryAfter));

    if (status === 429) wait = Math.max(wait, 30000);
    if (!status || status >= 500) wait = Math.max(wait, 5000);

    return clamp(wait, 1000, 600000);
  }

  function statusIsRetryable(status) {
    if (!status) return true;
    return status === 408 || status === 409 || status === 425 ||
      status === 429 || status >= 500;
  }

  function requestOptions() {
    var timeoutMs = Math.round(getNumberCfg("arxiv.requestTimeoutSeconds", 60, 10, 180) * 1000);
    var opts = {
      method: "GET",
      headers: {
        Accept: "application/atom+xml,text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
    };
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      opts.signal = AbortSignal.timeout(timeoutMs);
    }
    return opts;
  }

  async function fetchTextWithRetry(url, cacheKind, retryMax, cancelToken, progressCallback) {
    var lastErr = "unknown error";
    var retryWaits = retryWaitsMs(retryMax);
    var totalTries = retryWaits.length + 1;
    var triesMade = 0;

    for (var attempt = 0; attempt < totalTries; attempt++) {
      if (cancelToken && cancelToken.cancelled) throw new Error("cancelled");
      triesMade++;
      var retryAfter = "";
      var status = 0;
      try {
        var resp = await fetch(url, requestOptions());
        status = resp.status;
        retryAfter = resp.headers && resp.headers.get ? resp.headers.get("Retry-After") : "";
        if (resp.ok) {
          var text = await resp.text();
          if (responseLooksValid(cacheKind, text)) return text;
          lastErr = "invalid arXiv response body for " + cacheKind;
        } else {
          lastErr = "HTTP " + resp.status;
        }
      } catch (e) {
        lastErr = e.message || String(e);
      }

      if (attempt >= retryWaits.length) {
        break;
      }

      if (!statusIsRetryable(status) && lastErr.indexOf("invalid arXiv response body") !== 0) {
        break;
      }

      var waitMs = retryDelayMs(attempt, status, retryWaits, retryAfter);
      if (status === 429 || /rate[- ]?limit/i.test(lastErr)) {
        notifyProgress(progressCallback, "arXiv API is busy/rate-limited; waiting before retry", 15);
      } else {
        notifyProgress(progressCallback, "Fetching arXiv papers", 15);
      }
      log("arXiv request failed (" + lastErr + "), retry " + (attempt + 1) + "/" +
        retryWaits.length + " after " + Math.round(waitMs / 1000) + "s");
      await sleepCancellable(waitMs, cancelToken);
    }
    throw new Error("fetch failed after " + triesMade + " tries: " + lastErr);
  }

  function responseLooksValid(cacheKind, text) {
    if (!text) return false;
    if (cacheKind === "announcement") {
      return /arxiv/i.test(text) &&
        (/<h3\b/i.test(text) || /<dl\b/i.test(text) || /\/abs\//i.test(text) ||
         /catchup\s+results/i.test(text) || /no\s+(new\s+)?submissions/i.test(text));
    }
    if (cacheKind === "api-search" || cacheKind === "api-id-list") {
      return /<feed[\s>]/i.test(text) && /<\/feed>/i.test(text);
    }
    return true;
  }

  function extractAnnouncementDatesFromHTML(text) {
    var seen = {};
    var dates = [];
    var html = String(text || "");
    var headerRegex = /<(?:h1|h2|h3)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|h3)>/gi;
    var match;

    function addDate(value) {
      var date = parseAnnouncementDate(value);
      if (date && !seen[date]) {
        seen[date] = true;
        dates.push(date);
      }
    }

    while ((match = headerRegex.exec(html)) !== null) {
      addDate(match[1] || "");
    }

    if (dates.length === 0) {
      addDate(cleanText(html.slice(0, 12000)));
    }

    return dates.sort();
  }

  function cacheMatchesRequest(cacheKind, text, context) {
    context = context || {};
    if (cacheKind !== "announcement") return true;

    var expectedDate = normalizeDateStr(context.expectedAnnouncementDate);
    if (!expectedDate) return true;

    var dates = extractAnnouncementDatesFromHTML(text);
    if (dates.length === 0) {
      log("ignoring cached arXiv announcement: no parseable publication date for expected " + expectedDate);
      return false;
    }
    if (dates.indexOf(expectedDate) < 0) {
      log("ignoring cached arXiv announcement: expected date " + expectedDate +
        ", cached dates " + dates.join(", "));
      return false;
    }
    return true;
  }

  async function fetchTextProtected(url, cacheKind, retryMax, cancelToken, progressCallback, cacheContext) {
    var key = cacheKind + ":" + url;
    var fresh = cacheGetFresh(key);
    if (fresh && responseLooksValid(cacheKind, fresh) && cacheMatchesRequest(cacheKind, fresh, cacheContext)) {
      log("using cached arXiv response: " + cacheKind);
      notifyProgress(progressCallback, "Using arXiv cache", 18);
      return fresh;
    } else if (fresh && responseLooksValid(cacheKind, fresh)) {
      notifyProgress(progressCallback, "Ignoring arXiv cache with mismatched date", 18);
    }

    try {
      var text = await fetchTextWithRetry(url, cacheKind, retryMax, cancelToken, progressCallback);
      cacheSet(key, text);
      return text;
    } catch (e) {
      if (cancelToken && cancelToken.cancelled) throw e;
      var stale = cacheGetStale(key);
      if (stale && responseLooksValid(cacheKind, stale) && cacheMatchesRequest(cacheKind, stale, cacheContext)) {
        log("arXiv request failed; using stale cache: " + cacheKind + " (" + (e.message || e) + ")");
        notifyProgress(progressCallback, "Using arXiv cache", 18);
        return stale;
      } else if (stale && responseLooksValid(cacheKind, stale)) {
        log("arXiv request failed; stale cache exists but does not match requested date: " + (e.message || e));
      }
      throw e;
    }
  }

  // ------------------------------------------------------------------------
  // Announcement URLs and date parsing
  // ------------------------------------------------------------------------

  function announcementNewUrl(category) {
    var show = Math.round(getNumberCfg("arxiv.announcementPageSize", 1000, 100, 2000));
    return ARXIV_SITE + "/list/" + encodeURIComponent(category) + "/new?skip=0&show=" + show;
  }

  function catchupUrl(category, dateStr) {
    return ARXIV_SITE + "/catchup?subject=" + encodeURIComponent(category) +
      "&date=" + encodeURIComponent(dateStr);
  }

  function normalizeDateStr(value) {
    var match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    var ms = Date.UTC(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
    if (!Number.isFinite(ms)) return "";
    var date = new Date(ms);
    var out = date.getUTCFullYear() + "-" +
      String(date.getUTCMonth() + 1).padStart(2, "0") + "-" +
      String(date.getUTCDate()).padStart(2, "0");
    return out === value ? out : "";
  }

  function dateMs(dateStr) {
    var normalized = normalizeDateStr(dateStr);
    if (!normalized) return NaN;
    var parts = normalized.split("-");
    return Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  function dateStrFromMs(ms) {
    var date = new Date(ms);
    return date.getUTCFullYear() + "-" +
      String(date.getUTCMonth() + 1).padStart(2, "0") + "-" +
      String(date.getUTCDate()).padStart(2, "0");
  }

  function historyDateWindow(targetDate) {
    var targetMs = dateMs(targetDate);
    var daysBack = Math.round(getNumberCfg("arxiv.daysBack", 3, 1, 365));
    return {
      targetDate: targetDate,
      startDate: dateStrFromMs(targetMs - daysBack * DAY_MS),
      endDate: targetDate,
      daysBack: daysBack,
    };
  }

  function datesForWindowNewestFirst(win) {
    var dates = [];
    var startMs = dateMs(win.startDate);
    var endMs = dateMs(win.endDate);
    for (var ms = endMs; ms >= startMs; ms -= DAY_MS) {
      dates.push(dateStrFromMs(ms));
    }
    return dates;
  }

  function filterByAnnouncementWindow(papers, win) {
    var inWindow = [];
    var selectedDate = "";
    for (var i = 0; i < papers.length; i++) {
      var date = papers[i].announcementDate || "";
      if (!date || date < win.startDate || date > win.endDate) continue;
      inWindow.push(papers[i]);
      if (!selectedDate || date > selectedDate) selectedDate = date;
    }
    if (!selectedDate) {
      return {
        papers: [],
        selectedDate: "",
        inWindowCount: inWindow.length,
      };
    }
    return {
      papers: inWindow.filter(function (paper) {
        return paper.announcementDate === selectedDate;
      }),
      selectedDate: selectedDate,
      inWindowCount: inWindow.length,
    };
  }

  function monthNumber(monthName) {
    var key = String(monthName || "").slice(0, 3).toLowerCase();
    var idx = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(key);
    return idx >= 0 ? idx + 1 : 0;
  }

  function toISODate(year, month, day) {
    if (year < 100) year += 2000;
    if (!month || !day || !year) return "";
    return String(year).padStart(4, "0") + "-" +
      String(month).padStart(2, "0") + "-" +
      String(day).padStart(2, "0");
  }

  // arXiv list headers are commonly "Mon, 4 May 2026".
  function parseAnnouncementDate(headerText) {
    var clean = cleanText(headerText);
    var iso = clean.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso && normalizeDateStr(iso[1])) return iso[1];

    var match = clean.match(/\b(?:[A-Z][a-z]+,\s*)?(\d{1,2})\s+([A-Z][a-z]{2,8})\s+(\d{2,4})\b/);
    if (match) {
      return toISODate(
        parseInt(match[3], 10),
        monthNumber(match[2]),
        parseInt(match[1], 10)
      );
    }

    match = clean.match(/\b(?:[A-Z][a-z]+,\s*)?([A-Z][a-z]{2,8})\s+(\d{1,2}),?\s+(\d{4})\b/);
    if (match) {
      return toISODate(
        parseInt(match[3], 10),
        monthNumber(match[1]),
        parseInt(match[2], 10)
      );
    }
    return "";
  }

  function sectionKindFromHeader(headerText) {
    var clean = cleanText(headerText).toLowerCase();
    if (clean.indexOf("replacement") >= 0) return "replacement";
    if (clean.indexOf("cross") >= 0) return "cross";
    return "new";
  }

  function sectionIsIncluded(kind) {
    if (kind === "cross") return getBoolCfg("arxiv.includeCrossLists", true);
    if (kind === "replacement") return getBoolCfg("arxiv.includeReplacements", false);
    return true;
  }

  function localDateStr() {
    var now = new Date();
    return now.getFullYear() + "-" +
      String(now.getMonth() + 1).padStart(2, "0") + "-" +
      String(now.getDate()).padStart(2, "0");
  }

  function targetDateFromConfig() {
    var mode = String(getCfg("arxiv.dateFilter", "latest") || "latest").trim().toLowerCase();
    if (mode === "today") return localDateStr();
    if (/^\d{4}-\d{2}-\d{2}$/.test(mode)) return mode;
    return "";
  }

  // ------------------------------------------------------------------------
  // Announcement HTML parser
  // ------------------------------------------------------------------------

  function parseAnnouncementHTML(html, category, forcedAnnouncementDate) {
    var allPapers = [];
    var sectionRegex = /<h3\b[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3\b[^>]*>|<\/main>|<\/body>|$)/gi;
    var sections = [];
    var section;

    while ((section = sectionRegex.exec(html)) !== null) {
      sections.push({ header: section[1] || "", body: section[2] || "" });
    }
    if (sections.length === 0) {
      sections.push({ header: "", body: html });
    }

    var currentDate = normalizeDateStr(forcedAnnouncementDate) || "";
    for (var s = 0; s < sections.length; s++) {
      var header = sections[s].header;
      var body = sections[s].body;
      var headerDate = parseAnnouncementDate(header);
      if (headerDate) currentDate = headerDate;

      var sectionKind = sectionKindFromHeader(header);
      if (!sectionIsIncluded(sectionKind)) continue;

      var announcementDate = normalizeDateStr(forcedAnnouncementDate) || headerDate || currentDate;
      var seenInSection = {};
      var entryRegex = /<dt\b[\s\S]*?href\s*=\s*["'](?:https?:\/\/arxiv\.org)?\/abs\/([^"'#?]+)(?:[?#][^"']*)?["'][\s\S]*?<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
      var match;

      while ((match = entryRegex.exec(body)) !== null) {
        var arxivId = baseArxivId(match[1]);
        if (!arxivId || seenInSection[arxivId]) continue;
        seenInSection[arxivId] = true;

        var details = match[2] || "";
        var title = extractClassField(details, "list-title", "Title");
        var authors = extractClassField(details, "list-authors", "Authors");
        var subjects = extractClassField(details, "list-subjects", "Subjects");
        var abstract = extractFirstParagraph(details);
        var primaryCategory = "";
        var primaryMatch = details.match(/<span\b[^>]*class\s*=\s*["'][^"']*\bprimary-subject\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
        if (primaryMatch) primaryCategory = cleanText(primaryMatch[1]);

        allPapers.push({
          arxivId: arxivId,
          title: title,
          authors: authors,
          abstract: abstract,
          primaryCategory: primaryCategory,
          categories: subjects,
          announcementDate: announcementDate || "",
          announcementSection: sectionKind,
          sourceCategory: category,
          citationIdentifier: "arXiv:" + arxivId,
          dateSource: "announcement",
        });
      }

      if (!Object.keys(seenInSection).length) {
        var absRegex = /href\s*=\s*["'](?:https?:\/\/arxiv\.org)?\/abs\/([^"'#?]+)(?:[?#][^"']*)?["']/gi;
        while ((match = absRegex.exec(body)) !== null) {
          var fallbackId = baseArxivId(match[1]);
          if (!fallbackId || seenInSection[fallbackId]) continue;
          seenInSection[fallbackId] = true;
          allPapers.push({
            arxivId: fallbackId,
            title: "",
            authors: "",
            abstract: "",
            primaryCategory: "",
            categories: "",
            announcementDate: announcementDate || "",
            announcementSection: sectionKind,
            sourceCategory: category,
            citationIdentifier: "arXiv:" + fallbackId,
            dateSource: "announcement",
          });
        }
      }
    }

    return allPapers;
  }

  function dedupePapers(papers) {
    var seen = {};
    var unique = [];
    for (var i = 0; i < papers.length; i++) {
      var p = papers[i];
      var id = baseArxivId(p.arxivId);
      if (!id) continue;
      p.arxivId = id;

      if (!seen[id]) {
        seen[id] = p;
        unique.push(p);
        continue;
      }

      var existing = seen[id];
      if (!existing.announcementDate && p.announcementDate) existing.announcementDate = p.announcementDate;
      if (!existing.announcementSection && p.announcementSection) existing.announcementSection = p.announcementSection;
      if (!existing.title && p.title) existing.title = p.title;
      if (!existing.abstract && p.abstract) existing.abstract = p.abstract;
      if (!existing.authors && p.authors) existing.authors = p.authors;
      if (!existing.primaryCategory && p.primaryCategory) existing.primaryCategory = p.primaryCategory;
      if (!existing.categories && p.categories) existing.categories = p.categories;
      if (!existing.citationIdentifier && p.citationIdentifier) existing.citationIdentifier = p.citationIdentifier;
      if (p.sourceCategory && (!existing.sourceCategory || existing.sourceCategory.indexOf(p.sourceCategory) < 0)) {
        existing.sourceCategory = existing.sourceCategory
          ? existing.sourceCategory + "; " + p.sourceCategory
          : p.sourceCategory;
      }
    }
    return unique;
  }

  function filterByDateMode(papers) {
    var mode = String(getCfg("arxiv.dateFilter", "latest") || "latest").trim().toLowerCase();
    if (mode === "rolling") return papers;

    var targetDate = targetDateFromConfig();
    if (targetDate) {
      return papers.filter(function (p) { return p.announcementDate === targetDate; });
    }

    var dated = papers.filter(function (p) { return p.announcementDate; });
    if (dated.length === 0) return papers;

    var latest = "";
    for (var i = 0; i < dated.length; i++) {
      if (dated[i].announcementDate > latest) latest = dated[i].announcementDate;
    }
    log("announcement date selected: " + latest);
    return papers.filter(function (p) { return p.announcementDate === latest; });
  }

  // ------------------------------------------------------------------------
  // API query
  // ------------------------------------------------------------------------

  function apiQueryUrl(idList) {
    var ids = idList.map(baseArxivId).filter(Boolean).join(",");
    return ARXIV_API + "?id_list=" + encodeURIComponent(ids) + "&max_results=" + idList.length;
  }

  function apiSearchUrl(category, start, maxResults) {
    return ARXIV_API +
      "?search_query=" + encodeURIComponent("cat:" + category) +
      "&start=" + encodeURIComponent(String(start)) +
      "&max_results=" + encodeURIComponent(String(maxResults)) +
      "&sortBy=submittedDate&sortOrder=descending";
  }

  function parseApiResponse(xml) {
    var papers = [];
    var entryRegex = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
    var entry;

    while ((entry = entryRegex.exec(xml)) !== null) {
      var block = entry[1];
      var idMatch = block.match(/<id>\s*https?:\/\/arxiv\.org\/abs\/([^\s<]+)\s*<\/id>/i);
      var titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      var summaryMatch = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
      var publishedMatch = block.match(/<published[^>]*>([^<]+)/i);
      var doiMatch = block.match(/<arxiv:doi\b[^>]*>([\s\S]*?)<\/arxiv:doi>/i);
      var journalRefMatch = block.match(/<arxiv:journal_ref\b[^>]*>([\s\S]*?)<\/arxiv:journal_ref>/i);
      var authors = [];
      var authorRegex = /<author\b[^>]*>[\s\S]*?<name[^>]*>([^<]+)<\/name>[\s\S]*?<\/author>/gi;
      var authorMatch;
      while ((authorMatch = authorRegex.exec(block)) !== null) {
        authors.push(cleanText(authorMatch[1]));
      }

      var primary = block.match(/<arxiv:primary_category[^>]*term="([^"]+)"/i);
      var primaryCategory = primary ? cleanText(primary[1]) : "";

      var catRegex = /<category[^>]*term="([^"]+)"/gi;
      var categories = [];
      var catMatch;
      while ((catMatch = catRegex.exec(block)) !== null) {
        categories.push(cleanText(catMatch[1]));
      }

      var arxivId = idMatch ? baseArxivId(idMatch[1]) : "";
      if (!arxivId) continue;

      papers.push({
        arxivId: arxivId,
        title: titleMatch ? cleanText(titleMatch[1]) : "",
        authors: authors.join("; "),
        abstract: summaryMatch ? cleanText(summaryMatch[1]) : "",
        primaryCategory: primaryCategory,
        categories: categories.join("; "),
        published: publishedMatch ? cleanText(publishedMatch[1]) : "",
        doi: doiMatch ? cleanText(doiMatch[1]) : "",
        journalRef: journalRefMatch ? cleanText(journalRefMatch[1]) : "",
        citationIdentifier: doiMatch ? cleanText(doiMatch[1]) : "arXiv:" + arxivId,
        dateSource: "api",
      });
    }
    return papers;
  }

  function paperWithinDaysBack(paper) {
    var daysBack = getNumberCfg("arxiv.daysBack", 3, 1, 365);
    var publishedTime = Date.parse(paper.published || "");
    if (!Number.isFinite(publishedTime)) return true;
    return publishedTime >= (Date.now() - daysBack * DAY_MS);
  }

  // ------------------------------------------------------------------------
  // Module
  // ------------------------------------------------------------------------

  globalThis.ArxivDailyFetcher = {

    fetchAnnouncementWindow: async function (categories, targetDate, cancelToken, progressCallback) {
      var normalizedTarget = normalizeDateStr(targetDate);
      if (!normalizedTarget) throw new Error("Invalid target arXiv announcement date: " + targetDate);

      var win = historyDateWindow(normalizedTarget);
      var dates = datesForWindowNewestFirst(win);
      var selectedPapers = [];
      var selectedDate = "";
      var fetchedEntries = 0;
      var retryMax = getNumberCfg("arxiv.retryMax", 2, 0, 10);
      var intervalMs = getNumberCfg("arxiv.requestIntervalMs", 3000, 0, 120000);

      notifyProgress(
        progressCallback,
        "Fetching arXiv announcement window " + win.startDate + " to " + win.endDate,
        15
      );

      for (var d = 0; d < dates.length; d++) {
        if (cancelToken && cancelToken.cancelled) break;
        var date = dates[d];
        var dayPapers = [];

        for (var i = 0; i < categories.length; i++) {
          if (cancelToken && cancelToken.cancelled) break;
          var cat = categories[i];
          var url = catchupUrl(cat, date);

          log("fetching historical catchup: " + url);
          notifyProgress(progressCallback, "Fetching arXiv papers", 15);
          try {
            var html = await fetchTextProtected(url, "announcement", retryMax, cancelToken, progressCallback, {
              expectedAnnouncementDate: date,
            });
            var papers = parseAnnouncementHTML(html, cat, date);
            fetchedEntries += papers.length;
            log("  -> " + papers.length + " raw historical catchup entries from " + cat + " " + date);
            notifyProgress(progressCallback, "Announcement " + cat + " " + date + ": " + papers.length + " raw entries", 15);
            dayPapers = dayPapers.concat(papers);
          } catch (e) {
            logError("historical catchup fetch failed: " + cat + " " + date + " - " + (e.message || e));
          }

          if (i < categories.length - 1) {
            await sleepCancellable(intervalMs, cancelToken);
          }
        }

        dayPapers = dedupePapers(dayPapers);
        if (dayPapers.length > 0) {
          selectedDate = date;
          selectedPapers = dayPapers;
          break;
        }
        if (d < dates.length - 1) await sleepCancellable(intervalMs, cancelToken);
      }

      log("historical catchup window selected " + (selectedDate || "none") +
        " for target " + win.targetDate + " from " + fetchedEntries + " fetched entries");
      notifyProgress(
        progressCallback,
        selectedDate
          ? "Selected arXiv announcement date " + selectedDate + " for target " + win.targetDate
          : "No arXiv announcement entries found from " + win.startDate + " to " + win.endDate,
        22
      );
      return selectedPapers;
    },

    fetchAnnouncements: async function (categories, dateStr, cancelToken, progressCallback) {
      var explicitDate = normalizeDateStr(dateStr);
      if (explicitDate) {
        return this.fetchAnnouncementWindow(categories, explicitDate, cancelToken, progressCallback);
      }

      var dateSource = String(getCfg("arxiv.dateSource", "announcement") || "announcement").toLowerCase();
      var dateFilter = String(getCfg("arxiv.dateFilter", "latest") || "latest").toLowerCase();
      if (dateSource === "api" || dateFilter === "rolling") {
        log("announcement fetch skipped; using API submitted-date mode");
        notifyProgress(progressCallback, "Fetching arXiv papers", 15);
        return this.fetchRecentByAPI(categories, cancelToken, progressCallback);
      }

      var allPapers = [];
      var retryMax = getNumberCfg("arxiv.retryMax", 2, 0, 10);
      var intervalMs = getNumberCfg("arxiv.requestIntervalMs", 3000, 0, 120000);
      var expectedAnnouncementDate = targetDateFromConfig();

      for (var i = 0; i < categories.length; i++) {
        if (cancelToken && cancelToken.cancelled) break;
        var cat = categories[i];
        var url = announcementNewUrl(cat);

        log("fetching announcement: " + url);
        notifyProgress(progressCallback, "Fetching arXiv papers", 15);
        try {
          var html = await fetchTextProtected(url, "announcement", retryMax, cancelToken, progressCallback, {
            expectedAnnouncementDate: expectedAnnouncementDate,
          });
          var papers = parseAnnouncementHTML(html, cat);
          log("  -> " + papers.length + " raw announcement entries from " + cat);
          notifyProgress(progressCallback, "Announcement " + cat + ": " + papers.length + " raw entries", 15);
          allPapers = allPapers.concat(papers);
        } catch (e) {
          logError("announcement fetch failed: " + cat + " - " + (e.message || e));
        }

        if (i < categories.length - 1) await sleepCancellable(intervalMs, cancelToken);
      }

      var unique = dedupePapers(allPapers);
      notifyProgress(progressCallback, "Filtering by date", 22);
      var filtered = filterByDateMode(unique);
      notifyProgress(progressCallback, "Announcement pages kept " + filtered.length + " papers after date filtering", 22);
      log("  -> " + filtered.length + " announcement papers after filtering (was " + unique.length + ")");

      if (filtered.length === 0) {
        log("announcement returned no papers; falling back to arXiv API submitted-date query");
        notifyProgress(progressCallback, "Announcement pages yielded 0 papers after date filtering; trying API fallback", 22);
        notifyProgress(progressCallback, "Filtering by date", 22);
        var fallback = await this.fetchRecentByAPI(categories, cancelToken, progressCallback);
        notifyProgress(progressCallback, "API fallback kept " + fallback.length + " recent papers", 18);
        return fallback;
      }
      return filtered;
    },

    fetchRecentByAPI: async function (categories, cancelToken, progressCallback) {
      var maxResults = Math.round(getNumberCfg("arxiv.maxResults", 150, 1, 1000));
      var pageSize = Math.round(getNumberCfg("arxiv.pageSize", 50, 1, Math.min(maxResults, 200)));
      var retryMax = getNumberCfg("arxiv.retryMax", 2, 0, 10);
      var intervalMs = getNumberCfg("arxiv.requestIntervalMs", 3000, 0, 120000);
      var threshold = getNumberCfg("arxiv.paginationContinueThreshold", 0.8, 0.1, 1);
      var allPapers = [];
      var failedCategories = 0;

      for (var c = 0; c < categories.length; c++) {
        if (cancelToken && cancelToken.cancelled) break;
        var cat = categories[c];
        var start = 0;
        var categoryRecent = 0;
        var categoryFailed = false;

        while (start < maxResults) {
          if (cancelToken && cancelToken.cancelled) break;
          var limit = Math.min(pageSize, maxResults - start);
          var url = apiSearchUrl(cat, start, limit);
          log("fetching API recent papers: " + cat + " start=" + start + " max=" + limit);
          notifyProgress(progressCallback, "Fetching arXiv papers", 15);

          var pagePapers = [];
          try {
            var xml = await fetchTextProtected(url, "api-search", retryMax, cancelToken, progressCallback);
            pagePapers = parseApiResponse(xml);
          } catch (e) {
            logError("API recent query failed: " + cat + " - " + (e.message || e));
            categoryFailed = true;
            break;
          }

          if (pagePapers.length === 0) break;

          for (var p = 0; p < pagePapers.length; p++) {
            pagePapers[p].sourceCategory = cat;
          }
          var recent = pagePapers.filter(paperWithinDaysBack);
          allPapers = allPapers.concat(recent);
          categoryRecent += recent.length;
          log("  -> kept " + recent.length + "/" + pagePapers.length + " recent API papers");

          start += pagePapers.length;
          if (pagePapers.length < limit) break;
          if (recent.length === 0) break;
          if (recent.length < limit * threshold) break;
          if (start < maxResults) await sleepCancellable(intervalMs, cancelToken);
        }

        log("  -> " + categoryRecent + " recent API papers from " + cat);
        notifyProgress(progressCallback, "API " + cat + ": " + categoryRecent + " recent papers", 18);
        if (categoryFailed && categoryRecent === 0) failedCategories++;
        if (c < categories.length - 1) await sleepCancellable(intervalMs, cancelToken);
      }

      if (allPapers.length === 0 && failedCategories === categories.length && categories.length > 0) {
        throw new Error("All arXiv API fallback requests failed. Check network access, arXiv status, or category codes.");
      }

      return dedupePapers(allPapers);
    },

    fetchMetadata: async function (idList, cancelToken, progressCallback) {
      var ids = [];
      var seen = {};
      for (var i = 0; i < idList.length; i++) {
        var id = baseArxivId(idList[i]);
        if (id && !seen[id]) {
          seen[id] = true;
          ids.push(id);
        }
      }
      if (ids.length === 0) return [];

      var batchSize = Math.round(getNumberCfg("arxiv.idBatchSize", 50, 1, 200));
      var retryMax = getNumberCfg("arxiv.retryMax", 2, 0, 10);
      var intervalMs = getNumberCfg("arxiv.requestIntervalMs", 3000, 0, 120000);
      var allPapers = [];

      for (var start = 0; start < ids.length; start += batchSize) {
        if (cancelToken && cancelToken.cancelled) break;
        var batch = ids.slice(start, start + batchSize);
        var url = apiQueryUrl(batch);

        log("fetching API metadata for " + batch.length + " IDs");
        notifyProgress(progressCallback, "Fetching arXiv papers", 18);
        try {
          var xml = await fetchTextProtected(url, "api-id-list", retryMax, cancelToken, progressCallback);
          var papers = parseApiResponse(xml);
          allPapers = allPapers.concat(papers);
          log("  -> " + papers.length + " metadata results");
        } catch (e) {
          logError("API metadata query failed: " + (e.message || e));
        }

        if (start + batchSize < ids.length) await sleepCancellable(intervalMs, cancelToken);
      }
      return dedupePapers(allPapers);
    },

    merge: function (announcePapers, apiPapers) {
      var apiMap = {};
      for (var i = 0; i < apiPapers.length; i++) {
        apiMap[baseArxivId(apiPapers[i].arxivId)] = apiPapers[i];
      }

      var merged = [];
      for (var j = 0; j < announcePapers.length; j++) {
        var p = announcePapers[j];
        var api = apiMap[baseArxivId(p.arxivId)];
        if (api) {
          if (!p.title && api.title) p.title = api.title;
          if (!p.abstract && api.abstract) p.abstract = api.abstract;
          if (!p.authors && api.authors) p.authors = api.authors;
          if (!p.published && api.published) p.published = api.published;
          if (!p.primaryCategory && api.primaryCategory) p.primaryCategory = api.primaryCategory;
          if (!p.categories && api.categories) p.categories = api.categories;
          if (!p.doi && api.doi) p.doi = api.doi;
          if (!p.journalRef && api.journalRef) p.journalRef = api.journalRef;
          if (!p.citationIdentifier && api.citationIdentifier) p.citationIdentifier = api.citationIdentifier;
          if (!p.citationIdentifier) p.citationIdentifier = "arXiv:" + baseArxivId(p.arxivId);
        }
        merged.push(p);
      }
      return dedupePapers(merged);
    },
  };
})();
