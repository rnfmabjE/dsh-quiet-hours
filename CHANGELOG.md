# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.0] - 2026-10-23

### Added

- 工作日时段（默认 09:00–12:00、14:00–18:00）免打扰：`agent/pre-step` 拒绝该步，不调用模型。
- 时段内通过 WeChatAgent 原生 hook `POST /SendTextMsg` 直接发送固定文案。
- 私聊全部应答；群聊默认只在被 @ / 唤醒词点名时应答，支持 `always` / `never`。
- 每会话冷却与每小时上限；发送失败默认仍拦截 AI，可用 `fallbackToAgent` 放行。
- `quiet_hours_status` / `quiet_hours_control` 工具，以及 `state/away/override.json` 手动开关。
- `check.mjs` 现场自检（reader / hook / 会话映射，可选发一条测试到文件传输助手）。
- 单测与接线测试（`npm test`），GitHub Actions CI（Node 20 / 22）。
