// 接线测试：用假 ctx 把 apply() 跑起来，直接触发 agent/pre-step，
// 验证“时段内微信会话会被拦住、时段外/非微信会话完全不碰”。
// 不会连微信、不会发消息（临时工作区里没有 reader 配置，发送必然失败并记审计）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../index.js';

function makeRoot({ whitelistPrivate = ['123456'], mapping = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'away-wire-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'state', 'away'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'wechatagent.json'), JSON.stringify({
    account: { nicknames: ['小助手'] },
    hook: { baseUrl: 'http://127.0.0.1:30001' },
    wechat: { wake_words: ['小助手'], whitelist: { groups: ['999'], private: whitelistPrivate } },
  }));
  if (mapping) {
    const dir = path.join(root, 'state', 'accounts', 'scope');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'dsh-sessions.json'), JSON.stringify({
      version: 2,
      conversations: { 'wechat:private:123456': 'social-test-session' },
      profiles: {},
    }));
  }
  return root;
}

function makeCtx() {
  const handlers = [];
  const tools = [];
  const ctx = {
    on(event, fn) { handlers.push({ event, fn }); },
    effect(fn) { const dispose = fn(); return () => dispose?.(); },
    tools: { register(definition) { tools.push(definition); } },
    get() { return undefined; },
    logger() { return { warn() {}, info() {} }; },
  };
  return { ctx, handlers, tools };
}

const relay = text => [{
  role: 'user',
  id: 'm1',
  source: { kind: 'wechat-social-bridge', form: 'relay' },
  content: [{ type: 'text', text }],
}];

const desktop = () => [{ role: 'user', id: 'm2', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] }];

function findPreStep(handlers) {
  const hit = handlers.find(item => item.event === 'agent/pre-step');
  assert.ok(hit, '应当注册 agent/pre-step');
  return hit.fn;
}

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (error) { console.error('  FAIL ' + name + '\n       ' + (error?.stack ?? error)); process.exitCode = 1; }
};

console.log('接线');

await test('时段内 + 微信私聊 → reject（AI 不上场）', async () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'state', 'away', 'override.json'), JSON.stringify({ mode: 'away' }));
  const { ctx, handlers, tools } = makeCtx();
  apply(ctx, { projectRoot: root, enabled: true });
  assert.equal(tools.length, 2, '应当注册两个工具');

  const preStep = findPreStep(handlers);
  const result = await preStep({ agent: { session: { id: 'social-test-session' } }, messages: relay('在吗') }, async () => ({ kind: 'enter', messages: [] }));
  assert.equal(result.kind, 'reject');

  const audit = fs.readFileSync(path.join(root, 'state', 'away', 'audit.jsonl'), 'utf8');
  assert.match(audit, /"action":"failed"/);
  assert.match(audit, /AWAY_READER/);
  fs.rmSync(root, { recursive: true, force: true });
});

await test('时段外 → 原样放行', async () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'state', 'away', 'override.json'), JSON.stringify({ mode: 'open' }));
  const { ctx, handlers } = makeCtx();
  apply(ctx, { projectRoot: root, enabled: true });
  const preStep = findPreStep(handlers);
  let called = 0;
  const result = await preStep({ agent: { session: { id: 'social-test-session' } }, messages: relay('在吗') }, async () => {
    called++;
    return { kind: 'enter', messages: relay('在吗') };
  });
  assert.equal(called, 1);
  assert.equal(result.kind, 'enter');
  fs.rmSync(root, { recursive: true, force: true });
});

await test('非微信会话完全不碰', async () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'state', 'away', 'override.json'), JSON.stringify({ mode: 'away' }));
  const { ctx, handlers } = makeCtx();
  apply(ctx, { projectRoot: root, enabled: true });
  const preStep = findPreStep(handlers);
  let called = 0;
  const result = await preStep({ agent: { session: { id: 'desktop-session' } }, messages: desktop() }, async () => {
    called++;
    return { kind: 'enter', messages: desktop() };
  });
  assert.equal(called, 1);
  assert.equal(result.kind, 'enter');
  fs.rmSync(root, { recursive: true, force: true });
});

await test('不在白名单的会话放行', async () => {
  const root = makeRoot({ whitelistPrivate: ['999999'] });
  fs.writeFileSync(path.join(root, 'state', 'away', 'override.json'), JSON.stringify({ mode: 'away' }));
  const { ctx, handlers } = makeCtx();
  apply(ctx, { projectRoot: root, enabled: true });
  const preStep = findPreStep(handlers);
  let called = 0;
  await preStep({ agent: { session: { id: 'social-test-session' } }, messages: relay('在吗') }, async () => {
    called++;
    return { kind: 'enter', messages: [] };
  });
  assert.equal(called, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

await test('群聊没被点名 → 静默 reject（不发消息）', async () => {
  const root = makeRoot({ whitelistPrivate: [] });
  fs.writeFileSync(path.join(root, 'config', 'wechatagent.json'), JSON.stringify({
    account: { nicknames: ['小助手'] },
    wechat: { wake_words: ['小助手'], whitelist: { groups: ['123456'], private: [] } },
  }));
  const dir = path.join(root, 'state', 'accounts', 'scope');
  fs.writeFileSync(path.join(dir, 'dsh-sessions.json'), JSON.stringify({
    version: 2,
    conversations: { 'wechat:group:123456': 'social-group-session' },
    profiles: {},
  }));
  fs.writeFileSync(path.join(root, 'state', 'away', 'override.json'), JSON.stringify({ mode: 'away' }));
  const { ctx, handlers } = makeCtx();
  apply(ctx, { projectRoot: root, enabled: true });
  const preStep = findPreStep(handlers);
  const result = await preStep({ agent: { session: { id: 'social-group-session' } }, messages: relay('今天吃什么') }, async () => ({ kind: 'enter', messages: [] }));
  assert.equal(result.kind, 'reject');
  const audit = fs.readFileSync(path.join(root, 'state', 'away', 'audit.jsonl'), 'utf8');
  assert.match(audit, /group_not_woken/);
  assert.doesNotMatch(audit, /"action":"reply"/);
  fs.rmSync(root, { recursive: true, force: true });
});

await test('enabled=false 时完全放行', async () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'state', 'away', 'override.json'), JSON.stringify({ mode: 'away' }));
  const { ctx, handlers } = makeCtx();
  apply(ctx, { projectRoot: root, enabled: false });
  const preStep = findPreStep(handlers);
  let called = 0;
  await preStep({ agent: { session: { id: 'social-test-session' } }, messages: relay('在吗') }, async () => {
    called++;
    return { kind: 'enter', messages: [] };
  });
  assert.equal(called, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

console.log(`\n${passed} 项通过${process.exitCode ? '，有失败' : ''}`);
