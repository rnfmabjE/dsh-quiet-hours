# 第三方依赖与声明

本仓库（**dsh-quiet-hours**）自身以 [MIT](LICENSE) 发布。MIT 只覆盖本仓库的代码与文档，
**不覆盖**下面这些第三方内容，也不表示任何一方对本项目的背书。

## WeChatAgent（必需，但不在本仓库中）

- **是什么**：第三方 Windows 微信助手程序，提供 reader、OneBot adapter、bridge 和微信原生 hook。
  本插件依赖它已安装并跑通收发。
- **来源**：<https://github.com/sourcepro5/WeChatAgent>（作者 Derpyu520；安装包通过其 GitHub Releases 分发）。
  该地址取自 WeChatAgent 自身的更新检查配置，本仓库不镜像、不改写其内容。
- **许可**：其分发中自带的 `LICENSE` 为 MIT，版权行为
  `Copyright (c) 2026 Derpyu520 and qq-bridge / QSH contributors`。
- **与本项目的关系**：独立项目，与作者无隶属、无官方合作或背书。
  本仓库**不包含、不重新分发** WeChatAgent 的源码、安装包、原生 DLL 或运行环境；
  `package.json` 只声明可选 peer 依赖，不下载任何东西。
- **如何获得**：按上述仓库的 Release 安装，并遵守它自带的许可与说明。
  本仓库的安装章节只说明如何与本机已安装的实例对接。
- **兼容范围**：按 WeChatAgent `0.3.9` 的本地接口与文件格式工作（reader `5031`、hook `30001`、
  `config/wechatagent.json`、`state/*`）；对方升级后接口可能变化，需要相应调整。

## 微信 / 腾讯

- 本插件不包含微信客户端、原生 hook，也不包含任何腾讯代码或资源；它只与本机已运行的实例通信，
  并调用 WeChatAgent 暴露的本机接口。
- 使用非官方客户端或自动化手段可能违反微信的服务条款，并带来账号风险。
  请在合法授权的范围内使用，并自行评估后果。

## DeepSeek Harness

- 本插件是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的宿主插件，
  运行在 DSH 之上；DSH 及其模型服务受各自的仓库许可与服务条款约束。
- 本项目与 DeepSeek 官方无隶属关系，也不代表官方背书。

## Node.js

- 运行时只使用 Node.js 内置模块（`node:fs`、`node:path`、`fetch`、`Intl` 等），
  不包含任何 npm 依赖，也没有构建步骤。

## 名称与商标

`WeChatAgent`、`WeChat` / `微信`、`腾讯`、`DeepSeek` 等名称与标识归各自权利人所有。
本项目仅在描述兼容性时提及这些名称，不主张任何商标权利，也不暗示官方关联。

## 致谢

- 功能命名参考操作系统里的 “quiet hours / 免打扰时段” 概念，与任何具体产品无关；
- 感谢 WeChatAgent 及其上游组件（`qq-bridge`、`weflow-cli` 等，均为 MIT）把这些本地接口整理出来，
  本插件只在其之上做了一层时段判定与固定回复。
