// 纯判定逻辑：这一步该正常交给模型、直接回固定文案，还是静默拦截。
// 拆出来是为了能脱离 DSH 单测。

export function inboundText(messages) {
  const parts = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const source = message?.source ?? {};
    if (source.kind !== 'wechat-social-bridge') continue;
    if (source.socialBootstrap || source.socialPersonaRetired) continue;
    for (const block of Array.isArray(message?.content) ? message.content : []) {
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}

export function isWechatMessages(messages) {
  return (Array.isArray(messages) ? messages : []).some(message => message?.source?.kind === 'wechat-social-bridge');
}

// 群聊里点名：正文里出现本账号的昵称/唤醒词。
// 微信的 @ 会以「@昵称」出现在正文里，所以匹配到昵称就等价于被 @。
// anyMention=true 时退化为“任意 @ 都算”，只在明确配置时启用（会误认 @ 别人的消息）。
export function woken(text, { names = [], anyMention = false } = {}) {
  const body = String(text ?? '');
  if (!body) return false;
  for (const name of names) {
    if (name && body.includes(name)) return true;
  }
  return anyMention === true && /@\S/.test(body);
}

export const ACTIONS = ['reply', 'silent', 'open'];

/**
 * @returns {{action:'reply'|'silent'|'open', reason:string, key?:string, kind?:string, text:string}}
 */
export function gateDecision({ key, kind, messages, away, groupReply = 'wake', policy = {} }) {
  const text = inboundText(messages);
  if (!away) return { action: 'open', reason: 'outside_window', text };
  if (!key) return { action: 'open', reason: 'unknown_conversation', text };
  if (kind !== 'private' && kind !== 'group') return { action: 'open', reason: 'not_wechat', text };
  if (kind === 'group') {
    if (groupReply === 'never') return { action: 'silent', reason: 'group_silent', key, kind, text };
    const names = [...(policy.nicknames ?? []), ...(policy.wakeWords ?? []), ...(policy.accountNames ?? [])]
      .map(name => String(name ?? '').trim()).filter(Boolean);
    if (groupReply === 'wake' && !woken(text, { names, anyMention: policy.groupWakeAnyMention === true })) {
      return { action: 'silent', reason: 'group_not_woken', key, kind, text };
    }
  }
  return { action: 'reply', reason: kind === 'group' ? 'group_woken' : 'private', key, kind, text };
}
