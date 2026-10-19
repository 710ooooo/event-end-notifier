// Service Worker: 認証・同期・アラーム・通知。
// いつ停止しても良いように、状態はグローバル変数ではなく毎回 storage から読む。

import { AuthError, ApiError, getToken, listEvents, mergeEvents, signOut } from './calendar.js';
import { SYNC_ALARM, ensureSyncAlarm, parseAlarmName, rebuild } from './scheduler.js';
import {
  getEvents,
  getSettings,
  getState,
  markNotified,
  setEvents,
  setState,
  wasNotified,
} from './storage.js';

const SYNC_RANGE_MS = 24 * 60 * 60 * 1000;
// スリープ復帰などで遅れて発火したとき、終了からこれ以上たっていたら通知しない
const STALE_LIMIT_MS = 10 * 60 * 1000;
const OFFSCREEN_URL = 'offscreen.html';

// ---- 同期 ----

// 同じ Service Worker の中で同期が重ならないようにするだけのもの（停止で消えても問題ない）
let runningSync = null;

function sync(options) {
  runningSync ??= doSync(options).finally(() => {
    runningSync = null;
  });
  return runningSync;
}

async function doSync({ interactive = false } = {}) {
  const settings = await getSettings();
  try {
    if (interactive) await getToken(true);

    const now = new Date();
    const timeMax = new Date(now.getTime() + SYNC_RANGE_MS);
    const itemsByCalendar = [];
    for (const calendarId of settings.calendarIds) {
      try {
        itemsByCalendar.push({ calendarId, items: await listEvents(calendarId, now, timeMax) });
      } catch (e) {
        // 購読をやめたカレンダーなどは飛ばして他を続ける
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
          console.warn(`calendar ${calendarId} skipped:`, e.message);
          continue;
        }
        throw e;
      }
    }

    const events = mergeEvents(itemsByCalendar, settings);
    await setEvents(events);
    await rebuild(events, settings);
    await setState({ authRequired: false, lastSyncAt: Date.now(), lastError: null });
    return { ok: true, count: events.length };
  } catch (e) {
    const authRequired = e instanceof AuthError;
    console.warn('sync failed:', e);
    // 失敗時は前回のキャッシュとアラームを残しておく（ネットワーク断などで通知が消えないように）
    await setState({ authRequired, lastError: e?.message ?? String(e) });
    return { ok: false, authRequired, error: e?.message ?? String(e) };
  }
}

async function logout() {
  await signOut();
  await setEvents([]);
  await rebuild([], await getSettings());
  await setState({ authRequired: true, lastSyncAt: null, lastError: null });
}

// ---- 通知 ----

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

async function handleNotifyAlarm(name) {
  const parsed = parseAlarmName(name);
  if (!parsed) return;

  const events = await getEvents();
  const event = events.find((e) => e.id === parsed.eventId && e.end === parsed.endISO);
  if (!event) return; // 削除・時刻変更された予定

  const now = Date.now();
  const end = Date.parse(event.end);
  if (now - end >= STALE_LIMIT_MS) return;
  if (parsed.kind === 'pre' && now >= end) return; // 終了後に「まもなく終了」は出さない
  if (await wasNotified(name)) return;

  const settings = await getSettings();
  let title;
  let message;
  if (parsed.kind === 'pre') {
    const minutesLeft = Math.max(1, Math.round((end - now) / 60000));
    title = `まもなく終了（あと${minutesLeft}分）`;
    message = `${event.summary} 〜 ${formatTime(event.end)}`;
  } else {
    title = '会議終了時刻です';
    message = event.summary;
  }

  await markNotified(name, now);
  await chrome.notifications.create(name, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icon128.png'),
    title,
    message,
    requireInteraction: settings.requireInteraction,
    silent: settings.sound, // 独自の通知音を鳴らすときは OS の音を重ねない
    priority: 2,
  });

  if (settings.sound) {
    try {
      await playChime();
    } catch (e) {
      console.warn('chime failed:', e);
    }
  }
}

async function playChime() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (contexts.length === 0) {
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['AUDIO_PLAYBACK'],
        justification: '会議終了の通知音を鳴らすため',
      });
    } catch (e) {
      // 同時に2つの通知が来て作成が競合した場合
      if (!String(e?.message).includes('single offscreen')) throw e;
    }
  }
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'play' });
}

// ---- イベントリスナー（Service Worker を起こせるよう、すべてトップレベルで登録する） ----

chrome.runtime.onInstalled.addListener(async () => {
  await ensureSyncAlarm();
  await sync();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureSyncAlarm();
  await sync();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM) {
    await sync();
  } else {
    await handleNotifyAlarm(alarm.name);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) sync();
});

chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
});

const messageHandlers = {
  sync: () => sync(),
  login: () => sync({ interactive: true }),
  logout: async () => {
    await logout();
    return { ok: true };
  },
  status: async () => ({ state: await getState(), events: await getEvents() }),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'background') return false;
  const handler = messageHandlers[msg.type];
  if (!handler) return false;
  handler()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e?.message ?? String(e) }));
  return true; // 非同期で応答する
});
