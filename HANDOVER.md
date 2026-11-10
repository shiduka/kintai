# 農業勤怠管理システム（kintai）プロジェクト引き継ぎ書

本ドキュメントは、プロジェクト管理への移行および今後の開発・保守をスムーズに行うための引き継ぎ用ドキュメントです。
これまでの開発経緯、システム構成、ファイル構造、環境情報、運用手順、注意点を網羅しています。

---

## 1. プロジェクト概要

- **プロジェクト名**: 農業勤怠管理システム（NFC版）
- **リポジトリ名**: `kintai`
- **概要**: 
  Androidスマートフォン（Google Chrome）の Web NFC API を活用し、従業員のNFCカード／タグをかざすだけで出退勤・休憩の打刻と給与・実働時間の自動計算を行うWebアプリケーション。
  さらに、打刻漏れや誤打刻をスマホやPCから修正・再計算できる管理者専用画面を備える。

---

## 2. システム構成・アーキテクチャ

```
【従業員・現場打刻】
Androidスマホ (Chrome) ──[Web NFC]──> NFCタグ（従業員証）
      │
      ▼
GitHub Pages (https://shiduka.github.io/kintai/)
      │
      │ fetch (REST API / JSONP / POST)
      ▼
Google Apps Script (GAS) Webアプリ
      │
      ▼
Google スプレッドシート（データベース: 「【重要】勤怠管理システム_データベース」）
      - スタッフ名簿 シート
      - 勤務記録 シート
      - 設定マスタ シート

【管理者修正・確認】
PC / スマホブラウザ
      │
      ▼
GitHub Pages (https://shiduka.github.io/kintai/admin.html)
      │
      │ PIN認証 (初期: 1234) & API通信
      ▼
Google Apps Script (GAS) ──> スプレッドシート更新
```

- **フロントエンド**: GitHub Pages（HTML5, CSS3, Vanilla JavaScript / 外部ライブラリ非依存）
- **バックエンド**: Google Apps Script (GAS)
- **データベース**: Google スプレッドシート
- **動作環境**:
  - メイン打刻画面: Android スマートフォン（Google Chrome 89以降、Web NFC機能必須）
  - 管理者画面: PC / スマホ共通（Chrome, Safari, Edge等）

---

## 3. リポジトリ・環境情報

| 項目 | 内容 |
| :--- | :--- |
| **GitHub リポジトリ** | `https://github.com/shiduka/kintai` |
| **GitHub Pages (打刻)** | `https://shiduka.github.io/kintai/` （または `index.html`） |
| **GitHub Pages (管理者)**| `https://shiduka.github.io/kintai/admin.html` |
| **ローカル作業パス** | `D:\shiduka\OneDrive\development\Antigravity\kintai` |
| **デフォルトブランチ** | `main` |
| **管理者画面 PINコード** | `1234`（`admin.html` 内で変更可能） |

---

## 4. ファイル構成と役割

```
kintai/
├── index.html              # メイン打刻画面（GitHub Pages公開用。kintai_standalone.htmlと同内容）
├── kintai_standalone.html   # HTML/CSS/JSを1枚にまとめたスタンドアロン打刻画面
├── admin.html              # 管理者専用の時間修正・再計算画面（PIN認証付き）
├── code.js                 # Google Apps Script (GAS) の全サーバーサイド処理コード
├── app.js                  # 打刻画面のJSロジック（単体ファイル版、kintai_standaloneに内包）
├── style.css               # 打刻画面のスタイルシート（単体ファイル版、kintai_standaloneに内包）
├── SPECIFICATION.md        # システム仕様書（初期要件・データ構造定義）
├── GAS_INSTRUCTIONS.md     # GASセットアップおよびGitHub Pages公開マニュアル
└── HANDOVER.md             # 本引き継ぎ書
```

---

## 5. 主要機能の詳細

### 5.1 メイン打刻画面 (`index.html`)
- **自動ステータス判定**: NFCタグ読み取り時、現在の状態（未出勤/勤務中/休憩中）に応じて出勤・休憩・退勤を自動判定。
- **端数処理**: 打刻時刻は5分単位で自動切り捨て（例: 08:04 → 08:00）。
- **重複防止**: 同一タグの連続タッチを防止する3秒間のクールダウン。
- **バイブレーション・音声通知**: 打刻成功時の触覚・視覚フィードバック。
- **スタッフ新規登録**: 空きNFCタグをかざし、名前と時給をスプレッドシートに即時登録。
- **本日の稼働状況・履歴表示**: リアルタイムで稼働中のスタッフ一覧や履歴を確認可能。

