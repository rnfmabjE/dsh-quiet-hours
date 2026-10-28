# dsh-quiet-hours

> 给微信机器人加一个「静音时段（quiet hours）」：到点闭嘴，有人来找只回一句话。

插件 ID `dsh-quiet-hours`，名字取自手机系统的「quiet hours / 免打扰时段」——
在设定好的时段里，这个微信机器人只负责一句固定回复，其余交给时间。

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件。挂在 WeChatAgent 的微信会话上，
在工作日的指定时段里**一次模型都不调用**，来消息时用固定文案自动应答；时段外自动恢复成人格对话，
不改人格、不清会话、不动聊天记录。

```
工作日 09:00 ─────────── 12:00     14:00 ─────────── 18:00
        免打扰：只回固定文案              免打扰：只回固定文案
        （不调用模型）                     （不调用模型）
```

## 特性

- **时段可配**：默认工作日 `09:00–12:00`、`14:00–18:00`（`Asia/Shanghai`），支持节假日、调休、任意时区；
- **真·AI 停答**：在 `agent/pre-step` 直接拒绝这一步，模型不参与，不产生 token；
- **固定文案直发**：通过 WeChatAgent 原生 hook 的 `POST /SendTextMsg` 发出，不经模型；
- **私聊全回，群里只在被 @/点名时回**（可按群改为 always / never）；
- **限流兜底**：每会话冷却（默认 180 秒）+ 每小时上限（默认 12 条），防刷屏、防重试重复发；
- **手动控制**：`quiet_hours_status` / `quiet_hours_control` 两个工具，可临时强制开关；
- **失败安全**：插件内部任何异常都会放行原流程；固定文案发不出去时默认仍然拦住 AI（可切回 `fallbackToAgent`）。

## 为什么不是「到点停掉 WeChatAgent」

| 做法 | 结果 |
|---|---|
| 停掉 WeChatAgent 后台服务（reader / bridge / adapter） | 消息没人读，插件也不知道“有人发消息”，固定回复无从触发；还会连带停掉表情、记忆、上下文维护 |
| **保留消息链路，只让 AI 不上场（本插件）** | 消息照常接收、会话照常落库；模型这一步被跳过，固定文案由插件直发 |

## 工作原理

```
微信 ──► WeChatAgent reader ──► adapter ──► bridge ──► DSH plugin (11230)
                                                          │
                                              agent/pre-step（本插件在这里）
                                                          │
                              ┌───────────────────────────┴───────────────┐
                              │ 时段外 / 非微信会话：next()，一切照旧        │
                              │ 时段内：发固定文案 + return {kind:'reject'} │
                              └───────────────────────────┬───────────────┘
                                                          │
                                        hook /SendTextMsg ─┴─► 微信
```

1. DSH 为每个微信会话建一个 session，桥接插件把新消息送进 `agent/pre-step`；
2. 插件用 `state/accounts/*/dsh-sessions.json` 把 session id 反查回 `wechat:private|group:<id>`，
   再用会话标题（`微信私聊｜…` / `微信群聊｜…`）兜底；
3. 会话必须在 WeChatAgent 的 `whitelist` 里，否则不拦；
4. 时段内：解析正文判断要不要回（群聊看有没有 @/唤醒词）→ 冷却检查 → 解析真实 wxid →
   `POST /SendTextMsg` → 返回 `{ kind: 'reject' }`，这一轮不会进模型；
5. 时段外完全没有副作用。

> **已知边界**：被拒绝的消息不会进入 AI 的会话历史；固定文案也不写进 AI 的对话记录。
> 时段恢复后，AI 不知道自己在免打扰期间回过这句话。

## 兼容性

| 组件 | 版本 |
|---|---|
| DeepSeek Harness | `0.2.0-rc.2`（实测） |
| WeChatAgent | `0.3.9`（实测） |
| 微信 + 原生 hook | `4.1.10.27` |
| Node.js | `>= 20`（用到 `AbortSignal.any`、原生 `fetch`） |

- WeChatAgent 是第三方 Windows 程序，本插件**只读**它的配置/状态，并且只调用它本机的 hook 接口，不修改它的任何文件；
- 插件本身零依赖，只用 Node 内置模块；
- 没有 WeChatAgent 的环境也能安装和跑单测，只是没有实际效果。

## 安装

### 一键安装（已收录市场后）

- **DSH Desktop**：设置 → **插件市场** → 搜 `quiet hours` → 安装；
- **命令行 / web profile**：`dsh plugin --profile web add github:rnfmabjE/dsh-quiet-hours`
  （安装成功后会自动把包名写进 `dsh.profile.bundles`）。

> 桌面版的 `desktop` profile 由应用独占，命令行执行 `dsh plugin --profile desktop …` 会报
> `profile "desktop" is managed exclusively by the Electron application`，请用应用内安装。

收录状态与提交方法见 [docs/marketplace.md](docs/marketplace.md)。

### 手动安装

完整步骤（含前置检查、profile 覆盖层配置、真机验收、升级/卸载）见
**[docs/deploy.md](docs/deploy.md)**。最短路径：

