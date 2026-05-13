/* ==========================================================================
 * llm/client.js - LLM API client
 *
 * Supports OpenAI-compatible Chat Completions and Anthropic Messages API.
 * ==========================================================================
 */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";
  const ANTHROPIC_VERSION = "2023-06-01";
  const INVISIBLE_RE = /[\u0000-\u001F\u007F-\u009F\u00A0\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
  const MESSAGE_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

  function log(msg) {
    const text = "[" + LOG_PREFIX + "] " + msg;
    if (typeof Zotero.debug === "function") Zotero.debug(text);
    else if (typeof Zotero.log === "function") Zotero.log(text);
  }

  function getConfig() {
    if (typeof ArxivDailyConfig === "undefined") return null;
    return {
      provider: cleanTextValue(ArxivDailyConfig.get("llm.provider") || ""),
      apiStyle: cleanTextValue(ArxivDailyConfig.get("llm.apiStyle") || "openai"),
      apiKey: cleanHeaderValue(ArxivDailyConfig.get("llm.apiKey") || ""),
      model: cleanTextValue(ArxivDailyConfig.get("llm.model") || ""),
      baseUrl: cleanURLValue(ArxivDailyConfig.get("llm.baseUrl") || ""),
      temperature: numericValue(ArxivDailyConfig.get("llm.temperature"), 0.3, 0, 2),
      maxTokens: Math.round(numericValue(ArxivDailyConfig.get("llm.maxTokens"), 32768, 256, 1000000)),
      timeoutSeconds: Math.round(numericValue(ArxivDailyConfig.get("llm.timeoutSeconds"), 180, 30, 600)),
      retryAttempts: Math.round(numericValue(ArxivDailyConfig.get("llm.retryAttempts"), 3, 1, 5)),
    };
  }

  function cleanTextValue(value) {
    return String(value || "").replace(INVISIBLE_RE, "").trim();
  }

  function cleanHeaderValue(value) {
    return String(value || "").replace(INVISIBLE_RE, "").trim();
  }

  function cleanURLValue(value) {
    return String(value || "").replace(INVISIBLE_RE, "").trim();
  }

  function cleanMessageText(value) {
    var text = String(value || "").replace(MESSAGE_CONTROL_RE, "");
    var out = "";
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) {
        var next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
        if (next >= 0xDC00 && next <= 0xDFFF) {
          out += text.charAt(i) + text.charAt(i + 1);
          i++;
        } else {
          out += "\uFFFD";
        }
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        out += "\uFFFD";
      } else {
        out += text.charAt(i);
      }
    }
    return out;
  }

  function numericValue(value, fallback, min, max) {
    var number = parseFloat(value);
    if (!Number.isFinite(number)) number = fallback;
    if (Number.isFinite(min)) number = Math.max(min, number);
    if (Number.isFinite(max)) number = Math.min(max, number);
    return number;
  }

  function splitModelList(value) {
    if (Array.isArray(value)) return value;
    return String(value || "")
      .split(/[\n,;，；、]+/)
      .map(function (part) { return cleanTextValue(part); })
      .filter(function (part) { return !!part; });
  }

  function usageKey(kind) {
    kind = lower(kind || "default");
    if (kind === "report" || kind === "generate" || kind === "generation") return "report";
    if (kind === "search" || kind === "llm-search") return "search";
    if (kind === "qa" || kind === "chat" || kind === "question") return "qa";
    return "default";
  }

  function modelRef(apiId, model) {
    return cleanTextValue(apiId || "") + "::" + cleanTextValue(model || "");
  }

  function parseModelRef(ref) {
    var value = cleanTextValue(ref || "");
    var idx = value.indexOf("::");
    if (idx < 0) return { apiId: "", model: value };
    return {
      apiId: value.slice(0, idx),
      model: value.slice(idx + 2),
    };
  }

  function legacyAPIConfig() {
    if (typeof ArxivDailyConfig === "undefined") return null;
    var provider = cleanTextValue(ArxivDailyConfig.get("llm.provider") || "");
    var apiKey = cleanHeaderValue(ArxivDailyConfig.get("llm.apiKey") || "");
    var apiKeyEnv = cleanTextValue(ArxivDailyConfig.get("llm.apiKeyEnv") || "");
    var model = cleanTextValue(ArxivDailyConfig.get("llm.model") || "");
    if (!provider && !apiKey && !apiKeyEnv && !model) return null;
    return {
      id: "default",
      name: "默认 API",
      provider: provider,
      apiStyle: cleanTextValue(ArxivDailyConfig.get("llm.apiStyle") || "openai"),
      apiKey: apiKey,
      apiKeyEnv: apiKeyEnv,
      model: model,
      models: model ? [model] : [],
      baseUrl: cleanURLValue(ArxivDailyConfig.get("llm.baseUrl") || ""),
      enabled: true,
    };
  }

  function apiKeyFromEnv(name) {
    name = cleanTextValue(name || "");
    if (!name) return "";
    try {
      if (typeof Zotero !== "undefined" && Zotero.Utilities && Zotero.Utilities.Internal &&
          typeof Zotero.Utilities.Internal.Environment === "object") {
        return cleanHeaderValue(Zotero.Utilities.Internal.Environment[name] || "");
      }
    } catch (e) {}
    return "";
  }

  function normalizedAPIEntry(api, index) {
    if (!api || typeof api !== "object") return null;
    var id = cleanTextValue(api.id || ("api_" + (index + 1)));
    var model = cleanTextValue(api.model || "");
    var models = splitModelList(api.models || api.modelList || model);
    if (model && models.indexOf(model) < 0) models.unshift(model);
    var apiKey = cleanHeaderValue(api.apiKey || "");
    if (!apiKey) apiKey = apiKeyFromEnv(api.apiKeyEnv);
    return {
      id: id,
      name: cleanTextValue(api.name || api.label || id),
      provider: cleanTextValue(api.provider || ""),
      apiStyle: cleanTextValue(api.apiStyle || "openai"),
      apiKey: apiKey,
      apiKeyEnv: cleanTextValue(api.apiKeyEnv || ""),
      model: model || (models.length ? models[0] : ""),
      models: models,
      baseUrl: cleanURLValue(api.baseUrl || ""),
      enabled: api.enabled !== false,
    };
  }

  function configuredAPIs() {
    var out = [];
    var legacy = legacyAPIConfig();
    if (legacy) out.push(legacy);
    try {
      if (typeof ArxivDailyConfig !== "undefined") {
        var apis = ArxivDailyConfig.get("llm.apis") || [];
        if (Array.isArray(apis)) {
          for (var i = 0; i < apis.length; i++) {
            var entry = normalizedAPIEntry(apis[i], i);
            if (entry) out.push(entry);
          }
        }
      }
    } catch (e) {}
    var seen = {};
    return out.filter(function (api) {
      if (!api || !api.enabled) return false;
      var key = api.id || api.name;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function configuredModels() {
    var apis = configuredAPIs();
    var out = [];
    var seen = {};
    for (var i = 0; i < apis.length; i++) {
      var api = apis[i];
      var models = api.models && api.models.length ? api.models : (api.model ? [api.model] : []);
      for (var m = 0; m < models.length; m++) {
        var model = cleanTextValue(models[m]);
        if (!model || !api.apiKey) continue;
        var ref = modelRef(api.id, model);
        if (seen[ref]) continue;
        seen[ref] = true;
        out.push({
          ref: ref,
          apiId: api.id,
          apiName: api.name || api.id,
          provider: api.provider || "",
          apiStyle: api.apiStyle || "openai",
          model: model,
          label: (api.name || api.provider || api.id || "API") + " / " + model,
          baseUrl: normalizedBaseURL(Object.assign({}, api, { model: model })),
        });
      }
    }
    return out;
  }

  function resolveConfig(options) {
    options = options || {};
    if (options.config) return Object.assign({}, options.config);
    var cfg = getConfig();
    var ref = cleanTextValue(options.modelRef || "");
    var kind = usageKey(options.kind || options.usage || "default");
    if (!ref && typeof ArxivDailyConfig !== "undefined" && kind !== "default") {
      ref = cleanTextValue(ArxivDailyConfig.get("llm.usage." + kind) || "");
    }
    if (ref === "__no_llm__") return null;
    var parsed = parseModelRef(ref);
    var apis = configuredAPIs();
    var chosen = null;
    if (!ref && (!cfg || !cfg.apiKey || !cfg.model)) {
      for (var a = 0; a < apis.length; a++) {
        var firstModels = apis[a].models && apis[a].models.length ? apis[a].models : (apis[a].model ? [apis[a].model] : []);
        if (!apis[a].apiKey || !firstModels.length) continue;
        chosen = apis[a];
        parsed = { apiId: chosen.id, model: firstModels[0] };
        break;
      }
    }
    if (parsed.apiId) {
      for (var i = 0; i < apis.length; i++) {
        if (apis[i].id === parsed.apiId) {
          chosen = apis[i];
          break;
        }
      }
    }
    if (!chosen && ref) {
      for (var m = 0; m < apis.length; m++) {
        var models = apis[m].models && apis[m].models.length ? apis[m].models : [apis[m].model];
        if (models.indexOf(parsed.model || ref) >= 0) {
          chosen = apis[m];
          break;
        }
      }
    }
    if (chosen) {
      cfg = Object.assign({}, cfg || {}, chosen);
      cfg.model = parsed.model || chosen.model || cfg.model || "";
      return cfg;
    }
    if (parsed.model && cfg) cfg = Object.assign({}, cfg, { model: parsed.model });
    return cfg;
  }

  function requestOptions(method, headers, body, timeoutSeconds) {
    var opts = {
      method: method,
      headers: headers,
      body: body,
    };
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      opts.signal = AbortSignal.timeout((timeoutSeconds || 120) * 1000);
    }
    return opts;
  }

  function uniqueURLs(urls) {
    var seen = {};
    return urls.filter(function (url) {
      if (!url || seen[url]) return false;
      seen[url] = true;
      return true;
    });
  }

  function lower(value) {
    return String(value || "").toLowerCase();
  }

  function isAnthropicStyle(cfg) {
    var style = lower(cfg && cfg.apiStyle);
    var provider = lower(cfg && cfg.provider);
    var base = lower(cfg && cfg.baseUrl);
    if (style === "anthropic") return true;
    if (style !== "auto") return false;
    return provider === "anthropic" ||
      /api\.anthropic\.com/i.test(base) ||
      /\/anthropic(?:\/|$)/i.test(base);
  }

  function normalizedBaseURL(cfg) {
    var provider = lower(cfg && cfg.provider);
    var base = cleanURLValue((cfg && cfg.baseUrl) || "");
    var anthropic = isAnthropicStyle(cfg);

    if (!base) {
      if (provider === "deepseek") {
        return anthropic ? "https://api.deepseek.com/anthropic" : "https://api.deepseek.com";
      }
      if (provider === "anthropic" || anthropic) return "https://api.anthropic.com";
      return "https://api.openai.com/v1";
    }

    base = base.replace(/\/+$/, "");
    if (/^https:\/\/api\.openai\.com\/v1$/i.test(base)) {
      if (provider === "deepseek") {
        return anthropic ? "https://api.deepseek.com/anthropic" : "https://api.deepseek.com";
      }
      if (provider === "anthropic" || anthropic) return "https://api.anthropic.com";
    }
    return base;
  }

  function stripAnthropicPath(base) {
    base = cleanURLValue(base || "").replace(/\/+$/, "");
    base = base.replace(/\/v1\/messages$/i, "");
    base = base.replace(/\/messages$/i, "");
    base = base.replace(/\/anthropic\/v1$/i, "");
    base = base.replace(/\/anthropic$/i, "");
    return base;
  }

  function openAIEndpointURLs(cfg) {
    var base = normalizedBaseURL(cfg);
    if (/\/chat\/completions$/i.test(base)) return [base];
    if (/\/v1$/i.test(base)) return [base + "/chat/completions"];
    return uniqueURLs([
      base + "/chat/completions",
      base + "/v1/chat/completions",
    ]);
  }

  function deepSeekAnthropicFallback(base) {
    var match = String(base || "").match(/^(https?:\/\/api\.deepseek\.com)(?:\/.*)?$/i);
    return match ? match[1] + "/anthropic/v1/messages" : "";
  }

  function anthropicEndpointURLs(cfg) {
    var base = normalizedBaseURL(cfg);
    var urls = [];

    if (/\/v1\/messages$/i.test(base)) {
      urls.push(base);
    } else if (/\/messages$/i.test(base)) {
      urls.push(base);
    } else if (/\/v1$/i.test(base)) {
      urls.push(base + "/messages");
    } else {
      urls.push(base + "/v1/messages");
      urls.push(base + "/messages");
    }

    if (/api\.deepseek\.com/i.test(base) && !/\/anthropic(?:\/|$)/i.test(base)) {
      urls.push(deepSeekAnthropicFallback(base));
    }

    return uniqueURLs(urls);
  }

  function endpointURLs(cfg) {
    return isAnthropicStyle(cfg) ? anthropicEndpointURLs(cfg) : openAIEndpointURLs(cfg);
  }

  function headersFor(cfg) {
    var apiKey = cleanHeaderValue(cfg && cfg.apiKey);
    if (!apiKey) {
      throw new Error("LLM API Key 为空。请检查设置中是否只填入了空格或换行。");
    }
    if (isAnthropicStyle(cfg)) {
      return {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      };
    }
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey,
    };
  }

  function validateEndpointURL(url) {
    var cleaned = cleanURLValue(url);
    try {
      new URL(cleaned);
    } catch (e) {
      throw new Error("LLM endpoint URL 非法: " + cleaned + "。请检查 Base URL，不能包含空格、换行或非 URL 字符。");
    }
    return cleaned;
  }

  function requestSendError(err, url, urls, cfg, elapsedMs) {
    var message = err && err.message ? err.message : String(err);
    var tried = urls && urls.length ? "\nTried: " + urls.join(" ; ") : "";
    var hint = "LLM 请求未能发出。请检查 API Key 是否含有换行/不可见字符，Base URL 是否为服务根地址或完整 endpoint，API style 是否与服务匹配。";
    var out = new Error(hint + "\nEndpoint: " + url +
      "\nStyle: " + ((cfg && cfg.apiStyle) || "openai") +
      "\nModel: " + ((cfg && cfg.model) || "") +
      "\nElapsed: " + Math.round(elapsedMs || 0) + " ms" +
      tried +
      "\n原始信息: " + message);
    out.sendError = true;
    out.elapsedMs = elapsedMs || 0;
    out.endpoint = url;
    if (/invalid or illegal string|invalid header|header/i.test(message)) out.nonRetryable = true;
    return out;
  }

  function retryAfterMs(value) {
    if (!value) return 0;
    var seconds = parseInt(value, 10);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    var dateMs = Date.parse(value);
    return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
  }

  function httpError(status, text, url, urls, cfg, elapsedMs, headers) {
    var detail = String(text || "").slice(0, 500);
    var anthropic = isAnthropicStyle(cfg);
    var hint;
    if (status === 404 && anthropic) {
      hint = "apiStyle=anthropic uses the Anthropic Messages API endpoint /v1/messages. " +
        "For DeepSeek Anthropic-compatible mode, use base URL https://api.deepseek.com/anthropic. " +
        "For Anthropic, use https://api.anthropic.com.";
    } else if (status === 404) {
      hint = "OpenAI-compatible mode uses /chat/completions. " +
        "For DeepSeek OpenAI-compatible mode, use base URL https://api.deepseek.com or https://api.deepseek.com/v1.";
    } else {
      hint = "LLM request failed.";
    }
    var tried = urls && urls.length ? "\nTried: " + urls.join(" ; ") : "";
    var retryAfter = headers && headers.get ? headers.get("Retry-After") : "";
    var out = new Error("HTTP " + status + " at " + url + ". " + hint +
      "\nStyle: " + ((cfg && cfg.apiStyle) || "openai") +
      "\nModel: " + ((cfg && cfg.model) || "") +
      "\nElapsed: " + Math.round(elapsedMs || 0) + " ms" +
      (retryAfter ? "\nRetry-After: " + retryAfter : "") +
      tried + (detail ? "\nResponse: " + detail : ""));
    out.status = status;
    out.responseText = detail;
    out.retryAfterMs = retryAfterMs(retryAfter);
    out.elapsedMs = elapsedMs || 0;
    out.endpoint = url;
    return out;
  }

  function contentToText(content) {
    if (content === undefined || content === null) return "";
    if (typeof content === "string") return cleanMessageText(content);
    if (Array.isArray(content)) {
      return content.map(function (part) {
        if (typeof part === "string") return cleanMessageText(part);
        if (part && typeof part.text === "string") return cleanMessageText(part.text);
        if (part && typeof part.content === "string") return cleanMessageText(part.content);
        return "";
      }).filter(function (part) {
        return part;
      }).join("\n");
    }
    return cleanMessageText(content);
  }

  function normalizeInputMessages(systemPrompt, userMessages, anthropic) {
    var systemParts = [];
    var messages = [];

    if (systemPrompt) systemParts.push(cleanMessageText(systemPrompt));

    function addMessage(message) {
      if (!message) return;
      var role = lower(message.role || "user");
      var content = contentToText(message.content);
      if (!content) return;

      if (role === "system") {
        systemParts.push(content);
        return;
      }

      if (role !== "assistant") role = "user";
      messages.push({ role: role, content: content });
    }

    if (typeof userMessages === "string") {
      messages.push({ role: "user", content: cleanMessageText(userMessages) });
    } else if (Array.isArray(userMessages)) {
      for (var i = 0; i < userMessages.length; i++) addMessage(userMessages[i]);
    } else if (userMessages) {
      addMessage(userMessages);
    }

    if (!messages.length) messages.push({ role: "user", content: "" });

    if (!anthropic && systemParts.length) {
      messages.unshift({ role: "system", content: cleanMessageText(systemParts.join("\n\n")) });
    }

    return {
      system: cleanMessageText(systemParts.join("\n\n")),
      messages: messages,
    };
  }

  function buildBody(cfg, systemPrompt, userMessages, stream) {
    var anthropic = isAnthropicStyle(cfg);
    var normalized = normalizeInputMessages(systemPrompt, userMessages, anthropic);
    var body = {
      model: cfg.model,
      messages: normalized.messages,
      max_tokens: Math.round(numericValue(cfg.maxTokens, 32768, 1, 1000000)),
    };
    if (stream) body.stream = true;

    if (typeof cfg.temperature === "number" || cfg.temperature) {
      body.temperature = numericValue(cfg.temperature, 0.3, 0, 2);
    }
    if (anthropic && normalized.system) {
      body.system = normalized.system;
    }

    return JSON.stringify(body);
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function isTransientStatus(status) {
    return status === 408 || status === 409 || status === 425 || status === 429 ||
      status === 500 || status === 502 || status === 503 || status === 504;
  }

  function isTransientError(err) {
    if (!err) return false;
    if (err.nonRetryable) return false;
    if (err.status !== undefined) return isTransientStatus(Number(err.status));
    var msg = String(err.message || err);
    if (/HTTP\s+(400|401|403|404)/.test(msg)) return false;
    if (/invalid or illegal string|LLM API Key|endpoint URL 非法|not configured/i.test(msg)) return false;
    return !!(err.sendError || /timeout|timed out|network|temporar|rate|fetch|connection|refused|reset|aborted/i.test(msg));
  }

  async function postOnceWithFallback(cfg, body) {
    var urls = endpointURLs(cfg);
    var resp = null;
    var url = "";
    var errText = "";

    for (var i = 0; i < urls.length; i++) {
      url = validateEndpointURL(urls[i]);
      var started = Date.now();
      try {
        resp = await fetch(url, requestOptions("POST", headersFor(cfg), body, cfg.timeoutSeconds));
      } catch (e) {
        throw requestSendError(e, url, urls, cfg, Date.now() - started);
      }
      if (resp.ok) return resp;
      errText = await resp.text().catch(function () { return ""; });
      if (resp.status !== 404 || i === urls.length - 1) {
        throw httpError(resp.status, errText, url, urls, cfg, Date.now() - started, resp.headers);
      }
    }

    throw httpError(0, errText, url, urls, cfg, 0, null);
  }

  async function postWithFallback(cfg, body) {
    var attempts = Number(cfg && cfg.retryAttempts) || 3;
    attempts = Math.max(1, Math.min(5, attempts));
    var lastErr = null;
    for (var attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await postOnceWithFallback(cfg, body);
      } catch (err) {
        lastErr = err;
        if (attempt >= attempts || !isTransientError(err)) throw err;
        var retryAfter = Number(err.retryAfterMs || 0);
        var baseDelay = Math.min(30000, 1500 * Math.pow(2, attempt - 1));
        var jitter = Math.floor(Math.random() * Math.max(1200, baseDelay * 0.35));
        var delay = Math.max(retryAfter, baseDelay + jitter);
        log("LLM transient request failure; retrying attempt " + (attempt + 1) + "/" + attempts + " after " + delay + " ms: " + (err.message || err));
        await sleep(delay);
      }
    }
    throw lastErr || new Error("LLM request failed");
  }

  function shouldTryOpenAIStyleFallback(cfg, err) {
    if (!cfg || !isAnthropicStyle(cfg) || !err || err.status !== 404) return false;
    if (lower(cfg.apiStyle) !== "auto") return false;
    var provider = lower(cfg.provider);
    var base = lower(normalizedBaseURL(cfg));
    return provider !== "anthropic" && !/api\.anthropic\.com/i.test(base);
  }

  function shouldRetryWithoutTemperature(err) {
    var msg = String((err && (err.responseText || err.message)) || "");
    return err && (err.status === 400 || err.status === 422) &&
      /temperature|unsupported|extra_forbidden|unknown field|invalid parameter/i.test(msg);
  }

  function shouldRetryWithoutStreaming(err) {
    var msg = String((err && (err.responseText || err.message)) || "");
    return err && (err.status === 400 || err.status === 404 || err.status === 415 ||
      err.status === 422 || err.status === 501) &&
      /stream|streaming|event-stream|unsupported|unknown field|invalid parameter/i.test(msg);
  }

  async function postCompletionJSON(cfg, systemPrompt, userMessages, stream) {
    var body = buildBody(cfg, systemPrompt, userMessages, stream);
    var resp = await postWithFallback(cfg, body);
    return await resp.json();
  }

  async function completeJSONWithAdaptation(cfg, systemPrompt, userMessages, stream) {
    try {
      return await postCompletionJSON(cfg, systemPrompt, userMessages, stream);
    } catch (err) {
      if (shouldTryOpenAIStyleFallback(cfg, err)) {
        var openAICfg = Object.assign({}, cfg, {
          apiStyle: "openai",
          baseUrl: stripAnthropicPath(normalizedBaseURL(cfg)),
        });
        try {
          log("Anthropic-style endpoint returned 404; retrying once as OpenAI-compatible endpoint for non-Anthropic provider");
          return await postCompletionJSON(openAICfg, systemPrompt, userMessages, stream);
        } catch (fallbackErr) {
          fallbackErr.message = fallbackErr.message + "\nOpenAI-compatible fallback after Anthropic 404 also failed. Original error: " + (err.message || err);
          throw fallbackErr;
        }
      }
      if (shouldRetryWithoutTemperature(err)) {
        var noTempCfg = Object.assign({}, cfg);
        delete noTempCfg.temperature;
        try {
          log("LLM endpoint rejected an optional parameter; retrying once without temperature");
          return await postCompletionJSON(noTempCfg, systemPrompt, userMessages, stream);
        } catch (paramErr) {
          paramErr.message = paramErr.message + "\nRetry without temperature also failed. Original error: " + (err.message || err);
          throw paramErr;
        }
      }
      throw err;
    }
  }

  function parseOpenAIResponse(json) {
    return json && json.choices && json.choices[0] && json.choices[0].message
      ? contentToText(json.choices[0].message.content)
      : "";
  }

  function parseAnthropicResponse(json) {
    if (!json) return "";
    if (typeof json.content === "string") return cleanMessageText(json.content);
    if (Array.isArray(json.content)) {
      return json.content.map(function (block) {
        if (!block) return "";
        if (block.type === "text" && typeof block.text === "string") return cleanMessageText(block.text);
        if (typeof block.text === "string") return cleanMessageText(block.text);
        return "";
      }).filter(function (text) {
        return text;
      }).join("");
    }
    return parseOpenAIResponse(json);
  }

  function parseResponseText(json, cfg) {
    return isAnthropicStyle(cfg) ? parseAnthropicResponse(json) : parseOpenAIResponse(json);
  }

  function parseThinkingFromResponse(json, cfg) {
    if (!json) return null;
    try {
      if (isAnthropicStyle(cfg)) {
        var content = json.content || [];
        var parts = [];
        for (var i = 0; i < content.length; i++) {
          if (content[i].type === "thinking") parts.push(cleanMessageText(content[i].thinking || ""));
          if (content[i].type === "redacted_thinking") parts.push("[redacted_thinking]");
        }
        return parts.length > 0 ? parts.join("\n") : null;
      }
      var choice = json.choices && json.choices[0];
      if (choice && choice.message && choice.message.reasoning_content) {
        return cleanMessageText(choice.message.reasoning_content);
      }
    } catch (e) {}
    return null;
  }

  function processOpenAIStreamLine(line, onChunk) {
    line = String(line || "").trim();
    if (!line || !line.startsWith("data: ")) return false;
    var data = line.slice(6);
    if (data === "[DONE]") {
      onChunk("", true);
      return true;
    }
    try {
      var parsed = JSON.parse(data);
      if (parsed.error) {
        var err = new Error(parsed.error.message || "OpenAI stream error");
        err.isOpenAIStreamError = true;
        throw err;
      }
      var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
      var content = delta && delta.content ? delta.content : "";
      if (content) onChunk(content, false);
    } catch (e) {
      if (e && e.isOpenAIStreamError) throw e;
    }
    return false;
  }

  function processAnthropicStreamLine(line, onChunk) {
    line = String(line || "").trim();
    if (!line || !line.startsWith("data: ")) return false;
    try {
      var parsed = JSON.parse(line.slice(6));
      if (parsed.type === "content_block_delta" && parsed.delta && parsed.delta.text) {
        onChunk(parsed.delta.text, false);
      } else if (parsed.type === "content_block_start" &&
          parsed.content_block &&
          parsed.content_block.type === "text" &&
          parsed.content_block.text) {
        onChunk(parsed.content_block.text, false);
      } else if (parsed.type === "message_stop") {
        onChunk("", true);
        return true;
      } else if (parsed.type === "error" || parsed.error) {
        var streamError = new Error((parsed.error && parsed.error.message) || "Anthropic stream error");
        streamError.isAnthropicStreamError = true;
        throw streamError;
      }
    } catch (e) {
      if (e && e.isAnthropicStreamError) throw e;
    }
    return false;
  }

  async function readOpenAIStream(resp, onChunk, cancelToken) {
    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";

    while (true) {
      if (cancelToken && cancelToken.cancelled) {
        reader.cancel();
        throw new Error("cancelled");
      }

      var result = await reader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      var lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (var i = 0; i < lines.length; i++) {
        if (processOpenAIStreamLine(lines[i], onChunk)) return;
      }
    }

    buffer += decoder.decode();
    var tailLines = buffer.split("\n");
    for (var tail = 0; tail < tailLines.length; tail++) {
      if (processOpenAIStreamLine(tailLines[tail], onChunk)) return;
    }
    onChunk("", true);
  }

  async function readAnthropicStream(resp, onChunk, cancelToken) {
    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";

    while (true) {
      if (cancelToken && cancelToken.cancelled) {
        reader.cancel();
        throw new Error("cancelled");
      }

      var result = await reader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      var lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (var i = 0; i < lines.length; i++) {
        if (processAnthropicStreamLine(lines[i], onChunk)) return;
      }
    }

    buffer += decoder.decode();
    var tailLines = buffer.split("\n");
    for (var tail = 0; tail < tailLines.length; tail++) {
      if (processAnthropicStreamLine(tailLines[tail], onChunk)) return;
    }
    onChunk("", true);
  }

  // Module
  globalThis.ArxivDailyLLM = {
    getConfigSummary: function () {
      var cfg = resolveConfig({ kind: "default" }) || {};
      return {
        provider: cfg.provider || "",
        apiStyle: cfg.apiStyle || "openai",
        model: cfg.model || "",
        baseUrl: normalizedBaseURL(cfg),
        maxTokens: cfg.maxTokens || 32768,
        timeoutSeconds: cfg.timeoutSeconds || 120,
        retryAttempts: cfg.retryAttempts || 3,
      };
    },

    getConfiguredAPIs: function () {
      return configuredAPIs();
    },

    getAvailableModels: function () {
      return configuredModels();
    },

    getUsageModelRef: function (kind) {
      try {
        if (typeof ArxivDailyConfig === "undefined") return "";
        return cleanTextValue(ArxivDailyConfig.get("llm.usage." + usageKey(kind)) || "");
      } catch (e) {
        return "";
      }
    },

    setUsageModelRef: function (kind, ref) {
      try {
        if (typeof ArxivDailyConfig === "undefined") return;
        ArxivDailyConfig.set("llm.usage." + usageKey(kind), cleanTextValue(ref || ""));
      } catch (e) {}
    },

    resolveModelLabel: function (ref) {
      var models = configuredModels();
      for (var i = 0; i < models.length; i++) {
        if (models[i].ref === ref) return models[i].label;
      }
      return ref || "";
    },

    // Check if LLM is configured.
    isConfigured: function (options) {
      var cfg = resolveConfig(options || {});
      return !!(cfg && cfg.apiKey && cfg.model);
    },

    // Non-streaming completion.
    complete: async function (systemPrompt, userMessages, cancelToken, options) {
      var cfg = resolveConfig(options || {});
      if (!cfg || !cfg.apiKey) throw new Error("LLM not configured");

      try {
        var json = await completeJSONWithAdaptation(cfg, systemPrompt, userMessages, false);
        return parseResponseText(json, cfg);
      } catch (e) {
        if (cancelToken && cancelToken.cancelled) throw new Error("cancelled");
        throw e;
      }
    },

    // Streaming completion - calls onChunk(content, done) for each token.
    completeStream: async function (systemPrompt, userMessages, onChunk, cancelToken, options) {
      var cfg = resolveConfig(options || {});
      if (!cfg || !cfg.apiKey) throw new Error("LLM not configured");

      try {
        var body = buildBody(cfg, systemPrompt, userMessages, true);
        var resp = await postWithFallback(cfg, body);
        var contentType = resp.headers && resp.headers.get ? String(resp.headers.get("Content-Type") || "") : "";
        if (/json/i.test(contentType) || !resp.body || !resp.body.getReader) {
          var json = await resp.json();
          var text = parseResponseText(json, cfg);
          if (text) onChunk(text, false);
          onChunk("", true);
          return;
        }
        if (isAnthropicStyle(cfg)) {
          await readAnthropicStream(resp, onChunk, cancelToken);
        } else {
          await readOpenAIStream(resp, onChunk, cancelToken);
        }
      } catch (e) {
        if (cancelToken && cancelToken.cancelled) {
          onChunk("", true);
          return;
        }
        if (shouldRetryWithoutStreaming(e)) {
          var fallbackJSON = await completeJSONWithAdaptation(cfg, systemPrompt, userMessages, false);
          var fallbackText = parseResponseText(fallbackJSON, cfg);
          if (fallbackText) onChunk(fallbackText, false);
          onChunk("", true);
          return;
        }
        throw e;
      }
    },

    // Batch process multiple papers with LLM, one prompt per batch.
    batchScreen: async function (papers, systemPrompt, batchSize, cancelToken, options) {
      options = options || {};
      var passes = Math.max(1, Math.min(5, parseInt(options.passes || 1, 10) || 1));
      var parallelPasses = options.parallelPasses !== false && passes > 1;
      var taskLabel = options.taskLabel || "screening";
      var results = [];
      for (var start = 0; start < papers.length; start += batchSize) {
        var successForBatch = 0;
        var lastBatchErr = null;
        var batch = papers.slice(start, start + batchSize);
        var runPass = async (pass) => {
          if (cancelToken && cancelToken.cancelled) throw new Error("cancelled");
          var paperList = batch.map(function (p, idx) {
            return "Paper " + (idx + 1) + ":" +
              "\n   arXiv ID: " + p.arxivId +
              "\n   Title: " + p.title +
              "\n   Authors: " + (p.authors || "") +
              "\n   Categories: " + (p.categories || p.primaryCategory || "") +
              "\n   Keyword score: " + (p.keywordScore || 0) +
              "\n   Abstract: " + (p.abstract || "").slice(0, 500);
          }).join("\n\n");

          var action = taskLabel === "prefilter" ? "Broad prefiltering" : "Screening";
          var userMsg = action + " pass " + pass + "/" + passes + ". Please judge the following papers independently. Use the exact arXiv ID in each returned arxiv_id field.\n\n" + paperList;
          var responseText = await this.complete(systemPrompt, userMsg, cancelToken, options);
          return {
            startIdx: start,
            batchSize: batch.length,
            pass: pass,
            passes: passes,
            response: responseText,
          };
        };

        if (parallelPasses) {
          var passPromises = [];
          for (var passNo = 1; passNo <= passes; passNo++) {
            passPromises.push(runPass(passNo).then(function (value) {
              return { value: value };
            }, function (err) {
              return { error: err };
            }));
          }
          var settled = await Promise.all(passPromises);
          for (var s = 0; s < settled.length; s++) {
            if (settled[s].value) {
              successForBatch++;
              results.push(settled[s].value);
            } else if (settled[s].error) {
              lastBatchErr = settled[s].error;
              if (cancelToken && cancelToken.cancelled) throw lastBatchErr;
              log("LLM " + taskLabel + " pass " + (s + 1) + "/" + passes + " failed for batch starting " + start + "; continuing with other passes: " + (lastBatchErr.message || lastBatchErr));
            }
          }
        } else {
          for (var pass = 1; pass <= passes; pass++) {
            if (cancelToken && cancelToken.cancelled) break;
            try {
              var result = await runPass(pass);
              successForBatch++;
              results.push(result);
            } catch (err) {
              lastBatchErr = err;
              if (cancelToken && cancelToken.cancelled) throw err;
              if (passes <= 1) throw err;
              log("LLM " + taskLabel + " pass " + pass + "/" + passes + " failed for batch starting " + start + "; continuing with other passes: " + (err.message || err));
            }
          }
        }

        if (!successForBatch && lastBatchErr) {
          throw lastBatchErr;
        }
      }
      return results;
    },

    // QA completion with config overrides (model, temperature, maxTokens)
    completeQA: async function (systemPrompt, userMessages, overrides, cancelToken) {
      var cfg = resolveConfig(overrides || {});
      if (!cfg || !cfg.apiKey) throw new Error("LLM not configured");
      if (overrides) {
        if (overrides.model) cfg.model = overrides.model;
        if (overrides.temperature !== undefined) cfg.temperature = overrides.temperature;
        if (overrides.maxTokens) cfg.maxTokens = overrides.maxTokens;
      }
      try {
        var json = await completeJSONWithAdaptation(cfg, systemPrompt, userMessages, false);
        return {
          content: parseResponseText(json, cfg),
          thinking: parseThinkingFromResponse(json, cfg),
        };
      } catch (e) {
        if (cancelToken && cancelToken.cancelled) throw new Error("cancelled");
        throw e;
      }
    },

    // QA streaming with thinking extraction
    // onChunk(content, done, thinkingDelta)
    completeQAStream: async function (systemPrompt, userMessages, overrides, onChunk, cancelToken) {
      var cfg = resolveConfig(overrides || {});
      if (!cfg || !cfg.apiKey) throw new Error("LLM not configured");
      var safeOnChunk = function (chunk, done, thinkingDelta) {
        if (typeof onChunk === "function") {
          onChunk(cleanMessageText(chunk || ""), !!done, cleanMessageText(thinkingDelta || ""));
        }
      };
      if (overrides) {
        if (overrides.model) cfg.model = overrides.model;
        if (overrides.temperature !== undefined) cfg.temperature = overrides.temperature;
        if (overrides.maxTokens) cfg.maxTokens = overrides.maxTokens;
      }
      try {
        var body = buildBody(cfg, systemPrompt, userMessages, true);
        var resp = await postWithFallback(cfg, body);
        var contentType = resp.headers && resp.headers.get ? String(resp.headers.get("Content-Type") || "") : "";
        if (/json/i.test(contentType) || !resp.body || !resp.body.getReader) {
          var json = await resp.json();
          var text = parseResponseText(json, cfg);
          var thinking = parseThinkingFromResponse(json, cfg);
          if (thinking) safeOnChunk("", false, thinking);
          if (text) safeOnChunk(text, false, null);
          safeOnChunk("", true, null);
          return;
        }
        if (isAnthropicStyle(cfg)) {
          await readAnthropicStreamQA(resp, safeOnChunk, cancelToken);
        } else {
          await readOpenAIStreamQA(resp, safeOnChunk, cancelToken);
        }
      } catch (e) {
        if (cancelToken && cancelToken.cancelled) { safeOnChunk("", true, null); return; }
        if (shouldRetryWithoutStreaming(e)) {
          var fallbackJSON = await completeJSONWithAdaptation(cfg, systemPrompt, userMessages, false);
          var fallbackText = parseResponseText(fallbackJSON, cfg);
          var fallbackThinking = parseThinkingFromResponse(fallbackJSON, cfg);
          if (fallbackThinking) safeOnChunk("", false, fallbackThinking);
          if (fallbackText) safeOnChunk(fallbackText, false, null);
          safeOnChunk("", true, null);
          return;
        }
        throw e;
      }
    },

    testConnection: async function (cancelToken, options) {
      var cfg = resolveConfig(options || {});
      if (!cfg || !cfg.apiKey || !cfg.model) {
        throw new Error("LLM not configured");
      }
      var testCfg = Object.assign({}, cfg, {
        maxTokens: Math.min(64, cfg.maxTokens || 64),
        timeoutSeconds: Math.min(60, cfg.timeoutSeconds || 60),
      });
      var started = Date.now();
      var json = await completeJSONWithAdaptation(
        testCfg,
        "You are a connection test. Reply with OK.",
        "Reply with exactly: OK",
        false
      );
      if (cancelToken && cancelToken.cancelled) throw new Error("cancelled");
      var text = parseResponseText(json, testCfg).trim();
      return {
        ok: !!text,
        text: text,
        elapsedMs: Date.now() - started,
        provider: testCfg.provider,
        apiStyle: testCfg.apiStyle,
        model: testCfg.model,
        baseUrl: normalizedBaseURL(testCfg),
      };
    },
  };
})();