### 5.2 管理者時間修正画面 (`admin.html`)
- **アクセス制限**: PINコード（初期設定: `1234`）によるログイン保護。
- **打刻データ検索**: 日付とスタッフを選択して、その日の打刻記録（出勤・退勤・休憩等）を取得。
- **時間修正 & 自動再計算**:
  - 各打刻の時間を直接編集（スマホ対応のタイムピッカー）。
  - 実働時間、休憩時間（自動控除含む）、日当をサーバー側ロジックで自動再計算してスプレッドシートを更新。
- **レスポンシブUI**: スマホ表示時に右端が見切れないよう `box-sizing: border-box;` や縦並びレイアウトを適用済み。

### 5.3 バックエンド (`code.js`)
- `doGet(e)` / `doPost(e)`: REST API エンドポイント。
- `punch()`: 打刻登録およびステータス遷移・給与計算処理。
- `registerStaff()`: スタッフ情報の新規追加。
- `getTodayStatus()` / `getStaffList()`: マスタ・稼働状況の取得。
- `getStaffDailyRecords()`: 管理者用、指定スタッフ・指定日の全打刻ログ取得。
- `updatePunchTime()`: 管理者用、打刻時刻修正および実働時間・給与の再計算・スプレッドシート反映。

---

## 6. これまでの開発経緯・トラブルシュート記録

1. **管理者専用時間修正機能の実装**:
   - メイン画面を汚さず、別ページ `admin.html` として独立実装。
   - `code.js` に `getStaffDailyRecords` と `updatePunchTime` を追加。
2. **GASコードの文字化け問題と解消**:
   - PowerShellによるファイル書き換え時に文字コードがShift-JIS/破損したため、UTF-8で正しく再生成・コミット。
3. **Androidスマホ表示でのUI崩れ修正**:
   - 時計選択ポップアップの「設定」ボタンが見切れる問題が発生。
   - 原因: `box-sizing: border-box;` の欠落により余白（padding）分だけ横幅100%のinput要素が画面外にはみ出していた。
   - 全体リセットCSSを適用し、縦並びレイアウトにすることで解決。
4. **GitHub Pagesのキャッシュ問題**:
   - 更新が即座にスマホに反映されない場合、URL末尾に `?v=2` 等のクエリパラメータを付与することでキャッシュをバイパス確認。
5. **他プロジェクト（AgriLog）との連携検討**:
   - 栽培管理アプリ（AgriLog）への作業者名紐付け検討があったが、ユーザー判断により一旦取り消し（現状は独立運用）。

---

## 7. 開発・運用時の重要ルール・注意事項

1. **GASの更新ルール**:
   - `code.js` を変更した際は、Googleスプレッドシートの「Apps Script」エディタに貼り付け後、**「デプロイ」→「デプロイを管理」→「新バージョン」**としてデプロイすること。（新バージョンを発行しないとWebアプリURLの内容が更新されません）
2. **GitHub Pagesへのデプロイ**:
   - `kintai_standalone.html` を更新した場合は、必ず `index.html` にも同内容をコピーしてコミット・プッシュすること。
   - プッシュ後、GitHub Pagesに反映されるまで1〜3分程度のタイムラグがあります。
3. **コーディング規約**:
   - ソースコード内のコメントは**必ず日本語で記述すること**。
4. **セキュリティ**:
   - `admin.html` のPINコードはクライアント側（JavaScript）で照合しているため、必要に応じてGAS側での認証トークン検証への強化を検討。

---

## 8. 次期開発・今後の検討課題

- [ ] 管理者画面のPINコード変更機能（スプレッドシート側でPINを保持・変更する仕組み）
- [ ] 打刻漏れアラート（退勤打刻がないまま翌日を迎えた場合の通知等）
- [ ] 月次給与集計・CSV一括出力の強化
- [ ] 栽培管理アプリ（AgriLog）等の他システムとのマスタ連携（必要になった場合）
