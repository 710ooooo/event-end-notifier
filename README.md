# Event End Notifier

Google カレンダーの予定が**終わる少し前**と**終了時刻ちょうど**に、デスクトップ通知を出す Chrome 拡張機能です。
Google カレンダー標準では「開始前」しか通知できないため、会議の延長や次の予定への遅れを防ぐために作りました。

## 主な機能

- 予定の終了 N 分前（既定 5 分）と終了時刻に通知
- 通知音のオン・オフ、通知を閉じるまで表示し続ける設定
- 通知の対象にするカレンダーの選択
- 「不参加」と回答した予定や、会議リンクのない予定の除外（終日予定・勤務場所・不在は常に除外）
- ポップアップで進行中の会議の残り時間と、この後の予定を表示

## データの取り扱い

- カレンダーへのアクセスは**読み取り専用**です（`calendar.events.readonly`、`calendar.calendarlist.readonly`）
- 取得した予定はブラウザの中（`chrome.storage.local`）だけに保存し、外部のサーバーには送りません。通信先は Google の API だけです
- 詳しくは[プライバシーポリシー](https://710ooooo.github.io/event-end-notifier/privacy.html)をご覧ください

## インストール（開発版）

ウェブストアにはまだ公開していません。今はパッケージ化されていない拡張機能として読み込みます。

1. このリポジトリを clone する
2. `chrome://extensions` を開き、右上の「デベロッパー モード」を ON にする
3. 「パッケージ化されていない拡張機能を読み込む」で `src/` フォルダを選ぶ
4. ツールバーのアイコンからポップアップを開き、「Googleでログイン」を押す

Chrome 116 以上が必要です。Google Cloud 側の準備やテストの実行方法は [src/README.md](src/README.md) にあります。

## フォルダ構成

```
src/     拡張機能本体（Chrome で読み込むフォルダ）
docs/    仕様書
```

- 仕様書: [docs/event-end-notifier-spec.md](docs/event-end-notifier-spec.md)
- 開発者向けの説明: [src/README.md](src/README.md)

## フォークして改修する方へ

`src/manifest.json` には、作者の拡張IDを固定する公開鍵（`key`）と、作者の OAuth クライアントID（`oauth2.client_id`）が入っています。改修版を自分で使ったり配布したりする場合は、次のものを自分で用意して差し替えてください。

1. `key` を削除するか、自分で作った鍵の公開鍵に置き換える
2. 自分の Google Cloud プロジェクトで Calendar API を有効にし、「Chrome 拡張機能」タイプの OAuth クライアントを作って `client_id` を置き換える
3. ウェブストアで公開する場合は、OAuth 同意画面・プライバシーポリシーなども自分のものを用意する

また、改修版を配布するときは「Event End Notifier」という名前とアイコンを使わないようお願いします。

## リンク

- ホームページ: https://710ooooo.github.io/event-end-notifier/
- プライバシーポリシー: https://710ooooo.github.io/event-end-notifier/privacy.html
- 利用規約: https://710ooooo.github.io/event-end-notifier/terms.html

## ライセンス

[MIT License](LICENSE)
