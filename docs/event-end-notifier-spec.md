# Event End Notifier 仕様書

最終更新: 2026-10-19（v0.1.0 の実装に合わせて更新）

## 1. 概要

Googleカレンダーの予定を取得し、**予定の終了前・終了時刻**にデスクトップ通知を出す Chrome 拡張機能。
Googleカレンダー標準では「開始前」しか通知できないため、「終了前」の通知を補う。

- 名前: Event End Notifier（リポジトリ: `710ooooo/event-end-notifier`、MIT ライセンス）
- 形態: Chrome 拡張機能（Manifest V3、Chrome 116 以上）
- 対象: まずは自分用（パッケージ化されていない拡張として読み込む）。ウェブストア公開に向けて準備中（10章）
- 外部サービス: Google Calendar API（読み取り専用）

## 2. 機能要件

### 2.1 必須（v1）

| # | 機能 | 内容 |
|---|------|------|
| F1 | Googleログイン | `chrome.identity` で OAuth 認可を行う。初回のみ同意画面を表示 |
| F2 | 予定の取得 | 現在時刻〜24時間後の予定を Calendar API から取得 |
| F3 | 終了前通知 | 終了 N 分前に通知を出す（N は 0〜60 で設定可能。既定値は 5 分、0 で無効） |
| F4 | 終了時刻通知 | 終了時刻ちょうどに通知を出す（ON/OFF 可能） |
| F5 | 定期同期 | 15分ごとに予定を再取得し、アラームを張り直す（予定の変更や追加に追従するため） |
| F6 | ポップアップ | 進行中の会議と残り時間、この後の予定、最終同期時刻を表示。手動同期ボタンを置く |
| F7 | 設定画面 | 通知タイミング、音、通知の表示方法、対象にする予定とカレンダーを設定。ログアウト |

### 2.2 通知の対象にする予定の条件

| 条件 | 扱い |
|------|------|
| キャンセルされた予定（`status: cancelled`） | **除外**（固定） |
| 終日予定（`start.dateTime` を持たない） | **除外**（固定） |
| 「勤務場所」「不在」の予定（`eventType` が `workingLocation` / `outOfOffice`） | **除外**（固定） |
| 自分が「不参加」と回答した予定 | **除外**（設定、既定 ON） |
| Google Meet などの会議リンクがない予定 | **除外**（設定、既定 OFF） |
| 対象にするカレンダー | 設定で選択（既定はメインのカレンダーのみ） |

同じ予定が複数のカレンダーに出てくる場合は、予定IDで1件にまとめる。

### 2.3 あると良い（v2以降）

- 通知に「5分延長」ボタンを付けて再通知する
- 音の種類と音量の選択
- 次の会議が直後に続く場合、「次: ○○ が △△:△△ から」と通知に添える
- アイコンのバッジに残り分数を表示（例: `5m`）
- 複数の Google アカウントへの対応

## 3. 非機能要件

- 権限は必要最小限にする（カレンダーは読み取りのみ。取得する項目も `fields` で絞る）
- 予定データは外部サーバーに送らない。拡張内（`chrome.storage.local`）だけで扱う。通信先は Google の API だけ
- PCのスリープ復帰後やブラウザ再起動後も、アラームが正しく再設定されること
- Service Worker はいつ止まってもよいように、状態はグローバル変数に持たず毎回 `storage` から読む
- タイムゾーンは API が返す ISO 8601 の時刻を `Date` に変換し、保存時は `toISOString()` で UTC に揃える（アラーム名を安定させるため）

## 4. 技術構成

### 4.1 ファイル構成

