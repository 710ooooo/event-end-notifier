# 会議終了通知 Chrome拡張 仕様書

## 1. 概要

Googleカレンダーの予定を取得し、**会議の終了前・終了時刻**にデスクトップ通知を出す Chrome 拡張機能。
Googleカレンダー標準では「開始前」しか通知できないため、「終了前」の通知を補う。

- 形態: Chrome 拡張機能（Manifest V3）
- 対象: まずは自分用（パッケージ化されていない拡張として読み込む）。将来的にウェブストア公開も視野に入れる
- 外部サービス: Google Calendar API（読み取り専用）

## 2. 機能要件

### 2.1 必須（v1）

| # | 機能 | 内容 |
|---|------|------|
| F1 | Googleログイン | `chrome.identity` で OAuth 認可を行う。初回のみ同意画面を表示 |
| F2 | 予定の取得 | 当日（現在時刻〜24時間後）の予定を Calendar API から取得 |
| F3 | 終了前通知 | 終了 N 分前に通知を出す（N は設定可能。既定値は 5 分） |
| F4 | 終了時刻通知 | 終了時刻ちょうどに通知を出す（ON/OFF 可能） |
| F5 | 定期同期 | 15分ごとに予定を再取得し、アラームを張り直す（予定の変更や追加に追従するため） |
| F6 | ポップアップ | 次に終わる会議・残り時間・今日の予定一覧を表示。手動同期ボタンを置く |
| F7 | 設定画面 | 通知タイミング、音、対象にする予定の条件を設定 |

### 2.2 通知の対象にする予定の条件（設定で切り替え）

- 終日予定は**除外**（固定）
- 自分が「不参加」と回答した予定は**除外**（既定 ON）
- Google Meet などの会議リンクが付いた予定**だけ**を対象にする（既定 OFF）
- 対象にするカレンダーの選択（既定はメインのカレンダーのみ）

### 2.3 あると良い（v2以降）

- 通知に「5分延長」ボタンを付けて再通知する
- 音の種類と音量の選択
- 次の会議が直後に続く場合、「次: ○○ が △△:△△ から」と通知に添える
- アイコンのバッジに残り分数を表示（例: `5m`）
- 複数の Google アカウントへの対応

## 3. 非機能要件

- 権限は必要最小限にする（カレンダーは読み取りのみ）
- 予定データは外部サーバーに送らない。拡張内（`chrome.storage`）だけで扱う
- PCのスリープ復帰後やブラウザ再起動後も、アラームが正しく再設定されること
- タイムゾーンは API が返す ISO 8601 の時刻をそのまま `Date` に変換して扱う

## 4. 技術構成

### 4.1 ファイル構成

```
meeting-end-notifier/
├── manifest.json
├── src/
│   ├── background.js      # Service Worker: 認証・同期・アラーム・通知
│   ├── calendar.js        # Calendar API ラッパー
│   ├── scheduler.js       # 予定 → アラーム変換
│   ├── storage.js         # 設定・キャッシュの読み書き
│   ├── offscreen.html     # 通知音再生用
│   ├── offscreen.js
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   └── options/
│       ├── options.html
│       ├── options.js
│       └── options.css
├── assets/
│   ├── icon16.png / icon48.png / icon128.png
│   └── chime.mp3
└── README.md
```

### 4.2 manifest.json（骨子）

```json
{
  "manifest_version": 3,
  "name": "Meeting End Notifier",
  "version": "0.1.0",
  "description": "Googleカレンダーの会議終了前に通知します",
  "key": "<固定IDにするための公開鍵>",
  "permissions": ["identity", "alarms", "notifications", "storage", "offscreen"],
  "host_permissions": ["https://www.googleapis.com/*"],
  "oauth2": {
    "client_id": "<OAuthクライアントID>.apps.googleusercontent.com",
    "scopes": [
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
    ]
  },
  "background": { "service_worker": "src/background.js", "type": "module" },
  "action": { "default_popup": "src/popup/popup.html" },
  "options_page": "src/options/options.html",
  "icons": { "16": "assets/icon16.png", "48": "assets/icon48.png", "128": "assets/icon128.png" }
}
```

### 4.3 使う Chrome API

| API | 用途 |
|-----|------|
| `chrome.identity.getAuthToken` | OAuth アクセストークンの取得（Chrome 専用。Edge などでは `launchWebAuthFlow` が必要） |
| `chrome.alarms` | 終了前・終了時刻・定期同期のスケジュール |
| `chrome.notifications` | デスクトップ通知 |
| `chrome.storage.local` | 設定、予定のキャッシュ、通知済みの記録 |
| `chrome.offscreen` | Service Worker から音を鳴らすための offscreen document（理由は `AUDIO_PLAYBACK`） |
| `chrome.runtime.onStartup` / `onInstalled` | 起動時やインストール時の同期 |

## 5. 処理フロー

### 5.1 同期処理 `sync()`

1. `getAuthToken({ interactive: false })` でトークンを取得する。失敗したら「要ログイン」状態にしてポップアップで促す
2. 対象カレンダーごとに `events.list` を呼ぶ
   - `timeMin` = 現在時刻、`timeMax` = 現在時刻 + 24時間
   - `singleEvents=true`（繰り返し予定を展開する）
   - `orderBy=startTime`
   - `fields` で必要な項目だけに絞る: `items(id,summary,start,end,status,attendees(self,responseStatus),hangoutLink,conferenceData)`
3. フィルタ（2.2の条件）を適用する
4. キャッシュに保存し、`scheduler.rebuild(events)` を呼ぶ

