# 01. システムアーキテクチャ

## 1. 全体構成図

```mermaid
flowchart LR
  subgraph Users["利用者"]
    RESP["回答者<br/>（来店客・スマホ）"]
    ADMIN["管理者<br/>（個人 / 法人メンバー）"]
    OPS["運営担当<br/>（自社）"]
  end

  subgraph Firebase["Firebase / Google Cloud"]
    HOST["Firebase Hosting<br/>Nuxt 4 SPA（静的配信）"]
    AUTH["Firebase Authentication"]
    APPCHECK["App Check<br/>（reCAPTCHA Enterprise）"]
    FUNC["Cloud Functions（2nd gen）<br/>onCall / onRequest / onSchedule"]
    FS[("Cloud Firestore")]
    SECRET["Secret Manager<br/>（API キー）"]
    KMS["Cloud KMS<br/>（OAuth トークン暗号化）"]
    SCHED["Cloud Scheduler"]
    TASKS["Cloud Tasks<br/>（順位計測の分散実行）"]
  end

  subgraph External["外部サービス"]
    GOAUTH["Google OAuth 2.0"]
    GBP["Google Business Profile APIs<br/>（Account / Business Information）"]
    GREVIEW["Google 口コミ投稿画面<br/>search.google.com/local/writereview"]
    LLM["LLM API<br/>（口コミ下書き生成・提供元は未決）"]
    RANK["Google マップ<br/>（Headless Chrome で取得。RankProvider で差し替え可）"]
  end

  RESP -->|アンケート表示・回答| HOST
  ADMIN -->|管理画面| HOST
  OPS -->|運営管理画面| HOST
  HOST --> AUTH
  HOST -->|callable| FUNC
  HOST -->|公開スナップショット読取 / 管理データ読取| FS
  APPCHECK -.検証.-> FUNC

  FUNC --> FS
  FUNC --> SECRET
  FUNC --> KMS
  FUNC -->|トークン交換・更新| GOAUTH
  FUNC -->|アカウント / ロケーション取得| GBP
  FUNC -->|下書き生成| LLM
  FUNC -->|順位取得| RANK
  SCHED -->|毎日| FUNC
  FUNC -->|キーワード単位で投入| TASKS
  TASKS --> FUNC

  RESP -.本文をコピーして遷移.-> GREVIEW
```

## 2. 構成要素と役割

| レイヤ | 要素 | 役割 | 備考 |
| --- | --- | --- | --- |
| フロント | Nuxt 4（SPA） | 回答画面・管理画面・運営画面を 1 アプリで提供 | 既存リポジトリ構成を継続。`ssr: false` で静的生成 |
| フロント | Tailwind CSS v4 | スタイル | `app/assets/css/main.css` の `@theme` をトークンの正とする |
| 配信 | Firebase Hosting | 静的ファイル配信 | 回答画面を別ドメイン / 別サイトに分けるかは I-21 |
| 認証 | Firebase Authentication | 管理者ログイン（メール / Google） | 回答者は認証しない |
| 認証 | App Check | 回答送信・下書き生成の bot 対策 | 公開エンドポイントの濫用防止 |
| API | Cloud Functions 2nd gen | 業務ロジック・外部 API 呼び出しをすべて集約 | フロントからは composables 経由で callable を呼ぶ |
| DB | Cloud Firestore | 組織・店舗・アンケート・回答・順位履歴 | 設計は `02-database.md` |
| 秘密 | Secret Manager | LLM / 順位取得 API キー、OAuth クライアントシークレット | Functions の `secrets` で注入 |
| 秘密 | Cloud KMS | GBP のリフレッシュトークンを暗号化して保存 | Firestore には暗号文のみ置く |
| バッチ | Cloud Scheduler + Cloud Tasks | 順位計測の定期実行。キーワード単位に分割して並列・リトライ | 1 関数でまとめて回すとタイムアウトしやすいため分割する |

### Functions のドメイン分割（案）

CLAUDE.md の「業務ドメインとの対応が分かるフォルダ構成」に合わせる。

```
functions/src/
├─ index.ts              エントリ。firebase-admin の初期化はここで 1 回だけ
├─ identity/             組織作成・招待・メンバー権限
├─ google/               OAuth 連携・GBP アカウント / ロケーション取得
├─ stores/               店舗の取込・更新
├─ surveys/              公開管理（公開スナップショットの生成・停止）
├─ responses/            回答受付・条件判定・口コミ下書き生成・遷移ログ
├─ rankings/             順位計測（定期 / 手動 / タスクワーカー）
├─ usage/                利用量カウント・上限判定
└─ shared/               Firestore 書き込み helper、権限チェック、LLM / 順位プロバイダのアダプタ
```

> `region` は `.claude/PROJECT.md` で定義する（現在は未記入。I-20）。

## 3. 主要シーケンス

### 3.1 アンケート回答 → 口コミ下書き → Google 遷移（R-1 / R-2）