```
event-end-notifier/
├── LICENSE
├── README.md                # リポジトリの概要
├── .gitignore               # .secrets/, *.pem, *.crx, *.zip
├── .secrets/key.pem         # 拡張IDを固定する鍵の秘密鍵（Git には入れない）
├── docs/                    # GitHub Pages で公開するフォルダ
│   ├── event-end-notifier-spec.md
│   ├── index.html           # ホームページ
│   ├── privacy.html         # プライバシーポリシー
│   ├── terms.html           # 利用規約
│   ├── style.css
│   └── .nojekyll            # Jekyll で変換せずそのまま公開する
└── src/                     # 拡張機能本体（このフォルダを読み込む）
    ├── manifest.json
    ├── README.md
    ├── background.js        # Service Worker: 認証・同期・アラーム・通知
    ├── calendar.js          # Calendar API ラッパーと予定のフィルタ
    ├── scheduler.js         # 予定 → アラーム変換
    ├── storage.js           # 設定・キャッシュ・状態の読み書き
    ├── offscreen.html       # 通知音の再生
    ├── offscreen.js
    ├── popup/               # popup.html / popup.js / popup.css
    ├── options/             # options.html / options.js / options.css
    ├── assets/
    │   ├── icon16.png / icon48.png / icon128.png
    │   └── chime.mp3
    └── tests/
        └── logic.test.js    # Chrome API を使わない部分のテスト（Deno）
```

公開ページ（ホームページ・プライバシーポリシー・利用規約）は `docs/` に置き、GitHub Pages（`main` ブランチの `/docs`）で公開する（10章）。

### 4.2 manifest.json（骨子）

```json
{
  "manifest_version": 3,
  "name": "Event End Notifier",
  "version": "0.1.0",
  "description": "Googleカレンダーの予定の終了前に通知します",
  "key": "<固定IDにするための公開鍵>",
  "minimum_chrome_version": "116",
  "permissions": ["identity", "alarms", "notifications", "storage", "offscreen"],
  "host_permissions": ["https://www.googleapis.com/*"],
  "oauth2": {
    "client_id": "<OAuthクライアントID>.apps.googleusercontent.com",
    "scopes": [
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
    ]
  },
  "background": { "service_worker": "background.js", "type": "module" },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": { "16": "assets/icon16.png", "48": "assets/icon48.png", "128": "assets/icon128.png" }
  },
  "options_page": "options/options.html",
  "icons": { "16": "assets/icon16.png", "48": "assets/icon48.png", "128": "assets/icon128.png" }
}
```

`minimum_chrome_version` を 116 にしているのは `chrome.runtime.getContexts` を使うため。

### 4.3 使う Chrome API

| API | 用途 |
|-----|------|
| `chrome.identity.getAuthToken` / `removeCachedAuthToken` / `clearAllCachedAuthTokens` | OAuth アクセストークンの取得と破棄（Chrome 専用。Edge などでは `launchWebAuthFlow` が必要） |
| `chrome.alarms` | 終了前・終了時刻・定期同期のスケジュール |
| `chrome.notifications` | デスクトップ通知。クリックで閉じる |
| `chrome.storage.local` | 設定、予定のキャッシュ、状態、通知済みの記録。`onChanged` で設定変更を検知して再同期する |
| `chrome.offscreen` | Service Worker から音を鳴らすための offscreen document（理由は `AUDIO_PLAYBACK`） |
| `chrome.runtime.getContexts` | offscreen document がすでにあるかの確認 |
| `chrome.runtime.onStartup` / `onInstalled` | 起動時やインストール時の同期 |
| `chrome.runtime.sendMessage` / `onMessage` | ポップアップ・設定画面から Service Worker への依頼（`sync` / `login` / `logout` / `status`） |

## 5. 処理フロー

### 5.1 同期処理 `sync()`

1. 同期中なら、実行中の同期の結果を返す（同じ Service Worker の中で同期を重ねない）
2. ログインボタンから呼ばれたときは `getAuthToken({ interactive: true })` で同意画面を出す
3. 対象カレンダーごとに `events.list` を呼ぶ
   - `timeMin` = 現在時刻、`timeMax` = 現在時刻 + 24時間
   - `singleEvents=true`（繰り返し予定を展開する）、`orderBy=startTime`、`maxResults=250`
   - `nextPageToken` があればページを送ってすべて取る
   - `fields`: `nextPageToken,items(id,summary,start,end,status,eventType,attendees(self,responseStatus),hangoutLink,conferenceData(entryPoints(entryPointType,uri)))`
   - 404 / 403 が返ったカレンダー（購読をやめたものなど）は飛ばして、他のカレンダーを続ける
