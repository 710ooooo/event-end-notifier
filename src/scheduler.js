// 予定 → アラームの変換。アラーム名に種類・予定ID・終了時刻を埋め込み、張り直しを冪等にする。

export const SYNC_ALARM = 'sync';
export const SYNC_PERIOD_MINUTES = 15;

// 予定ID（英数字と _）には ":" が含まれないので、先頭2つの ":" で区切れる
export function alarmName(kind, event) {
  return `${kind}:${event.id}:${event.end}`;
}

export function parseAlarmName(name) {
  const m = /^(pre|end):([^:]+):(.+)$/.exec(name);
  if (!m) return null;
  return { kind: m[1], eventId: m[2], endISO: m[3] };
}

// 張るべきアラームの一覧を返す。発火時刻が過去になるものは作らない
export function planAlarms(events, settings, now = Date.now()) {
  const plans = [];
  for (const event of events) {
    const end = Date.parse(event.end);
    if (!(end > now)) continue;

    if (settings.preMinutes > 0) {
      const when = end - settings.preMinutes * 60 * 1000;
      if (when > now) plans.push({ name: alarmName('pre', event), when });
    }
    if (settings.notifyAtEnd) {
      plans.push({ name: alarmName('end', event), when: end });
    }
  }
  return plans;
}

export async function ensureSyncAlarm() {
  const existing = await chrome.alarms.get(SYNC_ALARM);
  if (!existing || existing.periodInMinutes !== SYNC_PERIOD_MINUTES) {
    await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
  }
}

export async function rebuild(events, settings) {
  const existing = await chrome.alarms.getAll();
  await Promise.all(
    existing.filter((a) => a.name !== SYNC_ALARM).map((a) => chrome.alarms.clear(a.name)),
  );
  const plans = planAlarms(events, settings);
  await Promise.all(plans.map((p) => chrome.alarms.create(p.name, { when: p.when })));
  return plans;
}
