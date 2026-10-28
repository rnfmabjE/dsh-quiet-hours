# Contributing

感谢愿意改进这个插件。提交前请先看这一页。

## 开发环境

- Node.js >= 20
- 跑测试不需要微信或 WeChatAgent：

```bash
npm test
```

## 修改约定

- `lib/` 里的纯逻辑（作息、判定、限流）尽量保持无副作用，方便单测；
- 任何会写文件、发请求的行为都要有失败兜底，不能让异常打断正常聊天；
- 改动判定逻辑时，同步补 `test/smoke.mjs` 或 `test/wiring.mjs`；
- 不要提交本机状态（`state/`）、日志、账号、会话 id 或令牌；
- 提交信息用「类型: 说明」，例如 `fix: 限流读错字段导致冷却失效`。

## Pull Request

1. 说明改了什么、为什么；
2. 附上 `npm test` 结果；
3. 涉及行为的改动，写清边界情况（群聊、冷却、发送失败）。

## 报告问题

请用仓库的 issue 模板，尽量附上：

- DSH / WeChatAgent 版本；
- `quiet_hours_status` 的输出（可去掉会话 id）；
- `state/away/audit.jsonl` 里相关的那几行（同样可以先脱敏）。

安全问题请走 [SECURITY.md](SECURITY.md)，不要开公开 issue。
