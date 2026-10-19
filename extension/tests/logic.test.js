// 実行: deno test tests/
import assert from 'node:assert/strict';
import { isTarget, mergeEvents } from '../src/calendar.js';
import { alarmName, parseAlarmName, planAlarms } from '../src/scheduler.js';
import { DEFAULT_SETTINGS } from '../src/storage.js';

const timed = (overrides = {}) => ({
  id: 'abc123',
  summary: '定例',
  status: 'confirmed',
  start: { dateTime: '2026-10-17T10:00:00+09:00' },
  end: { dateTime: '2026-10-17T11:00:00+09:00' },
  ...overrides,
});

Deno.test('終日予定・キャンセル・勤務場所は対象外', () => {
  assert.equal(isTarget(timed(), DEFAULT_SETTINGS), true);
  assert.equal(isTarget(timed({ start: { date: '2026-10-17' }, end: { date: '2026-10-18' } }), DEFAULT_SETTINGS), false);
  assert.equal(isTarget(timed({ status: 'cancelled' }), DEFAULT_SETTINGS), false);
  assert.equal(isTarget(timed({ eventType: 'workingLocation' }), DEFAULT_SETTINGS), false);
});

Deno.test('不参加の除外は設定で切り替わる', () => {
  const declined = timed({ attendees: [{ self: true, responseStatus: 'declined' }, { responseStatus: 'accepted' }] });
  assert.equal(isTarget(declined, DEFAULT_SETTINGS), false);
  assert.equal(isTarget(declined, { ...DEFAULT_SETTINGS, excludeDeclined: false }), true);
  // 他人の不参加は関係ない
  assert.equal(isTarget(timed({ attendees: [{ responseStatus: 'declined' }] }), DEFAULT_SETTINGS), true);
});

Deno.test('会議リンクのある予定だけに絞れる', () => {
  const s = { ...DEFAULT_SETTINGS, onlyWithMeetLink: true };
  assert.equal(isTarget(timed(), s), false);
  assert.equal(isTarget(timed({ hangoutLink: 'https://meet.google.com/x' }), s), true);
  const zoom = timed({ conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://zoom.us/j/1' }] } });
  assert.equal(isTarget(zoom, s), true);
  const phoneOnly = timed({ conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:1' }] } });
  assert.equal(isTarget(phoneOnly, s), false);
});

Deno.test('複数カレンダーの重複を除き、時刻を UTC に揃えて開始順に並べる', () => {
  const later = timed({ id: 'later', start: { dateTime: '2026-10-17T13:00:00+09:00' }, end: { dateTime: '2026-10-17T14:00:00+09:00' } });
  const events = mergeEvents(
    [
      { calendarId: 'primary', items: [later, timed()] },
      { calendarId: 'team@example.com', items: [timed()] },
    ],
    DEFAULT_SETTINGS,
  );
  assert.deepEqual(events.map((e) => e.id), ['abc123', 'later']);
  assert.equal(events[0].calendarId, 'primary');
  assert.equal(events[0].end, '2026-10-17T02:00:00.000Z');
  assert.equal(mergeEvents([{ calendarId: 'primary', items: [timed({ summary: '' })] }], DEFAULT_SETTINGS)[0].summary, '(タイトルなし)');
});

Deno.test('アラーム名は往復できる（繰り返し予定のIDも含む）', () => {
  const event = { id: 'abc_20261017T010000Z', end: '2026-10-17T02:00:00.000Z' };
  assert.deepEqual(parseAlarmName(alarmName('pre', event)), {
    kind: 'pre',
    eventId: 'abc_20261017T010000Z',
    endISO: '2026-10-17T02:00:00.000Z',
  });
  assert.equal(parseAlarmName('sync'), null);
});

Deno.test('アラームの計画: 過去の発火時刻は作らない', () => {
  const end = Date.parse('2026-10-17T02:00:00.000Z');
  const event = { id: 'a', end: new Date(end).toISOString() };
  const min = 60 * 1000;

  // 十分前: 終了前と終了時刻の2つ
  assert.deepEqual(planAlarms([event], DEFAULT_SETTINGS, end - 30 * min), [
    { name: alarmName('pre', event), when: end - 5 * min },
    { name: alarmName('end', event), when: end },
  ]);
  // 終了3分前: 終了前通知はもう過ぎている
  assert.deepEqual(planAlarms([event], DEFAULT_SETTINGS, end - 3 * min).map((p) => p.name), [alarmName('end', event)]);
  // 終了済み: なし
  assert.deepEqual(planAlarms([event], DEFAULT_SETTINGS, end), []);
  // 設定で無効化
  assert.deepEqual(planAlarms([event], { ...DEFAULT_SETTINGS, preMinutes: 0, notifyAtEnd: false }, end - 30 * min), []);
});