```powershell
# 1) 取代码，放到长期不变的目录
git clone https://github.com/rnfmabjE/dsh-quiet-hours.git D:\tools\dsh-quiet-hours

# 2) 链接进 DSH profile（也可以改用 plugin_manager 的 install_bundle）
New-Item -ItemType Junction `
  -Path  "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-quiet-hours" `
  -Target "D:\tools\dsh-quiet-hours"
```

3. 把 `"dsh-quiet-hours"` 加进 profile `package.json` 的 `dsh.profile.bundles`；
4. 改 `cordis.patch.yml` 里的 `reply`（文案）、`accountNames`（群里昵称）、`windows`（作息）；
5. **从托盘完全退出 DSH 再打开**（宿主插件只在启动时加载）。

前置要求：Node.js ≥ 20；DSH `0.2.0-rc.2`；WeChatAgent `0.3.9` 已跑通收发
（reader `5031`、hook `30001`、bridge `11229`、DSH 桥接插件 `11230`）。

### 验证安装

在桌面 DSH 会话里问一句「静音时段现在什么状态」，会调用 `quiet_hours_status`，
返回里应看到 `probe.reader=true`、`probe.hook=true`。

不依赖 DSH 的自检：

```bash
node check.mjs               # reader / hook / 会话映射
node check.mjs --send-test   # 额外给「文件传输助手」发一条测试文字（发给自己）
```

## 配置

配置写在仓库的 `cordis.patch.yml` 里（安装后位于 profile 的 `node_modules/dsh-quiet-hours/`）。
改完重启 DSH 生效。

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `projectRoot` | string | `$WECHAT_AGENT_ROOT` 或 `D:/WeChat Agent/data/workspace` | WeChatAgent 数据目录 |
| `enabled` | boolean | `true` | 总开关；`false` 时插件完全不动作 |
| `timeZone` | string | `Asia/Shanghai` | 作息使用的 IANA 时区 |
| `windows` | array | 工作日 09–12、14–18 | 每项 `{ days, start, end }`，`days` 用 1=周一 … 7=周日；左闭右开 |
| `reply` | string | 见下方「改固定文案」 | 固定文案，≤300 字，换行会被压成空格 |
| `replyByChat` | object | `{}` | 按会话覆盖文案，如 `{"wechat:private:123": "…"}` |
| `groupReply` | `wake`/`always`/`never` | `wake` | 群聊策略：被 @ 才回 / 都回 / 不回 |
| `accountNames` | string[] | `[]` | 本账号在群里的昵称，用于判断是否被 @ |
| `groupWakeAnyMention` | boolean | `false` | 没配昵称时，是否把“任意 @”都当成叫自己 |
| `replyCooldownSeconds` | number | `180` | 同一会话两次固定回复的最小间隔 |
| `maxRepliesPerChatPerHour` | number | `12` | 同一会话每小时最多几条 |
| `holidays` | string[] | `[]` | 不上班的日期，如 `['2026-10-01']` |
| `extraWorkdays` | string[] | `[]` | 调休上班的周末，如 `['2026-10-11']` |
| `fallbackToAgent` | boolean | `false` | 固定文案发不出去时，是否放行让 AI 回 |
| `log` | boolean | `true` | 是否往 DSH 日志写诊断信息 |

完整示例见 [`examples/cordis.patch.yml`](examples/cordis.patch.yml)。

### 改固定文案

仓库默认文案就是：

> 梁文峰不是我兄弟，梁文谷才是

它在 `cordis.patch.yml` 的 `reply` 字段里，**改这一行就能换**：

```yaml
- insert:
    - id: quiet-hours
      name: dsh-quiet-hours
      config:
        reply: '梁文峰不是我兄弟，梁文谷才是'
```

改完：

1. 保存 `cordis.patch.yml`；
2. 从托盘**完全退出 DSH 再打开**（宿主插件与配置在启动时读取）；
3. 用 `quiet_hours_status` 确认 `config.reply` 已经是新文案。

补充说明：

- **只想改某一个会话**：不动 `reply`，加 `replyByChat`，键是会话 key，值是文案：

  ```yaml
  replyByChat:
    wechat:private:1000000001: '在忙，晚点回你。'
    wechat:group:2000000002: '上班中，被 @ 才回。'
  ```

- **代码里的兜底**在 `index.js` 的 `DEFAULTS.reply`（和仓库默认一致），只有配置里完全没写 `reply` 时才生效；
  改它不如改 `cordis.patch.yml`，因为配置里的值优先。
- 文案会被压成单行（连续空白合成一个空格）并截断到 300 字，不支持多行/分段。
- 文案里不要放 `RESPOND:`、`SILENT`、`[STICKER:x]` 这类协议标记——它不经过模型，但会被 WeChatAgent 当成回复正文。

### 群聊怎么算“叫我”

默认 `groupReply: wake`，命中任意一条才回：