4. 2.2 の条件で絞り込み、予定IDで重複を除き、開始時刻順に並べる
5. 保存する形に変換する: `{ id, calendarId, summary, start, end, meetLink }`（タイトルがなければ「(タイトルなし)」）
6. キャッシュ（`events`）に保存し、`rebuild(events, settings)` でアラームを張り直す
7. 状態を `{ authRequired: false, lastSyncAt: 現在時刻, lastError: null }` にする

失敗したとき:
- 前回のキャッシュとアラームは残す（ネットワークが切れても通知が消えないように）
- 認証エラーなら `authRequired: true` にしてポップアップでログインを促す。それ以外は `lastError` にメッセージを入れる

トークンの取得（API を呼ぶたび）:
- `getAuthToken({ interactive: false })` で取る。取れなければ認証エラー
- 401 が返ったら `removeCachedAuthToken` してから1回だけ取り直して再試行する。それでも 401 なら認証エラー

トリガー:
- `onInstalled` / `onStartup`（同時に `sync` アラームがなければ作る）
- 15分ごとの `sync` アラーム
- ポップアップの「今すぐ同期」「Googleでログイン」ボタン
- 設定の変更（`storage.onChanged` で `settings` の変更を検知）

### 5.2 アラーム設計

アラーム名に種類・予定ID・終了時刻を埋め込み、張り直しを冪等にする。

| アラーム名 | 発火時刻 | 作る条件 |
|-----------|---------|---------|
| `sync` | 15分ごと（`periodInMinutes: 15`） | 常に |
| `pre:<eventId>:<endISO>` | 終了時刻 − N分 | N > 0 で、発火時刻が未来 |
| `end:<eventId>:<endISO>` | 終了時刻 | 終了時刻の通知が ON で、終了時刻が未来 |

予定ID（英数字と `_`）には `:` が含まれないので、先頭2つの `:` で区切って解析できる。

`rebuild` の手順:
1. `sync` 以外の既存アラームをすべて消す
2. 終了時刻が未来の予定について、上記の条件でアラームを作る
3. 名前に `endISO` を含めることで、予定の時刻が変わったら別のアラームとして扱われる

### 5.3 通知 `onAlarm`

1. アラーム名から種類・予定ID・終了時刻を取り出し、キャッシュから**IDと終了時刻の両方が一致する**予定を引く（見つからなければ削除・時刻変更された予定として何もしない）
2. 次の場合は通知しない
   - 終了時刻から10分以上たっている（スリープ復帰などで遅れて発火した）
   - 終了前の通知なのに、すでに終了時刻を過ぎている
   - 同じアラーム名で通知済み（`notified` に記録がある）
3. `notified` に記録してから、`chrome.notifications.create` で通知を出す（通知IDはアラーム名）
   - 終了前: タイトル「まもなく終了（あと◯分）」、本文「<予定名> 〜 HH:MM」。◯は実際の残り時間を分に丸めたもの（最小1）
   - 終了時刻: タイトル「会議終了時刻です」、本文「<予定名>」
   - `requireInteraction` は設定に従う。`priority: 2`
   - 通知音を鳴らす設定のときは、OS の通知音と重ならないよう通知自体は `silent: true` にする
4. 通知音が ON なら offscreen document（なければ作る）に再生を依頼する。2つの通知が同時に来て作成が競合した場合のエラーは無視する
5. 通知をクリックしたら閉じる

offscreen document は、音が止まって30秒たつと Chrome が自動で閉じる。

## 6. 保存するデータ（`chrome.storage.local`）

### 6.1 `settings`

