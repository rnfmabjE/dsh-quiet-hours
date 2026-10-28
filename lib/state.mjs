// 状态文件：state/away/ 下的 mode.json、replies.json、audit.jsonl。
import fs from 'node:fs';
import path from 'node:path';

export const awayDir = root => path.join(root, 'state', 'away');

export function readJson(file, fallback = null) {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : fallback;
  } catch { return fallback; }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

export function appendAudit(root, entry) {
  try {
    const file = path.join(awayDir(root), 'audit.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
  } catch { /* 审计失败不影响聊天 */ }
}

export function readAudit(root, limit = 8) {
  try {
    const file = path.join(awayDir(root), 'audit.jsonl');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-limit);
    return lines.map(line => { try { return JSON.parse(line); } catch { return { raw: line }; } }).reverse();
  } catch { return []; }
}

export function writeMode(root, value) {
  try { writeJson(path.join(awayDir(root), 'mode.json'), value); } catch { /* 只用于展示 */ }
}

export function readMode(root) {
  return readJson(path.join(awayDir(root), 'mode.json'));
}

// 每个会话的最近回复时间：{ keys: { 'wechat:private:123': [ts, ...] } }
// settings 既接受 allowReply 自己的短名，也接受插件 settings 里的长名。
export function allowReply(root, key, settings = {}, now = Date.now()) {
  const file = path.join(awayDir(root), 'replies.json');
  const store = readJson(file, { keys: {} });
  store.keys = store.keys && typeof store.keys === 'object' ? store.keys : {};
  const cooldownSeconds = settings.cooldownSeconds ?? settings.replyCooldownSeconds;
  const maxPerHour = settings.maxPerHour ?? settings.maxRepliesPerChatPerHour;
  const cooldown = Math.max(0, Number(cooldownSeconds) || 0) * 1000;
  const hour = (Array.isArray(store.keys[key]) ? store.keys[key] : [])
    .map(Number)
    .filter(value => Number.isFinite(value) && now - value < 3600000);

  if (cooldown > 0 && hour.length) {
    const last = Math.max(...hour);
    if (now - last < cooldown) {
      store.keys[key] = hour;
      writeJson(file, store);
      return { ok: false, reason: 'cooldown', waitSeconds: Math.ceil((cooldown - (now - last)) / 1000) };
    }
  }
  const cap = Math.max(1, Number(maxPerHour) || 12);
  if (hour.length >= cap) {
    store.keys[key] = hour;
    writeJson(file, store);
    return { ok: false, reason: 'hourly_cap', waitSeconds: Math.ceil((3600000 - (now - Math.min(...hour))) / 1000) };
  }
  return { ok: true, store, file, hour };
}

export function recordReply(root, key, entry = {}, now = Date.now()) {
  const file = path.join(awayDir(root), 'replies.json');
  const store = readJson(file, { keys: {} });
  store.keys = store.keys && typeof store.keys === 'object' ? store.keys : {};
  const hour = (Array.isArray(store.keys[key]) ? store.keys[key] : [])
    .map(Number).filter(value => Number.isFinite(value) && now - value < 3600000);
  hour.push(now);
  store.keys[key] = hour;
  store.last = { key, at: now, ...entry };
  try { writeJson(file, store); } catch { /* 限流状态丢了最多多回一条 */ }
  return store;
}
