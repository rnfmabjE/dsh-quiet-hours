// 现场自检：不经过 DSH，直接看 reader / hook / 会话映射，并算一遍作息。
// 用法：
//   node check.mjs                  # 只读检查
//   node check.mjs --send-test      # 额外给「文件传输助手」发一条测试文字（安全，发给自己）
import { normalizeSchedule, describe, evaluate } from './lib/schedule.mjs';
import { probe, sendWechatText } from './lib/wechat.mjs';

const root = process.env.WECHAT_AGENT_ROOT || 'D:/WeChat Agent/data/workspace';
const sendTest = process.argv.includes('--send-test');

const settings = normalizeSchedule({
  timeZone: 'Asia/Shanghai',
  windows: [
    { days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' },
    { days: [1, 2, 3, 4, 5], start: '14:00', end: '18:00' },
  ],
});

const now = new Date();
const mode = describe(settings, now);
console.log('== 作息（Asia/Shanghai）==');
console.log(JSON.stringify({
  now: now.toISOString(),
  local: `${mode.day} ${mode.clock}`,
  weekday: mode.weekday,
  mode: mode.mode,
  window: mode.window,
  nextChangeAt: mode.nextChangeAt,
  nextChangeInSeconds: mode.nextChangeInSeconds,
}, null, 2));

console.log('\n== 链路 ==');
const report = await probe(root, undefined);
console.log(JSON.stringify(report, null, 2));

if (sendTest) {
  console.log('\n== 发送测试（文件传输助手）==');
  try {
    const line = `【自动回复插件自检】${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} 链路正常`;
    const result = await sendWechatText(root, { wxid: 'filehelper', text: line });
    console.log('已提交：' + JSON.stringify(result));
    console.log('请在微信「文件传输助手」里确认是否收到：' + line);
  } catch (error) {
    console.error('发送失败：' + String(error?.message ?? error));
    process.exitCode = 1;
  }
}

const verdict = evaluate(settings, now).away ? '现在处于自动回复时段' : '现在不处于自动回复时段';
console.log('\n结论：' + verdict + (report.reader && report.hook ? '；reader 与 hook 都在线。' : '；有链路不在线，见上面报告。'));
