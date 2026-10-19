// Google Calendar API ラッパー（読み取り専用）。

const API_BASE = 'https://www.googleapis.com/calendar/v3';

const EVENT_FIELDS =
  'nextPageToken,items(id,summary,start,end,status,eventType,' +
  'attendees(self,responseStatus),hangoutLink,conferenceData(entryPoints(entryPointType,uri)))';
const CALENDAR_FIELDS = 'nextPageToken,items(id,summary,summaryOverride,primary,backgroundColor)';

// 通知の対象にしない予定の種類（勤務場所・不在は会議ではない）
const EXCLUDED_EVENT_TYPES = new Set(['workingLocation', 'outOfOffice']);

// ログインが必要なことを表すエラー。呼び出し側はこれを見て「要ログイン」状態にする
export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function getToken(interactive = false) {
  try {
    const result = await chrome.identity.getAuthToken({ interactive });
    // Chrome 105 以降はオブジェクト、それより前は文字列が返る
    const token = typeof result === 'string' ? result : result?.token;
    if (!token) throw new Error('トークンを取得できませんでした');
    return token;
  } catch (e) {
    throw new AuthError(e?.message ?? String(e));
  }
}

export async function signOut() {
  let token = null;
  try {
    token = await getToken(false);
  } catch {
    // すでにログアウト済み
  }
  if (token) {
    await chrome.identity.removeCachedAuthToken({ token });
    // キャッシュを消すだけだと次回の非対話取得で再び黙ってトークンが出るので、付与自体を取り消す
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
      });
    } catch {
      // 失効に失敗してもキャッシュは消えているので続行する
    }
  }
  await chrome.identity.clearAllCachedAuthTokens();
}

async function apiGet(path, params) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  let token = await getToken(false);
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  // トークンの期限切れ: キャッシュを捨てて1回だけ取り直す
  if (res.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token });
    token = await getToken(false);
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) throw new AuthError('認可の期限が切れました');
  }

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      message = (await res.json())?.error?.message ?? message;
    } catch {
      // 本文が JSON でなければステータスだけ使う
    }
    throw new ApiError(res.status, message);
  }
  return res.json();
}

async function listAll(path, params) {
  const items = [];
  let pageToken;
  do {
    const page = await apiGet(path, { ...params, pageToken });
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

export function listEvents(calendarId, timeMin, timeMax) {
  return listAll(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
    fields: EVENT_FIELDS,
  });
}

export async function listCalendars() {
  const items = await listAll('/users/me/calendarList', {
    minAccessRole: 'reader',
    fields: CALENDAR_FIELDS,
  });
  return items.map((c) => ({
    // メインのカレンダーは設定上 "primary" として扱う
    id: c.primary ? 'primary' : c.id,
    summary: c.summaryOverride ?? c.summary ?? c.id,
    primary: Boolean(c.primary),
    color: c.backgroundColor ?? null,
  }));
}

function meetLinkOf(item) {
  if (item.hangoutLink) return item.hangoutLink;
  const video = item.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video');
  return video?.uri ?? null;
}

// API の予定を、通知の対象にするかどうか判定する（2.2 の条件）
export function isTarget(item, settings) {
  if (item.status === 'cancelled') return false;
  // 終日予定は dateTime を持たない
  if (!item.start?.dateTime || !item.end?.dateTime) return false;
  if (EXCLUDED_EVENT_TYPES.has(item.eventType)) return false;
  if (settings.excludeDeclined) {
    const self = item.attendees?.find((a) => a.self);
    if (self?.responseStatus === 'declined') return false;
  }
  if (settings.onlyWithMeetLink && !meetLinkOf(item)) return false;
  return true;
}

// キャッシュに保存する形に変換する。時刻は toISOString で UTC に揃え、アラーム名を安定させる
export function normalize(item, calendarId) {
  return {
    id: item.id,
    calendarId,
    summary: item.summary || '(タイトルなし)',
    start: new Date(item.start.dateTime).toISOString(),
    end: new Date(item.end.dateTime).toISOString(),
    meetLink: meetLinkOf(item),
  };
}

// 複数カレンダーの API 結果をまとめる。同じ予定が複数のカレンダーに出ても1件にする
export function mergeEvents(itemsByCalendar, settings) {
  const byId = new Map();
  for (const { calendarId, items } of itemsByCalendar) {
    for (const item of items) {
      if (!isTarget(item, settings) || byId.has(item.id)) continue;
      byId.set(item.id, normalize(item, calendarId));
    }
  }
  return [...byId.values()].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}
