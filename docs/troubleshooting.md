# 排错

先跑一次自检：

```bash
node check.mjs
```

它会输出当前作息、reader / hook 是否在线、账号目录、会话数、会话映射数。加 `--send-test`
会额外给「文件传输助手」发一条测试文字（发给自己，不会打扰别人）。

## 到点了没切过去

1. `quiet_hours_status` 看 `mode`、`reason`、`nextChangeAt`；
2. `reason` 是 `override` 说明有手动开关没清掉：`quiet_hours_control({action:'auto'})`；
3. 看 `state/away/mode.json` 的 `checkedAt` 是不是最近 30 秒内的——心跳停了说明插件没加载；
4. 确认 profile 的 `dsh.profile.bundles` 里有 `dsh-quiet-hours`，并且从托盘完全重启过 DSH。

## 状态是 away，但对方没收到固定文案

看 `state/away/audit.jsonl`：

| `action` | 含义 | 处理 |
|---|---|---|
| `reply` | 已提交发送 | 对方没收到就查 hook 和微信登录状态 |
| `failed` | 发送失败 | 看 `error`：`AWAY_HOOK_*` 是 hook 问题，`AWAY_READER_*` 是 reader 问题，`AWAY_CONVERSATION_NOT_FOUND` 是 mapping 过期 |
| `silent` + `cooldown` / `hourly_cap` | 被限流 | 正常行为；确认 `waitSeconds` |
| `silent` + `group_not_woken` | 群里没点名 | 看下面的群聊问题 |
| `skip` + `conversation_unverified` | 会话不在白名单或映射缺失 | 检查 `wechatagent.json` 的 whitelist |

完全没有任何审计行，说明 `agent/pre-step` 根本没跑到本插件：确认 DSH 插件已加载（工具列表里有没有
`quiet_hours_status`），以及消息是否真的进了 DSH。

## 群里被 @ 了也不回

1. WeChatAgent 的 `config/wechatagent.json` 里 `account.nicknames` / `wechat.wake_words` 是否包含群里显示的名字；
2. 插件的 `accountNames` 是否也包含它（示例：`['阿鲸']`）；
3. 实在拿不准，临时设 `groupWakeAnyMention: true`，任何 `@` 都算——副作用是 @ 别人也会触发；
4. 群如果配的是“唤醒后回复”，没被唤醒的消息根本不会进 DSH，插件自然也看不到。

## 同一条消息回了好几条

1. `replyCooldownSeconds` 是否为 0（旧版本有一个字段名 bug，会让冷却失效，0.1.0 已修）；
2. 同一条消息是否被 WeChatAgent 重试投递（桥接插件对失败批次可能重投，冷却就是防这个的）；
3. `state/away/replies.json` 里对应会话的时间戳能看出实际发送节奏。

## hook 在线但 `/SendTextMsg` 不生效

- 微信是否登录（hook 的 `/QueryDB/status` 能看 `IsLogin`）；
- `state/hook/native-token.txt` 是否 64 位十六进制；
- 顶部账号是否和 `reader status` 的 `accountDirectory` 一致（切换账号后需要重开 DSH）；
- 看 WeChatAgent 的 `state/logs/` 里 hook 相关日志。

## 想彻底停用

1. `enabled: false`，重启 DSH；或
2. 把 `dsh-quiet-hours` 从 profile 的 `dsh.profile.bundles` 里去掉并重启；
3. 状态文件留在 `state/away/`，不会影响 WeChatAgent 本身。
