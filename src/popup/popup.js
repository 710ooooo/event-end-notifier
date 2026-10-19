import { getEvents, getState } from '../storage.js';

const $ = (id) => document.getElementById(id);

function send(type) {
  return chrome.runtime.sendMessage({ target: 'background', type });
}

function formatTime(iso, now) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : `翌 ${time}`;
}

function formatRemaining(ms) {
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `残り ${minutes}分`;
  return `残り ${Math.floor(minutes / 60)}時間${minutes % 60}分`;
}

function renderEvent(event, now, ongoing) {
  const li = document.createElement('li');
  if (ongoing) {
    const remaining = document.createElement('span');
    remaining.className = 'remaining';
    remaining.textContent = formatRemaining(Date.parse(event.end) - now.getTime());
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = event.summary;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = `${formatTime(event.end, now)} 終了`;
    li.append(remaining, title, time);
  } else {
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = `${formatTime(event.start, now)}〜${formatTime(event.end, now)}`;
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = event.summary;
    li.append(time, title);
  }
  return li;
}

async function render() {
  const [state, events] = await Promise.all([getState(), getEvents()]);
  const now = new Date();
  const nowMs = now.getTime();

  $('login').hidden = !state.authRequired;
  $('main').hidden = state.authRequired;
  $('sync-button').hidden = state.authRequired;

  // 次に終わる会議が先頭に来るよう、進行中は終了時刻順に並べる
  const ongoing = events
    .filter((e) => Date.parse(e.start) <= nowMs && nowMs < Date.parse(e.end))
    .sort((a, b) => a.end.localeCompare(b.end));
  const upcoming = events.filter((e) => Date.parse(e.start) > nowMs);

  $('ongoing').replaceChildren(...ongoing.map((e) => renderEvent(e, now, true)));
  $('ongoing-empty').hidden = ongoing.length > 0;
  $('upcoming').replaceChildren(...upcoming.map((e) => renderEvent(e, now, false)));
  $('upcoming-empty').hidden = upcoming.length > 0;

  $('last-sync').textContent = state.lastSyncAt
    ? `最終同期 ${new Date(state.lastSyncAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`
    : '未同期';

  const showError = state.lastError && !state.authRequired;
  $('error').hidden = !showError;
  $('error').textContent = showError ? `同期に失敗しました: ${state.lastError}` : '';
}

async function runWithButton(button, type) {
  button.disabled = true;
  try {
    const res = await send(type);
    // 起動時の「未ログイン」は毎回出るので、ログインを押して失敗したときだけ理由を出す
    if (type === 'login') {
      $('login-error').hidden = Boolean(res?.ok);
      $('login-error').textContent = res?.ok ? '' : `ログインに失敗しました: ${res?.error}`;
    }
  } finally {
    button.disabled = false;
    await render();
  }
}

$('sync-button').addEventListener('click', (e) => runWithButton(e.currentTarget, 'sync'));
$('login-button').addEventListener('click', (e) => runWithButton(e.currentTarget, 'login'));
$('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.events || changes.state)) render();
});

render();
// 残り時間を更新する
setInterval(render, 15 * 1000);
