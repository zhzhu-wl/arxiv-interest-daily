/* ==========================================================================
 * i18n — Internationalization module
 *
 * Provides ArxivDailyI18n with language detection and translation lookup.
 * Languages: zh-CN (default), en-US.
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";

  function log(msg) {
    const text = "[" + LOG_PREFIX + "] " + msg;
    if (typeof Zotero.debug === "function") Zotero.debug(text);
    else if (typeof Zotero.log === "function") Zotero.log(text);
  }

  // ── Translations ──────────────────────────────────────────────────────────

  const LOCALES = {
    "zh-CN": {
      "plugin.name": "每日 arXiv",
      "menu.label": "每日 arXiv",
      "menu.settings": "设置",
      "menu.interests": "科研兴趣画像",
      "menu.generate": "生成今日报告",
      "menu.progress": "任务进度",
      "menu.stop": "停止生成",
      "menu.search": "在报告中搜索",
      "menu.profile": "科研兴趣画像",
      "menu.qa": "向 LLM 提问",
      "menu.calendar": "按日历查找",
      "menu.open_data_dir": "打开插件数据目录",
      "menu.export_diagnostics": "导出诊断日志",
      "menu.show.report": "显示每日 arXiv 报告框",
      "menu.show.project": "显示每日 arXiv 项目论文框",
      "menu.guide": "使用教程",
      "help.unavailable": "使用教程模块尚未加载。",
      "button.settings": "设置",
      "button.interests": "科研兴趣画像",
      "button.generate": "生成今日报告",
      "button.stop": "停止生成",
      "button.search": "在报告中搜索",
      "button.profile": "科研兴趣画像",
      "button.qa": "向 LLM 提问",
      "button.calendar": "按日历查找",
      "button.open_project_directory": "打开项目目录",
      "pane.reports.title": "报告",
      "pane.projects.title": "项目论文",
      "pane.reports.empty": "暂无报告",
      "pane.projects.empty": "暂无项目论文",
      "splitter.tooltip": "拖动调节高度",

      "env.zotero_version": "Zotero 版本",
      "env.data_dir": "数据目录",
      "env.collections_api": "文献库 API",
      "env.items_api": "条目 API",
      "env.arxiv_network": "arXiv 网络连接",
      "env.llm_config": "LLM 配置",
      "env.pass": "通过",
      "env.fail": "失败",
      "env.found": "找到",
      "env.collections": "个文献库",
      "env.need_zotero9": "需要 Zotero 9+",
      "env.not_initialized": "未初始化",
      "env.config_not_loaded": "配置未加载",
      "env.missing_fields": "缺少字段",
      "env.test_running": "测试中...",
      "env.run_test": "运行环境测试",
      "env.module_unavailable": "环境测试模块不可用",
      "settings.title": "每日 arXiv - 设置",
      "settings.basic": "基础配置",
      "settings.categories": "arXiv 分区",
      "settings.advanced": "高级配置",
      "settings.env_test": "环境测试",
      "settings.save": "保存",
      "settings.cancel": "取消",
      "settings.api_key_show": "显示 API Key",
      "settings.api_key_hide": "隐藏 API Key",
    },
    "en-US": {
      "plugin.name": "arXiv Daily",
      "menu.label": "arXiv Daily",
      "menu.settings": "Settings",
      "menu.interests": "Research Interest Profile",
      "menu.generate": "Generate Today's Report",
      "menu.progress": "Task Progress",
      "menu.stop": "Stop Generation",
      "menu.search": "Search Reports",
      "menu.profile": "Research Interest Profile",
      "menu.qa": "Ask LLM",
      "menu.calendar": "Calendar",
      "menu.open_data_dir": "Open Plugin Data Directory",
      "menu.export_diagnostics": "Export Diagnostics Log",
      "menu.show.report": "Show arXiv Report Panel",
      "menu.show.project": "Show arXiv Project Papers Panel",
      "menu.guide": "User Guide",
      "help.unavailable": "The user guide module is not loaded yet.",
      "button.settings": "Settings",
      "button.interests": "Research Interest Profile",
      "button.generate": "Generate Today's Report",
      "button.stop": "Stop Generation",
      "button.search": "Search Reports",
      "button.profile": "Research Interest Profile",
      "button.qa": "Ask LLM",
      "button.calendar": "Calendar",
      "button.open_project_directory": "Open Project Directory",
      "pane.reports.title": "Reports",
      "pane.projects.title": "Project Papers",
      "pane.reports.empty": "No reports yet",
      "pane.projects.empty": "No project papers yet",
      "splitter.tooltip": "Drag to resize",

      "env.zotero_version": "Zotero Version",
      "env.data_dir": "Data Directory",
      "env.collections_api": "Collections API",
      "env.items_api": "Items API",
      "env.arxiv_network": "arXiv Network",
      "env.llm_config": "LLM Configuration",
      "env.pass": "PASS",
      "env.fail": "FAIL",
      "env.found": "Found",
      "env.collections": "collections",
      "env.need_zotero9": "Need Zotero 9+",
      "env.not_initialized": "Not initialized",
      "env.config_not_loaded": "Config not loaded",
      "env.missing_fields": "Missing",
      "env.test_running": "Testing...",
      "env.run_test": "Run Environment Test",
      "env.module_unavailable": "Environment test module not available",
      "settings.title": "arXiv Daily - Settings",
      "settings.basic": "Basic Configuration",
      "settings.categories": "arXiv Categories",
      "settings.advanced": "Advanced Configuration",
      "settings.env_test": "Environment Test",
      "settings.save": "Save",
      "settings.cancel": "Cancel",
      "settings.api_key_show": "Show API Key",
      "settings.api_key_hide": "Hide API Key",
    },
  };

  // ── Module ────────────────────────────────────────────────────────────────

  globalThis.ArxivDailyI18n = {
    _locale: "zh-CN",

    _detectLocale: function () {
      try {
        if (typeof ArxivDailyConfig !== "undefined" && ArxivDailyConfig.get) {
          const configured = ArxivDailyConfig.get("ui.locale");
          if (configured && LOCALES[configured]) return configured;
        }
      } catch (e) {}
      try {
        const zoteroLocale = Zotero.locale || "zh-CN";
        return LOCALES[zoteroLocale] ? zoteroLocale : "zh-CN";
      } catch (e2) {
        return "zh-CN";
      }
    },

    init: function () {
      this._locale = this._detectLocale();
      log("i18n initialized: locale=" + this._locale);
    },

    setLocale: function (locale) {
      if (!locale) {
        this._locale = this._detectLocale();
        return true;
      }
      if (LOCALES[locale]) {
        this._locale = locale;
        return true;
      }
      return false;
    },

    getLocale: function () {
      return this._locale;
    },

    t: function (key, fallback) {
      const locale = LOCALES[this._locale];
      if (locale && locale[key] !== undefined) return locale[key];
      const fallbackLocale = LOCALES["zh-CN"];
      if (fallbackLocale && fallbackLocale[key] !== undefined) return fallbackLocale[key];
      return fallback || key;
    },

    availableLocales: function () {
      return Object.keys(LOCALES);
    },
  };
})();
