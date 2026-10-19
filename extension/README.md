# Event End Notifier

Googleカレンダーの予定の**終了前・終了時刻**にデスクトップ通知を出す Chrome 拡張機能（Manifest V3）です。
仕様は [meeting-end-notifier-spec.md](../_docs/meeting-end-notifier-spec.md) を参照してください。

- 予定データは拡張の中（`chrome.storage.local`）だけで扱い、外部サーバーには送りません
- カレンダーへのアクセスは読み取り専用です

## セットアップ

### 1. 拡張ID

`manifest.json` の `key` に公開鍵を入れてあるため、拡張IDは次の値に固定されます。

```
fhipcnepdiplkebbnjngaokiadbkcbhl
```

対応する秘密鍵は `.secrets/key.pem` にあります（Git には入れません）。ウェブストアに出すときや `.crx` を作るときに使うので、なくさないように保管してください。

### 2. Google Cloud 側の準備

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作る
2. 「API とサービス」→「ライブラリ」で **Google Calendar API** を有効にする
3. 「OAuth 同意画面」を設定する
   - ユーザーの種類: **外部**
   - 公開ステータス: **テスト**（自分のアカウントをテストユーザーに追加する）
   - スコープ: `.../auth/calendar.events.readonly`、`.../auth/calendar.calendarlist.readonly`
4. 「認証情報」→「OAuth クライアント ID を作成」
   - アプリケーションの種類: **Chrome 拡張機能**
   - アイテム ID: 上の拡張ID
5. 発行されたクライアントIDを `manifest.json` の `oauth2.client_id` に書く（`YOUR_CLIENT_ID.apps.googleusercontent.com` を置き換える）

### 3. 読み込み

1. `chrome://extensions` を開き、右上の「デベロッパー モード」を ON にする
2. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選ぶ
3. ID が `fhipcnepdiplkebbnjngaokiadbkcbhl` になっていることを確認する
4. ツールバーのアイコンからポップアップを開き、「Googleでログイン」を押す

`.secrets/` も一緒に読み込まれますが、拡張のコードからは参照しません。zip にしてウェブストアへ出すときは `.secrets/`・`tests/`・仕様書を除いてください。

## 使い方

- **ポップアップ**: 進行中の会議（次に終わるものが先頭）と残り時間、この後の予定、最終同期時刻を表示します。「今すぐ同期」で手動同期できます
- **設定画面**: 何分前に通知するか、終了時刻の通知、通知音、通知を閉じるまで表示するか、対象にする予定とカレンダーを選べます。変更はすぐに保存され、再同期されます。ログアウトもここから行います

同期は、インストール時・ブラウザ起動時・15分ごと・手動同期・設定変更時に行います。

## 動作確認（M4）

1. Googleカレンダーに「今から数分後に終わる予定」を作る
2. ポップアップの「今すぐ同期」を押す
3. 終了 N 分前と終了時刻に通知が出ることを確認する

アラームの状態は `chrome://extensions` → 「Service Worker」の DevTools で確認できます。

```js
await chrome.alarms.getAll();
await chrome.storage.local.get(null);
```

## テスト

予定のフィルタ、アラームの計画、アラーム名の解析といった、Chrome API を使わない部分のテストです。[Deno](https://deno.com/) で実行します。

```sh
deno test tests/
```

## ファイル構成

```
manifest.json
src/
  background.js    Service Worker: 認証・同期・アラーム・通知
  calendar.js      Calendar API ラッパーと予定のフィルタ
  scheduler.js     予定 → アラーム変換
  storage.js       設定・キャッシュ・状態の読み書き
  offscreen.*      通知音の再生
  popup/           ポップアップ
  options/         設定画面
assets/            アイコン、通知音
tests/             ロジックのテスト
```

## 仕様からの補足

- `events.list` の `fields` に `nextPageToken` と `eventType` を加えています（ページ送りと、「勤務場所」「不在」の予定を除外するため）
- `chrome.runtime.getContexts` を使うため、対応する Chrome は 116 以上です
- 通知音を鳴らす設定のときは、OS の通知音と重ならないよう通知自体は `silent` にしています
- ログアウトでは `removeCachedAuthToken` に加えてトークンを失効させます。キャッシュを消すだけだと、次の同期で黙ってトークンが再発行されるためです
