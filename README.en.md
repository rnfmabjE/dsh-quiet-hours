# dsh-quiet-hours

> Work-hours away mode for WeChat bots: at the configured windows the AI is skipped entirely and
> every incoming message gets one fixed reply.

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin for WeChatAgent sessions.
On weekdays between `09:00–12:00` and `14:00–18:00` (configurable) it does **not** call the model.
Instead it sends a canned line through WeChatAgent's native hook and rejects the step, so the persona
never sees the message. Outside the windows everything behaves exactly as before.

```
weekdays 09:00 ───────────── 12:00     14:00 ───────────── 18:00
         away mode: one fixed reply            away mode: one fixed reply
         (no model call, no tokens)            (no model call, no tokens)
```

## Features

- Configurable windows, time zone, holidays and make-up workdays.
- True model bypass: the plugin rejects `agent/pre-step` instead of prompting the persona.
- Fixed reply sent via `POST /SendTextMsg` on the local WeChatAgent hook.
- Private chats always answered; group chats only when mentioned (or `always` / `never`).
- Per-chat cooldown and hourly cap to avoid spam and duplicate sends.
- Two tools: `quiet_hours_status`, `quiet_hours_control` (force on/off, back to schedule).
- Fails safe: internal errors fall back to the normal flow.

## Why not stop WeChatAgent at 09:00?

If the reader/bridge processes are stopped, nobody reads incoming messages, so the plugin cannot know
that someone wrote, and the fixed reply can never be triggered. Keeping the message pipeline alive and
only skipping the model step keeps the bot responsive without spending tokens.

## Requirements

| Component | Version |
|---|---|
| DeepSeek Harness | `0.2.0-rc.2` (tested) |
| WeChatAgent | `0.3.9` (tested) |
| WeChat + native hook | `4.1.10.27` |
| Node.js | `>= 20` |

The plugin has no runtime dependencies and only talks to `127.0.0.1`.

## Install

Full local deployment guide: [docs/deploy.md](docs/deploy.md) (Chinese). Short version:

```powershell
git clone https://github.com/rnfmabjE/dsh-quiet-hours.git D:\tools\dsh-quiet-hours
New-Item -ItemType Junction `
  -Path  "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-quiet-hours" `
  -Target "D:\tools\dsh-quiet-hours"
```

Then add `"dsh-quiet-hours"` to `dsh.profile.bundles`, edit `cordis.patch.yml`
(`reply`, `accountNames`, `windows`), and fully quit/reopen DSH from the tray.

See the [Chinese README](README.md) for the configuration table and troubleshooting.

## Configuration (short version)

```yaml
- insert:
    - id: quiet-hours
      name: dsh-quiet-hours
      config:
        projectRoot: 'D:/WeChat Agent/data/workspace'
        windows:
          - { days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' }
          - { days: [1, 2, 3, 4, 5], start: '14:00', end: '18:00' }
        reply: '梁文峰不是我兄弟，梁文谷才是'
        groupReply: wake
        accountNames: []
```

`WECHAT_AGENT_ROOT` can replace `projectRoot` on machines with a different install path.

### Changing the fixed reply

The default line is the `reply` field of `cordis.patch.yml` (shown above) — edit that one value,
save, then fully quit and reopen DSH. Use `quiet_hours_status` to confirm `config.reply`.

For a single conversation, leave `reply` alone and add `replyByChat`:

```yaml
replyByChat:
  wechat:private:1000000001: 'Busy right now, will reply later.'
```

The text is collapsed to a single line and capped at 300 characters. The fallback in
`index.js` (`DEFAULTS.reply`) is only used when `reply` is absent from the config.

## Tests

```bash
npm test
```

Runs schedule/gate/rate-limit unit tests plus a wiring test that drives `agent/pre-step` with a fake
context — no WeChat connection and no messages are sent.

## Security

Only loopback calls to the local reader (`5031`) and hook (`30001`). No outbound network, no
telemetry, no credentials in the repository. Runtime state is written to WeChatAgent's
`state/away/` and ignored by git.

## Third-party notices

MIT applies to **this repository only**:

- The plugin requires a locally installed **WeChatAgent** (third-party Windows project by Derpyu520,
  distributed under MIT with its own copyright line). This repository does not bundle or redistribute
  its source, installer, native DLLs or runtime, and is not affiliated with or endorsed by it.
- No WeChat client or native hook is included. Unofficial automation may violate platform terms and
  puts the account at risk.
- The plugin runs on **DeepSeek Harness**; DSH and its model service have their own licenses and terms.
- Runtime uses Node.js built-ins only — no npm dependencies.

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) (Chinese) for the full text.

## License

[MIT](LICENSE)
