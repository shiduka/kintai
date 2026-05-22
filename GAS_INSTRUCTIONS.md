# 農業勤怠管理システム（NFC版）導入手順

## 構成図

```
管理者スマホ (Chrome Android)
    ↓ NFCタグ読み取り
GitHub Pages (HTML/JS) ← 画面表示
    ↓ fetch()
GAS WebアプリURL ← REST API
    ↓ 読み書き
Google スプレッドシート ← データ保存
```

## ステップ1: GASのセットアップ

1. [Google スプレッドシート](https://sheets.new/)を新規作成
2. 「拡張機能」→「Apps Script」
3. 既存コードを消して、`code.js` の内容を貼り付け
4. 関数ドロップダウンから `setup` を選び「▶ 実行」
5. 承認を求められたら「権限を確認」→ 自分のアカウント → 許可
6. スプレッドシートに「勤務記録」「スタッフ名簿」「設定マスタ」が作成されていることを確認

## ステップ2: GAS Webアプリとして公開

1. GASエディタ → 「デプロイ」→「新しいデプロイ」
2. 種類: **ウェブアプリ**
3. 設定:
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
4. 「デプロイ」→ **WebアプリのURL** をコピー

> [!IMPORTANT]
> このURLは後でHTMLの設定画面に入力します。

## ステップ3: GitHub Pagesで公開

1. GitHubに新しいリポジトリを作成（例: `kintai`）
2. `kintai_standalone.html` を `index.html` にリネームしてアップロード
3. リポジトリの「Settings」→「Pages」
   - Source: **Deploy from a branch**
   - Branch: **main** / **(root)**
   - 「Save」
4. 数分後に `https://ユーザー名.github.io/kintai/` でアクセス可能

## ステップ4: 初回設定と運用開始

1. **Android版Chrome**でGitHub PagesのURLを開く
2. 画面下部の「⚙️ 設定」をタップ
3. ステップ2でコピーした **GAS WebアプリURL** を貼り付けて「保存」
4. 「➕ 新規登録」モードに切り替え → NFCシールをかざす → 名前と時給を入力
5. 「📋 打刻モード」に戻して → NFCシールをかざすと打刻完了！

---

> [!WARNING]
> - **Android版Chromeのみ**対応（iPhoneは非対応）
> - GASのURLを変更した場合は「管理者メニュー」→「設定」から再入力が必要
> - NFCシールが反応しない場合は、NFC Toolsアプリでフォーマット（初期化）を試してください