// ── QA streaming helpers ──────────────────────────────────────────────────

function processOpenAIQAStreamLine(line, onChunk) {
  line = String(line || "").trim();
  if (!line || !line.startsWith("data: ")) return false;
  var data = line.slice(6);
  if (data === "[DONE]") { onChunk("", true, null); return true; }
  try {
    var parsed = JSON.parse(data);
    if (parsed.error) {
      var err = new Error(parsed.error.message || "OpenAI stream error");
      err.isOpenAIStreamError = true;
      throw err;
    }
    var choice = parsed.choices && parsed.choices[0];
    if (!choice) return false;
    if (choice.delta && choice.delta.reasoning_content) {
      onChunk("", false, choice.delta.reasoning_content);
    }
    if (choice.delta && choice.delta.content) {
      onChunk(choice.delta.content, false, null);
    }
  } catch (e) {
    if (e && e.isOpenAIStreamError) throw e;
  }
  return false;
}

function processAnthropicQAStreamLine(line, onChunk) {
  line = String(line || "").trim();
  if (!line || !line.startsWith("data: ")) return false;
  var data = line.slice(6);
  try {
    var parsed = JSON.parse(data);
    if (parsed.type === "content_block_delta" && parsed.delta) {
      if (parsed.delta.type === "thinking_delta" && parsed.delta.thinking) {
        onChunk("", false, parsed.delta.thinking);
      }
      if (parsed.delta.type === "text_delta" && parsed.delta.text) {
        onChunk(parsed.delta.text, false, null);
      }
    }
    if (parsed.type === "message_stop") { onChunk("", true, null); return true; }
    if (parsed.type === "error" || parsed.error) {
      var err = new Error((parsed.error && parsed.error.message) || "Anthropic stream error");
      err.isAnthropicStreamError = true;
      throw err;
    }
  } catch (e) {
    if (e && e.isAnthropicStreamError) throw e;
  }
  return false;
}

