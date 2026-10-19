// 設定・予定キャッシュ・状態の読み書き。
// Service Worker はいつ止まるかわからないので、状態はすべてここ経由で chrome.storage.local に置く。

export const DEFAULT_SETTINGS = {
  preMinutes: 5,            // 終了何分前に通知するか（0 で無効）
  notifyAtEnd: true,        // 終了時刻ちょうどにも通知するか
  sound: true,              // 通知音を鳴らすか
  requireInteraction: true, // 閉じるまで通知を表示し続けるか
  excludeDeclined: true,    // 不参加と回答した予定を除外するか
  onlyWithMeetLink: false,  // 会議リンクのある予定だけを対象にするか
  calendarIds: ['primary'], // 対象カレンダー
};

const DEFAULT_STATE = {
  authRequired: false, // true ならポップアップでログインを促す
  lastSyncAt: null,    // 最後に同期が成功した時刻（epoch ms）
  lastError: null,     // 直近の同期エラーのメッセージ
};

// 通知済み記録の保持期間。24時間先までしか予定を取らないので2日あれば十分
const NOTIFIED_TTL_MS = 2 * 24 * 60 * 60 * 1000;

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function saveSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings });
  return settings;
}

export async function getEvents() {
  const { events } = await chrome.storage.local.get('events');
  return events ?? [];
}

export async function setEvents(events) {
  await chrome.storage.local.set({ events });
}

export async function getState() {
  const { state } = await chrome.storage.local.get('state');
  return { ...DEFAULT_STATE, ...state };
}

export async function setState(patch) {
  const state = { ...(await getState()), ...patch };
  await chrome.storage.local.set({ state });
  return state;
}

export async function wasNotified(alarmName) {
  const { notified } = await chrome.storage.local.get('notified');
  return Boolean(notified?.[alarmName]);
}

export async function markNotified(alarmName, now = Date.now()) {
  const { notified = {} } = await chrome.storage.local.get('notified');
  const pruned = Object.fromEntries(
    Object.entries(notified).filter(([, at]) => now - at < NOTIFIED_TTL_MS),
  );
  pruned[alarmName] = now;
  await chrome.storage.local.set({ notified: pruned });
}