```mermaid
sequenceDiagram
  autonumber
  actor R as 回答者
  participant P as 回答画面 /s/[slug]
  participant FS as Firestore
  participant F as Functions
  participant L as LLM API
  participant G as Google 口コミ画面

  R->>P: QR / URL からアクセス
  P->>FS: publicSurveys/{slug} を取得（公開中のみ読取可）
  FS-->>P: 設問（遷移条件は含まない）
  R->>P: 回答して送信
  P->>F: postSurveyResponse（App Check 付き）
  F->>FS: 公開状態・期間・重複を検証し回答を保存
  F->>F: 遷移条件を評価（サーバー側）
  alt 条件を満たす
    F-->>P: isEligible=true, responseId
    P->>F: createReviewDraft(responseId)
    F->>L: 回答内容 + 店舗の生成設定で下書きを生成
    L-->>F: 下書き文面
    F->>FS: 下書きを回答に保存・利用量を加算
    F-->>P: 下書き・reviewUrl
    R->>P: 文面を確認・編集
    R->>P: 「コピーして Google で投稿」
    P->>P: クリップボードにコピー
    P->>F: postReviewRedirect(responseId)（遷移ログ）
    P->>G: 新しいタブで口コミ投稿画面を開く
    R->>G: 本文を貼り付けて投稿（Google アカウントで）
  else 条件を満たさない
    F-->>P: isEligible=false
    P-->>R: お礼画面（店舗へのフィードバックとして受付）
  end
```

> Google の口コミ URL は本文を受け取れないため、「生成した文面をそのまま投稿させる」ことはできません。回答者が自分で貼り付けて投稿します（I-04）。

### 3.2 Google Business Profile 連携（R-5）

```mermaid
sequenceDiagram
  autonumber
  actor A as 管理者（owner / admin）
  participant P as 管理画面 /admin/[orgId]/settings/google
  participant F as Functions
  participant GO as Google OAuth
  participant GBP as GBP APIs
  participant FS as Firestore

  A->>P: 「Google と連携」
  P->>F: createGoogleAuthUrl(orgId)
  F->>FS: state（orgId・uid・期限）を保存
  F-->>P: 認可 URL
  P->>GO: リダイレクト（scope: business.manage）
  GO-->>F: googleOAuthCallback?code&state（onRequest）
  F->>FS: state を検証して削除
  F->>GO: code → access / refresh token
  F->>F: refresh token を KMS で暗号化
  F->>FS: googleConnections と oauthTokens を保存
  F-->>P: 設定画面へリダイレクト
  A->>P: 「店舗を取り込む」
  P->>F: getGbpLocations(connectionId)
  F->>GBP: accounts.list → locations.list
  GBP-->>F: ロケーション一覧（placeId 含む）
  F-->>P: 候補一覧
  A->>P: 取り込む店舗を選択
  P->>F: createStoresFromGbp(locationNames)
  F->>FS: stores を作成（placeId と reviewUrl を保存）
```

### 3.3 順位計測（R-4）

```mermaid
sequenceDiagram
  autonumber
  participant S as Cloud Scheduler
  participant F as Functions
  participant T as Cloud Tasks
  participant RP as Google マップ（Headless Chrome）
  participant FS as Firestore

  S->>F: scheduledRankCheck（毎日 1 回）
  F->>FS: 有効な rankKeywords を取得
  loop キーワードごと
    F->>T: rankCheckWorker のタスクを投入
  end
  T->>F: rankCheckWorker(keywordId)
  F->>FS: 利用量の上限を確認
  F->>RP: キーワード + 検索地点で検索
  RP-->>F: 上位 20 件（placeId・店名・評価など）
  F->>F: 店舗の placeId と照合して順位を算出
  F->>FS: 順位（rankSnapshots）と上位 20 件（rankResults）を保存
```

> 競合の店名・評価は計測結果の 20 件として保存し、順位推移画面で日付を選んだときに読む（F-17）。

## 4. 非機能方針

| 観点 | 方針 |
| --- | --- |
| マルチテナント分離 | すべての業務データを `organizations/{orgId}` 配下に置き、ルールでメンバー判定する |
| 公開データの分離 | 回答画面が読むのは `publicSurveys` の公開スナップショットだけ。管理用の設定（遷移条件など）は公開しない |
| 秘密情報 | OAuth トークンと API キーはクライアントに出さない。トークンは KMS で暗号化し、ルールで全拒否のコレクションに置く |
| 濫用対策 | 回答送信・下書き生成は App Check 必須。回答単位で下書き生成回数に上限を設ける |
| コスト管理 | LLM と順位取得は従量課金のため、組織ごとの月次利用量を記録し上限で止める |
| 冪等性 | 回答送信はクライアント生成の `submissionId` を使って重複保存を防ぐ。順位計測は `keywordId + 日付` をドキュメント ID にする |
| 監査 | 公開 / 停止、連携 / 解除、メンバー変更を監査ログに残す |
