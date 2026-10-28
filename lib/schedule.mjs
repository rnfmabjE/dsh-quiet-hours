// 工作时段判定：只依赖 Intl，不碰系统时区设置。
// 配置里的 windows 用本地时钟（默认 Asia/Shanghai），days 用 ISO 周几：1=周一 … 7=周日。

const DAY_NAMES = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const MINUTE = 60000;

export function toMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59) return null;
  if (hours === 24 && minutes !== 0) return null;
  return hours * 60 + minutes;
}

export function normalizeSchedule(config = {}) {
  const timeZone = typeof config.timeZone === 'string' && config.timeZone.trim() ? config.timeZone.trim() : 'Asia/Shanghai';
  const windows = [];
  for (const item of Array.isArray(config.windows) ? config.windows : []) {
    const start = toMinutes(item?.start);
    const end = toMinutes(item?.end);
    if (start === null || end === null || start === end) continue;
    const days = (Array.isArray(item?.days) ? item.days : [1, 2, 3, 4, 5])
      .map(Number)
      .filter(day => Number.isInteger(day) && day >= 1 && day <= 7);
    if (!days.length) continue;
    windows.push({ days: [...new Set(days)], start, end, label: `${item.start}-${item.end}` });
  }
  windows.sort((a, b) => a.start - b.start);
  const holidays = new Set((Array.isArray(config.holidays) ? config.holidays : []).map(day => String(day).slice(0, 10)));
  const extraWorkdays = new Set((Array.isArray(config.extraWorkdays) ? config.extraWorkdays : []).map(day => String(day).slice(0, 10)));
  return { timeZone, windows, holidays, extraWorkdays };
}

export function partsOf(date, timeZone) {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  });
  const parts = {};
  for (const item of format.formatToParts(date)) parts[item.type] = item.value;
  const hour = Number(parts.hour) % 24;
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour, minute: Number(parts.minute), second: Number(parts.second),
    weekday: DAY_NAMES[parts.weekday] ?? 0,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  };
}

export function evaluate(schedule, date) {
  const parts = partsOf(date, schedule.timeZone);
  const base = { parts, window: null, away: false, reason: 'outside' };
  if (!parts.weekday) return base;
  if (schedule.holidays.has(parts.date)) return { ...base, reason: 'holiday' };
  const workingDay = parts.weekday >= 1 && parts.weekday <= 5;
  const forced = schedule.extraWorkdays.has(parts.date);
  if (!workingDay && !forced) return { ...base, reason: 'weekend' };
  for (const window of schedule.windows) {
    if (!window.days.includes(parts.weekday) && !forced) continue;
    if (parts.minutes < window.start || parts.minutes >= window.end) continue;
    return { parts, window, away: true, reason: 'window' };
  }
  return base;
}

const DAY_MS = 24 * 60 * MINUTE;

// 往后逐分钟找模式翻转点。最多看 8 天，用于状态展示和“下次切换”提示。
export function nextFlip(schedule, date, limitDays = 8) {
  const current = evaluate(schedule, date).away;
  const start = Math.ceil(date.getTime() / MINUTE) * MINUTE;
  const end = start + limitDays * DAY_MS;
  for (let at = start + MINUTE; at <= end; at += MINUTE) {
    if (evaluate(schedule, new Date(at)).away !== current) return at;
  }
  return null;
}

export function describe(schedule, date = new Date()) {
  const state = evaluate(schedule, date);
  const flip = nextFlip(schedule, date);
  return {
    away: state.away,
    mode: state.away ? 'away' : 'open',
    reason: state.reason,
    window: state.window ? state.window.label : null,
    day: state.parts.date,
    weekday: state.parts.weekday,
    clock: `${String(state.parts.hour).padStart(2, '0')}:${String(state.parts.minute).padStart(2, '0')}`,
    timeZone: schedule.timeZone,
    nextChangeAt: flip === null ? null : new Date(flip).toISOString(),
    nextChangeInSeconds: flip === null ? null : Math.max(0, Math.round((flip - date.getTime()) / 1000)),
  };
}
