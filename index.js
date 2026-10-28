import fs from 'node:fs';
import path from 'node:path';
import { describe, evaluate, normalizeSchedule } from './lib/schedule.mjs';
import { allowReply, appendAudit, awayDir, readAudit, readJson, readMode, recordReply, writeJson, writeMode } from './lib/state.mjs';
import { gateDecision, inboundText, isWechatMessages } from './lib/gate.mjs';
import {
  parseConversationKey, probe, readerSessions, resolveConversation, sessionKeyFor,
  sendWechatText, titleKindOf, wechatPolicy,
} from './lib/wechat.mjs';

// 微信工作时段自动回复：
// 工作日 09:00–12:00、14:00–18:00 不让 AI 上场（agent/pre-step 直接拒绝这一步，不跑模型），
// 改由本插件用 WeChatAgent 的原生 hook /SendTextMsg 直接回一条固定文案。
// AI 的会话、人格、上下文全部保持原样，时段外自动恢复。

// WeChatAgent 的 data/workspace 目录。优先读环境变量，方便跨机器部署。
const DEFAULT_ROOT = String(process.env.WECHAT_AGENT_ROOT ?? '').trim() || 'D:/WeChat Agent/data/workspace';

const DEFAULTS = {
  projectRoot: DEFAULT_ROOT,
  enabled: true,
  timeZone: 'Asia/Shanghai',
  windows: [
    { days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' },
    { days: [1, 2, 3, 4, 5], start: '14:00', end: '18:00' },
  ],
  reply: '梁文峰不是我兄弟，梁文谷才是',
  replyByChat: {},
  groupReply: 'wake', // wake=群里被 @/唤醒才回；always=都回；never=群里不回
  accountNames: [], // 本账号在群里的昵称（和 wake_words 一起用来判断有没有被 @）
  groupWakeAnyMention: false, // 没配昵称时是否“任意 @ 都算叫我”
  replyCooldownSeconds: 180,
  maxRepliesPerChatPerHour: 12,
  holidays: [],
  extraWorkdays: [],
  fallbackToAgent: false, // 固定文案发不出去时，是否退回让 AI 正常回复
  log: true,
};

function settingsOf(config = {}) {
  const merged = {
    ...DEFAULTS,
    ...config,
    windows: Array.isArray(config.windows) && config.windows.length ? config.windows : DEFAULTS.windows,
    replyByChat: config.replyByChat && typeof config.replyByChat === 'object' ? config.replyByChat : {},
    holidays: Array.isArray(config.holidays) ? config.holidays : DEFAULTS.holidays,
    extraWorkdays: Array.isArray(config.extraWorkdays) ? config.extraWorkdays : DEFAULTS.extraWorkdays,
  };
  merged.projectRoot = typeof config.projectRoot === 'string' && config.projectRoot.trim()
    ? config.projectRoot.trim()
    : DEFAULT_ROOT;
  merged.reply = String(merged.reply ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  merged.groupReply = ['wake', 'always', 'never'].includes(merged.groupReply) ? merged.groupReply : 'wake';
  merged.accountNames = (Array.isArray(config.accountNames) ? config.accountNames : DEFAULTS.accountNames)
    .map(name => String(name ?? '').trim()).filter(Boolean).slice(0, 20);
  merged.groupWakeAnyMention = config.groupWakeAnyMention === true;
  merged.replyCooldownSeconds = Math.min(3600, Math.max(0, Number(merged.replyCooldownSeconds)));
  merged.maxRepliesPerChatPerHour = Math.min(200, Math.max(1, Number(merged.maxRepliesPerChatPerHour) || 12));
  merged.schedule = normalizeSchedule(merged);
  return merged;
}

function sessionTitle(ctx, session) {
  if (!session) return '';
  try {
    const service = ctx.get?.('sessionTitle');
    if (service?.get) {
      const value = service.get(session);
      if (typeof value === 'string' && value) return value;
      if (value && typeof value.title === 'string' && value.title) return value.title;
    }
  } catch { /* 服务不可用就往下试 */ }
  if (typeof session.title === 'string' && session.title) return session.title;
  try {
    const events = session.snapshotEvents?.() ?? [];
    for (let index = events.length - 1; index >= 0; index--) {
      if (events[index]?.type === 'session/title' && typeof events[index].data?.title === 'string') return events[index].data.title;
    }
  } catch { /* 读不到就当没有 */ }
  return '';
}

function parseTitle(title) {
  const match = /^微信(群聊|私聊)｜(.+?)(?:｜|$)/.exec(String(title ?? ''));
  if (!match) return null;
  return { kind: match[1] === '群聊' ? 'group' : 'private', name: match[2] };
}

export const name = 'dsh-quiet-hours';
export const inject = ['tools'];

export function apply(ctx, config = {}) {
  const settings = settingsOf(config);
  const root = settings.projectRoot;
  const output = (value, isError = false) => ({ content: JSON.stringify(value, null, 2), isError });

  try { fs.mkdirSync(awayDir(root), { recursive: true }); } catch { /* 状态目录只用于排错 */ }
  try {
    fs.writeFileSync(path.join(awayDir(root), 'loaded.json'),
      JSON.stringify({ at: new Date().toISOString(), pid: process.pid, cooldown: settings.replyCooldownSeconds }));
  } catch { /* 标记文件只用于排错 */ }

  const warn = (message, detail) => {
    if (!settings.log) return;
    try { ctx.logger?.('quiet-hours')?.warn?.(message, detail ?? ''); } catch { /* 没 logger 就算了 */ }
  };

  // ---- 手动覆盖：state/away/override.json ----
  function overrideOf(now = Date.now()) {
    const value = readJson(path.join(awayDir(root), 'override.json'), null);
    if (!value || !['away', 'open', 'auto'].includes(value.mode)) return null;
    if (value.mode === 'auto') return null;
    const until = Number(value.until ?? 0);
    if (Number.isFinite(until) && until > 0 && until <= now) return null;
    return { mode: value.mode, until: Number.isFinite(until) && until > 0 ? until : null, note: value.note ?? null };
  }

  function currentState(now = new Date()) {
    const base = evaluate(settings.schedule, now);
    const override = overrideOf(now.getTime());
    const away = override ? override.mode === 'away' : base.away;
    return { away, base, override, window: base.window?.label ?? null, reason: override ? 'override' : base.reason };
  }

  function replyFor(key) {
    const custom = settings.replyByChat?.[key];
    return String(custom ?? settings.reply ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  }

  // ---- 核心闸门 ----
  // 返回 true = 这一步直接拒绝（不调模型）。任何异常都由外层兜住并放行。
  async function shouldGate(list, session) {
    if (!settings.enabled) return false;
    if (!session || !list.length) return false;
    if (!isWechatMessages(list)) return false;

    const now = new Date();
    const state = currentState(now);
    if (!state.away) return false;

    const sid = String(session.id ?? '');
    const title = sessionTitle(ctx, session);
    let key = sessionKeyFor(root, sid);
    if (!key) {
      const parsed = parseTitle(title);
      if (parsed) {
        try {
          const known = await readerSessions(root, undefined);
          const hit = known.find(item => item.kind === parsed.kind && item.displayName === parsed.name);
          if (hit) key = `wechat:${hit.kind}:${hit.conversationId}`;
        } catch { /* 标题兜底失败就按未知处理 */ }
      }
    }
    const parsedKey = parseConversationKey(key);
    const kind = parsedKey?.kind ?? titleKindOf(title);
    const policy = wechatPolicy(root);

    if (!parsedKey || !kind || !policy.whitelist[kind]?.has(parsedKey.conversationId)) {
      // 不是白名单里的微信会话：不拦，交回原流程。
      appendAudit(root, { action: 'skip', reason: 'conversation_unverified', sid, title: title.slice(0, 60) });
      return false;
    }

    const text = inboundText(list);
    const verdict = gateDecision({
      key, kind, messages: list, away: state.away, groupReply: settings.groupReply,
      policy: {
        nicknames: policy.nicknames,
        wakeWords: policy.wakeWords,
        accountNames: settings.accountNames,
        groupWakeAnyMention: settings.groupWakeAnyMention,
      },
    });

    if (verdict.action === 'open') return false;

    if (verdict.action === 'silent') {
      appendAudit(root, { action: 'silent', reason: verdict.reason, key, kind, chars: text.length, window: state.window });
      return true;
    }

    const line = replyFor(key);
    if (!line) {
      appendAudit(root, { action: 'silent', reason: 'empty_reply', key });
      return true;
    }

    const limit = allowReply(root, key, {
      cooldownSeconds: settings.replyCooldownSeconds,
      maxPerHour: settings.maxRepliesPerChatPerHour,
    }, now.getTime());
    if (!limit.ok) {
      appendAudit(root, { action: 'silent', reason: limit.reason, key, waitSeconds: limit.waitSeconds });
      return true;
    }

    try {
      const chat = await resolveConversation(root, key, undefined);
      await sendWechatText(root, { wxid: chat.wxid, text: line });
      recordReply(root, key, { text: line, name: chat.name, window: state.window }, Date.now());
      appendAudit(root, { action: 'reply', key, kind, name: chat.name, wxid: chat.wxid, chars: line.length, window: state.window, mode: 'fixed' });
      return true;
    } catch (error) {
      const code = String(error?.message ?? error);
      appendAudit(root, { action: 'failed', key, kind, error: code.slice(0, 160), window: state.window });
      warn('fixed reply failed:', code);
      // 默认仍然拦住 AI：工作时段就是要它闭嘴。fallbackToAgent=true 时才放行。
      return !settings.fallbackToAgent;
    }
  }

  // 在 next() 之前判断，避免桥接插件为一轮注定不跑的对话做初始化；next() 保证只调一次。
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    try {
      if (await shouldGate(Array.isArray(messages) ? messages : [], agent?.session)) return { kind: 'reject' };
    } catch (error) {
      // 闸门自身出错绝不影响正常聊天：放行。
      warn('gate skipped:', String(error?.message ?? error));
    }
    return next();
  }, { global: true });

  // ---- 状态心跳：把当前模式写到 state/away/mode.json，方便排错 ----
  let nextChangeAt = null;
  let nextChangeCheckedAt = 0;
  const tick = () => {
    try {
      const now = new Date();
      const state = currentState(now);
      const nowMs = Date.now();
      const flipMs = nextChangeAt ? Date.parse(nextChangeAt) : 0;
      if (!nextChangeAt || nowMs >= flipMs || nowMs - nextChangeCheckedAt > 300000) {
        nextChangeAt = describe(settings.schedule, now).nextChangeAt;
        nextChangeCheckedAt = nowMs;
      }
      const previous = readMode(root);
      const payload = {
        enabled: settings.enabled,
        mode: state.away ? 'away' : 'open',
        away: state.away,
        reason: state.reason,
        window: state.window,
        override: state.override,
        checkedAt: now.toISOString(),
        nextChangeAt,
        reply: settings.reply,
        groupReply: settings.groupReply,
        replyCooldownSeconds: settings.replyCooldownSeconds,
      };
      if (!previous || previous.mode !== payload.mode || previous.window !== payload.window ||
          previous.nextChangeAt !== payload.nextChangeAt || previous.enabled !== payload.enabled ||
          (state.override?.mode ?? null) !== (previous.override?.mode ?? null)) {
        writeMode(root, payload);
      }
    } catch (error) {
      warn('heartbeat failed:', String(error?.message ?? error));
    }
  };
  tick();
  ctx.effect(() => {
    const timer = setInterval(tick, 30000);
    timer.unref?.();
    return () => clearInterval(timer);
  });

  // ---- 工具 ----
  const commonOutput = {
    schema: {
      type: 'object',
      properties: { content: { type: 'string' }, isError: { type: 'boolean' } },
      required: ['content', 'isError'],
      additionalProperties: false,
    },
    render: (_args, value) => [{ type: 'text', text: value.content }],
  };

  ctx.tools.register({
    name: 'quiet_hours_status',
    description: '查看微信工作时段自动回复插件的状态：现在是不是免打扰时段、下一段作息、固定文案、群里是否只在 @/唤醒时回、最近几条拦截/发送记录，以及 reader / hook 是否在线。只读，不会发消息。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: commonOutput,
    async execute() {
      const now = new Date();
      const state = currentState(now);
      const described = describe(settings.schedule, now);
      const report = {
        enabled: settings.enabled,
        mode: state.away ? 'away' : 'open',
        away: state.away,
        reason: state.reason,
        window: state.window,
        timeZone: settings.timeZone,
        now: described.clock,
        day: described.day,
        weekday: described.weekday,
        nextChangeAt: described.nextChangeAt,
        config: {
          windows: settings.windows,
          reply: settings.reply,
          groupReply: settings.groupReply,
          replyCooldownSeconds: settings.replyCooldownSeconds,
          maxRepliesPerChatPerHour: settings.maxRepliesPerChatPerHour,
          fallbackToAgent: settings.fallbackToAgent,
        },
        override: state.override,
        lastReply: readJson(path.join(awayDir(root), 'replies.json'), null)?.last ?? null,
        recent: readAudit(root, 6),
      };
      report.probe = await probe(root, undefined).catch(error => ({ error: String(error?.message ?? error) }));
      return output(report);
    },
  });

  ctx.tools.register({
    name: 'quiet_hours_control',
    description: '手动切换微信工作时段自动回复：action=on 强制免打扰（只回固定文案、AI 不上场），off 强制恢复 AI 对话，auto 清除强制、回到作息表，status 只看状态。可给 minutes 限定强制多久（默认 120，最多 10080）。只在本机生效，不会发微信消息。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['on', 'off', 'auto', 'status'] },
        minutes: { type: 'integer', minimum: 1, maximum: 10080 },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: commonOutput,
    async execute(args) {
      const action = String(args?.action ?? 'status');
      const file = path.join(awayDir(root), 'override.json');
      try {
        if (action === 'on' || action === 'off') {
          const minutes = Math.min(10080, Math.max(1, Number(args?.minutes) || 120));
          const until = Date.now() + minutes * 60000;
          writeJson(file, { mode: action === 'on' ? 'away' : 'open', until, note: 'manual', at: new Date().toISOString() });
        } else if (action === 'auto') {
          try { fs.rmSync(file, { force: true }); } catch { /* 没有就算了 */ }
        }
        tick();
        const state = currentState(new Date());
        return output({
          ok: true,
          action,
          mode: state.away ? 'away' : 'open',
          reason: state.reason,
          window: state.window,
          override: state.override,
          stateFile: path.join(awayDir(root), 'mode.json'),
        });
      } catch (error) {
        return output({ ok: false, error: String(error?.message ?? error) }, true);
      }
    },
  });
}

export { settingsOf, gateDecision, inboundText };
