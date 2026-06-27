# arXiv Interest Daily for Zotero 9

arXiv Interest Daily 是一个面向 Zotero 9 的全平台 XPI 插件，用于个性化 arXiv 论文筛选、每日兴趣报告生成、项目论文管理、历史报告搜索，以及基于 LLM 的阅读问答。

English documentation: [README.md](README.md)

## 支持平台

- Zotero 9.x
- Windows、macOS、Linux
- 可访问 arXiv 网络
- 可选：兼容 OpenAI-style、Anthropic-style 或类似 chat API 的 LLM 服务

这个目录是全平台通用 XPI 的目标目录。旧的 `zotero-arxiv-interest-daily-win-zotero9` 目录保留为 Windows 验证快照，不再作为通用发布源。

## 功能

- 根据 arXiv 分区和科研兴趣画像生成个性化日报。
- 使用本地信号和可选 LLM 筛选/评分论文。
- 将报告、缓存、项目论文元数据、聊天记录和配置保存在 Zotero profile 下。
- 一键添加论文到项目 collection，并做重复检查。
- 支持关键词和 LLM 辅助历史报告搜索。
- 支持围绕当前报告、Zotero 条目、PDF 上下文、选中文本和项目论文库向 LLM 提问。
- 在报告/PDF 中选中文本后可通过浮动入口提问，并严格绑定入口生命周期，避免残留。

## 安装

1. 从 GitHub Release 下载 `arxiv-interest-daily-v1.2.0.xpi`。
2. 打开 Zotero。
3. 进入 `工具 -> 插件`。
4. 点击齿轮按钮。
5. 选择 `从文件安装附加组件...`。
6. 选择下载好的 `.xpi` 文件。
7. 如 Zotero 提示，重启 Zotero。

## 基础配置

在 Zotero 中打开 `每日 arXiv -> 设置`，配置：

- arXiv 核心分区和交叉分区。
- LLM provider、API style、base URL、API key 和模型列表。
- 报告生成、搜索、问答各自的默认模型。
- 界面语言、报告语言、提醒时间、选中文本问答模式。

LLM 功能需要有效 API key 和模型配置。未配置 LLM 时，非 LLM 的基础流程仍可用。

## 数据位置

插件会把生成数据保存在当前 Zotero profile 下：

```text
<Zotero profile>/arxiv-interest-daily
```

插件通过 Zotero/Firefox 文件 API 和系统原生路径处理保存数据，不硬编码 `%APPDATA%`、`/Users/...`、`/home/...`，也不依赖 Windows 反斜杠路径。

## 构建

需要 Node.js 18 或更高版本，不需要安装额外 npm 依赖。

```bash
npm run check
npm run build
```

如果 Windows PowerShell 因执行策略拦截 `npm.ps1`，可以改用 `npm.cmd run check` / `npm.cmd run build`，或直接运行 Node 脚本：

```bash
node scripts/check-js.js
node scripts/build-xpi.js
```

生成的 XPI 位于：

```text
build/arxiv-interest-daily-v1.2.0.xpi
```

构建脚本会强制 XPI 内部 entry 使用 `/`，并检查 `manifest.json`、`bootstrap.js`、`src/main.js` 等必需文件存在。

## 更新

`plugin/manifest.json` 中的 Zotero 更新地址为：

```text
https://raw.githubusercontent.com/zhzhu-wl/arxiv-interest-daily/main/updates.json
```

`npm run build` 会根据当前 manifest 版本和 XPI SHA-256 重新生成 `updates.json`。发布新版本时，将生成的 XPI 上传到对应 GitHub Release，例如 tag `v1.2.0`。

## 开发注意

修改路径、打包、PDF/报告选中文本、LLM、Zotero 数据同步相关逻辑前，请先阅读 [docs/USER_REQUIREMENTS_FROM_CODEX_SESSIONS_zh.md](docs/USER_REQUIREMENTS_FROM_CODEX_SESSIONS_zh.md) 和 [docs/CROSS_PLATFORM_MIGRATION_zh.md](docs/CROSS_PLATFORM_MIGRATION_zh.md)。这些文档记录了用户需求和之前踩过的关键 bug。
