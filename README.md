# dsh-plugin-fshare

DSH Web 插件：在会话输入框上方提供一个可折叠的「文件」条 —— 浏览会话工作区（及可选白名单目录）、预览图片/PDF、下载文件到手机/电脑、递归文件名搜索。全部经 DSH Web UI 完成，远程无人值守场景无需开放额外端口（SSH/网盘等）。

## 功能

- 折叠头部（36px，默认收起，点击展开）｜宽度与输入卡一致
- 目录逐级浏览（📁 芯片）、⬆ 上级、↻ 手动刷新
- 图片缩略图 + 点击页内放大预览（下载 / 新窗口打开）
- PDF 内嵌预览 + 下载；其他文件（txt/zip 等）一键下载
- 文件名搜索：当前目录递归子目录（上限 4000 节点 / 8 层深度 / 200 结果），回车/按钮触发，结果可预览/下载/跳转目录
- 自动适配明/暗主题（全部使用 DSH 主题 token）

## 安装

前置：DSH web profile（`dsh --profile web`），Node >= 20。

### 方式 A：GitHub / npm 包（官方通道，推荐）

```sh
dsh plugin --profile web add github:<作者>/DSH-plugin-fshare
```

（发布到 npm 后：`dsh plugin --profile web add dsh-plugin-fshare@<version>`）

然后重启：`dsh --profile web`。

> 注意：如果该 profile 的 `cordis.patch.yml` 里有手动挂载行（`- id: fshare`），
> 先删除，避免双挂载启动失败。

### 方式 B：手动（无需发布）

```powershell
# 把 dsh-plugin-fshare 目录放到 profiles/web/plugins/ 下（见仓库内 install 脚本）
# profiles/web/package.json 依赖中加：
#   "dsh-plugin-fshare": "file:plugins/dsh-plugin-fshare"
# profiles/web/cordis.patch.yml 加：
#   - insert:
#       - id: fshare
#         name: 'dsh-plugin-fshare'
# 然后：
pnpm install
dsh --profile web
```

## 配置（白名单目录）

编辑 `lib/index.js` 顶部：

```js
const EXTRA_ROOTS = []   // 追加绝对路径即可，如 ['D:\\results', 'E:\\out']
```

默认根为当前会话工作区（`Session.header.cwd`）。修改后重启生效。其他限制：单文件 64MB 上限。

## 安全说明

- 仅允许会话工作区根 + `EXTRA_ROOTS` 白名单内的路径（`fs.resolve` + `fs.contains` 校验，拒绝绝对路径、`..` 越权）
- `.html`/`.svg` 强制以附件下载（`X-Content-Type-Options: nosniff`），避免同源脚本注入
- 不注册任何工具/命令，不影响模型行为；无上传功能

## 开发

无构建步骤：host 半部为纯 ESM（`lib/index.js`），client 半部为
`window.__ModuleLoader__.load({id, factory})` 格式的自包含 bundle
（`lib/client.js`，仅 `require('react')`，由 shell 基座提供）。改动后重启 profile 生效。

## License

MIT