```js
{
  preMinutes: 5,            // 終了何分前に通知するか（0〜60。0 で無効）
  notifyAtEnd: true,        // 終了時刻ちょうどにも通知するか
  sound: true,              // 通知音を鳴らすか
  requireInteraction: true, // 閉じるまで通知を表示し続けるか
  excludeDeclined: true,    // 不参加と回答した予定を除外するか
  onlyWithMeetLink: false,  // 会議リンクのある予定だけを対象にするか
  calendarIds: ["primary"]  // 対象カレンダー（メインのカレンダーは "primary"）
}
```

保存されていない項目は既定値で補う。

### 6.2 その他

| キー | 内容 |
|------|------|
| `events` | 予定のキャッシュ。`[{ id, calendarId, summary, start, end, meetLink }]`（時刻は UTC の ISO 文字列） |
| `state` | `{ authRequired, lastSyncAt, lastError }`。ポップアップの表示に使う |
| `notified` | `{ <アラーム名>: 通知した時刻 }`。2日より古い記録は書き込みのたびに消す |

## 7. UI

### 7.1 ポップアップ

- ヘッダー: 拡張名と「設定」リンク（設定画面を開く）
- 未ログイン時（`authRequired`）: 「Googleでログイン」ボタン。ログインに失敗したときだけ理由を表示する
- ログイン後:
  - 進行中の会議: 終了時刻が早い順に、残り時間・予定名・終了時刻
  - この後の予定: 開始〜終了時刻、予定名
  - 日付が今日でない時刻には「翌」を付ける
  - 予定がなければ「進行中の会議はありません」「この後の予定はありません」
- フッター: 最終同期時刻（未同期なら「未同期」）、「今すぐ同期」ボタン、同期エラーのメッセージ
- 15秒ごと、および `events` / `state` が変わったときに表示を更新する

### 7.2 設定画面

- 6.1 の各項目をフォームで編集する。変更したらすぐに保存する（保存ボタンはない）
  - 「何分前」は 0〜60 の整数でなければ保存しない
  - カレンダーは1つ以上選ばないと保存しない
- カレンダー一覧は `calendarList.list`（`minAccessRole=reader`）で取得し、色付きのチェックボックスで表示する。メインのカレンダーを先頭にして「（メイン）」を付ける
  - 未ログインなどで一覧を読めないときは、カレンダーの選択を変えずに他の項目だけ保存する
- 「ログアウト」ボタン
  1. `removeCachedAuthToken` に加えて、`https://oauth2.googleapis.com/revoke` でトークンを失効させる（キャッシュを消すだけだと、次の同期で黙ってトークンが再発行されるため）
  2. `clearAllCachedAuthTokens` を呼ぶ
  3. 予定のキャッシュと通知のアラームを消し、`authRequired: true` にする

## 8. Google Cloud 側の準備

1. Google Cloud Console でプロジェクトを作る
2. **Google Calendar API** を有効にする
3. OAuth 同意画面を設定する
   - ユーザーの種類: 外部
   - スコープ: `calendar.events.readonly`、`calendar.calendarlist.readonly`（どちらも sensitive scope）
   - 公開ステータス: テスト中は自分のアカウントをテストユーザーに追加する。テストのままだと7日ごとに再ログインが必要になるので、**本番環境**に切り替える（確認前でも、警告付きで100人まで使える）
   - ブランディング（10章のページを登録する）
4. 認証情報 → OAuth クライアントIDを作る → 種類は **「Chrome 拡張機能」**、アイテムIDに拡張IDを入力
5. 拡張IDを固定するため、manifest に `key`（公開鍵）を入れてある。こうしないと読み込み直すたびにIDが変わり、OAuth が通らなくなる
   - 拡張ID: `fhipcnepdiplkebbnjngaokiadbkcbhl`
   - 秘密鍵は `.secrets/key.pem`。`.crx` を作るときや、ウェブストアでも同じIDを使いたいときに必要。なくした場合は、ストアで割り当てられたIDを OAuth クライアントに登録し直せばよい

## 9. エッジケースと注意点