async function readOpenAIStreamQA(resp, onChunk, cancelToken) {
  var reader = resp.body.getReader();
  var decoder = new TextDecoder();
  var buffer = "";
  while (true) {
    if (cancelToken && cancelToken.cancelled) { reader.cancel(); throw new Error("cancelled"); }
    var result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    var lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (var i = 0; i < lines.length; i++) {
      if (processOpenAIQAStreamLine(lines[i], onChunk)) return;
    }
  }
  buffer += decoder.decode();
  var tailLines = buffer.split("\n");
  for (var tail = 0; tail < tailLines.length; tail++) {
    if (processOpenAIQAStreamLine(tailLines[tail], onChunk)) return;
  }
  onChunk("", true, null);
}

async function readAnthropicStreamQA(resp, onChunk, cancelToken) {
  var reader = resp.body.getReader();
  var decoder = new TextDecoder();
  var buffer = "";
  while (true) {
    if (cancelToken && cancelToken.cancelled) { reader.cancel(); throw new Error("cancelled"); }
    var result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    var lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (var i = 0; i < lines.length; i++) {
      if (processAnthropicQAStreamLine(lines[i], onChunk)) return;
    }
  }
  buffer += decoder.decode();
  var tailLines = buffer.split("\n");
  for (var tail = 0; tail < tailLines.length; tail++) {
    if (processAnthropicQAStreamLine(tailLines[tail], onChunk)) return;
  }
  onChunk("", true, null);
}
