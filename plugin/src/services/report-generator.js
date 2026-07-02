/* ==========================================================================
 * services/report-generator.js — Full report generation pipeline
 *
 * Orchestrates: fetch → keyword score → LLM screen → deep read → write report
 * Ported from arxiv_daily.py (~3000 lines of logic).
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

  function emitProgress(onProgress, step, pct) {
    if (typeof onProgress !== "function" || !step) return;
    try {
      onProgress(step, pct);
    } catch (e) {}
  }

  function stageError(prefix, err) {
    var msg = err && err.message ? err.message : String(err);
    if (msg.indexOf(prefix + ": ") === 0) return err;
    return new Error(prefix + ": " + msg);
  }

  function getDateStr() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, "0");
    var d = String(now.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function formatDate(dateStr) {
    var p = dateStr.split("-");
    return p[0] + "年" + p[1] + "月" + p[2] + "日";
  }

  function datePart(value) {
    var match = String(value || "").match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : "";
  }

  function paperPublicationDate(paper) {
    // Announcement date is arXiv's daily publish/listing date. API `published`
    // can reflect the submission timestamp, which may fall on the evening
    // before the announced publication day.
    return datePart(paper && paper.announcementDate) ||
      datePart(paper && paper.published) ||
      datePart(paper && paper.updated);
  }

  function inferReportDateFromPapers(papers) {
    var counts = {};
    var latest = "";
    for (var i = 0; i < (papers || []).length; i++) {
      var date = paperPublicationDate(papers[i]);
      if (!date) continue;
      counts[date] = (counts[date] || 0) + 1;
      if (date > latest) latest = date;
    }
    var dates = Object.keys(counts).sort();
    return {
      date: latest,
      dates: dates,
      counts: counts,
      mixed: dates.length > 1,
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
      if (!existing.title && p.title) existing.title = p.title;
      if (!existing.abstract && p.abstract) existing.abstract = p.abstract;
      if (!existing.authors && p.authors) existing.authors = p.authors;
      if (!existing.categories && p.categories) existing.categories = p.categories;
      if (!existing.primaryCategory && p.primaryCategory) existing.primaryCategory = p.primaryCategory;
      if (!existing.sourceCategory && p.sourceCategory) existing.sourceCategory = p.sourceCategory;
    }
    return unique;
  }

  function clampScore(value, fallback) {
    var n = parseInt(value, 10);
    if (!Number.isFinite(n)) n = fallback || 1;
    return Math.max(1, Math.min(5, n));
  }

  function truthy(value) {
    if (typeof value === "string") {
      return /^(true|1|yes|y|keep)$/i.test(value.trim());
    }
    return !!value;
  }

  function tagsFrom(value) {
    if (Array.isArray(value)) {
      return value.map(function (tag) { return String(tag || "").trim(); }).filter(Boolean);
    }
    if (typeof value === "string") {
      return value.split(/[,;，、]/).map(function (tag) { return tag.trim(); }).filter(Boolean);
    }
    return [];
  }

  function ensureKeywordScores(papers) {
    if (typeof ArxivDailyKeywords === "undefined" || !ArxivDailyKeywords.scorePaper) return;
    for (var i = 0; i < papers.length; i++) {
      if (!Number.isFinite(parseFloat(papers[i].keywordScore))) {
        papers[i].keywordScore = ArxivDailyKeywords.scorePaper(papers[i]);
      }
    }
  }

  function fallbackScore(paper) {
    var keywordScore = parseInt(paper && paper.keywordScore, 10);
    if (!Number.isFinite(keywordScore)) keywordScore = 0;
    return Math.max(1, Math.min(5, Math.floor(keywordScore / 3) + 1));
  }

  function stripJSONFence(text) {
    var raw = String(text || "").trim();
    raw = raw.replace(/^\uFEFF/, "").trim();
    raw = raw.replace(/^```(?:json|JSON)?\s*/, "").replace(/\s*```$/, "").trim();
    return raw;
  }

  function parseJSONCandidate(candidate) {
    var parsed = JSON.parse(candidate);
    if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
      var nested = parsed.papers || parsed.results || parsed.items || parsed.selections || parsed.data;
      if (nested !== undefined) parsed = nested;
    }
    if (!Array.isArray(parsed)) {
      throw new Error("LLM selection response is not a JSON array");
    }
    return parsed;
  }

  function collectBalancedJSONCandidates(raw) {
    var text = String(raw || "");
    var candidates = [];
    var start = -1;
    var stack = [];
    var inString = false;
    var escape = false;

    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (start < 0) {
        if (ch === "[" || ch === "{") {
          start = i;
          stack = [ch === "[" ? "]" : "}"];
          inString = false;
          escape = false;
        }
        continue;
      }

      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === "\\") {
          escape = true;
        } else if (ch === "\"") {
          inString = false;
        }
        continue;
      }

      if (ch === "\"") {
        inString = true;
      } else if (ch === "[" || ch === "{") {
        stack.push(ch === "[" ? "]" : "}");
      } else if (ch === "]" || ch === "}") {
        if (!stack.length || stack[stack.length - 1] !== ch) {
          start = -1;
          stack = [];
          continue;
        }
        stack.pop();
        if (!stack.length) {
          candidates.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }

    return candidates;
  }

  function parseLLMSelectionResponse(text) {
    var raw = stripJSONFence(text);
    var lastError = null;
    try {
      return parseJSONCandidate(raw).filter(function (item) {
        return item && typeof item === "object";
      });
    } catch (e) {
      lastError = e;
    }

    var candidates = collectBalancedJSONCandidates(raw);
    for (var i = 0; i < candidates.length; i++) {
      try {
        return parseJSONCandidate(candidates[i]).filter(function (item) {
          return item && typeof item === "object";
        });
      } catch (err) {
        lastError = err;
      }
    }

    var arrayMatch = raw.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return parseJSONCandidate(arrayMatch[0]).filter(function (item) {
          return item && typeof item === "object";
        });
      } catch (arrayErr) {
        lastError = arrayErr;
      }
    }

    throw lastError || new Error("LLM selection response does not contain a parseable JSON array");
  }

  function paperById(papers, id) {
    var target = baseArxivId(id);
    if (!target) return null;
    for (var i = 0; i < papers.length; i++) {
      if (baseArxivId(papers[i].arxivId) === target) return papers[i];
    }
    return null;
  }

  function resolveSelectionPaper(item, localIndex, batch, candidates) {
    var rawId = item.arxiv_id || item.arxivId || item.paper_id || item.paperId || item.id || "";
    var numeric = parseInt(rawId, 10);
    if (Number.isFinite(numeric) && String(rawId).trim().match(/^\d+$/)) {
      if (numeric >= batch.startIdx + 1 && numeric <= batch.startIdx + batch.batchSize) {
        return candidates[numeric - 1] || null;
      }
      if (numeric >= 1 && numeric <= batch.batchSize) {
        return candidates[batch.startIdx + numeric - 1] || null;
      }
    }

    var byId = paperById(candidates, rawId);
    if (byId) return byId;
    return candidates[batch.startIdx + localIndex] || null;
  }

  function applySelection(paper, selection, fallbackReason) {
    var score = clampScore(selection && selection.score, fallbackScore(paper));
    paper.llmScore = score;
    paper.selectionScore = score;
    paper.selectionKeep = selection && selection.keep !== undefined
      ? truthy(selection.keep)
      : score >= 3;
    paper.selectionCross = !!(selection && (
      selection.is_cross_discipline ||
      selection.isCrossDiscipline ||
      selection.cross ||
      selection.selection_cross
    ));
    paper.llmReason = String(
      (selection && (selection.reason || selection.relevance || selection.summary)) ||
      fallbackReason ||
      ""
    ).trim();
    paper.llmTags = tagsFrom(selection && selection.tags);
    return paper;
  }

  function safeFilePart(value) {
    return String(value || "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "unknown";
  }

  function responseLogName(batch, label, suffix) {
    var date = new Date().toISOString().replace(/[:.]/g, "-");
    var parts = [
      date,
      safeFilePart(label || "llm"),
      "start-" + (batch && batch.startIdx !== undefined ? batch.startIdx : "x"),
      "size-" + (batch && batch.batchSize !== undefined ? batch.batchSize : "x"),
      "pass-" + (batch && batch.pass !== undefined ? batch.pass : "x"),
    ];
    if (suffix) parts.push(safeFilePart(suffix));
    return "cache/llm/raw-responses/" + parts.join("_") + ".json";
  }

  function writeLLMResponseDiagnostic(batch, response, label, error, suffix) {
    if (typeof ArxivDailyDataDir === "undefined" || !ArxivDailyDataDir.writeFile) return "";
    var path = responseLogName(batch, label, suffix || "parse-failure");
    var payload = {
      savedAt: new Date().toISOString(),
      label: label || "LLM",
      startIdx: batch && batch.startIdx,
      batchSize: batch && batch.batchSize,
      pass: batch && batch.pass,
      passes: batch && batch.passes,
      error: error ? String(error.message || error) : "",
      responseLength: String(response || "").length,
      response: String(response || ""),
    };
    try {
      if (ArxivDailyDataDir.writeFile(path, JSON.stringify(payload, null, 2))) return path;
    } catch (e) {
      logError("failed to save LLM response diagnostic: " + (e.message || e));
    }
    return "";
  }

  function parseBatchResponse(batchResult, candidates) {
    var parsed = parseLLMSelectionResponse(batchResult.response);
    var records = [];
    var seenInBatch = {};
    var parsedCount = 0;
    for (var p = 0; p < parsed.length; p++) {
      var paper = resolveSelectionPaper(parsed[p], p, batchResult, candidates);
      if (paper) {
        seenInBatch[baseArxivId(paper.arxivId)] = true;
        records.push(applySelection(Object.assign({}, paper), parsed[p]));
        parsedCount++;
      }
    }
    return {
      records: records,
      seenInBatch: seenInBatch,
      parsedCount: parsedCount,
    };
  }

  async function retryFailedSelectionBatch(batchResult, candidates, options, originalError) {
    if (typeof ArxivDailyLLM === "undefined" || !ArxivDailyLLM.batchScreen) return null;
    options = options || {};
    var retryBatchSize = Math.max(1, parseInt(options.retryBatchSize || 5, 10) || 5);
    var sourceBatchSize = parseInt(batchResult && batchResult.batchSize, 10) || 0;
    if (sourceBatchSize <= 1 || retryBatchSize >= sourceBatchSize) return null;

    var startIdx = parseInt(batchResult.startIdx, 10) || 0;
    var batchPapers = candidates.slice(startIdx, startIdx + sourceBatchSize);
    if (!batchPapers.length) return null;

    emitProgress(options.onProgress, options.label + " 第 " + (options.batchNumber || "?") +
      " 批解析失败，正在用 " + retryBatchSize + " 篇小批次重试", options.retryProgress || options.progressStart || 64);
    log((options.label || "LLM") + " parse failed for batch starting " + startIdx +
      "; retrying with batch size " + retryBatchSize + ": " + (originalError.message || originalError));

    var retryOptions = Object.assign({}, options.llmOptions || {}, {
      passes: 1,
      parallelPasses: false,
      taskLabel: options.taskLabel || "screening-retry",
    });
    var retryResults = await ArxivDailyLLM.batchScreen(
      batchPapers,
      options.systemPrompt,
      retryBatchSize,
      options.cancelToken,
      retryOptions
    );

    for (var i = 0; i < retryResults.length; i++) {
      retryResults[i].startIdx = startIdx + (parseInt(retryResults[i].startIdx, 10) || 0);
      retryResults[i].pass = batchResult.pass;
      retryResults[i].passes = batchResult.passes;
    }
    return retryResults;
  }

  function fallbackSelectionBatch(batch, candidates, reason, minKeepScore, keepAll) {
    var selected = [];
    var threshold = Number.isFinite(parseFloat(minKeepScore)) ? parseFloat(minKeepScore) : 3;
    for (var i = 0; i < batch.batchSize; i++) {
      var paper = candidates[batch.startIdx + i];
      if (!paper) continue;
      var score = fallbackScore(paper);
      selected.push(applySelection(Object.assign({}, paper), {
        score: score,
        keep: !!keepAll || score >= threshold,
        reason: reason || "LLM 筛选结果不可解析，已按关键词分数兜底。",
        tags: [],
      }));
    }
    return selected;
  }

  async function parseBatchSelections(batchResults, candidates, options) {
    options = options || {};
    var records = [];
    var parseFailures = 0;
    var recoveredFailures = 0;
    var diagnostics = [];
    var label = options.label || "LLM";
    var minKeepScore = Number.isFinite(parseFloat(options.minKeepScore)) ? parseFloat(options.minKeepScore) : 3;
    var fallbackReason = options.fallbackReason || "LLM 结果不可解析，已按关键词分数兜底。";
    var missingReason = options.missingReason || fallbackReason;
    var onProgress = options.onProgress;
    var progressStart = Number.isFinite(parseFloat(options.progressStart)) ? parseFloat(options.progressStart) : 52;
    var progressStep = Number.isFinite(parseFloat(options.progressStep)) ? parseFloat(options.progressStep) : 4;
    var progressMax = Number.isFinite(parseFloat(options.progressMax)) ? parseFloat(options.progressMax) : 22;
    var totalBatches = batchResults.length || 0;

    for (var b = 0; b < batchResults.length; b++) {
      emitProgress(onProgress, "解析 " + label + " 结果: 第 " + (b + 1) + "/" + totalBatches + " 批", progressStart + Math.min(progressMax, b * progressStep));
      var response = batchResults[b].response;
      try {
        var parsedBatch = parseBatchResponse(batchResults[b], candidates);
        var parsedCount = parsedBatch.parsedCount;
        var seenInBatch = parsedBatch.seenInBatch;
        records = records.concat(parsedBatch.records);
        if (parsedCount === 0) {
          parseFailures++;
          var emptyPath = writeLLMResponseDiagnostic(
            batchResults[b],
            response,
            label,
            "Parsed JSON contained no resolvable paper records.",
            "empty"
          );
          if (emptyPath) diagnostics.push(emptyPath);
          records = records.concat(fallbackSelectionBatch(
            batchResults[b],
            candidates,
            fallbackReason,
            minKeepScore,
            options.fallbackKeepAll
          ));
        } else if (parsedCount < batchResults[b].batchSize) {
          for (var miss = 0; miss < batchResults[b].batchSize; miss++) {
            var missingPaper = candidates[batchResults[b].startIdx + miss];
            if (!missingPaper || seenInBatch[baseArxivId(missingPaper.arxivId)]) continue;
            var score = fallbackScore(missingPaper);
            records.push(applySelection(Object.assign({}, missingPaper), {
              score: score,
              keep: !!options.fallbackKeepAll || score >= minKeepScore,
              reason: missingReason,
              tags: [],
            }));
          }
        }
        emitProgress(onProgress, label + " 第 " + (b + 1) + " 批解析完成: " + parsedCount + "/" + batchResults[b].batchSize + " 篇", progressStart + 4 + Math.min(progressMax, b * progressStep));
      } catch (e) {
        logError(label + " parse error in batch " + b + ": " + (e.message || e));
        var diagnosticPath = writeLLMResponseDiagnostic(batchResults[b], response, label, e, "parse-failure");
        if (diagnosticPath) diagnostics.push(diagnosticPath);
        var recovered = false;
        if (options.retryOnParseFailure && options.systemPrompt) {
          try {
            var retryResults = await retryFailedSelectionBatch(
              batchResults[b],
              candidates,
              Object.assign({}, options, {
                batchNumber: b + 1,
                retryProgress: progressStart + 4 + Math.min(progressMax, b * progressStep),
              }),
              e
            );
            if (retryResults && retryResults.length) {
              var parsedRetry = await parseBatchSelections(retryResults, candidates, Object.assign({}, options, {
                retryOnParseFailure: false,
                label: label + " 小批重试",
                progressStart: progressStart + 4 + Math.min(progressMax, b * progressStep),
                progressStep: 1,
                progressMax: Math.max(1, Math.min(4, progressMax)),
              }));
              records = records.concat(parsedRetry.records);
              parseFailures += parsedRetry.parseFailures;
              recoveredFailures += 1 + (parsedRetry.recoveredFailures || 0);
              diagnostics = diagnostics.concat(parsedRetry.diagnostics || []);
              recovered = true;
              emitProgress(onProgress, label + " 第 " + (b + 1) + " 批已通过小批重试恢复", progressStart + 5 + Math.min(progressMax, b * progressStep));
            }
          } catch (retryErr) {
            logError(label + " retry failed in batch " + b + ": " + (retryErr.message || retryErr));
          }
        }
        if (recovered) continue;

        parseFailures++;
        records = records.concat(fallbackSelectionBatch(
          batchResults[b],
          candidates,
          fallbackReason,
          minKeepScore,
          options.fallbackKeepAll
        ));
        emitProgress(onProgress, label + " 第 " + (b + 1) + " 批解析失败，已使用宽松兜底: " + (e.message || e), progressStart + 4 + Math.min(progressMax, b * progressStep));
      }
    }

    return {
      records: records,
      parseFailures: parseFailures,
      recoveredFailures: recoveredFailures,
      diagnostics: diagnostics,
    };
  }

  function aggregateScreened(records, minScore) {
    var map = {};
    var order = [];
    for (var i = 0; i < (records || []).length; i++) {
      var record = records[i];
      var key = paperKey(record);
      if (!key) continue;
      if (!map[key]) {
        map[key] = {
          paper: Object.assign({}, record),
          count: 0,
          scoreSum: 0,
          keepCount: 0,
          crossCount: 0,
          reasons: [],
          tags: {},
        };
        order.push(key);
      }
      var agg = map[key];
      var score = clampScore(record.selectionScore || record.llmScore || fallbackScore(record), fallbackScore(record));
      agg.count++;
      agg.scoreSum += score;
      if (record.selectionKeep || score >= minScore) agg.keepCount++;
      if (record.selectionCross) agg.crossCount++;
      if (record.llmReason && agg.reasons.indexOf(record.llmReason) < 0) agg.reasons.push(record.llmReason);
      var tags = record.llmTags || [];
      for (var t = 0; t < tags.length; t++) {
        if (tags[t]) agg.tags[tags[t]] = true;
      }
    }

    var out = [];
    for (var k = 0; k < order.length; k++) {
      var item = map[order[k]];
      var avg = item.count ? item.scoreSum / item.count : fallbackScore(item.paper);
      var rounded = clampScore(Math.round(avg), fallbackScore(item.paper));
      var keepMajority = item.keepCount >= Math.ceil(item.count / 2);
      item.paper.llmScore = rounded;
      item.paper.selectionScore = rounded;
      item.paper.selectionAverageScore = Math.round(avg * 10) / 10;
      item.paper.selectionPassCount = item.count;
      item.paper.selectionKeep = keepMajority || avg >= minScore;
      item.paper.selectionCross = item.crossCount >= Math.ceil(item.count / 2);
      item.paper.llmReason = [
        item.count > 1 ? "多轮筛选平均 " + item.paper.selectionAverageScore + "/5，" + item.keepCount + "/" + item.count + " 轮建议保留。" : "",
        item.reasons.slice(0, 2).join("；"),
      ].filter(Boolean).join(" ");
      item.paper.llmTags = Object.keys(item.tags);
      out.push(item.paper);
    }
    return out;
  }

  function markPrefilterResults(papers, minScore) {
    var threshold = Number.isFinite(parseFloat(minScore)) ? parseFloat(minScore) : 2;
    for (var i = 0; i < (papers || []).length; i++) {
      var paper = papers[i];
      var score = paper.selectionScore || paper.llmScore || fallbackScore(paper);
      paper.prefilterScore = score;
      paper.prefilterAverageScore = paper.selectionAverageScore || score;
      paper.prefilterPassCount = paper.selectionPassCount || 1;
      paper.prefilterKeep = !!paper.selectionKeep || score >= threshold;
      paper.prefilterReason = paper.llmReason || "";
    }
    return papers || [];
  }

  function scoreSort(a, b) {
    return ((b.selectionScore || b.llmScore || 0) - (a.selectionScore || a.llmScore || 0)) ||
      ((b.keywordScore || 0) - (a.keywordScore || 0));
  }

  function guessProfileTokens(text) {
    var value = String(text || "").toLowerCase();
    var seen = {};
    var tokens = [];
    function add(token) {
      token = String(token || "").trim();
      if (!token || token.length < 2 || seen[token]) return;
      seen[token] = true;
      tokens.push(token);
    }

    var english = value.match(/[a-z][a-z0-9+.#-]{2,}/g) || [];
    for (var i = 0; i < english.length; i++) {
      add(english[i]);
      if (tokens.length >= 240) return tokens;
    }

    var stop = {
      "喜欢": true, "不喜": true, "论文": true, "文章": true, "研究": true,
      "方向": true, "方法": true, "主题": true, "一般": true, "优先": true,
      "排除": true, "降低": true, "推荐": true, "画像": true,
    };
    var runs = value.match(/[\u4e00-\u9fff]{2,}/g) || [];
    for (var r = 0; r < runs.length; r++) {
      var run = runs[r].slice(0, 48);
      for (var size = 2; size <= 6; size++) {
        for (var p = 0; p + size <= run.length; p++) {
          var token = run.slice(p, p + size);
          if (!stop[token]) add(token);
          if (tokens.length >= 240) return tokens;
        }
      }
    }
    return tokens;
  }

  function guessCandidateText(paper) {
    return [
      paper && paper.title,
      paper && paper.abstract,
      paper && paper.localizedAbstract,
      paper && paper.categories,
      paper && paper.primaryCategory,
      paper && paper.sourceCategory,
      paper && paper.llmReason,
      paper && paper.readingGuide,
      paper && paper.crossFieldGuide,
      paper && paper.llmTags ? paper.llmTags.join(" ") : "",
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function buildGuessFallback(candidates, feedbackProfile, limit, reason) {
    if (!limit || !candidates || !candidates.length || !String(feedbackProfile || "").trim()) return [];
    ensureKeywordScores(candidates);
    var tokens = guessProfileTokens(feedbackProfile);
    var scored = [];
    for (var i = 0; i < candidates.length; i++) {
      var paper = candidates[i];
      if (!paper) continue;
      var text = guessCandidateText(paper);
      var overlap = 0;
      var matched = [];
      for (var t = 0; t < tokens.length; t++) {
        if (text.indexOf(tokens[t]) >= 0) {
          overlap++;
          if (matched.length < 5) matched.push(tokens[t]);
        }
      }
      var keywordScore = parseFloat(paper.keywordScore);
      if (!Number.isFinite(keywordScore)) keywordScore = 0;
      var baseScore = scoreOf(paper) || fallbackScore(paper);
      scored.push({
        paper: paper,
        rank: i,
        score: baseScore * 20 + keywordScore + overlap * 3,
        baseScore: baseScore,
        matched: matched,
      });
    }
    scored.sort(function (a, b) {
      return (b.score - a.score) || (a.rank - b.rank);
    });

    var out = [];
    var seen = {};
    var fallbackReason = reason || "LLM 猜你喜欢排序为空，已按猜你喜欢画像、当前相关性评分和关键词分数兜底排序。";
    for (var s = 0; s < scored.length && out.length < limit; s++) {
      var item = scored[s];
      var key = paperKey(item.paper) || String(s);
      if (seen[key]) continue;
      seen[key] = true;
      item.paper.guessFallback = true;
      item.paper.guessFallbackReason = fallbackReason;
      item.paper.guessScore = Math.max(3, Math.min(5, Math.round(item.baseScore || fallbackScore(item.paper))));
      item.paper.guessReason = item.matched.length
        ? fallbackReason + " 画像命中: " + item.matched.join("、") + "。"
        : fallbackReason;
      out.push(item.paper);
    }
    return out;
  }

  function paperMatchesCategories(paper, categories) {
    if (!categories || !categories.length) return false;
    var text = [paper.categories || "", paper.primaryCategory || "", paper.sourceCategory || ""].join("; ");
    return categories.some(function (cat) {
      return text.indexOf(cat) >= 0;
    });
  }

  function authorList(value) {
    if (Array.isArray(value)) {
      return value.map(function (author) {
        if (typeof author === "string") return author.trim();
        if (author && typeof author === "object") {
          return String(author.name ||
            [author.firstName || "", author.lastName || ""].join(" ").trim() ||
            author.fullName ||
            "").trim();
        }
        return "";
      }).filter(Boolean);
    }
    return String(value || "")
      .split(/\s*;\s*|\s*,\s+(?=[A-Z][A-Za-z.\-]+\s)|\s+and\s+/)
      .map(function (author) { return author.trim(); })
      .filter(Boolean);
  }

  function normalizeName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function correspondingAuthorNames(paper) {
    var raw = paper.correspondingAuthors ||
      paper.correspondingAuthor ||
      paper.corresponding ||
      paper.correspondence ||
      [];
    return authorList(raw);
  }

  function firstAuthorNames(paper) {
    var raw = paper.firstAuthors ||
      paper.firstAuthor ||
      paper.first_author ||
      paper.first_authors ||
      [];
    return authorList(raw);
  }

  function formatAuthors(paper) {
    var authors = authorList(paper.authors);
    if (!authors.length) return "";
    var firstAuthors = firstAuthorNames(paper);
    var corresponding = correspondingAuthorNames(paper);
    var firstMap = {};
    var correspondingMap = {};
    for (var f = 0; f < firstAuthors.length; f++) {
      firstMap[normalizeName(firstAuthors[f])] = true;
    }
    for (var c = 0; c < corresponding.length; c++) {
      correspondingMap[normalizeName(corresponding[c])] = true;
    }

    var formatted = authors.map(function (author) {
      var marks = [];
      if (firstMap[normalizeName(author)]) marks.push("第一作者");
      if (correspondingMap[normalizeName(author)]) marks.push("通讯作者");
      return marks.length ? author + "（" + marks.join("，") + "）" : author;
    });
    return formatted.join("; ");
  }

  function readDataFile(relativePath) {
    try {
      if (typeof ArxivDailyDataDir !== "undefined") {
        return ArxivDailyDataDir.readFile(relativePath) || "";
      }
    } catch (e) {}
    return "";
  }

  function looksLikeFeedbackRecord(text) {
    var value = String(text || "");
    if (!value.trim()) return false;
    if (/猜你喜欢科研兴趣画像（待确认草稿）|喜欢的论文信号|一般的论文信号|不喜欢的论文信号|可编辑偏好草稿/.test(value)) return true;
    if (/猜你喜欢反馈记录|Feedback record/i.test(value) && /##\s*(喜欢|一般|不喜欢)/.test(value)) return true;
    return false;
  }

  function looksLikeOrphanGuideText(text) {
    var value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value) return false;
    return /^(这篇论文|本文|这项工作|这个工作|作者|论文的逻辑|论文的论证|核心画面|核心逻辑|这里的关键|关键推进是|他们发现|它们发现|如果我们|反过来说|总的来说|换句话说)/.test(value) && value.length > 45;
  }

  function usableFeedbackProfile(text) {
    var value = String(text || "").trim();
    if (!value) return "";
    if (value.indexOf("<!-- arxiv-interest-daily:feedback-profile -->") >= 0 && !looksLikeFeedbackRecord(value)) return value;
    if (looksLikeFeedbackRecord(value)) return "";
    if (looksLikeOrphanGuideText(value) && !/(偏好|画像|兴趣|推荐|降权|排除|喜欢|不喜欢|主题|方法|平台)/.test(value)) return "";
    if (!/(偏好|画像|兴趣|推荐|降权|排除|喜欢|不喜欢|主题|方法|平台|observable|method|platform|preference|deprioritize)/i.test(value)) return "";
    return value;
  }

  function readFeedbackProfile() {
    return usableFeedbackProfile(readDataFile("research_interests.feedback.md")) ||
      usableFeedbackProfile(readDataFile("feedback/research_interests.feedback.md"));
  }

  function paperKey(paper) {
    return baseArxivId(paper && (paper.arxivId || paper.id || paper.paperId)) ||
      String((paper && (paper.title || paper.link || paper.url)) || "");
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

  function isCrossPaper(paper, crossCats) {
    return !!(paper && (paper.selectionCross || paperMatchesCategories(paper, crossCats || [])));
  }

  function scoreOf(paper) {
    return parseInt(paper && (paper.selectionScore || paper.llmScore || 0), 10) || 0;
  }

  function takePapers(pool, seen, limit) {
    var selected = [];
    seen = seen || {};
    for (var i = 0; i < pool.length; i++) {
      var key = paperKey(pool[i]);
      if (key && seen[key]) continue;
      selected.push(pool[i]);
      if (key) seen[key] = true;
      if (limit !== undefined && limit !== null && selected.length >= limit) break;
    }
    return selected;
  }

  function sectionTags(papers) {
    var counts = {};
    for (var i = 0; i < papers.length; i++) {
      var tags = papers[i].llmTags || [];
      for (var t = 0; t < tags.length; t++) {
        var tag = String(tags[t] || "").trim();
        if (!tag) continue;
        counts[tag] = (counts[tag] || 0) + 1;
      }
    }
    return Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || a.localeCompare(b);
    }).slice(0, 6);
  }

  function paperSummaryText(paper) {
    return [
      paper && paper.llmReason ? "推荐理由: " + paper.llmReason : "",
      paper && paper.abstract ? "摘要: " + String(paper.abstract).slice(0, 1200) : "",
    ].filter(Boolean).join("\n");
  }

  function fallbackGuide(paper, cross) {
    var title = paper && paper.title ? paper.title : "这篇论文";
    var cats = paper && (paper.primaryCategory || paper.categories) ? "它位于 " + (paper.primaryCategory || paper.categories) + " 方向。" : "";
    var reason = paper && paper.llmReason ? String(paper.llmReason) : "";
    var abs = paper && paper.abstract ? String(paper.abstract) : "";
    var absShort = abs ? abs.slice(0, cross ? 850 : 1100) + (abs.length > (cross ? 850 : 1100) ? "..." : "") : "";
    var tags = paper && paper.llmTags && paper.llmTags.length ? paper.llmTags.join("、") : "";

    if (cross) {
      return [
        title + " 可以先按一个跨领域问题来理解。" + (cats ? cats : "") +
          " 对半外行读者来说，第一步不是追逐所有技术细节，而是抓住它所在领域关心的对象、自由度和可观测量。" +
          (tags ? " 这篇文章中最值得先建立图像的关键词是 " + tags + "。" : ""),
        (reason ? "它进入交叉推荐的原因是：" + reason + " " : "") +
          (absShort ? "从摘要看，文章的叙事主线大致是：" + absShort : "当前缺少完整摘要，因此只能先依据题名、分类和筛选理由判断。") +
          " 读这类文章时可以把重点放在“问题从哪里来、作者用什么证据约束它、结论改变了哪一种图像”这条链上。",
        "如果要把它和你的核心方向连接起来，建议关注其中是否提供了新的材料平台、谱学或输运判据、有效模型、边界或缺陷态图像，以及这些结果是否能转译到拓扑超导、Majorana、涡旋束缚态或 STM/STS 可观测量上。"
      ].join("\n\n");
    }

    return [
      title + " 可以从一幅基础图像进入：先识别论文研究的材料或模型、关键自由度、实验或理论可观测量，再看作者试图解决的具体矛盾。" +
        (tags ? " 本文可先围绕 " + tags + " 建立阅读坐标。" : ""),
      (reason ? "它被选为核心候选的原因是：" + reason + " " : "") +
        (absShort ? "摘要显示，文章的逻辑链是：" + absShort : "当前缺少完整摘要，因此需要结合正文或 arXiv 页面继续确认。") +
        " 阅读时可以顺着“出发问题 -> 方法和可观测量 -> 主要现象 -> 机制解释 -> 对后续工作的价值”这条线来组织。",
      "它的价值通常不只在于给出一个结论，还在于提供一种可复用的判断方式：哪些信号可信、哪些机制需要排除、哪些材料或参数区间值得继续追踪。"
    ].join("\n\n");
  }

  function fullAbstract(paper) {
    return String((paper && (paper.localizedAbstract || paper.abstract)) || "").replace(/\s+/g, " ").trim();
  }

  function normalizeLocale(value) {
    var locale = String(value || "").trim();
    if (/^zh/i.test(locale)) return "zh-CN";
    if (/^en/i.test(locale)) return "en-US";
    return locale || "zh-CN";
  }

  function reportLocaleFromConfig() {
    var reportLocale = "";
    var uiLocale = "";
    try {
      if (typeof ArxivDailyConfig !== "undefined") {
        reportLocale = ArxivDailyConfig.get("ui.reportLocale") || "";
        uiLocale = ArxivDailyConfig.get("ui.locale") || "";
      }
    } catch (e) {}
    if (!uiLocale) {
      try { uiLocale = (typeof Zotero !== "undefined" && Zotero.locale) || ""; } catch (e2) {}
    }
    return normalizeLocale(reportLocale || uiLocale || "zh-CN");
  }

  function languageName(locale) {
    locale = normalizeLocale(locale);
    if (/^zh/i.test(locale)) return "Simplified Chinese";
    if (/^en/i.test(locale)) return "English";
    return locale;
  }

  function shouldTranslateAbstract(text, locale) {
    text = String(text || "").trim();
    if (!text) return false;
    locale = normalizeLocale(locale);
    if (/^zh/i.test(locale)) return !/[\u4e00-\u9fff]/.test(text);
    if (/^en/i.test(locale)) return /[\u4e00-\u9fff]/.test(text);
    return false;
  }

  function textHash(text) {
    var hash = 2166136261;
    text = String(text || "");
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }

  function abstractTranslationCacheKey(paper, locale, source) {
    return [baseArxivId(paper && paper.arxivId) || paperKey(paper), normalizeLocale(locale), textHash(source)].join("::");
  }

  function readAbstractTranslationCache() {
    try {
      if (typeof ArxivDailyDataDir === "undefined" || !ArxivDailyDataDir.readJSON) return {};
      return ArxivDailyDataDir.readJSON("cache/llm/abstract-translations.json") || {};
    } catch (e) {
      return {};
    }
  }

  function writeAbstractTranslationCache(cache) {
    try {
      if (typeof ArxivDailyDataDir === "undefined" || !ArxivDailyDataDir.writeJSON) return;
      ArxivDailyDataDir.writeJSON("cache/llm/abstract-translations.json", cache || {});
    } catch (e) {
      logError("abstract translation cache write failed: " + (e.message || e));
    }
  }

  function collectUniquePapersForAbstracts(groups) {
    var seen = {};
    var out = [];
    for (var g = 0; g < (groups || []).length; g++) {
      var papers = groups[g] || [];
      for (var i = 0; i < papers.length; i++) {
        var paper = papers[i];
        var key = paperKey(paper);
        if (!key || seen[key]) continue;
        seen[key] = true;
        out.push(paper);
      }
    }
    return out;
  }

  function buildAbstractTranslationPrompt(items, locale) {
    var target = languageName(locale);
    return [
      "Translate the following arXiv abstracts into " + target + ".",
      "Preserve the complete scientific content, equations, symbols, acronyms, citations, and technical terms.",
      "Do not summarize, omit, shorten, add commentary, or end with ellipses.",
      "Make the translation grammatically natural in " + target + ".",
      "Return only a valid JSON array. Do not include Markdown fences.",
      "Each object must have exactly these fields: arxiv_id, abstract.",
      "",
      JSON.stringify(items)
    ].join("\n");
  }

  function looksTruncated(text) {
    return /(\.\.\.|…)\s*$/.test(String(text || "").trim());
  }

  function hasSubstantiveMetadata(paper) {
    if (!paper) return false;
    return !!(
      String(paper.title || "").trim() ||
      String(paper.abstract || "").trim() ||
      String(paper.authors || "").trim()
    );
  }

  function missingMetadataPapers(papers) {
    var missing = [];
    for (var i = 0; i < (papers || []).length; i++) {
      if (!hasSubstantiveMetadata(papers[i])) {
        var id = baseArxivId(papers[i] && papers[i].arxivId);
        if (id) missing.push(id);
      }
    }
    return missing;
  }

  function cacheArxivMetadata(papers) {
    if (!papers || !papers.length || typeof ArxivDailyDataDir === "undefined") return;
    try {
      var cache = ArxivDailyDataDir.readJSON("cache/arxiv/metadata.json") || {};
      for (var i = 0; i < papers.length; i++) {
        var id = baseArxivId(papers[i].arxivId);
        if (!id) continue;
        var existing = cache[id] || null;
        if (!hasSubstantiveMetadata(papers[i])) {
          if (!existing || !hasSubstantiveMetadata(existing)) delete cache[id];
          continue;
        }
        cache[id] = Object.assign({}, existing || {}, {
          arxivId: id,
          title: papers[i].title || (existing && existing.title) || "",
          authors: papers[i].authors || (existing && existing.authors) || "",
          abstract: papers[i].abstract || (existing && existing.abstract) || "",
          primaryCategory: papers[i].primaryCategory || (existing && existing.primaryCategory) || "",
          categories: papers[i].categories || (existing && existing.categories) || "",
          published: papers[i].published || (existing && existing.published) || "",
          doi: papers[i].doi || (existing && existing.doi) || "",
          journalRef: papers[i].journalRef || (existing && existing.journalRef) || "",
          citationIdentifier: papers[i].citationIdentifier || papers[i].doi || ("arXiv:" + id),
          cachedAt: new Date().toISOString(),
        });
      }
      ArxivDailyDataDir.writeJSON("cache/arxiv/metadata.json", cache);
    } catch (e) {
      logError("cache arXiv metadata failed: " + (e.message || e));
    }
  }

  function extractArxivIdsFromMarkdown(markdown) {
    var seen = {};
    var ids = [];
    var re = /(?:arXiv:\s*|arxiv\.org\/(?:abs|pdf)\/)([0-9]{4}\.[0-9]{4,5}(?:v\d+)?|[a-z-]+\/[0-9]{7}(?:v\d+)?)/ig;
    var match;
    while ((match = re.exec(String(markdown || "")))) {
      var id = baseArxivId(match[1]);
      if (id && !seen[id]) {
        seen[id] = true;
        ids.push(id);
      }
    }
    return ids;
  }

  function buildPriorReportMap(currentDate) {
    var map = {};
    if (typeof ArxivDailyReportStore === "undefined") return map;
    try {
      var reports = ArxivDailyReportStore.listReports().slice().sort(function (a, b) {
        return String(a.date || "").localeCompare(String(b.date || ""));
      });
      for (var i = 0; i < reports.length; i++) {
        var date = reports[i].date || "";
        if (!date || date === currentDate || date > currentDate) continue;
        var md = ArxivDailyReportStore.loadReport(date) || "";
        var ids = extractArxivIdsFromMarkdown(md);
        for (var j = 0; j < ids.length; j++) {
          if (!map[ids[j]]) map[ids[j]] = { date: date, fileName: reports[i].fileName || "" };
        }
      }
    } catch (err) {
      logError("build prior report map failed: " + (err.message || err));
    }
    return map;
  }

  function annotatePriorReports(papers, priorMap) {
    for (var i = 0; i < (papers || []).length; i++) {
      var id = baseArxivId(papers[i] && papers[i].arxivId);
      if (id && priorMap[id]) {
        papers[i].previousReportDate = priorMap[id].date;
      }
    }
  }

  function parseGuessResponse(text, ranked, limit) {
    var parsed = parseLLMSelectionResponse(text);
    var map = {};
    for (var i = 0; i < ranked.length; i++) {
      var key = paperKey(ranked[i]);
      if (key) map[key] = ranked[i];
    }
    var selected = [];
    for (var p = 0; p < parsed.length; p++) {
      var id = baseArxivId(parsed[p].arxiv_id || parsed[p].arxivId || parsed[p].id);
      var paper = map[id];
      if (!paper) continue;
      var score = clampScore(parsed[p].score, 0);
      if (score < 3) continue;
      paper.guessScore = score;
      paper.guessReason = String(parsed[p].reason || parsed[p].relevance || "").trim();
      selected.push(paper);
      if (selected.length >= limit) break;
    }
    return selected;
  }

  // ── Module ────────────────────────────────────────────────────────────────

  function parseAbstractTranslationResponse(text) {
    var raw = stripJSONFence(text);
    try {
      return parseJSONCandidate(raw).filter(function (item) {
        return item && typeof item === "object";
      });
    } catch (e) {
      var candidates = collectBalancedJSONCandidates(raw);
      for (var i = 0; i < candidates.length; i++) {
        try {
          return parseJSONCandidate(candidates[i]).filter(function (item) {
            return item && typeof item === "object";
          });
        } catch (err) {}
      }
      throw e;
    }
  }

  globalThis.ArxivDailyReportGenerator = {

    // Check if user can generate a report
    canGenerate: function () {
      if (typeof ArxivDailyConfig === "undefined") return false;
      if (typeof ArxivDailyLLM === "undefined") return false;
      return ArxivDailyConfig.isReadyForReport();
    },

    // Main generation pipeline
    generate: async function (dateStr, cancelToken, onProgress, options) {
      options = options || {};
      var requestedDateArg = dateStr || "";
      dateStr = requestedDateArg || getDateStr();
      log("=== Report generation started: " + dateStr + " ===");
      emitProgress(onProgress, "开始生成日报: " + dateStr, 2);

      var reportMeta = { date: dateStr, paperCount: 0 };
      var config = {};

      if (typeof ArxivDailyConfig !== "undefined") {
        config = {
          coreCategories: ArxivDailyConfig.get("arxiv.coreCategories") || [],
          crossCategories: ArxivDailyConfig.get("arxiv.crossCategories") || [],
          minScore: ArxivDailyConfig.get("screening.llmMinScore") || 3,
          maxCandidates: ArxivDailyConfig.get("screening.maxCandidates") || 80,
          keywordPrefilter: ArxivDailyConfig.get("screening.keywordPrefilter") !== false,
          keywordMinScore: ArxivDailyConfig.get("screening.keywordMinScore") || 2,
          prefilterMinScore: ArxivDailyConfig.get("screening.llmPrefilterMinScore") || 2,
          prefilterPasses: Math.max(1, Math.min(5, parseInt(ArxivDailyConfig.get("screening.llmPrefilterPasses") || 3, 10) || 3)),
          selectionMode: ArxivDailyConfig.get("screening.selectionMode") || "llm",
          llmBatchSize: ArxivDailyConfig.get("screening.llmBatchSize") || 20,
          llmRetryBatchSize: ArxivDailyConfig.get("screening.llmRetryBatchSize") || 5,
          llmPasses: Math.max(1, Math.min(5, parseInt(ArxivDailyConfig.get("screening.llmPasses") || 3, 10) || 3)),
          topN: ArxivDailyConfig.get("deepRead.topN") || 5,
          crossN: ArxivDailyConfig.get("deepRead.crossN") || 3,
          deepReadEnabled: ArxivDailyConfig.get("deepRead.enabled") !== false,
          deepReadMinCoreScore: ArxivDailyConfig.get("deepRead.minCoreScore") || 4,
          deepReadMinCrossScore: ArxivDailyConfig.get("deepRead.minCrossScore") || 1,
          outputTopN: ArxivDailyConfig.get("output.topN") || 3,
          outputGuessYouLikeN: ArxivDailyConfig.get("output.guessYouLikeN") || 7,
          outputMinCoreScore: ArxivDailyConfig.get("output.minCoreScore") || 2,
          outputMinCrossScore: ArxivDailyConfig.get("output.minCrossScore") || 1,
          outputCrossFallbackN: ArxivDailyConfig.get("output.crossFallbackN") || 4,
          reportLocale: reportLocaleFromConfig(),
        };
      }
      if (!config.reportLocale) config.reportLocale = reportLocaleFromConfig();
      if (options.noLLM) config.selectionMode = "keyword";
      config.llmOptions = (!options.noLLM && options.modelRef) ? { kind: "report", modelRef: options.modelRef } : { kind: "report" };
      if (!options.noLLM && options.reasoningEffort !== undefined) {
        config.llmOptions.reasoningEffort = options.reasoningEffort || "";
      }
      var llmConfiguredForReport = !options.noLLM &&
        typeof ArxivDailyLLM !== "undefined" &&
        ArxivDailyLLM.isConfigured(config.llmOptions);

      if (config.coreCategories.length === 0) {
        throw new Error("No arXiv categories configured. Configure core arXiv categories first.");
      }

      // ── Step 1: Fetch from announcement pages ──────────────────────────
      if (cancelToken && cancelToken.cancelled) throw new Error("cancelled");
      log("Step 1: Fetching core announcements...");
      emitProgress(onProgress, "正在抓取核心 arXiv 分区: " + config.coreCategories.join(", "), 12);

      var allPapers = [];

      if (typeof ArxivDailyFetcher !== "undefined") {
        try {
          var corePapers = await ArxivDailyFetcher.fetchAnnouncements(
            config.coreCategories, requestedDateArg || null, cancelToken, onProgress
          );
          emitProgress(onProgress, "核心分区抓取完成: " + corePapers.length + " 篇", 18);

          var crossPapers = [];
          if (config.crossCategories.length > 0) {
            log("Fetching cross-category announcements...");
            emitProgress(onProgress, "正在抓取交叉 arXiv 分区: " + config.crossCategories.join(", "), 18);
            crossPapers = await ArxivDailyFetcher.fetchAnnouncements(
              config.crossCategories, requestedDateArg || null, cancelToken, onProgress
            );
            emitProgress(onProgress, "交叉分区抓取完成: " + crossPapers.length + " 篇", 20);
          }

          allPapers = dedupePapers(corePapers.concat(crossPapers));
          emitProgress(onProgress, "抓取去重完成: " + allPapers.length + " 篇候选论文", 23);
        } catch (e) {
          throw stageError("Fetching arXiv papers failed", e);
        }

        if (allPapers.length > 0) {
          var ids = allPapers.map(function (p) { return p.arxivId; });
          try {
            emitProgress(onProgress, "正在补全 arXiv 元数据: " + ids.length + " 个 ID", 24);
            var apiPapers = await ArxivDailyFetcher.fetchMetadata(ids, cancelToken, onProgress);
            allPapers = ArxivDailyFetcher.merge(allPapers, apiPapers);
            allPapers = dedupePapers(allPapers);
            var missingMetadata = missingMetadataPapers(allPapers);
            if (missingMetadata.length) {
              reportMeta.missingMetadataCount = missingMetadata.length;
              reportMeta.missingMetadataIds = missingMetadata.slice(0, 30);
              reportMeta.missingMetadataWarning =
                "有 " + missingMetadata.length + " 篇论文缺少标题、作者和摘要，可能是 arXiv API 临时失败或缓存污染。";
              logError(reportMeta.missingMetadataWarning + " IDs: " + missingMetadata.slice(0, 20).join(", "));
            }
            cacheArxivMetadata(allPapers);
            emitProgress(onProgress, "元数据补全完成: " + apiPapers.length + " 条 API 结果，合并后 " + allPapers.length + " 篇", 28);
          } catch (e) {
            throw stageError("Fetching arXiv metadata failed", e);
          }
        }
      }

      log("Total papers fetched: " + allPapers.length);
      reportMeta.fetchedCount = allPapers.length;
      if (allPapers.length === 0) {
        var dateFilter = typeof ArxivDailyConfig !== "undefined"
          ? (ArxivDailyConfig.get("arxiv.dateFilter") || "latest")
          : "latest";
        var daysBack = typeof ArxivDailyConfig !== "undefined"
          ? (ArxivDailyConfig.get("arxiv.daysBack") || 3)
          : 3;
        throw new Error(
          "No papers found after arXiv fetching. " +
          "coreCategories=" + config.coreCategories.join(",") +
          "; crossCategories=" + config.crossCategories.join(",") +
          "; dateFilter=" + dateFilter +
          "; daysBack=" + daysBack + ". " +
          "Check arXiv category codes, date filter, network access, cache, and whether the selected categories have new papers today."
        );
      }
      if (cancelToken && cancelToken.cancelled) throw new Error("cancelled");

      var paperDateInfo = inferReportDateFromPapers(allPapers);
      var paperDateStr = paperDateInfo.date;
      if (paperDateInfo.dates.length) {
        reportMeta.paperDates = paperDateInfo.dates;
        reportMeta.paperDateCounts = paperDateInfo.counts;
      }
      if (paperDateInfo.mixed) {
        reportMeta.mixedPaperDates = true;
        reportMeta.reportDateRule = "latest-paper-date";
        emitProgress(onProgress, "检测到多日 arXiv 论文，报告命名日期采用最后日期: " + paperDateStr, 29);
      }
      if (paperDateStr && paperDateStr !== dateStr) {
        reportMeta.requestedDate = dateStr;
        dateStr = paperDateStr;
        reportMeta.date = dateStr;
        emitProgress(onProgress, "日报日期按抓取论文最后日期校正为: " + dateStr, 29);
      }

      // ── Step 2: Keyword scoring / optional keyword-only pre-filter ─────
      log("Step 2: Keyword scoring...");
      emitProgress(onProgress, "正在为候选论文计算关键词特征: " + allPapers.length + " 篇", 32);
      ensureKeywordScores(allPapers);
      var llmSelectionMode = config.selectionMode !== "keyword";
      var candidates = allPapers.slice();
      if (!llmSelectionMode && config.keywordPrefilter && typeof ArxivDailyKeywords !== "undefined") {
        candidates = ArxivDailyKeywords.prefilter(allPapers, config.keywordMinScore);
      } else if (llmSelectionMode) {
        reportMeta.keywordPrefilterBypassed = true;
      }
      if (cancelToken && cancelToken.cancelled) throw new Error("cancelled");

      if (candidates.length === 0 && allPapers.length > 0) {
        candidates = allPapers.slice();
        candidates.sort(function (a, b) { return (b.keywordScore || 0) - (a.keywordScore || 0); });
        reportMeta.keywordFallback = true;
        emitProgress(onProgress, "关键词预筛没有命中，已回退到全部抓取论文继续筛选: " + candidates.length + " 篇", 34);
      } else if (llmSelectionMode) {
        emitProgress(onProgress, "LLM 模式已跳过关键词预筛；关键词仅作为评分特征，送入 LLM " + candidates.length + " 篇", 34);
      } else {
        emitProgress(onProgress, "关键词预筛完成: " + allPapers.length + " → " + candidates.length + " 篇", 34);
      }

      // Limit candidates only for keyword-only mode. LLM mode follows the
      // desktop projects: keep high recall and let the LLM judge all fetched
      // papers, with keyword score provided only as a feature and fallback.
      if (!llmSelectionMode && candidates.length > config.maxCandidates) {
        candidates.sort(function (a, b) { return (b.keywordScore || 0) - (a.keywordScore || 0); });
        candidates = candidates.slice(0, config.maxCandidates);
        emitProgress(onProgress, "候选数量超过上限，保留关键词分数靠前的 " + candidates.length + " 篇", 36);
      }
      log("Candidates for LLM: " + candidates.length);
      reportMeta.candidateCount = candidates.length;

      var interestProfile = "";
      if (typeof ArxivDailyDataDir !== "undefined") {
        interestProfile = ArxivDailyDataDir.readFile("research_interests.base.md") ||
                         ArxivDailyDataDir.readFile("research_interests.active.md") || "";
      }
      var prefilterRejected = [];

      // ── Step 3: Broad LLM prefilter ───────────────────────────────────
      if (llmSelectionMode && candidates.length > 0 &&
          llmConfiguredForReport &&
          typeof ArxivDailyPrompts !== "undefined" && ArxivDailyPrompts.prefilterPrompt) {
        log("Step 3: broad LLM prefilter...");
        reportMeta.prefilterSourceCount = candidates.length;
        emitProgress(onProgress, "正在进行宽松 LLM 预筛: " + candidates.length + " 篇，" +
          config.prefilterPasses + " 轮并行取平均，最低保留分 " + config.prefilterMinScore, 38);

        var prefilterPrompt = ArxivDailyPrompts.prefilterPrompt(interestProfile);
        var prefilterBatchResults;
        try {
          prefilterBatchResults = await ArxivDailyLLM.batchScreen(candidates, prefilterPrompt, config.llmBatchSize, cancelToken, Object.assign({
            passes: config.prefilterPasses,
            parallelPasses: true,
            taskLabel: "prefilter",
          }, config.llmOptions));
        } catch (e) {
          throw stageError("LLM broad prefilter failed", e);
        }

        var parsedPrefilter = await parseBatchSelections(prefilterBatchResults, candidates, {
          label: "LLM 预筛",
          minKeepScore: config.prefilterMinScore,
          fallbackKeepAll: true,
          fallbackReason: "LLM 预筛结果不可解析，为避免关键词误杀，已宽松保留并进入正式评分。",
          missingReason: "LLM 预筛未返回这篇论文，为避免误杀，已宽松保留并进入正式评分。",
          retryOnParseFailure: true,
          retryBatchSize: config.llmRetryBatchSize,
          systemPrompt: prefilterPrompt,
          taskLabel: "prefilter-retry",
          llmOptions: config.llmOptions,
          cancelToken: cancelToken,
          onProgress: onProgress,
          progressStart: 40,
          progressStep: 3,
          progressMax: 14,
        });
        reportMeta.prefilterParseFailures = parsedPrefilter.parseFailures;
        reportMeta.prefilterRecoveredFailures = parsedPrefilter.recoveredFailures;
        reportMeta.prefilterDiagnostics = parsedPrefilter.diagnostics;

        var prefilterSource = candidates.slice();
        var prefiltered = markPrefilterResults(
          aggregateScreened(parsedPrefilter.records, config.prefilterMinScore),
          config.prefilterMinScore
        ).filter(function (paper) {
          var avg = parseFloat(paper.prefilterAverageScore || paper.prefilterScore || 0) || 0;
          return paper.prefilterKeep || avg >= config.prefilterMinScore;
        });

        if (prefiltered.length === 0) {
          reportMeta.prefilterFallback = true;
          prefiltered = candidates.map(function (paper) {
            var clone = Object.assign({}, paper);
            clone.prefilterScore = fallbackScore(clone);
            clone.prefilterAverageScore = clone.prefilterScore;
            clone.prefilterPassCount = 0;
            clone.prefilterKeep = true;
            clone.prefilterReason = "LLM 预筛没有保留任何论文，已回退到全部候选进入正式评分。";
            return clone;
          });
          prefilterRejected = [];
          emitProgress(onProgress, "宽松 LLM 预筛没有保留论文，已回退到全部候选: " + prefiltered.length + " 篇", 54);
        } else {
          var prefilteredMap = {};
          for (var pk = 0; pk < prefiltered.length; pk++) {
            var keptKey = paperKey(prefiltered[pk]);
            if (keptKey) prefilteredMap[keptKey] = true;
          }
          prefilterRejected = prefilterSource.filter(function (paper) {
            var key = paperKey(paper);
            return key && !prefilteredMap[key];
          }).map(function (paper) {
            var clone = Object.assign({}, paper);
            clone.prefilterKeep = false;
            clone.prefilterReason = "宽松 LLM 预筛未通过。";
            return clone;
          });
          emitProgress(onProgress, "宽松 LLM 预筛完成: " + candidates.length + " → " + prefiltered.length +
            " 篇，未通过 " + prefilterRejected.length + " 篇将写入其他论文", 54);
        }

        candidates = prefiltered;
        reportMeta.prefilterPassedCount = candidates.length;
        reportMeta.prefilterPasses = config.prefilterPasses;
        reportMeta.prefilterMinScore = config.prefilterMinScore;
        reportMeta.candidateCount = candidates.length;
      }

      // ── Step 4: LLM screening ─────────────────────────────────────────
      var screened = [];
      if (config.selectionMode !== "keyword" && candidates.length > 0 &&
          llmConfiguredForReport) {
        log("Step 4: LLM screening...");
        emitProgress(onProgress, "正在进行 LLM 相关性筛选: " + candidates.length + " 篇，批大小 " + config.llmBatchSize +
          "，筛选轮数 " + config.llmPasses + "（同批并行）", 58);

        var prompt = ArxivDailyPrompts.screeningPrompt(interestProfile);
        var batchResults;
        try {
          batchResults = await ArxivDailyLLM.batchScreen(candidates, prompt, config.llmBatchSize, cancelToken, Object.assign({
            passes: config.llmPasses,
            parallelPasses: true,
            taskLabel: "screening",
          }, config.llmOptions));
        } catch (e) {
          throw stageError("LLM relevance screening failed", e);
        }

        var parsedScreening = await parseBatchSelections(batchResults, candidates, {
          label: "LLM 筛选",
          minKeepScore: config.minScore,
          fallbackReason: "LLM 筛选结果不可解析，已按关键词分数兜底。",
          missingReason: "LLM 未返回这篇论文的筛选项，已按关键词分数兜底。",
          retryOnParseFailure: true,
          retryBatchSize: config.llmRetryBatchSize,
          systemPrompt: prompt,
          taskLabel: "screening-retry",
          llmOptions: config.llmOptions,
          cancelToken: cancelToken,
          onProgress: onProgress,
          progressStart: 60,
          progressStep: 3,
          progressMax: 14,
        });
        screened = parsedScreening.records;
        reportMeta.llmParseFailures = parsedScreening.parseFailures;
        reportMeta.llmRecoveredFailures = parsedScreening.recoveredFailures;
        reportMeta.llmDiagnostics = parsedScreening.diagnostics;
      } else {
        log("LLM screening skipped");
        for (var sk = 0; sk < candidates.length; sk++) {
          screened.push(applySelection(Object.assign({}, candidates[sk]), {
            score: fallbackScore(candidates[sk]),
            keep: fallbackScore(candidates[sk]) >= config.minScore,
            reason: config.selectionMode === "keyword"
              ? "关键词筛选模式：按关键词分数进入日报。"
              : "LLM 未配置或无候选，按关键词分数兜底。",
            tags: [],
          }));
        }
        emitProgress(onProgress, "LLM 筛选跳过，使用关键词分数: " + screened.length + " 篇", 58);
      }

      screened = aggregateScreened(screened, config.minScore);
      screened.sort(scoreSort);
      log("LLM screened: " + screened.length);
      reportMeta.screenedCount = screened.length;
      emitProgress(onProgress, "相关性筛选完成: " + screened.length + " 篇有评分", 72);

      // ── Step 4: Filter by score ───────────────────────────────────────
      var topPapers = screened.filter(function (p) {
        var score = p.selectionScore || p.llmScore || fallbackScore(p);
        return p.selectionKeep || score >= config.minScore;
      });
      topPapers.sort(scoreSort);

      if (topPapers.length === 0 && screened.length > 0) {
        var fallbackLimit = Math.max(1, (config.topN || 5) + (config.crossN || 3));
        topPapers = screened.slice(0, fallbackLimit);
        reportMeta.selectionFallback = true;
        reportMeta.selectionWarning = "没有论文达到当前 LLM 最低分阈值，报告改为保留低置信但排序靠前的邻近候选，避免抓取成功后生成空报告。";
        for (var fb = 0; fb < topPapers.length; fb++) {
          if (!topPapers[fb].llmReason) {
            topPapers[fb].llmReason = "低置信兜底候选：未达到当前最低分阈值，但在今日候选中排序靠前。";
          }
        }
        emitProgress(onProgress, "没有论文达到最低分阈值，已使用邻近候选兜底: " + topPapers.length + " 篇", 78);
      }

      log("Top papers after screening: " + topPapers.length);
      reportMeta.selectedCount = topPapers.length;
      emitProgress(onProgress, "日报候选确定: " + topPapers.length + " 篇", 82);

      if (config.deepReadEnabled && llmConfiguredForReport) {
        try {
          await this._enrichGuides(screened, config, cancelToken, onProgress);
        } catch (guideErr) {
          reportMeta.deepReadWarning = "深度导读生成失败，报告已回退为摘要导读: " + (guideErr.message || guideErr);
          emitProgress(onProgress, reportMeta.deepReadWarning, 84);
        }
      }

      var guessPapers = [];
      var guessSourcePapers = screened && screened.length ? screened : topPapers;
      try {
        guessPapers = await this._buildGuessYouLike(guessSourcePapers, config, cancelToken, onProgress);
        for (var gpWarn = 0; gpWarn < guessPapers.length; gpWarn++) {
          if (guessPapers[gpWarn] && guessPapers[gpWarn].guessFallback) {
            reportMeta.guessYouLikeWarning = guessPapers[gpWarn].guessFallbackReason ||
              "猜你喜欢 LLM 结果不可用，已按画像和当前评分兜底排序。";
            break;
          }
        }
      } catch (guessErr) {
        reportMeta.guessYouLikeWarning = "猜你喜欢区块生成失败，已跳过: " + (guessErr.message || guessErr);
        emitProgress(onProgress, reportMeta.guessYouLikeWarning, 86);
      }

      // ── Step 5: Generate markdown report ──────────────────────────────
      if (cancelToken && cancelToken.cancelled) throw new Error("cancelled");
      log("Step 5: Generating markdown report...");
      emitProgress(onProgress, "正在生成 Markdown 报告: " + topPapers.length + " 篇", 88);

      var priorReportMap = buildPriorReportMap(dateStr);
      annotatePriorReports(screened, priorReportMap);
      annotatePriorReports(guessPapers, priorReportMap);
      annotatePriorReports(prefilterRejected, priorReportMap);

      await this._localizeAbstracts([
        topPapers,
        screened,
        guessPapers,
        prefilterRejected,
      ], config, cancelToken, onProgress);

      var md = this._buildMarkdown(dateStr, topPapers, config, reportMeta, {
        guessPapers: guessPapers,
        weakRelatedSource: screened,
        otherPapers: prefilterRejected,
      });
      reportMeta.paperCount = topPapers.length;

      // ── Step 6: Save ─────────────────────────────────────────────────
      var saved = false;
      if (typeof ArxivDailyReportStore === "undefined") {
        throw new Error("Report save failed: report store module is not loaded");
      }
      try {
        if (ArxivDailyReportStore.hasReport && ArxivDailyReportStore.hasReport(dateStr)) {
          emitProgress(onProgress, "检测到当天已有旧报告，正在按删除旧报告流程清理关联项目论文", 92);
          if (typeof ArxivDailyCenterWorkspace !== "undefined" &&
              ArxivDailyCenterWorkspace.deleteReportCascade) {
            await ArxivDailyCenterWorkspace.deleteReportCascade(dateStr, { deleteZoteroItems: true });
          } else {
            ArxivDailyReportStore.deleteReport(dateStr);
          }
        }
        saved = ArxivDailyReportStore.saveReport(dateStr, md, reportMeta);
      } catch (e) {
        throw stageError("Report save failed", e);
      }
      if (!saved) {
        var storeDetail = "";
        try {
          if (typeof ArxivDailyDataDir !== "undefined" && ArxivDailyDataDir.getLastError) {
            storeDetail = ArxivDailyDataDir.getLastError() || "";
          }
        } catch (e2) {}
        throw new Error("Report save failed: report store returned false" +
          (storeDetail ? "; " + storeDetail : ""));
      }

      emitProgress(onProgress, "报告已保存: " + dateStr + "，论文 " + topPapers.length + " 篇", 96);
      emitProgress(onProgress, "正在刷新 Zotero 内部视图", 98);
      log("=== Report generation complete: " + dateStr + " ===");
      return { markdown: md, meta: reportMeta, saved: saved };
    },

    // ── Markdown builder ──────────────────────────────────────────────

    _enrichGuides: async function (papers, config, cancelToken, onProgress) {
      if (!papers || !papers.length) return;
      var coreDone = 0;
      var crossDone = 0;
      for (var i = 0; i < papers.length; i++) {
        if (cancelToken && cancelToken.cancelled) throw new Error("cancelled");
        var paper = papers[i];
        var score = scoreOf(paper);
        var cross = isCrossPaper(paper, config.crossCategories || []);
        if (!cross && (coreDone >= (config.topN || 5) || score < (config.deepReadMinCoreScore || 4))) continue;
        if (cross && (crossDone >= (config.crossN || 3) || score < (config.deepReadMinCrossScore || 1))) continue;
        emitProgress(onProgress, "正在生成论文导读: " + (paper.title || paper.arxivId || ""), 83 + Math.min(4, coreDone + crossDone));
        try {
          var prompt = cross
            ? ArxivDailyPrompts.crossReadPrompt(paper)
            : ArxivDailyPrompts.deepReadPrompt(paper, paper.abstract || "");
          var response = await ArxivDailyLLM.complete(
            cross ? "你是凝聚态交叉方向论文推荐助手。请用简体中文回答。" : "你是严谨的凝聚态论文导读助手。请用简体中文回答。",
            prompt,
            cancelToken,
            config.llmOptions
          );
          if (cross) {
            paper.crossFieldGuide = String(response || "").trim();
            crossDone++;
          } else {
            paper.readingGuide = String(response || "").trim();
            coreDone++;
          }
        } catch (e) {
          if (cancelToken && cancelToken.cancelled) throw e;
          if (cross) {
            paper.crossFieldGuide = fallbackGuide(paper, true);
            crossDone++;
          } else {
            paper.readingGuide = fallbackGuide(paper, false);
            coreDone++;
          }
        }
      }
    },

    _localizeAbstracts: async function (groups, config, cancelToken, onProgress) {
      var locale = normalizeLocale((config && config.reportLocale) || reportLocaleFromConfig());
      var papers = collectUniquePapersForAbstracts(groups);
      if (!papers.length) return;

      for (var i = 0; i < papers.length; i++) {
        papers[i].localizedAbstract = fullAbstract(papers[i]);
      }

      var needs = papers.filter(function (paper) {
        return shouldTranslateAbstract(paper.abstract, locale);
      });
      if (!needs.length) return;

      if (typeof ArxivDailyLLM === "undefined" || !ArxivDailyLLM.isConfigured(config.llmOptions)) {
        log("abstract translation skipped: LLM not configured for report");
        return;
      }

      var cache = readAbstractTranslationCache();
      var pending = [];
      for (var n = 0; n < needs.length; n++) {
        var source = String(needs[n].abstract || "").replace(/\s+/g, " ").trim();
        var key = abstractTranslationCacheKey(needs[n], locale, source);
        var cached = cache[key] && String(cache[key].abstract || "").trim();
        if (cached && !looksTruncated(cached)) {
          needs[n].localizedAbstract = cached;
        } else {
          pending.push({ paper: needs[n], key: key, source: source });
        }
      }
      if (!pending.length) return;

      emitProgress(onProgress, "Translating full abstracts for report language: " + pending.length, 87);
      var batchSize = 8;
      for (var start = 0; start < pending.length; start += batchSize) {
        if (cancelToken && cancelToken.cancelled) throw new Error("cancelled");
        var batch = pending.slice(start, start + batchSize);
        var items = batch.map(function (entry) {
          return {
            arxiv_id: baseArxivId(entry.paper.arxivId),
            title: entry.paper.title || "",
            abstract: entry.source,
          };
        });
        try {
          var prompt = buildAbstractTranslationPrompt(items, locale);
          var response = await ArxivDailyLLM.complete(
            "You are a careful scientific translator. Return only valid JSON.",
            prompt,
            cancelToken,
            Object.assign({}, config.llmOptions, { maxTokens: 12000, temperature: 0.1 })
          );
          var parsed = parseAbstractTranslationResponse(response);
          var byId = {};
          for (var p = 0; p < parsed.length; p++) {
            var id = baseArxivId(parsed[p].arxiv_id || parsed[p].arxivId || parsed[p].id);
            var text = String(parsed[p].abstract || parsed[p].translation || "").trim();
            if (id && text && !looksTruncated(text)) byId[id] = text.replace(/\s+/g, " ");
          }
          for (var b = 0; b < batch.length; b++) {
            var translated = byId[baseArxivId(batch[b].paper.arxivId)];
            if (!translated) continue;
            batch[b].paper.localizedAbstract = translated;
            cache[batch[b].key] = {
              arxivId: baseArxivId(batch[b].paper.arxivId),
              locale: locale,
              abstract: translated,
              sourceHash: textHash(batch[b].source),
              cachedAt: new Date().toISOString(),
            };
          }
        } catch (e) {
          logError("abstract translation batch failed: " + (e.message || e));
        }
      }
      writeAbstractTranslationCache(cache);
    },

    _buildGuessYouLike: async function (rankedPapers, config, cancelToken, onProgress) {
      var limit = Math.max(0, Math.min(20, parseInt(config.outputGuessYouLikeN, 10) || 0));
      if (!limit || !rankedPapers || !rankedPapers.length) return [];
      var feedbackProfile = readFeedbackProfile();
      if (!String(feedbackProfile || "").trim()) return [];
      var candidates = rankedPapers.slice(0, 80);
      var fallbackReason = "LLM 猜你喜欢排序不可用，已按猜你喜欢画像、当前相关性评分和关键词分数兜底排序。";
      if (typeof ArxivDailyLLM === "undefined" || !ArxivDailyLLM.isConfigured(config.llmOptions)) {
        emitProgress(onProgress, "猜你喜欢画像已读取，LLM 不可用，使用本地兜底排序", 85);
        return buildGuessFallback(candidates, feedbackProfile, limit, fallbackReason);
      }

      emitProgress(onProgress, "正在根据猜你喜欢画像重排今日候选", 85);
      var papersText = candidates.map(function (paper) {
        return [
          "arxiv_id: " + (paper.arxivId || ""),
          "title: " + (paper.title || ""),
          "categories: " + (paper.categories || paper.primaryCategory || ""),
          "summary: " + paperSummaryText(paper),
          "current_report_score: " + scoreOf(paper),
          "current_relevance: " + (paper.llmReason || ""),
        ].join("\n");
      }).join("\n\n---\n\n");
      var prompt = [
        "Rank papers for a '猜你喜欢' section.",
        "",
        "Feedback-adjusted profile:",
        feedbackProfile,
        "",
        "Today's candidate papers:",
        papersText,
        "",
        "Return a JSON array with at most " + limit + " objects:",
        '[{"arxiv_id":"paper id","score":1,"reason":"简短中文理由"}]',
        "",
        "Use score 1-5. Only include papers with score >= 3.",
      ].join("\n");
      try {
        var response = await ArxivDailyLLM.complete(
          "You are ranking today's arXiv papers for a short '猜你喜欢' section. Use the feedback-adjusted profile. Return only valid JSON.",
          prompt,
          cancelToken,
          config.llmOptions
        );
        var selected = parseGuessResponse(response, candidates, limit);
        if (selected.length) return selected;
        return buildGuessFallback(
          candidates,
          feedbackProfile,
          limit,
          "LLM 未返回可用猜你喜欢条目，已按猜你喜欢画像、当前相关性评分和关键词分数兜底排序。"
        );
      } catch (err) {
        logError("guess-you-like LLM ranking failed: " + (err.message || err));
        return buildGuessFallback(candidates, feedbackProfile, limit, fallbackReason);
      }
    },

    _buildMarkdown: function (dateStr, papers, config, meta, extras) {
      var lines = [];
      var dateLabel = formatDate(dateStr);
      extras = extras || {};

      lines.push("# " + dateLabel + " arXiv 兴趣报告");
      lines.push("");
      var reportNote = "自动生成";
      if (meta && meta.missingMetadataCount) {
        reportNote += "；信息提示：本报告有 " + meta.missingMetadataCount +
          " 篇论文缺少标题、作者和摘要。若怀疑抓取或缓存异常，请在阅读器顶部清除论文缓存并重新生成。";
      }
      lines.push("> " + reportNote);
      lines.push("");
      lines.push("## 今日概览");
      lines.push("");
      lines.push("- 推荐论文数: " + papers.length);
      if (meta) {
        lines.push("- 抓取论文数: " + (meta.fetchedCount || 0));
        if (meta.mixedPaperDates && meta.paperDates && meta.paperDates.length) {
          lines.push("- 日期校正: 检测到多日 arXiv 论文 (" + meta.paperDates.join(", ") + ")，本报告按最后日期 " + dateStr + " 命名");
        }
        lines.push("- LLM / 关键词筛选候选数: " + (meta.candidateCount || 0));
        if (meta.prefilterSourceCount) {
          lines.push("- 宽松 LLM 预筛: " + meta.prefilterSourceCount + " → " + (meta.prefilterPassedCount || 0) +
            " 篇，" + (meta.prefilterPasses || 1) + " 轮并行取平均，最低保留分 " + (meta.prefilterMinScore || 2));
        }
        lines.push("- 相关性评分论文数: " + (meta.screenedCount || 0));
        if (meta.keywordPrefilterBypassed) lines.push("- 关键词处理: LLM 模式使用宽松 LLM 预筛替代关键词预筛；关键词仅作为排序与兜底特征");
        if (meta.prefilterRecoveredFailures) lines.push("- 预筛恢复: " + meta.prefilterRecoveredFailures + " 个 LLM 批次解析失败后已自动小批重试恢复");
        if (meta.llmRecoveredFailures) lines.push("- 筛选恢复: " + meta.llmRecoveredFailures + " 个 LLM 批次解析失败后已自动小批重试恢复");
        if (meta.prefilterParseFailures) lines.push("- 预筛解析兜底: " + meta.prefilterParseFailures + " 个 LLM 批次仍不可解析，原始响应已保存到 cache/llm/raw-responses");
        if (meta.llmParseFailures) lines.push("- 筛选解析兜底: " + meta.llmParseFailures + " 个 LLM 批次仍不可解析，原始响应已保存到 cache/llm/raw-responses");
        if (meta.prefilterFallback) lines.push("- 预筛提示: LLM 预筛没有保留论文，已回退到全部候选进入正式评分");
        if (meta.selectionWarning) lines.push("- 筛选提示: " + meta.selectionWarning);
        if (meta.missingMetadataWarning) lines.push("- 元数据提示: " + meta.missingMetadataWarning);
        if (meta.deepReadWarning) lines.push("- 导读提示: " + meta.deepReadWarning);
        if (meta.guessYouLikeWarning) lines.push("- 猜你喜欢提示: " + meta.guessYouLikeWarning);
      }
      lines.push("");

      var coreCats = config.coreCategories || [];
      var crossCats = config.crossCategories || [];
      var ranked = papers.slice().sort(scoreSort);
      var weakSourceRanked = (extras.weakRelatedSource || papers).slice().sort(scoreSort);
      var otherPapers = (extras.otherPapers || []).slice().sort(function (a, b) {
        return ((b.keywordScore || 0) - (a.keywordScore || 0)) ||
          String(a.title || "").localeCompare(String(b.title || ""));
      });
      var sectionSeq = 0;
      function addNumberedSection(title) {
        sectionSeq++;
        var label = romanNumeral(sectionSeq);
        lines.push("## " + label + ". " + title);
        lines.push("");
        return label;
      }
      var themes = sectionTags(ranked);
      if (themes.length) {
        lines.push("## 今日主题");
        lines.push("");
        lines.push(themes.join(" / "));
        lines.push("");
      }

      var guessPapers = extras.guessPapers || [];
      if (guessPapers.length > 0) {
        var guessLabel = addNumberedSection("猜你喜欢");
        lines.push("这个区块根据“猜你喜欢科研兴趣画像”重排今日候选；它不影响后续推荐区块，同一篇论文仍可能在下面再次出现。");
        lines.push("");
        for (var gp = 0; gp < guessPapers.length; gp++) {
          this._addPaper(lines, guessPapers[gp], gp + 1, { guess: true, headingLabel: guessLabel + "." + (gp + 1) + "." });
        }
      }

      var seen = {};
      var minCoreScore = parseInt(config.outputMinCoreScore, 10) || 2;
      var minCrossScore = parseInt(config.outputMinCrossScore, 10) || 1;
      var topN = parseInt(config.outputTopN, 10) || 3;
      var relatedN = 10;
      var crossFallbackN = parseInt(config.outputCrossFallbackN, 10) || 4;

      var corePool = ranked.filter(function (p) {
        return !isCrossPaper(p, crossCats) && scoreOf(p) >= minCoreScore &&
          (paperMatchesCategories(p, coreCats) || !paperMatchesCategories(p, crossCats));
      });
      if (!corePool.length) {
        corePool = ranked.filter(function (p) { return !isCrossPaper(p, crossCats); });
      }
      var topPapers = takePapers(corePool, seen, topN);
      var detailPapers = takePapers(corePool, seen);

      var relatedPreview = [];

      var crossPapers = ranked.filter(function (p) {
        return isCrossPaper(p, crossCats) && scoreOf(p) >= minCrossScore;
      });
      var crossFallback = [];
      if (!crossPapers.length) {
        crossFallback = takePapers(ranked.filter(function (p) {
          return isCrossPaper(p, crossCats) || scoreOf(p) >= 1;
        }), seen, crossFallbackN);
      }

      var recommended = {};
      topPapers.concat(detailPapers).concat(crossPapers).concat(crossFallback).forEach(function (p) {
        var key = paperKey(p);
        if (key) recommended[key] = true;
      });
      relatedPreview = takePapers(ranked.filter(function (p) {
        var key = paperKey(p);
        return key && !recommended[key] && !isCrossPaper(p, crossCats) && scoreOf(p) >= 1;
      }), {}, relatedN);

      relatedPreview.forEach(function (p) {
        var key = paperKey(p);
        if (key) recommended[key] = true;
      });
      guessPapers.forEach(function (p) {
        var key = paperKey(p);
        if (key) recommended[key] = true;
      });

      var llmPassedNotRecommended = weakSourceRanked.filter(function (p) {
        var key = paperKey(p);
        return key && !recommended[key];
      });

      var topLabel = addNumberedSection("最相关论文");
      if (topPapers.length) {
        for (var i = 0; i < topPapers.length; i++) this._addPaper(lines, topPapers[i], i + 1, { guide: true, headingLabel: topLabel + "." + (i + 1) + "." });
      } else {
        lines.push("暂无达到核心分数阈值的论文。");
        lines.push("");
      }

      var detailLabel = addNumberedSection("论文详细列表");
      if (detailPapers.length) {
        for (var d = 0; d < detailPapers.length; d++) this._addPaper(lines, detailPapers[d], d + 1, { headingLabel: detailLabel + "." + (d + 1) + "." });
      } else {
        lines.push("除最相关论文外，今日暂无更多达到核心阈值的相关文章。");
        lines.push("");
      }

      var relatedLabel = addNumberedSection("其他相关文章速览");
      if (relatedPreview.length) {
        lines.push("以下论文相关性较弱或证据不如 Top 论文充分，但仍可能值得快速扫读标题、摘要和方法。");
        lines.push("");
        for (var rp = 0; rp < relatedPreview.length; rp++) this._addPaper(lines, relatedPreview[rp], rp + 1, { brief: true, headingLabel: relatedLabel + "." + (rp + 1) + "." });
      } else {
        lines.push("暂无更多可粗略推荐的相关文章。");
        lines.push("");
      }

      var crossLabel = addNumberedSection("交叉方向推荐");
      lines.push("这些论文不一定直接命中核心兴趣，但可能带来相邻方法、材料平台或新视角。");
      lines.push("");
      if (crossPapers.length > 0) {
        for (var c = 0; c < crossPapers.length; c++) this._addPaper(lines, crossPapers[c], c + 1, { crossGuide: true, headingLabel: crossLabel + "." + (c + 1) + "." });
      } else if (crossFallback.length) {
        lines.push("今天没有筛选出足够明确的交叉领域论文。下面列出几篇方向上可能接近、值得快速扫读的新推荐。");
        lines.push("");
        for (var cf = 0; cf < crossFallback.length; cf++) this._addPaper(lines, crossFallback[cf], cf + 1, { brief: true, headingLabel: crossLabel + "." + (cf + 1) + "." });
      } else {
        lines.push("暂无明确交叉方向推荐。");
        lines.push("");
      }

      var weakLabel = addNumberedSection("弱相关论文速读");
      if (llmPassedNotRecommended.length) {
        lines.push("下面列出通过宽松 LLM 预筛、但没有进入猜你喜欢/最相关/详细/速览/交叉推荐的论文，并按正式评分排序。这里保留题名、评分、推荐理由和摘要，方便快速扫读当天低置信但可能有用的论文。");
        lines.push("");
        for (var lp = 0; lp < llmPassedNotRecommended.length; lp++) {
          this._addPaper(lines, llmPassedNotRecommended[lp], lp + 1, { brief: true, skim: true, headingLabel: weakLabel + "." + (lp + 1) + "." });
        }
      } else {
        lines.push("无。");
        lines.push("");
      }

      var otherLabel = addNumberedSection("其他论文");
      if (otherPapers.length) {
        lines.push("以下论文未通过宽松 LLM 预筛，仍保留标题、作者、链接和摘要，供需要时完整回看当天抓取池。");
        lines.push("");
        for (var op = 0; op < otherPapers.length; op++) {
          this._addPaper(lines, otherPapers[op], op + 1, {
            brief: true,
            other: true,
            headingLabel: otherLabel + "." + (op + 1) + ".",
          });
        }
      } else {
        lines.push("无。");
        lines.push("");
      }

      return lines.join("\n");
    },

    _addPaper: function (lines, paper, num, options) {
      options = options || {};
      var score = paper.selectionScore || paper.llmScore || 0;
      var scoreStr = score && !options.other ? " [评分: " + score + "/5]" : "";
      var headingLabel = options.headingLabel || (num + ".");
      var headingTitle = String(paper.title || "").trim() || ("arXiv " + (paper.arxivId || "") + "（信息缺失）");
      lines.push("### " + headingLabel + " " + headingTitle + scoreStr);
      lines.push("");
      var authors = formatAuthors(paper);
      if (authors) lines.push("**作者**: " + authors);
      lines.push("**arXiv**: [" + paper.arxivId + "](https://arxiv.org/abs/" + paper.arxivId + ")");
      if (!options.other) {
        lines.push("**标识符**: " + (paper.citationIdentifier || paper.doi || ("arXiv:" + paper.arxivId)));
        if (paper.doi) lines.push("**DOI**: " + paper.doi);
        if (paper.journalRef) lines.push("**Journal ref**: " + paper.journalRef);
        if (paper.primaryCategory) lines.push("**分类**: " + paper.primaryCategory);
      }
      if (paper.previousReportDate) {
        lines.push("**曾见日报**: [" + paper.previousReportDate + "](arxiv-daily-report://" + paper.previousReportDate + "/" + paper.arxivId + ")");
      }
      if (!options.other && Number.isFinite(parseFloat(paper.keywordScore))) lines.push("**关键词分数**: " + paper.keywordScore);
      if (!options.other && options.guess && paper.guessReason) lines.push("**猜你喜欢理由**: " + paper.guessReason);
      if (!options.other && paper.llmReason) lines.push("**推荐理由**: " + paper.llmReason);
      if (!options.other && paper.llmTags && paper.llmTags.length > 0) {
        lines.push("**标签**: " + paper.llmTags.join(", "));
      }
      if (paper.abstract) {
        lines.push("");
        lines.push("**摘要**:");
        lines.push("");
        lines.push(fullAbstract(paper));
      }
      if (options.guide) {
        lines.push("");
        lines.push("**长导读**:");
        lines.push("");
        lines.push(paper.readingGuide || fallbackGuide(paper, false));
      } else if (options.crossGuide) {
        lines.push("");
        lines.push("**交叉导读**:");
        lines.push("");
        lines.push(paper.crossFieldGuide || paper.readingGuide || fallbackGuide(paper, true));
      }
      lines.push("");
      lines.push("---");
      lines.push("");
    },
  };
})();
