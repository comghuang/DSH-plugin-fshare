# Security notes — dsh-plugin-fshare

远程（手机/电脑）访问无人值守机器时，只经 DSH Web UI 暴露本插件功能。以下边界请知悉并配合部署层防护使用。

## 本插件的防护边界

- **路径白名单**：仅允许会话工作区根 + `EXTRA_ROOTS` 白名单目录。所有请求经 `fs.resolve` + `fs.contains` 校验，拒绝绝对路径、`..` 越权。
- **文件上限**：单文件 64MB；`html`/`svg` 强制 `attachment` 下载 + `X-Content-Type-Options: nosniff`，防止同源脚本注入。
- **只读为主**：浏览/预览/下载/搜索/状态采样均为只读；状态采样仅执行只读 PowerShell 查询（无写操作）。
- **无认证能力**：路由本身不鉴权（DSH 本体亦然）。访问控制由部署层负责（见下）。

## 部署层要求（重要）

1. **不要裸暴露 3080 到公网**。DSH 的 trustedHosts / browser-trust 机制防止跨站行为，不是身份认证。
2. 远程访问至少二选一：
   - **Tailscale / WireGuard**（推荐：设备级网络加密 + 无需公网端口）；
   - **Cloudflare Tunnel + Access**（或任意带 SSO/访问策略的反向代理 + HTTPS），如 frp + Nginx + Basic Auth/SSO。
3. 隧道/代理层提供 HTTPS 与访问控制后，手机浏览器访问的是加密链路，cookie/会话不暴露于明文网络。
4. 通知渠道（后续版本）勿在 URL 中携带明文密钥；使用至少只读权限的 token。
5. `EXTRA_ROOTS` 白名单保持最小化：只加真正需要远程查看的目录。

## 已知风险面

- `/fshare/f` 的 token 为「会话 ID + 相对路径」的 base64，**不可猜测但可复制**：任何能阅读页面内容的中人可构造同会话下载链接。若部署在共享/不信任网络，请确保访问控制（上节）到位。
- 状态采样通过 `powershell.exe` 执行只读脚本，脚本内容由本包固定，不接受外部输入。

## 上报

发现安全问题请联系包维护者（见 README）。
