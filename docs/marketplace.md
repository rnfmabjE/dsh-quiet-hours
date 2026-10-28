# 上架插件市场（让「一句命令」安装生效）

其它插件能 `dsh plugin add` 或市场一键装，靠的不是仓库里多写了什么，而是**它被收录进了
`awesome-dsh-plugin` 目录**。收录之后：

- 市场里出现卡片，点一下就装（DSH Desktop 用这个）；
- 命令行用户可以 `dsh plugin --profile <profile> add github:rnfmabjE/dsh-quiet-hours`；
- 收录**不要求**发布 npm（目录里一半以上的插件都没有 npm 包）。

## 现在就能用的安装方式

| 场景 | 命令 |
|---|---|
| DSH Desktop（`desktop` profile 由应用独占） | 应用内 **设置 → 插件** 安装本地目录，或等市场收录后一键装；命令行 `dsh plugin` 会报 `profile "desktop" is managed exclusively by the Electron application` |
| 命令行 / web profile | `dsh plugin --profile web add github:rnfmabjE/dsh-quiet-hours` |
| 已收录后 | 市场搜索「quiet hours」→ 安装；或 `dsh plugin --profile <profile> add github:rnfmabjE/dsh-quiet-hours` |

`dsh plugin add` 会在 pnpm 成功后自动把包名写进 `dsh.profile.bundles`，不需要再手改 `package.json`。

## 提交收录：一个文件 + 一个 topic

向 <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin> 提 PR，**只加一个文件**：

`data/plugins/rnfmabjE__dsh-quiet-hours.yml`

```yaml
url: https://github.com/rnfmabjE/dsh-quiet-hours
name: rnfmabjE/dsh-quiet-hours
category: tools
description:
  en: 'Scheduled quiet hours for WeChat bots: skips the model during the configured windows and answers incoming messages with one fixed line.'
  zh: '微信机器人静音时段：工作日的设定时段内不调用模型，来消息只回一条固定文案，时段外自动恢复。'
```

注意：

- 描述里只要有 `: `（英文冒号 + 空格）就必须加引号，否则 YAML 会解析成嵌套键；
- 一个 PR 最多 3 条；
- 不要手工改 README（由脚本生成）；
- 类别取最接近的即可（`tools` / `workflow` 都说得通，维护者会帮着挪）。

然后在 GitHub 仓库页给 `rnfmabjE/dsh-quiet-hours` 加上 **`dsh-plugin`** topic
（About 右边的齿轮 → Topics）。

## 收录门槛（对照自查）

| 要求 | 本仓库 |
|---|---|
| `package.json` 声明 `dsh.bundle` | ✅ `"bundle": { "patch": "./cordis.patch.yml" }` |
| 根目录有 `cordis.patch.yml`，行的 `name` 与包名一致 | ✅ `id: quiet-hours` / `name: dsh-quiet-hours` |
| 真实可用的代码，不是占位或纯 README | ✅ `index.js` + `lib/`，`npm test` 35 项 |
| 仓库创建满 1 天 | ⏳ 新仓库当天提交会被 CI 卡住，隔天再提 |
| 加 `dsh-plugin` topic | ← 需要你在仓库设置里加 |
| 描述只讲功能、不带营销词 | ✅ 参见上面的 YAML |
| 活跃维护 | ✅ CI 已配置 |

## 可选：发布 npm

发布后命令行可以简写成包名（也能让市场显示下载量）：

```powershell
npm login
cd D:\tools\dsh-quiet-hours
npm publish --access public
```

之后：`dsh plugin --profile web add dsh-quiet-hours`。

- 包的 `repository` 字段必须指回本仓库，目录才会把 npm 包与条目关联（已在 `package.json` 里写好）；
- 不需要在 YAML 里写 `npm:` 字段，写了会被校验拒绝；
- 不发布也完全不影响收录。

## 提交之后

- CI 会检查：`dsh.bundle`、仓库年龄、`awesome-lint`、README 是否能重新生成；
- 失败时按提示改同一分支再推，不用重开 PR；
- 合并后网站会自动重建，市场里的卡片通常一天内出现；
- 之后换文案/改配置不需要再提 PR，推本仓库即可。