| ケース | 対応 |
|-------|------|
| 会議が重なっている | それぞれ個別に通知する |
| 予定が直前に延長・短縮された | 15分ごとの同期で張り直す。直前の変更には手動同期で対応 |
| 予定が削除・時刻変更された | 同期時にアラームを消す。発火時にIDと終了時刻が一致する予定がキャッシュになければ通知しない |
| PCのスリープ中に発火時刻を過ぎた | 復帰後に `chrome.alarms` がまとめて発火する。終了時刻から10分以上たっていたら通知しない。終了後の「まもなく終了」も出さない |
| Service Worker が停止している | `chrome.alarms` が起こしてくれる。リスナーはすべてトップレベルで登録し、状態は毎回 `storage` から読む |
| 同じアラームが2回発火した | `notified` の記録を見て2回目は通知しない |
| 同期が重なった | 実行中の同期の結果を共有する |
| 同期に失敗した（ネットワーク断など） | 前回のキャッシュとアラームを残し、ポップアップにエラーを表示する |
| 購読をやめたカレンダーが設定に残っている | 404 / 403 のカレンダーは飛ばして他を同期する |
| トークンの期限切れ（401） | `removeCachedAuthToken` してから1回だけ再取得してリトライする |
| OAuth の公開ステータスが「テスト」 | 7日ごとに再認可を求められる。ポップアップでログインを促す（本番環境に切り替えれば解消） |
| 通知音の offscreen document の作成が競合した | すでにある旨のエラーは無視して再生を続ける |
| Chrome 以外のブラウザ | v1 は対象外にする（`getAuthToken` が使えないため） |

## 10. ウェブストアに公開する場合

- デベロッパー登録料: 5USD（1回払うだけ）
- カレンダーのスコープは **Google の OAuth 審査（sensitive scope）** の対象になる
  - ホームページ、プライバシーポリシー、利用規約、デモ動画、スコープが必要な理由の説明が必要
  - 審査が通るまで、外部ユーザーは「未確認のアプリ」警告付きで最大100人までしか使えない
  - CASA（セキュリティ評価）は restricted scope ではないので不要
- 公開ページ（このリポジトリの `docs/` を GitHub Pages で公開）
  - ホームページ: https://710ooooo.github.io/ （OAuth のブランディングに登録する URL。Search Console で所有確認したプロパティと一致させるため、サイトの一番上に置く。転送は不可。ソースは `710ooooo/710ooooo.github.io` の `index.html`）
  - ホームページ（サブパス版）: https://710ooooo.github.io/event-end-notifier/
  - プライバシーポリシー: https://710ooooo.github.io/event-end-notifier/privacy.html
  - 利用規約: https://710ooooo.github.io/event-end-notifier/terms.html
  - 承認済みドメイン: `710ooooo.github.io`（Search Console で所有確認する。確認用ファイルはサイトの一番上に置く必要があるので、`710ooooo/710ooooo.github.io` リポジトリに置く）
- 進め方: ストアの審査と OAuth の確認は並行して進める。確認が通るまではストアに**限定公開**で出し、通ったら一般公開にする
- ストアの説明には、データの取り扱い（外部に送信しないこと）を明記する
- zip にするときは `src/` の中身から `tests/` を除く（`.secrets/` と仕様書は `src/` の外にある）

## 11. 開発ステップ

1. **M1** 雛形: manifest、ポップアップ、Service Worker を置き、パッケージ化されていない拡張として読み込む
2. **M2** 認証: Cloud 側の設定、`getAuthToken` でトークンが取れることを確認する
3. **M3** 予定の取得: `events.list` を呼んでポップアップに今日の予定を表示する
4. **M4** 通知: アラームの張り直しと通知を実装する（テスト用に「1分後に終わる予定」を作って確認する）
5. **M5** 設定画面と各フィルタ
6. **M6** 通知音、エッジケースへの対応、仕上げ
7. **M7** 公開準備: ブランディング用ページ、OAuth の本番環境化と確認申請、ストア申請

M1〜M6 は v0.1.0 で実装済み。M7 は公開ページまで完了（2026-10-19 時点）。
