// Service Worker からは音を鳴らせないので、offscreen document で再生する。
// AUDIO_PLAYBACK の offscreen document は、音が止まって30秒たつと Chrome が自動で閉じる。

const audio = document.getElementById('chime');

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen' || msg.type !== 'play') return false;
  audio.currentTime = 0;
  audio
    .play()
    .then(() => sendResponse({ ok: true }))
    .catch((e) => sendResponse({ ok: false, error: e?.message ?? String(e) }));
  return true;
});
