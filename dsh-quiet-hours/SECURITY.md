# Security Policy

## 支持范围

| 版本 | 支持 |
|---|---|
| 0.1.x | ✅ |

## 报告问题

请不要开公开 issue。通过 GitHub 的 Private vulnerability reporting（仓库 → Security → Report a vulnerability）
或邮件联系维护者，说明版本、复现步骤和影响。

## 这个插件会接触什么

- 读取 WeChatAgent 的 `config/wechatagent.json`、`state/wechat-io-config.json`、`state/hook/native-token.txt`；
- 只向 `127.0.0.1` 的 reader（`5031`）和 hook（`30001`）发请求；
- 不向任何外部地址发请求，不收集遥测；
- 固定文案由本机直接发出，不经过模型服务。

仓库中不应出现账号、密钥、会话内容或聊天记录。运行时状态写在 WeChatAgent 的 `state/away/`，
已被 `.gitignore` 排除；提交前请自行确认。
