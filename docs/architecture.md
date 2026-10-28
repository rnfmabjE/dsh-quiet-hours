# 架构说明

## 组件关系

```
┌────────────┐   DB    ┌──────────────┐  HTTP 5031  ┌──────────────┐
│  微信客户端 │◄───────►│ reader-api   │◄───────────►│  adapter     │
│ (Weixin.exe)│        │ (python)     │             │ (OneBot ws)  │
└─────▲──────┘        └──────────────┘             └──────┬───────┘
      │ hook DLL（进程内 HTTP 30001）                       │ ws 11229
      │                                                     ▼
      │                                             ┌──────────────┐
      │                                             │  bridge      │
      │                                             │ (social)     │
      │                                             └──────┬───────┘
      │                                                    │ HTTP 11230
      │                                                    ▼
      │                                       ┌─────────────────────────┐
      └────────── /SendTextMsg ───────────────│ DSH + social bridge 插件 │
                                              │  ├─ 每聊天一个 session    │
                                              │  └─ agent/pre-step       │
                                              │        ▲                 │
                                              │        │ 本插件           │
                                              │  dsh-quiet-hours         │
                                              └─────────────────────────┘
```

- **WeChatAgent** 负责读微信数据库、把消息送给 DSH、把 DSH 的回复发回微信；
- **DSH 桥接插件**（`dsh-social-bridge-plugin`）为每个微信会话建一个 DSH session，
  新消息通过 `agent.followup()` 进入 `agent/pre-step`；
- **本插件** 在 `agent/pre-step` 里做两件事：判断要不要拦截；需要回固定文案时直接调 hook 发送。

## 为什么在 `agent/pre-step` 拦截

`agent/pre-step` 是 DSH 提供的“这一步要不要进模型”的决策点，返回 `{ kind: 'reject' }` 就会结束这一轮，
**模型不会被调用**，也不会有 token 消耗。相比“改 system prompt 让模型只回一句话”，这样做：

- 文案 100% 确定，不受模型发挥影响；
- 不花 token，也不会因为上下文太长而失败；
- 不会把免打扰期间的消息带进人格上下文。

代价是：被拒绝的消息不会写进会话历史（`pre-step` 拒绝后消息被丢弃），固定文案本身也不写进 AI 的记录。

## 一轮消息的时序

```
微信消息
  └─ adapter → bridge → DSH 桥接插件
        └─ agent.followup()
              └─ agent/pre-step（本插件）
                    ├─ 非微信 / 时段外 / 非白名单 → next()（原流程）
                    └─ 时段内
                          ├─ 解析正文（群聊判断 @/唤醒词）
                          ├─ 每会话冷却 & 每小时上限
                          ├─ reader 反查真实 wxid
                          ├─ hook POST /SendTextMsg
                          └─ return { kind: 'reject' }
```

桥接插件收到 `turn_blocked` 后不会发送任何 AI 回复，这一轮就结束了。

## 会话识别

DSH 的 session id 是 `social-<hash>`，桥接插件把 `wechat:private|group:<conversationId>` ↔ session id
写在 WeChatAgent 的 `state/accounts/<account>/dsh-sessions.json`。插件按这个映射反查会话 key；
映射缺失时退回解析会话标题（`微信私聊｜名字｜人格` / `微信群聊｜名字｜人格`）。

拿到会话 key 后还必须命中 `wechatagent.json` 的 `whitelist`，否则一律放行——
避免把非白名单会话（比如临时加进来的群）也拦掉。

## 发送链路

直接调 WeChatAgent 原生 hook：

```
POST http://127.0.0.1:30001/SendTextMsg
Authorization: Bearer <state/hook/native-token.txt>
X-WeChatAgent-Account: <reader status 里的 accountDirectory>
{"wxidorgid": "<真实 wxid>", "msg": "<固定文案>"}
```

返回 `{"ret": 0}` 视为提交成功。hook 不可达或返回非 0 时：记审计、默认仍然拦截 AI；
`fallbackToAgent: true` 才会放行让模型回复。

## 限流

- `replyCooldownSeconds`：同一会话两次固定回复的最小间隔，默认 180 秒；
- `maxRepliesPerChatPerHour`：同一会话每小时上限，默认 12 条。

状态存在 `state/away/replies.json`，跨重启保留（1 小时窗口滚动）。

## 安全边界

- 只访问 `127.0.0.1`，对非回环地址直接报错；
- 只读 WeChatAgent 的配置与令牌，不修改它的任何文件；
- 不向外部地址发请求，不采集遥测；
- 仓库与运行时状态分离（`state/away/` 被 `.gitignore` 排除）。