- 正文里出现 `accountNames` / `wake_words` / `account.nicknames` 中的任意一个名字（微信的 @ 会以 `@昵称` 出现在正文里）；
- 或者 `groupWakeAnyMention: true` 时，任意 `@某人` 都算。

名字都没配时，群里默认**不会**自动回复。建议先在 WeChatAgent 的
`config/wechatagent.json` 里确认本账号在群里的昵称，填进 `accountNames`。

## 手动控制

桌面 DSH 会话里可以直接让模型调用：

| 调用 | 作用 |
|---|---|
| `quiet_hours_status()` | 当前模式、下一段作息、固定文案、最近拦截/发送记录、reader/hook 是否在线 |
| `quiet_hours_control({action:'on', minutes:60})` | 强制进入免打扰（临时测试用） |
| `quiet_hours_control({action:'off', minutes:60})` | 强制恢复 AI |
| `quiet_hours_control({action:'auto'})` | 清除强制，回到作息表 |

等价的状态文件是 `state/away/override.json`：

```json
{ "mode": "away", "until": 1792730400000 }
```

`mode` 只认 `away` / `open` / `auto`，`until` 是毫秒时间戳（省略或过期即失效）。

> 这两个工具不会出现在微信会话里（WeChatAgent 的 `dshAccess` 没有授权它们），只有在桌面端才能调用。

## 排错

| 现象 | 先看哪 |
|---|---|
| 状态显示 `mode=away`，但没人收到固定文案 | `state/away/audit.jsonl` 里 `action=failed` 的 `error`；再确认 hook 的 `/SendTextMsg` 返回 `ret=0` |
| 群里被 @ 也不回 | `accountNames` 是否包含群昵称；或临时打开 `groupWakeAnyMention` |
| 一条消息回了好几条 | `replyCooldownSeconds` 是否被改成 0；同一会话是否真的连发 |
| 到点没切过去 | `quiet_hours_status` 的 `nextChangeAt`；DSH 进程时区/`timeZone` 配置 |
| 想立刻停掉 | `enabled: false` 后重启 DSH，或 `quiet_hours_control({action:'off'})` |

更多见 [docs/troubleshooting.md](docs/troubleshooting.md)。

## 开发

```bash
npm test     # 作息 / 闸门 / 限流 / 接线，35 项
npm run check
```

- `test/smoke.mjs`：纯逻辑单测（时区、窗口边界、群聊唤醒、限流）；
- `test/wiring.mjs`：假 ctx 直接触发 `agent/pre-step`，验证拦截/放行分支，不连微信、不发消息；
- CI：`.github/workflows/ci.yml`，Node 20 / 22 跑 `npm test`；
- 发版：推 `v*` tag 会先跑测试，再打包 zip 并上传到 GitHub Release（`.github/workflows/release.yml`）。

代码结构：

```
index.js            插件入口：配置、agent/pre-step 闸门、两个工具、状态心跳
lib/schedule.mjs    作息与“下次切换”计算
lib/gate.mjs        纯判定：open / silent / reply
lib/wechat.mjs      reader / hook / 会话映射 / 发送
lib/state.mjs       审计、限流、override 文件
```

## 隐私与安全

- 插件只访问 `127.0.0.1` 上的 reader（`5031`）和 hook（`30001`），不向任何外部地址发请求；
- 读取的都是本机 WeChatAgent 自己的配置与令牌（`state/wechat-io-config.json`、`state/hook/native-token.txt`）；
- 固定文案由本机直接发出，不经过模型服务；
- 仓库不含任何账号、会话、聊天记录或密钥；运行时状态写在 WeChatAgent 的 `state/away/`，已被 `.gitignore` 排除。

## 第三方依赖与声明

本仓库以 MIT 发布，**只覆盖本仓库的代码与文档**：

- 需要本机已安装并运行 **WeChatAgent**（第三方 Windows 项目，作者 Derpyu520，
  来源 <https://github.com/sourcepro5/WeChatAgent>，其分发自带 MIT 许可）。
  本仓库不包含、也不重新分发它的源码、安装包、原生 DLL 或运行环境；两者无隶属或背书关系；
- 不包含微信客户端或原生 hook；非官方自动化可能违反平台条款并带来账号风险；
- 本插件运行在 **DeepSeek Harness** 之上，DSH 与模型服务受其自身许可与条款约束；
- 运行时只用 Node.js 内置模块，没有 npm 依赖。

完整说明（含 WeChatAgent 许可与版权行、微信平台提示、商标与致谢）见
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 目录

```
.
├─ .github/workflows/ci.yml
├─ cordis.patch.yml         bundle patch（配置入口）
├─ index.js
├─ lib/
├─ locale/                  插件标题/说明（中英）
├─ icon.svg
├─ check.mjs                现场自检
├─ test/
├─ docs/
├─ examples/
├─ CHANGELOG.md
├─ CONTRIBUTING.md
├─ SECURITY.md
├─ THIRD-PARTY-NOTICES.md   第三方依赖与许可
└─ LICENSE
```

## License

[MIT](LICENSE)
