// 只读 WeChatAgent 的既有配置与状态、只调它的原生 hook 发文字。
// 不修改 WeChatAgent 的任何文件。
import fs from 'node:fs';
import path from 'node:path';

const KEY = /^(wechat|qq):(private|group):(.{1,256})$/;
const readText = file => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();

export function readJsonFile(file) {
  try { return JSON.parse(readText(file)); } catch { return null; }
}

export function projectPaths(root) {
  return {
    io: path.join(root, 'state', 'wechat-io-config.json'),
    config: path.join(root, 'config', 'wechatagent.json'),
    hookToken: path.join(root, 'state', 'hook', 'native-token.txt'),
    accounts: path.join(root, 'state', 'accounts'),
  };
}

export function wechatPolicy(root) {
  const config = readJsonFile(projectPaths(root).config) ?? {};
  const nicknames = (config.account?.nicknames ?? []).map(String).filter(Boolean);
  const wakeWords = (config.wechat?.wake_words ?? []).map(String).filter(Boolean);
  const whitelist = {
    group: new Set((config.wechat?.whitelist?.groups ?? []).map(String)),
    private: new Set((config.wechat?.whitelist?.private ?? []).map(String)),
  };
  return { nicknames, wakeWords, whitelist, hookBaseUrl: String(config.hook?.baseUrl ?? 'http://127.0.0.1:30001') };
}

function loopbackOf(url, code) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/' ||
      parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(code);
  return parsed.origin;
}

async function jsonFetch(url, options, timeoutMs, signal) {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 200) }; }
  return { ok: response.ok, status: response.status, body };
}

export async function readerGet(root, route, signal, timeoutMs = 5000) {
  const io = readJsonFile(projectPaths(root).io);
  if (!io?.reader_base_url || !io?.reader_token) throw new Error('AWAY_READER_NOT_CONFIGURED');
  const origin = loopbackOf(io.reader_base_url, 'AWAY_READER_LOOPBACK_REQUIRED');
  const result = await jsonFetch(origin + route, { headers: { Authorization: 'Bearer ' + io.reader_token } }, timeoutMs, signal);
  if (!result.ok) throw new Error('AWAY_READER_HTTP_' + result.status);
  return result.body ?? {};
}

export async function readerStatus(root, signal) {
  const status = await readerGet(root, '/api/v1/reader/status', signal, 4000);
  const account = String(status?.accountDirectory ?? '').toLowerCase();
  if (!account) throw new Error('AWAY_ACCOUNT_UNVERIFIED');
  return { account, raw: status };
}

let sessionCache = { at: 0, root: '', list: [] };

export async function readerSessions(root, signal, { fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && sessionCache.root === root && now - sessionCache.at < 60000 && sessionCache.list.length) return sessionCache.list;
  const data = await readerGet(root, '/api/v1/sessions?limit=500', signal, 6000);
  const list = (Array.isArray(data?.sessions) ? data.sessions : [])
    .filter(item => item && item.username)
    .map(item => ({
      username: String(item.username),
      conversationId: String(item.conversationId ?? ''),
      displayName: String(item.displayName ?? ''),
      kind: String(item.username).includes('@chatroom') ? 'group' : 'private',
    }));
  sessionCache = { at: now, root, list };
  return list;
}

export function parseConversationKey(key) {
  const match = KEY.exec(String(key ?? ''));
  if (!match) return null;
  return { platform: match[1], kind: match[2], conversationId: match[3], key: String(key) };
}

// 会话 key → 真实的微信 username（私聊是人/账号 id，群是 xxx@chatroom）。
export async function resolveConversation(root, key, signal) {
  const parsed = parseConversationKey(key);
  if (!parsed) throw new Error('AWAY_CONVERSATION_KEY_INVALID');
  const hits = (await readerSessions(root, signal)).filter(item =>
    item.conversationId === parsed.conversationId && item.kind === parsed.kind);
  if (!hits.length) throw new Error('AWAY_CONVERSATION_NOT_FOUND');
  const chat = hits[0];
  return { ...parsed, wxid: chat.username, name: chat.displayName || parsed.conversationId };
}