トリガー:
- `onInstalled` / `onStartup`
- 15分ごとの `sync` アラーム
- ポップアップの手動同期ボタン
- 設定変更時

### 5.2 アラーム設計

アラーム名に種類と予定IDを埋め込み、張り直しを冪等にする。

| アラーム名 | 発火時刻 |
|-----------|---------|
| `sync` | 15分ごと（`periodInMinutes: 15`） |
| `pre:<eventId>:<endISO>` | 終了時刻 − N分 |
| `end:<eventId>:<endISO>` | 終了時刻 |

`rebuild` の手順:
1. `sync` 以外の既存アラームをすべて消す
2. 終了時刻が未来の予定について、上記のアラームを作る（発火時刻が過去になるものは作らない）
3. 名前に `endISO` を含めることで、予定の時刻が変わったら別のアラームとして扱われる

### 5.3 通知 `onAlarm`

1. アラーム名から種類と予定IDを取り出し、キャッシュから予定を引く（見つからなければ何もしない）
2. 同じアラームで通知済みなら何もしない（`notified` に記録しておく）
3. `chrome.notifications.create` で通知を出す
   - 終了前: タイトル「まもなく終了（あと5分）」、本文「<会議名> 〜 HH:MM」
   - 終了時刻: タイトル「会議終了時刻です」、本文「<会議名>」
   - `requireInteraction: true` にして、閉じるまで表示し続ける（設定で切り替え可能）
4. 音が ON なら offscreen document を作って音声を再生する

## 6. 設定項目（`chrome.storage.local` の `settings`）

```js
{
  preMinutes: 5,            // 終了何分前に通知するか（0 で無効）
  notifyAtEnd: true,        // 終了時刻ちょうどにも通知するか
  sound: true,              // 通知音を鳴らすか
  requireInteraction: true, // 閉じるまで通知を表示し続けるか
  excludeDeclined: true,    // 不参加と回答した予定を除外するか
  onlyWithMeetLink: false,  // 会議リンクのある予定だけを対象にするか
  calendarIds: ["primary"]  // 対象カレンダー
}
```

## 7. UI

### 7.1 ポップアップ
- 未ログイン時: 「Googleでログイン」ボタン（`interactive: true` で認可）
- ログイン後:
  - 進行中の会議: 会議名、終了時刻、残り時間
  - 今日のこの後の予定一覧（開始〜終了時刻、会議名）
  - 「今すぐ同期」ボタン、最終同期時刻
  - 設定画面へのリンク

### 7.2 設定画面
- 6章の各項目をフォームで編集する
- カレンダー一覧は `calendarList.list` で取得し、チェックボックスで表示する
- 「ログアウト」ボタン（`removeCachedAuthToken` を呼んでトークンを失効させる）

## 8. Google Cloud 側の準備

1. Google Cloud Console でプロジェクトを作る
2. **Google Calendar API** を有効にする
3. OAuth 同意画面を設定する
   - ユーザーの種類: 外部
   - 公開ステータス: **テスト**（自分のアカウントをテストユーザーに追加）
   - スコープ: `calendar.events.readonly`、`calendar.calendarlist.readonly`
4. 認証情報 → OAuth クライアントIDを作る → 種類は **「Chrome 拡張機能」**、アイテムIDを入力
5. 拡張IDを固定するため、manifest に `key` を入れる（一度パッケージ化して公開鍵を取り出す。こうしないと読み込み直すたびにIDが変わり、OAuth が通らなくなる）

## 9. エッジケースと注意点

| ケース | 対応 |
|-------|------|
| 会議が重なっている | それぞれ個別に通知する |
| 予定が直前に延長・短縮された | 15分ごとの同期で張り直す。直前の変更には手動同期で対応 |
| 予定が削除された | 同期時にアラームを消す。発火時にキャッシュに予定がなければ通知しない |
| PCのスリープ中に発火時刻を過ぎた | 復帰後に `chrome.alarms` がまとめて発火する。終了時刻から10分以上たっていたら通知しない |
| Service Worker が停止している | `chrome.alarms` が起こしてくれる。グローバル変数に状態を持たず、毎回 `storage` から読む |
| トークンの期限切れ（401） | `removeCachedAuthToken` してから1回だけ再取得してリトライする |
| OAuth のテスト中ステータス | 一定期間で再認可を求められることがある。ポップアップでログインを促す |
| Chrome 以外のブラウザ | v1 は対象外にする（`getAuthToken` が使えないため） |

## 10. ウェブストアに公開する場合（将来）

- デベロッパー登録料: 5USD（1回払うだけ）
- カレンダーのスコープは **Google の OAuth 審査（sensitive scope）** の対象になる
  - プライバシーポリシーページ、ホームページ、デモ動画などが必要
  - 審査が通るまで、外部ユーザーは「未確認のアプリ」警告付きで最大100人までしか使えない
- ストアの説明には、データの取り扱い（外部に送信しないこと）を明記する

## 11. 開発ステップ

1. **M1** 雛形: manifest、ポップアップ、Service Worker を置き、パッケージ化されていない拡張として読み込む
2. **M2** 認証: Cloud 側の設定、`getAuthToken` でトークンが取れることを確認する
3. **M3** 予定の取得: `events.list` を呼んでポップアップに今日の予定を表示する
4. **M4** 通知: アラームの張り直しと通知を実装する（テスト用に「1分後に終わる予定」を作って確認する）
5. **M5** 設定画面と各フィルタ
6. **M6** 通知音、エッジケースへの対応、仕上げ
