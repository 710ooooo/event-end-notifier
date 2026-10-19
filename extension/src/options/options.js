import { AuthError, listCalendars } from '../calendar.js';
import { getSettings, saveSettings } from '../storage.js';

const form = document.getElementById('form');
const calendarsEl = document.getElementById('calendars');
const calendarsStatus = document.getElementById('calendars-status');
const savedEl = document.getElementById('saved');

const CHECKBOXES = ['notifyAtEnd', 'sound', 'requireInteraction', 'excludeDeclined', 'onlyWithMeetLink'];

let savedTimer;
function showSaved(text = '保存しました') {
  savedEl.textContent = text;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (savedEl.textContent = ''), 2000);
}

function fillForm(settings) {
  form.elements.preMinutes.value = settings.preMinutes;
  for (const name of CHECKBOXES) form.elements[name].checked = settings[name];
}

function calendarRow(calendar, checked) {
  const label = document.createElement('label');
  label.className = 'row';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = 'calendarIds';
  input.value = calendar.id;
  input.checked = checked;
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  if (calendar.color) swatch.style.background = calendar.color;
  const text = document.createElement('span');
  text.textContent = calendar.primary ? `${calendar.summary}（メイン）` : calendar.summary;
  label.append(input, swatch, text);
  return label;
}

async function loadCalendars(settings) {
  calendarsStatus.className = 'note';
  calendarsStatus.textContent = '読み込み中…';
  try {
    const calendars = await listCalendars();
    calendars.sort((a, b) => Number(b.primary) - Number(a.primary));
    const selected = new Set(settings.calendarIds);
    calendarsEl.replaceChildren(...calendars.map((c) => calendarRow(c, selected.has(c.id))));
    calendarsStatus.textContent = '';
  } catch (e) {
    calendarsStatus.className = 'note error';
    calendarsStatus.textContent =
      e instanceof AuthError
        ? 'カレンダー一覧を読むには、ポップアップからログインしてください。'
        : `カレンダー一覧を取得できませんでした: ${e.message}`;
  }
}

async function save() {
  const preMinutes = form.elements.preMinutes.valueAsNumber;
  if (!Number.isInteger(preMinutes) || preMinutes < 0 || preMinutes > 60) {
    showSaved('「何分前」は 0〜60 の整数で入力してください');
    return;
  }

  const patch = { preMinutes };
  for (const name of CHECKBOXES) patch[name] = form.elements[name].checked;

  // カレンダー一覧を読めていないときは、カレンダーの選択を変えない
  const boxes = [...calendarsEl.querySelectorAll('input[name="calendarIds"]')];
  if (boxes.length > 0) {
    const ids = boxes.filter((b) => b.checked).map((b) => b.value);
    if (ids.length === 0) {
      showSaved('カレンダーを1つ以上選んでください');
      return;
    }
    patch.calendarIds = ids;
  }

  // 保存すると Service Worker が storage の変更を見て再同期する
  await saveSettings(patch);
  showSaved();
}

form.addEventListener('change', save);
form.addEventListener('submit', (e) => e.preventDefault());

const logoutButton = document.getElementById('logout');
logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    await chrome.runtime.sendMessage({ target: 'background', type: 'logout' });
    calendarsEl.replaceChildren();
    showSaved('ログアウトしました');
    await loadCalendars(await getSettings());
  } finally {
    logoutButton.disabled = false;
  }
});

const settings = await getSettings();
fillForm(settings);
loadCalendars(settings);