// DSH 会话 id → WeChatAgent 的会话 key。桥接插件把映射写在 state/accounts/<scope>/dsh-sessions.json。
let mapCache = { at: 0, root: '', map: new Map() };

export function sessionKeyFor(root, sessionId, { fresh = false } = {}) {
  const sid = String(sessionId ?? '');
  if (!sid) return null;
  const now = Date.now();
  if (fresh || mapCache.root !== root || now - mapCache.at > 30000) {
    const map = new Map();
    const dir = projectPaths(root).accounts;
    let scopes = [];
    try { scopes = fs.readdirSync(dir, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name); } catch { scopes = []; }
    for (const scope of scopes) {
      const file = path.join(dir, scope, 'dsh-sessions.json');
      const saved = readJsonFile(file);
      if (!saved?.conversations || typeof saved.conversations !== 'object') continue;
      for (const [key, value] of Object.entries(saved.conversations)) {
        if (typeof value === 'string' && KEY.test(key)) map.set(value, key);
      }
    }
    mapCache = { at: now, root, map };
  }
  return mapCache.map.get(sid) ?? null;
}

export function titleKindOf(title) {
  const text = String(title ?? '');
  if (!text.startsWith('微信')) return null;
  return text.startsWith('微信群聊') ? 'group' : 'private';
}

export async function sendWechatText(root, { wxid, text, signal, attempts = 2 }) {
  const policy = wechatPolicy(root);
  const origin = loopbackOf(policy.hookBaseUrl, 'AWAY_HOOK_LOOPBACK_REQUIRED');
  let token;
  try { token = readText(projectPaths(root).hookToken); } catch { throw new Error('AWAY_HOOK_TOKEN_MISSING'); }
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('AWAY_HOOK_TOKEN_MISSING');
  const { account } = await readerStatus(root, signal);

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await jsonFetch(origin + '/SendTextMsg', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'X-WeChatAgent-Account': account,
        },
        body: JSON.stringify({ wxidorgid: wxid, msg: text }),
      }, 8000, signal);
      if (!result.ok) throw new Error('AWAY_HOOK_HTTP_' + result.status);
      if (result.body?.ret !== 0) throw new Error('AWAY_HOOK_REJECTED');
      return { ok: true, attempt, account };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 350));
    }
  }
  throw lastError ?? new Error('AWAY_HOOK_FAILED');
}

export async function probe(root, signal) {
  const report = { root, reader: false, hook: false, account: null, sessions: 0, mapping: 0 };
  try {
    const status = await readerStatus(root, signal);
    report.reader = true;
    report.account = status.account;
  } catch (error) { report.readerError = String(error?.message ?? error); }
  try {
    const list = await readerSessions(root, signal, { fresh: true });
    report.sessions = list.length;
  } catch { /* 已在上面的 readerError 里 */ }
  try {
    const policy = wechatPolicy(root);
    const origin = loopbackOf(policy.hookBaseUrl, 'AWAY_HOOK_LOOPBACK_REQUIRED');
    const token = readText(projectPaths(root).hookToken);
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('AWAY_HOOK_TOKEN_MISSING');
    const result = await jsonFetch(origin + '/QueryDB/status', { method: 'GET', headers: { Authorization: 'Bearer ' + token } }, 4000, signal);
    // 只要收到了 HTTP 响应就算 hook 在监听；401/404 属于路由差异，不代表进程没起来。
    report.hook = result.status > 0 && result.status < 500;
    report.hookStatus = result.body ?? null;
  } catch (error) { report.hookError = String(error?.message ?? error); }
  try {
    const dir = projectPaths(root).accounts;
    for (const scope of fs.readdirSync(dir, { withFileTypes: true }).filter(item => item.isDirectory())) {
      const saved = readJsonFile(path.join(dir, scope.name, 'dsh-sessions.json'));
      if (saved?.conversations) report.mapping += Object.keys(saved.conversations).length;
    }
  } catch { /* 没映射文件就当 0 */ }
  return report;
}
