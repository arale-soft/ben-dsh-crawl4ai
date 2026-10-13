# ben-dsh-crawl4ai

基于 [Crawl4AI](https://github.com/unclecode/crawl4ai) 的 DeepSeek Harness 网页抓取提供方，
注册到 web 能力接缝 `ctx.web`。

Crawl4AI 会真正启动浏览器，所以普通 HTTP 抓取只能拿到一个空的 `<div id="app">` 的页面，
在这里会变成渲染后的 Markdown —— 包括只有 JavaScript 执行后才存在的代码块、表格和懒加载正文。

这是一个**实现型**插件：它只向 `ctx.web` 注册提供方，**不**注册面向模型的工具。`web_fetch`
由 `@deepseek-ai/dsh-tool-web` 拥有（它的 schema、提示词和结果卡片），安装本插件就是让那个
既有工具改用 Crawl4AI 抓取。

| | |
|---|---|
| 提供方 id | `ben-crawl4ai` |
| 注册 | `ctx.web.registerFetchProvider(...)` |
| 配置位置 | 插件页 → 本插件 → `ben-crawl4ai` 行 → 配置 |
| 依赖 | 一个可访问的 Crawl4AI 服务（已对 0.9.x 验证） |

[English](README.md) | 中文

## 安装

```bash
dsh plugin --profile <配置档> add github:you/ben-dsh-crawl4ai   # 或绝对路径
```

本包声明了 `dsh.bundle`，所以安装的同时就已启用：它的 bundle patch 会插入提供方行，并在
`web` 行上选中它。

### 就地开发（`link:` 安装需要额外一步）

`dsh plugin add <绝对路径>` 会把依赖记作 `link:<路径>`，于是配置档里的
`node_modules/ben-dsh-crawl4ai` 是指回你工作目录的**目录联接（junction）**。Node 解析模块的
导入标识符时使用的是模块的**真实路径**，因此向上查找 `@deepseek-ai/…` 时从你的工作目录开始，
永远到不了配置档的解析根目录 —— 而从 npm 或压缩包安装的插件由 pnpm 实体化到配置档**内部**，
不存在这个问题。

一条命令即可补齐这份可达性：

```bash
node scripts/link-harness-deps.mjs
```

它把 `peerDependencies` 里声明的每个包，从 harness 自身的安装位置联接进本目录的
`node_modules`，并优先取配置档那一层，好让本插件与 harness **共用同一个模块实例**而不是副本。
改动 `peerDependencies` 后重新执行即可。默认根目录是 `$DSH_PROFILE_DIR/../node_modules`
（harness 会为子进程设置该变量），否则用 `--root <node_modules>` 指定。

## 配置

全部在**插件页 → 本插件 → `ben-crawl4ai` 行 → 配置**里完成。页面先把输入暂存，点**保存**
才落盘，并且走 shell 自带的设置通道（`ctx.configForms`），所以一次修改对下一次 `web_fetch`
立即生效，无需重启。

| 字段 | 含义 |
|---|---|
| **Crawl4AI 地址** | 服务根地址，例如 `http://crawl4ai.internal:11235`。为空或不是 `http(s)` 时提供方报告为不可用，`web_fetch` 会直接说明，而不是每次调用都失败。 |
| **验证 Header 名称** | 例如 `Authorization` 或 `X-API-Key`。留空则不带验证请求头。 |
| **验证 Header 值** | 作为该请求头的值发送。界面以掩码显示；**留空则不带验证请求头** —— 名称与值必须成对生效。 |

两个请求头字段彼此独立，因此任何请求头名称、或者完全不带验证，都能工作。

这些值存放在当前配置档的补丁文件
（`$DSH_HOME/profiles/<配置档>/cordis.patch.yml`）里，是**明文**。它是抓取后端读取自己的令牌，
不是某个用户的凭据；掩码控件只是不让它出现在屏幕上，而不是不让它出现在文件里。另有两个字段
不出现在页面上，因为那是部署层面的取舍，需要时在 YAML 里改：

| 键 | 默认 | 含义 |
|---|---|---|
| `timeoutMs` | `60000` | 单次抓取的资源兜底超时。请保持在面向模型的工具预算（`tool-web` 的 `timeoutMs`）之下，这样服务变慢会表现为提供方失败。 |
| `maxContentChars` | `200000` | 单页返回的 Markdown 上限；超出时结果会置 `truncated`。 |

补丁行会**整体替换**它命中的那一行的 `config`，所以要保留的键都必须重述。

## 必须显式选中本提供方

bundle patch 会设置 `web.fetchProvider: ben-crawl4ai`，这不是客套：
`@deepseek-ai/dsh-web-fetch-http` 与本插件同时挂载，而它的 `available()` 恒为 `true`，于是
**同时存在两个可用**的抓取提供方。接缝只在恰好一个可用时才自动选择，否则每次调用都会以
`WEB_PROVIDER_AMBIGUOUS` 失败。

补丁会整体替换它命中那一行的 `config`，而配置档补丁在所有 bundle 层之后应用 —— 所以如果你
也在 `web` 行上钉了 `searchProvider`，请在那里一并重述 `fetchProvider: ben-crawl4ai`。

## 服务端契约

一次抓取就是 `POST <base>/crawl`，请求体 `{"urls": ["<url>"]}` 加配置的请求头。应答是
Crawl4AI 的 `{ success, results: [ … ] }`；取第一条结果的最终地址（优先 `redirected_url`，
其次 `url`）、目标自身的 `status_code`，以及它的 `markdown` 对象 —— 其中优先 `fit_markdown`，
而当 `fit_markdown` 为**空字符串**时回退到 `raw_markdown`（未请求 fit 过滤时服务端就返回
`fit_markdown: ""`）。

对于不提供 `/crawl` 的服务端（较老的版本，或只暴露部分 API 的反向代理），会得到 404/405，
此时自动改用 `/md` 重试一次：内容相同，但没有目标状态码和最终地址。

**目标页面返回非 2xx 属于结果而不是错误** —— 状态码是被抓取资源的一部分，会连同 Crawl4AI
抽到的正文一起返回。只有"根本没能取到页面"才抛错。

## 错误

失败都是 `WebError`，由工具层渲染进工具结果。

| 情形 | 代码 |
|---|---|
| 调用方取消 | `WEB_ABORTED` |
| `timeoutMs` 用尽 | `WEB_FETCH_TIMEOUT` |
| 请求的 URL 不是绝对的 `http(s)` | `WEB_INVALID_URL` |
| 未配置 Crawl4AI 地址 | `WEB_PROVIDER_ERROR`（且 `available()` 为假） |
| 服务端拒绝（401/403） | `WEB_PROVIDER_ERROR`，并指明验证请求头 |
| 服务端不可达、5xx，或返回非 JSON | `WEB_PROVIDER_ERROR` |
| 服务端没有产出结果或正文 | `WEB_PROVIDER_ERROR` |

## 测试

```bash
node --test test/crawl4ai.test.mjs test/client.test.mjs   # 离线
```

`crawl4ai.test.mjs` 用桩 `fetch` 覆盖 HTTP 契约与映射。`client.test.mjs` 用桩模块加载器执行
浏览器端 bundle，因此多余的 `@deepseek-ai/*` 导入、写错的组件名、或与插入行不一致的 slot key
都会在这里失败，而不是弄坏整个 Web UI。

另外两个套件需要真实服务，缺省时跳过：

```bash
$env:CRAWL4AI_URL='https://ca.example:1443'
$env:CRAWL4AI_AUTH_HEADER_NAME='Authorization'
$env:CRAWL4AI_AUTH_HEADER_VALUE='Bearer …'
node --test test/seam.test.mjs          # 注册进真实的 ctx.web 并抓取
node --test test/crawl4ai.test.mjs      # 含一次真实抓取
```

`seam.test.mjs` 是端到端的那个：它挂载 `@deepseek-ai/dsh-web`，应用本插件，并通过接缝派发一次
抓取，覆盖按 id 选择、不可用门禁，以及"一次 volatile 配置修改对紧接着的下一次调用就生效"。

## 已知限制

- **只返回 Markdown。** 接缝的正文类型只有 `html` 与 `text`；本提供方始终返回 `text`，于是
  `dsh-tool-web` 的 HTML→Markdown 那一步被跳过了，而不是被重复执行。
- **不暴露抓取调参。** `crawler_config` 没有开放：扫描深度、缓存、过滤、截图都是 Crawl4AI 的
  能力，而接缝的请求结构没有地方放它们。
- **页面缓存由 Crawl4AI 服务端掌握。** `cache` 保持默认，因此重复抓取可能命中服务端缓存。
- **`/md` 回退路径丢失目标状态码。** 走回退时，成功转换一律按 HTTP 200 报告。

## 许可

MIT
