// 不依赖 DSH / 微信的单测：判定、作息、限流。
// 运行：node test/smoke.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, evaluate, normalizeSchedule, toMinutes } from '../lib/schedule.mjs';
import { gateDecision, inboundText, woken } from '../lib/gate.mjs';
import { allowReply, recordReply } from '../lib/state.mjs';
import { parseConversationKey } from '../lib/wechat.mjs';
import { settingsOf } from '../index.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (error) { console.error('  FAIL ' + name + '\n       ' + (error?.stack ?? error)); process.exitCode = 1; }
}

const WINDOWS = [
  { days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' },
  { days: [1, 2, 3, 4, 5], start: '14:00', end: '18:00' },
];
const schedule = normalizeSchedule({ timeZone: 'Asia/Shanghai', windows: WINDOWS });

const at = stamp => new Date(stamp);

console.log('作息判定');

test('09:00 前是 open', () => {
  assert.equal(evaluate(schedule, at('2026-10-23T08:59:00+08:00')).away, false);
});

test('09:00 整点进入 away', () => {
  const state = evaluate(schedule, at('2026-10-23T09:00:00+08:00'));
  assert.equal(state.away, true);
  assert.equal(state.window.label, '09:00-12:00');
});

test('11:59 仍在 away', () => {
  assert.equal(evaluate(schedule, at('2026-10-23T11:59:00+08:00')).away, true);
});

test('12:00 整点恢复 open', () => {
  assert.equal(evaluate(schedule, at('2026-10-23T12:00:00+08:00')).away, false);
});

test('14:00 进入下午时段', () => {
  assert.equal(evaluate(schedule, at('2026-10-23T14:00:00+08:00')).away, true);
});

test('18:00 整点下班', () => {
  assert.equal(evaluate(schedule, at('2026-10-23T18:00:00+08:00')).away, false);
});

test('周六不生效', () => {
  assert.equal(evaluate(schedule, at('2026-10-24T10:00:00+08:00')).away, false);
});

test('holidays 里的工作日不生效', () => {
  const holiday = normalizeSchedule({ timeZone: 'Asia/Shanghai', windows: WINDOWS, holidays: ['2026-10-23'] });
  assert.equal(evaluate(holiday, at('2026-10-23T10:00:00+08:00')).away, false);
});

test('extraWorkdays 里的周六生效', () => {
  const extra = normalizeSchedule({ timeZone: 'Asia/Shanghai', windows: WINDOWS, extraWorkdays: ['2026-10-24'] });
  assert.equal(evaluate(extra, at('2026-10-24T10:00:00+08:00')).away, true);
});

test('时区参数确实生效（UTC 01:00 = 北京 09:00）', () => {
  assert.equal(evaluate(schedule, at('2026-10-23T01:00:00Z')).away, true);
});

test('nextChangeAt 指向 09:00', () => {
  const result = describe(schedule, at('2026-10-23T08:30:00+08:00'));
  assert.equal(result.mode, 'open');
  assert.equal(new Date(result.nextChangeAt).toISOString(), '2026-10-23T01:00:00.000Z');
});

test('时段内 nextChangeAt 指向 12:00', () => {
  const result = describe(schedule, at('2026-10-23T11:30:00+08:00'));
  assert.equal(result.mode, 'away');
  assert.equal(new Date(result.nextChangeAt).toISOString(), '2026-10-23T04:00:00.000Z');
});

test('toMinutes 解析', () => {
  assert.equal(toMinutes('09:00'), 540);
  assert.equal(toMinutes('18:30'), 1110);
  assert.equal(toMinutes('9:5'), null);
  assert.equal(toMinutes('24:30'), null);
});

console.log('闸门判定');

const privateKey = 'wechat:private:1000000001';
const groupKey = 'wechat:group:2000000002';
const relay = text => [{ role: 'user', source: { kind: 'wechat-social-bridge', form: 'relay' }, content: [{ type: 'text', text }] }];

test('inboundText 忽略人格初始化消息', () => {
  const messages = [
    ...relay('在吗'),
    { role: 'user', source: { kind: 'wechat-social-bridge', form: 'relay', socialBootstrap: { digest: 'x' } }, content: [{ type: 'text', text: '初始人格' }] },
  ];
  assert.equal(inboundText(messages), '在吗');
});

test('私聊在时段内 → 回固定文案', () => {
  const verdict = gateDecision({ key: privateKey, kind: 'private', messages: relay('在吗'), away: true });
  assert.equal(verdict.action, 'reply');
});

test('时段外 → 交给 AI', () => {
  const verdict = gateDecision({ key: privateKey, kind: 'private', messages: relay('在吗'), away: false });
  assert.equal(verdict.action, 'open');
});

test('群聊没 @/唤醒 → 静默', () => {
  const verdict = gateDecision({ key: groupKey, kind: 'group', messages: relay('今天吃啥'), away: true, groupReply: 'wake', policy: { nicknames: ['小助手'], wakeWords: ['小助手'], accountNames: ['阿鲸'] } });
  assert.equal(verdict.action, 'silent');
});

test('群聊 @ 本账号 → 回固定文案', () => {
  const verdict = gateDecision({ key: groupKey, kind: 'group', messages: relay('@小助手 今天吃啥'), away: true, groupReply: 'wake', policy: { nicknames: ['小助手'], wakeWords: ['小助手'] } });
  assert.equal(verdict.action, 'reply');
});

test('群聊 @ 群里昵称 → 回固定文案', () => {
  const verdict = gateDecision({ key: groupKey, kind: 'group', messages: relay('@阿鲸 出来做个自我介绍'), away: true, groupReply: 'wake', policy: { accountNames: ['阿鲸'] } });
  assert.equal(verdict.action, 'reply');
});

test('群聊 @ 别人不算叫我', () => {
  const verdict = gateDecision({ key: groupKey, kind: 'group', messages: relay('@张三 你看这个'), away: true, groupReply: 'wake', policy: { accountNames: ['阿鲸'] } });
  assert.equal(verdict.action, 'silent');
});

test('群聊唤醒词 → 回固定文案', () => {
  const verdict = gateDecision({ key: groupKey, kind: 'group', messages: relay('小助手在吗'), away: true, groupReply: 'wake', policy: { nicknames: ['小助手'], wakeWords: ['小助手'] } });
  assert.equal(verdict.action, 'reply');
});

test('群聊 always → 都回', () => {
  const verdict = gateDecision({ key: groupKey, kind: 'group', messages: relay('今天吃啥'), away: true, groupReply: 'always' });
  assert.equal(verdict.action, 'reply');
});

test('群聊 never → 永远静默', () => {
  const verdict = gateDecision({ key: groupKey, kind: 'group', messages: relay('@小助手 在吗'), away: true, groupReply: 'never' });
  assert.equal(verdict.action, 'silent');
});

test('没有会话 key → 不拦', () => {
  assert.equal(gateDecision({ key: null, kind: null, messages: relay('在吗'), away: true }).action, 'open');
});

test('woken 认昵称，也认可选的任意 @', () => {
  assert.equal(woken('@小助手 你好', { names: ['小助手'] }), true);
  assert.equal(woken('小助手在吗', { names: ['小助手'] }), true);
  assert.equal(woken('随便聊聊', { names: ['小助手'] }), false);
  assert.equal(woken('@张三 你看', { names: ['小助手'] }), false);
  assert.equal(woken('@张三 你看', { names: ['小助手'], anyMention: true }), true);
});

test('parseConversationKey', () => {
  assert.deepEqual(parseConversationKey(privateKey), { platform: 'wechat', kind: 'private', conversationId: '1000000001', key: privateKey });
  assert.equal(parseConversationKey('wechat:private:'), null);
  assert.equal(parseConversationKey('nonsense'), null);
});

console.log('限流');

test('冷却期内不再重复回复', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'away-'));
  const now = Date.now();
  const settings = { cooldownSeconds: 60, maxPerHour: 5 };
  assert.equal(allowReply(root, privateKey, settings, now).ok, true);
  recordReply(root, privateKey, {}, now);
  const blocked = allowReply(root, privateKey, settings, now + 30000);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'cooldown');
  assert.equal(allowReply(root, privateKey, settings, now + 61000).ok, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('每小时上限', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'away-'));
  const now = Date.now();
  const settings = { cooldownSeconds: 0, maxPerHour: 2 };
  recordReply(root, privateKey, {}, now - 3000);
  recordReply(root, privateKey, {}, now - 2000);
  const blocked = allowReply(root, privateKey, settings, now);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'hourly_cap');
  fs.rmSync(root, { recursive: true, force: true });
});

// 回归：真实运行时传进来的是插件 settings（replyCooldownSeconds / maxRepliesPerChatPerHour），
// 字段名对不上会让冷却变成 0，10 秒内连回两条。
test('插件 settings 结构也能正确限流', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'away-'));
  const settings = settingsOf({ replyCooldownSeconds: 180, maxRepliesPerChatPerHour: 12 });
  const now = Date.now();
  assert.equal(allowReply(root, privateKey, settings, now).ok, true);
  recordReply(root, privateKey, {}, now);
  const blocked = allowReply(root, privateKey, settings, now + 10000);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'cooldown');
  fs.rmSync(root, { recursive: true, force: true });
});

console.log(`\n${passed} 项通过${process.exitCode ? '，有失败' : ''}`);
