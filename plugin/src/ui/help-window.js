/* ==========================================================================
 * ui/help-window.js - User guide dialog
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";
  const WINDOW_NAME = "arxiv-daily-user-guide";
  const WINDOW_FEATURES = "chrome,centerscreen,resizable,width=920,height=760";
  const REPO_URL = "https://github.com/zhzhu-wl/arxiv-interest-daily.git";

  var gWindow = null;

  function log(msg) {
    const text = "[" + LOG_PREFIX + "] " + msg;
    if (typeof Zotero.debug === "function") Zotero.debug(text);
    else if (typeof Zotero.log === "function") Zotero.log(text);
  }

  function logError(msg) {
    if (typeof Zotero.logError === "function") Zotero.logError(msg);
    else log("ERROR: " + msg);
  }

  function locale() {
    try {
      return typeof ArxivDailyI18n !== "undefined" && ArxivDailyI18n.getLocale() === "en-US" ? "en-US" : "zh-CN";
    } catch (e) {
      return "zh-CN";
    }
  }

  function resetDocument(dialog, title) {
    var doc = dialog.document;
    doc.open();
    doc.write("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>" + title + "</title></head><body></body></html>");
    doc.close();
    return doc;
  }

  function el(doc, tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function addList(doc, parent, items) {
    var ul = el(doc, "ul");
    for (var i = 0; i < items.length; i++) {
      var li = el(doc, "li");
      appendLinkedText(doc, li, items[i]);
      ul.appendChild(li);
    }
    parent.appendChild(ul);
  }

  function romanNumeral(num) {
    var values = [
      [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
    ];
    var n = Math.max(1, parseInt(num, 10) || 1);
    var out = "";
    for (var i = 0; i < values.length; i++) {
      while (n >= values[i][0]) {
        out += values[i][1];
        n -= values[i][0];
      }
    }
    return out;
  }

  function appendLinkedText(doc, parent, text) {
    text = String(text || "");
    var index = text.indexOf(REPO_URL);
    if (index < 0) {
      parent.textContent = text;
      return;
    }
    if (index > 0) parent.appendChild(doc.createTextNode(text.slice(0, index)));
    var link = el(doc, "a", "ari-guide-repo", REPO_URL);
    link.href = REPO_URL;
    link.addEventListener("click", function (event) {
      event.preventDefault();
      try {
        if (typeof Zotero !== "undefined" && Zotero.launchURL) Zotero.launchURL(REPO_URL);
        else if (doc.defaultView && doc.defaultView.open) doc.defaultView.open(REPO_URL);
      } catch (e) {}
    });
    parent.appendChild(link);
    if (index + REPO_URL.length < text.length) {
      parent.appendChild(doc.createTextNode(text.slice(index + REPO_URL.length)));
    }
  }

  function addSection(doc, parent, title, items, index) {
    var section = el(doc, "section", "ari-guide-section");
    section.appendChild(el(doc, "h2", null, romanNumeral(index) + ". " + title));
    addList(doc, section, items);
    parent.appendChild(section);
  }

  function addKeyTable(doc, parent, title, rows, index) {
    var section = el(doc, "section", "ari-guide-section");
    section.appendChild(el(doc, "h2", null, romanNumeral(index) + ". " + title));
    var table = el(doc, "table", "ari-guide-table");
    var tbody = el(doc, "tbody");
    for (var i = 0; i < rows.length; i++) {
      var tr = el(doc, "tr");
      tr.appendChild(el(doc, "th", null, rows[i][0]));
      tr.appendChild(el(doc, "td", null, rows[i][1]));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    section.appendChild(table);
    parent.appendChild(section);
  }

  function logo(doc) {
    if (typeof ArxivDailyLogo !== "undefined" && ArxivDailyLogo.longHtml) {
      return ArxivDailyLogo.longHtml(doc, 330, 92, "ari-guide-logo");
    }
    var fallback = el(doc, "div", "ari-guide-logo-fallback", "arXiv Interest Daily");
    return fallback;
  }

  const GUIDE = {
    "zh-CN": {
      title: "每日 arXiv 使用教程",
      close: "关闭",
      intro: "从基础配置开始，先让插件知道你的研究方向和 LLM 服务，再生成日报、管理论文、搜索历史报告并在 Zotero/PDF 中提问。",
      sections: [
        ["必要基础配置", [
          "打开顶部菜单“每日 arXiv -> 设置”，至少配置 arXiv 核心分区、可选交叉分区、LLM provider/API style/API Key/Base URL/模型。",
          "LLM 可使用 OpenAI 兼容接口，也可以配置多个 API 入口，并在报告、搜索、问答三个用途中分别指定模型。",
          "在“设置 -> 环境测试”中运行测试，确认 Zotero 版本、数据目录、文献库 API、arXiv 网络和 LLM 配置均可用。"
        ]],
        ["配置科研兴趣画像", [
          "打开“每日 arXiv -> 科研兴趣画像”，可从 Zotero 普通文献库、每日 arXiv 项目论文库、自定义项目文件夹或 Markdown 文件生成/导入画像。",
          "基础画像写入 research_interests.base.md，是日报筛选的主要依据；猜你喜欢画像来自反馈记录，融合或覆盖基础画像后才会影响主筛选。",
          "可让 LLM 根据画像建议 arXiv 分区，再选择覆盖或追加到当前设置。"
        ]],
        ["生成报告", [
          "点击左侧工具栏或菜单中的“生成今日报告”。旁边的下拉入口可选择报告生成模型，也可以使用设置中的默认模型或非 LLM 模式。",
          "生成过程会显示在“任务进度”中，可在任务运行时停止生成。完成后报告保存在插件数据目录，并自动出现在左侧报告列表和中央阅读区。",
          "报告会先抓取 arXiv 候选、补全元数据，再通过关键词/LLM 预筛、正式评分、深度阅读和 Markdown 渲染生成最终结果。"
        ]],
        ["报告内容与按钮", [
          "报告包含今日概览、今日主题、猜你喜欢、最相关论文、详细列表、其他相关文章速览、交叉方向推荐、弱相关论文速读和其他论文。",
          "每篇论文会展示评分、作者、分类、arXiv/DOI/Journal ref、关键词分数、推荐理由、标签、摘要，以及可折叠的长导读或交叉导读。",
          "报告顶部按钮可在新标签页打开报告、打开报告文件夹；论文卡片按钮可复制论文信息、反馈喜欢/一般/不喜欢、定位 Zotero 条目、跳转既往日报。"
        ]],
        ["一键添加论文", [
          "论文卡片上的“+”会把论文加入项目论文库，写入 project-papers/index.json，并创建或复用 Zotero 条目。",
          "插件会尽量补全标题、作者、URL、DOI、Extra 标识、项目标签、项目分类集合、PDF 附件和反馈笔记；左侧“项目论文”框可按日期浏览。",
          "已添加论文显示“✓”。在报告中再次点击可从插件项目论文库移除；在项目论文列表右键删除会同时移入插件创建/关联的 Zotero 条目。"
        ]],
        ["LLM 问答功能", [
          "点击“向 LLM 提问”打开右侧问答栏，可选择模型和思考深度，也可保存为默认设置。",
          "问答会读取当前日报/项目论文页、当前 Zotero PDF/条目、选中 Zotero 条目的全文缓存和元数据，作为发送问题时的上下文快照。",
          "在 Zotero PDF 或可选中文本区域选中段落后，单击“对选中部分提问”入口，选区会进入灰色提示框；发送前切换页面会自动清空未发送选区和入口。",
          "支持历史会话、新建/删除会话、重试失败问题、流式回答、思考过程展开，以及选中段落原文上下文定位。"
        ]],
        ["搜索功能", [
          "点击“在报告中搜索”，可按关键词、arXiv ID、作者等搜索历史报告，并使用开始/结束日期过滤。",
          "可勾选标题、作者、标签、摘要、推荐理由、导读、全文等字段，调整结果字号和缩放。",
          "“LLM”按钮会调用已配置模型做语义搜索，可单独选择搜索模型；结果点击后会打开对应日报并定位论文。"
        ]],
        ["升级与反馈", [
          "插件开源地址：" + REPO_URL,
          "可在仓库中获取新版本、查看源码、提交 issue 或反馈使用问题。"
        ]]
      ],
      advancedTitle: "高级配置参数",
      advanced: [
        ["llm.temperature / maxTokens / timeoutSeconds / retryAttempts", "控制 LLM 输出随机性、单次响应最大输出 token、请求超时和失败重试次数；maxTokens 不是上下文长度。"],
        ["llm.apis / llm.usage", "配置多个 API 入口，并为报告、搜索、问答分别指定使用哪个模型。"],
        ["arxiv.maxResults / daysBack / dateSource / dateFilter", "控制抓取论文数量、回看天数、日期来源和日期过滤策略。"],
        ["arxiv.pageSize / announcementPageSize / requestIntervalMs / retryMax", "控制 arXiv 请求分页、公告页规模、请求间隔与网络重试。"],
        ["screening.selectionMode / keywordPrefilter / keywordMinScore", "选择关键词、LLM 或混合筛选；设置关键词预筛阈值。"],
        ["screening.llmPrefilterMinScore / llmPrefilterPasses / maxCandidates", "控制宽松 LLM 预筛的最低分、轮数和进入正式评分的候选规模。"],
        ["screening.llmMinScore / llmBatchSize / llmPasses", "控制正式 LLM 评分最低分、批大小和多轮评分。"],
        ["deepRead.enabled / topN / crossN / maxPdfPages", "控制是否深度阅读 PDF，以及核心/交叉导读数量和最大 PDF 页数。"],
        ["deepRead.chunkSize / maxChunks / minTextChars / concurrency", "控制 PDF 文本切块、最大块数、最少文本长度和并发度。"],
        ["output.topN / guessYouLikeN / minCoreScore / minCrossScore", "控制报告各主要区块数量和核心/交叉推荐最低分。"],
        ["search.llmCandidates / llmBatchSize / llmMinScore / returnCount", "控制 LLM 搜索候选数量、批大小、最低相关分和返回结果数。"],
        ["cache.retentionDays / pdfRetentionDays / textRetentionDays", "控制缓存保留时间；cleanupEnabled 开启后会自动清理过期缓存。"],
        ["recommendation.writeTo", "控制推荐/反馈内容写入 Zotero note、attachment 或两者。"],
        ["ui.locale / reportLocale / timezone / reminderTime", "控制界面语言、报告语言、时区和每日提醒时间。"],
        ["ui.selectionAskMode / shortcuts.toggleQA", "控制全局选区问答入口模式和 LLM 问答快捷键。"]
      ]
    },
    "en-US": {
      title: "arXiv Daily User Guide",
      close: "Close",
      intro: "Start with configuration, teach the plugin your research interests and LLM service, then generate reports, manage papers, search history, and ask questions in Zotero/PDF.",
      sections: [
        ["Basic Configuration", [
          "Open arXiv Daily -> Settings and configure core arXiv categories, optional cross categories, LLM provider/API style/API key/Base URL/model.",
          "OpenAI-compatible APIs are supported. You can also configure multiple API entries and map separate models to report, search, and QA.",
          "Run Settings -> Environment Test to verify Zotero version, data directory, library APIs, arXiv network access, and LLM configuration."
        ]],
        ["Research Interest Profile", [
          "Open arXiv Daily -> Research Interest Profile to build or import a profile from Zotero items, project papers, a local project folder, or Markdown.",
          "The base profile is saved as research_interests.base.md and drives daily screening. The feedback profile affects main screening only after you merge or overwrite the base profile.",
          "You can ask the LLM to suggest arXiv categories from the profile, then overwrite or append them to settings."
        ]],
        ["Generate Reports", [
          "Click Generate Today's Report from the toolbar or menu. The adjacent dropdown can choose a report model, the default settings model, or no-LLM mode.",
          "Progress appears in Task Progress, and running tasks can be stopped. Finished reports are saved in the plugin data directory and opened in the report list and center reader.",
          "The pipeline fetches arXiv candidates, enriches metadata, prefilters with keywords/LLM, scores relevance, performs deep reading, and renders Markdown."
        ]],
        ["Report Details And Buttons", [
          "Reports include overview, themes, Guess You Like, top papers, detailed list, related preview, cross-discipline recommendations, weak-related skim, and other papers.",
          "Each paper shows score, authors, categories, arXiv/DOI/Journal ref, keyword score, recommendation reason, tags, abstract, and collapsible long/cross guide.",
          "Top buttons open the report in a new tab or folder. Paper buttons copy info, mark like/neutral/dislike, locate Zotero items, and jump to prior reports."
        ]],
        ["One-Click Add Paper", [
          "The '+' button adds a paper to the project-paper index at project-papers/index.json and creates or reuses a Zotero item.",
          "The plugin fills title, authors, URL, DOI, Extra identifiers, tags, project collection, PDF attachment, and a feedback note when possible.",
          "Added papers show a check mark. Clicking again removes the plugin project-paper record; deleting from the project-paper list also trashes linked Zotero items created or associated by the plugin."
        ]],
        ["LLM Q&A", [
          "Click Ask LLM to open the right-side QA panel. Choose model and thinking depth, or save them as defaults.",
          "QA uses a snapshot of the current report/project page, current Zotero PDF/item, selected Zotero item metadata, and full-text cache at send time.",
          "Select text in Zotero PDF or other selectable areas, then single-click Ask about selection. The passage enters the gray quote box; switching pages before sending clears the unsent quote and entry popup.",
          "Supports conversation history, new/delete threads, retry, streaming answers, expandable thinking, and original-context matching for selected passages."
        ]],
        ["Search", [
          "Open Search Reports to search by keyword, arXiv ID, author, and date range.",
          "Filter fields include title, authors, tags, abstract, recommendation reason, guide, and full text; result font size and zoom are adjustable.",
          "The LLM button runs semantic search with the configured model, and results open the matching report and paper."
        ]],
        ["Upgrade And Feedback", [
          "Open-source repository: " + REPO_URL,
          "Use the repository to get upgrades, review source code, submit issues, or report feedback."
        ]]
      ],
      advancedTitle: "Advanced Parameters",
      advanced: [
        ["llm.temperature / maxTokens / timeoutSeconds / retryAttempts", "Controls LLM randomness, maximum output tokens per response, request timeout, and retry count; maxTokens is not context length."],
        ["llm.apis / llm.usage", "Defines multiple API entries and maps models separately for report, search, and QA."],
        ["arxiv.maxResults / daysBack / dateSource / dateFilter", "Controls candidate count, lookback days, date source, and date filtering."],
        ["arxiv.pageSize / announcementPageSize / requestIntervalMs / retryMax", "Controls arXiv pagination, announcement page size, request interval, and network retries."],
        ["screening.selectionMode / keywordPrefilter / keywordMinScore", "Chooses keyword, LLM, or hybrid screening and sets keyword prefilter threshold."],
        ["screening.llmPrefilterMinScore / llmPrefilterPasses / maxCandidates", "Controls broad LLM prefilter threshold, passes, and candidates sent to formal scoring."],
        ["screening.llmMinScore / llmBatchSize / llmPasses", "Controls formal LLM scoring threshold, batch size, and scoring passes."],
        ["deepRead.enabled / topN / crossN / maxPdfPages", "Controls PDF deep reading, guide counts, and maximum PDF pages."],
        ["deepRead.chunkSize / maxChunks / minTextChars / concurrency", "Controls PDF text chunking, max chunks, minimum text length, and concurrency."],
        ["output.topN / guessYouLikeN / minCoreScore / minCrossScore", "Controls report section sizes and minimum core/cross recommendation scores."],
        ["search.llmCandidates / llmBatchSize / llmMinScore / returnCount", "Controls LLM search candidates, batch size, relevance threshold, and return count."],
        ["cache.retentionDays / pdfRetentionDays / textRetentionDays", "Controls cache retention. cleanupEnabled removes expired cache automatically."],
        ["recommendation.writeTo", "Writes recommendation/feedback content to Zotero note, attachment, or both."],
        ["ui.locale / reportLocale / timezone / reminderTime", "Controls UI language, report language, timezone, and daily reminder time."],
        ["ui.selectionAskMode / shortcuts.toggleQA", "Controls global selected-text QA entry mode and QA shortcut."]
      ]
    }
  };

  function installStyles(doc) {
    var style = el(doc, "style");
    style.textContent = [
      "html,body{width:100%;height:100%;margin:0;padding:0;}",
      "body{box-sizing:border-box;background:Canvas;color:CanvasText;font:13px message-box,system-ui,sans-serif;}",
      ".ari-guide{height:100%;display:flex;flex-direction:column;min-height:0;}",
      ".ari-guide-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid ThreeDShadow;background:Canvas;}",
      ".ari-guide-brand{flex:1;min-width:0;display:flex;align-items:center;gap:12px;}",
      ".ari-guide-logo{width:330px;height:92px;max-width:45vw;object-fit:contain;}",
      ".ari-guide-logo-fallback{font-size:26px;font-weight:700;letter-spacing:0;}",
      ".ari-guide-title{font-size:20px;font-weight:650;margin:0;}",
      ".ari-guide-close{min-width:72px;padding:6px 12px;border:1px solid ThreeDShadow;border-radius:4px;background:ButtonFace;color:ButtonText;cursor:pointer;font:13px message-box,system-ui,sans-serif;}",
      ".ari-guide-body{padding:18px 24px 28px;overflow:auto;line-height:1.55;}",
      ".ari-guide-intro{margin:0 0 16px;color:GrayText;font-size:14px;}",
      ".ari-guide-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:12px 18px;}",
      ".ari-guide-section{break-inside:avoid;margin:0 0 12px;}",
      ".ari-guide-section h2{font-size:15px;margin:0 0 6px;font-weight:650;}",
      ".ari-guide-section ul{margin:0;padding-left:18px;}",
      ".ari-guide-section li{margin:0 0 5px;}",
      ".ari-guide-table{width:100%;border-collapse:collapse;margin-top:4px;}",
      ".ari-guide-table th,.ari-guide-table td{vertical-align:top;text-align:left;border-top:1px solid rgba(0,0,0,.12);padding:7px 8px;}",
      ".ari-guide-table th{width:42%;font-family:ui-monospace,Consolas,monospace;font-size:12px;color:CanvasText;}",
      ".ari-guide-table td{color:CanvasText;}",
      ".ari-guide-repo{font-family:ui-monospace,Consolas,monospace;word-break:break-all;}",
      "@media(max-width:720px){.ari-guide-head{align-items:flex-start;flex-direction:column}.ari-guide-logo{max-width:100%;width:300px;height:84px}.ari-guide-close{align-self:flex-end}.ari-guide-body{padding:14px}.ari-guide-grid{grid-template-columns:1fr}}",
    ].join("\n");
    doc.head.appendChild(style);
  }

  function buildWindow(dialog) {
    var data = GUIDE[locale()] || GUIDE["zh-CN"];
    var doc = resetDocument(dialog, data.title);
    installStyles(doc);

    var root = el(doc, "main", "ari-guide");
    var head = el(doc, "header", "ari-guide-head");
    var brand = el(doc, "div", "ari-guide-brand");
    brand.appendChild(logo(doc));
    brand.appendChild(el(doc, "h1", "ari-guide-title", data.title));
    var close = el(doc, "button", "ari-guide-close", data.close);
    close.type = "button";
    close.addEventListener("click", function () { dialog.close(); });
    head.appendChild(brand);
    head.appendChild(close);
    root.appendChild(head);

    var body = el(doc, "div", "ari-guide-body");
    body.appendChild(el(doc, "p", "ari-guide-intro", data.intro));
    var grid = el(doc, "div", "ari-guide-grid");
    for (var i = 0; i < data.sections.length; i++) {
      addSection(doc, grid, data.sections[i][0], data.sections[i][1], i + 1);
    }
    body.appendChild(grid);
    addKeyTable(doc, body, data.advancedTitle, data.advanced, data.sections.length + 1);
    root.appendChild(body);
    doc.body.appendChild(root);
  }

  globalThis.ArxivDailyHelpWindow = {
    open: function (parentWin) {
      try {
        if (gWindow && !gWindow.closed) {
          gWindow.focus();
          return;
        }
        var win = parentWin || (typeof Zotero !== "undefined" && Zotero.getMainWindow ? Zotero.getMainWindow() : null);
        if (!win || !win.openDialog) throw new Error("Zotero main window is not available");
        var dialog = win.openDialog("about:blank", WINDOW_NAME, WINDOW_FEATURES);
        if (!dialog) throw new Error("Unable to open guide window");
        gWindow = dialog;
        var rendered = false;
        function render() {
          if (rendered || !dialog || dialog.closed) return;
          rendered = true;
          buildWindow(dialog);
          dialog.focus();
        }
        dialog.addEventListener("load", render, { once: true });
        dialog.addEventListener("unload", function () {
          if (gWindow === dialog) gWindow = null;
        }, { once: true });
        if (dialog.document && dialog.document.readyState !== "loading") {
          dialog.setTimeout(render, 0);
        }
      } catch (err) {
        logError("open user guide failed: " + (err.message || err));
        if (parentWin && parentWin.alert) {
          var message = locale() === "en-US" ? "Failed to open user guide:\n" : "打开使用教程失败:\n";
          parentWin.alert(message + (err.message || err));
        }
      }
    },
  };
})();
