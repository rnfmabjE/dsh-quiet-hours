# 本地部署

把 `dsh-quiet-hours` 装进本机 DSH 的完整步骤。全程只需 PowerShell + 一次 DSH 重启。

> 本文以 Windows + 默认 profile（`desktop`）为例。仓库：<https://github.com/rnfmabjE/dsh-quiet-hours>

## 0. 前置检查

| 需要 | 怎么确认 |
|---|---|
| Windows 10/11 x64 | WeChatAgent 只支持 Windows |
| Node.js ≥ 20 | `node -v` |
| Git | `git --version` |
| DSH `0.2.0-rc.2` 已安装并登录模型账号 | DSH 能正常对话 |
| WeChatAgent `0.3.9` 已跑通收发 | 微信里能正常收到机器人的回复 |

端口自检（四个都在监听才算跑通）：

```powershell
30001,5031,11229,11230 | ForEach-Object {
  "$_ = " + (Test-NetConnection 127.0.0.1 -Port $_ -InformationLevel Quiet -WarningAction SilentlyContinue)
}
```

## 1. 取代码

放到一个**长期不变**的目录，不要放在临时目录里（DSH 通过目录联接引用它）：

```powershell
git clone https://github.com/rnfmabjE/dsh-quiet-hours.git D:\tools\dsh-quiet-hours
cd D:\tools\dsh-quiet-hours

# 可选：先确认代码本身没问题（不需要微信）
npm test        # 35 项：29 单测 + 6 接线测试
```

## 2. 装进 DSH profile

### 方式 A：插件管理器（如果你的 DSH 提供 `plugin_manager`）

在 DSH 里执行 `plugin_manager` 的 `install_bundle`，`target` 填 `D:\tools\dsh-quiet-hours` 的绝对路径。
它会处理安装与启用；按提示重启。

### 方式 B：手动目录联接（所有版本都适用）

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
$target  = "D:\tools\dsh-quiet-hours"

New-Item -ItemType Junction -Path "$profile\node_modules\dsh-quiet-hours" -Target $target
```

然后把包名加进 profile 的 `package.json`，`dsh.profile.bundles` 数组末尾：

```jsonc
{
  "dsh": {
    "profile": {
      "bundles": [
        // …原有的 bundle 保持不动
        "dsh-quiet-hours"
      ]
    }
  }
}
```

改完**从托盘完全退出 DSH 再打开**。宿主插件只在启动时加载，这一步不能省。

## 3. 配置

插件配置在 `cordis.patch.yml` 的 `config` 里。两种放法，二选一：

### 3.1 直接改仓库里的文件（简单）

```powershell
notepad D:\tools\dsh-quiet-hours\cordis.patch.yml
```

至少确认这三项：

```yaml
projectRoot: 'D:/WeChat Agent/data/workspace'   # WeChatAgent 的 data/workspace
reply: '梁文峰不是我兄弟，梁文谷才是'             # 时段内的固定文案
accountNames: []                                 # 群里本账号的昵称，判断有没有被 @
```

- `projectRoot` 也可以不写，改用环境变量 `WECHAT_AGENT_ROOT`；
- `windows` 是作息，默认工作日 `09:00–12:00`、`14:00–18:00`；
- `accountNames` 建议填上（例：`[阿鲸]`），否则群里被 @ 也不会回。

### 3.2 放在 profile 覆盖层里（`git pull` 不会冲突，推荐长期用）

个人配置写进 `~/.dsh/profiles/desktop/cordis.patch.yml`，按 `id` 覆盖：

```yaml
- id: quiet-hours
  config:
    projectRoot: 'D:/WeChat Agent/data/workspace'
    reply: '上班中，12:00 / 18:00 后回你。'
    accountNames: [阿鲸]
```

这样仓库里的 `cordis.patch.yml` 保持原样，升级时直接 `git pull` 即可。

> 两种都放时，profile 覆盖层优先。改完都要重启 DSH。

## 4. 重启并验证

从托盘完全退出 DSH → 重新打开，然后在桌面会话里检查：

1. 工具是否出现：问一句「静音时段现在什么状态」，应调用 `quiet_hours_status`；
   返回里应看到 `probe.reader=true`、`probe.hook=true`、`probe.account` 是本机账号；
2. 状态文件：`D:\WeChat Agent\data\workspace\state\away\mode.json`
   里的 `mode` 是 `open` 或 `away`，`checkedAt` 在最近 30 秒内；
3. 不经过 DSH 的自检：

```powershell
cd D:\tools\dsh-quiet-hours
node check.mjs               # reader / hook / 会话映射
node check.mjs --send-test   # 额外给「文件传输助手」发一条测试文字（发给自己）
```

## 5. 真机验收（建议做一次）

1. 在桌面 DSH 里让模型调用 `quiet_hours_control({ action: 'on', minutes: 30 })`，强制进入免打扰；
2. 用另一个微信号：
   - 私聊发一句 → 只应收到 `reply` 里的那句固定文案；
   - 群里 @ 本账号 → 同样一条；不 @ → 不应有任何回复；
3. 看 `D:\WeChat Agent\data\workspace\state\away\audit.jsonl`，应有 `"action":"reply"` 和
   `"action":"silent"`（`group_not_woken`）两类记录；
4. 测完调用 `quiet_hours_control({ action: 'auto' })` 回到作息表。

## 6. 升级与卸载

```powershell
# 升级
cd D:\tools\dsh-quiet-hours
git pull --ff-only
# 然后从托盘完全重启 DSH
```

```powershell
# 卸载
Remove-Item "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-quiet-hours" -Force
# 再从 profile 的 package.json 里删掉 "dsh-quiet-hours"，重启 DSH
```

卸载不会动 WeChatAgent 的 `state/away/`（审计与限流状态），需要的话自己删。

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 桌面会话里没有 `quiet_hours_*` 工具 | `dsh.profile.bundles` 没加、或没完全重启 DSH |
| `wechat_away_*` 旧工具还在 | 那是改名前的版本，删掉旧联接与旧 bundle 项 |
| `probe.reader=false` | WeChatAgent 服务没启动，或微信没登录；先按 WeChatAgent 的说明修好 |
| `probe.hook=false` | 微信客户端没开，或 hook 没加载 |
| 到点没切换 | 看 `mode.json` 的 `checkedAt`；确认 `timeZone` 与系统时间 |
| 群里 @ 了不回 | `accountNames` 没配本账号昵称；或该群是“唤醒后回复”且没被唤醒 |
| 对方收到好几条一样的 | 检查 `replyCooldownSeconds` 是否被改成 0 |

更多见 [troubleshooting.md](troubleshooting.md)。
