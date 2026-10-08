# 06. API 利用料と月額原価の試算

有料 API と Firebase / Google Cloud の利用料から、サービス全体と組織 1 つあたりの **1 か月の原価**を試算する。

> **試算日: 2026-09-29。** 単価は公式ページと検索結果で確認した値。為替は **1 ドル = 150 円**。
> 2026-10-08 に、順位の取得方式を自前スクレイピングに変更したことを反映した（Places API の費用を削除し、ワーカーの実行費用を追加）。
> 利用規模（回答数・キーワード数など）は要件に指定がないため仮置き（I-23）。規模が決まったら再計算する。

## 1. 結論

| 規模 | 自前スクレイピング（採用） | 参考: SERP API に切り替え |
| --- | --- | --- |
| A. 立ち上げ期（10 組織） | **約 0.1 万円** | 約 0.1 万円 |
| B. 成長期（100 組織） | **約 1.0 万円** | 約 1.2 万円 |
| C. 拡大期（500 組織） | **約 6.8 万円** | 約 7.5 万円 |

- 順位は自前で Google マップを Headless Chrome で計測する（I-07）。API 料金はかからず、`rankCheckWorker`（2GiB・1 件 10 秒前後）の Functions 実行費用だけが増える
- 競合は計測結果の上位 20 件をそのまま使うため、Place Details は呼ばない（旧設計では原価の大半だった）
- 原価の中心は口コミ下書きの生成（LLM）と、規模が大きくなるときの順位計測のワーカーと reCAPTCHA
- SERP API の列は、`RankProvider` を差し替えた場合の参考値（取得データの保存可否は事業者の規約で確認が必要）

## 2. 使う API と単価

| 用途 | 呼び出す API | 課金区分（取得するフィールド） | 単価 | 月の無料枠 |
| --- | --- | --- | --- | --- |
| 順位計測（F-16） | 自前の Google マップ取得（API 料金なし） | — | **無料** | — |
| 順位計測のワーカー（F-16） | Cloud Functions（2nd gen）`rankCheckWorker` | 2GiB（1 vCPU）× 実行時間。1 件 10 秒前後 | 約 $0.000024 / vCPU 秒 + 約 $0.0000025 / GiB 秒（1 件あたり約 0.04 円） | 18 万 vCPU 秒・36 万 GiB 秒 |
| タスクキュー（F-16） | Cloud Tasks | 操作回数 | 月 100 万件まで無料 | 100 万件 |
| 口コミ下書き（F-08 / F-12） | Gemini 3.8 Flash（第一候補） | 入力 / 出力トークン | $0.75 / $3.75（100 万トークンあたり）※2027-01 から $1.5 / $7.5 | — |
| 同上（代替） | Claude Haiku 4.5 | 入力 / 出力トークン | $1 / $5（100 万トークンあたり） | — |
| GBP 連携（F-04 / F-05） | Google Business Profile APIs | — | **無料**（利用申請の承認が必要） | — |
| bot 対策（F-10 / F-12） | reCAPTCHA（App Check） | 判定回数 | 1 万〜10 万回は定額 $8、超過分は $1 / 1,000 回 | 1 万回 |
| 定期実行（F-16） | Cloud Scheduler | ジョブ数 | $0.10 / ジョブ / 月 | 3 ジョブ |
| バックエンド | Cloud Functions（2nd gen） | 呼び出し回数 | $0.40 / 100 万回 | 200 万回 |
| DB | Firestore | 読み取り / 書き込み | $0.03 / $0.09（10 万件あたり、us-central1） | 1 日 5 万 / 2 万件 |
| （代替）順位取得 | DataForSEO Google Maps SERP | 通常キュー | $0.60 / 1,000 回 | — |

- ワーカーの単価は Tier 1 リージョンの公開単価を記憶から使った値で、公式ページでは再確認していない（6 章）
- 取得元の Google マップは利用規約上の自動取得にあたる（I-07）。ブロックされて計測が止まる日がありうる

## 3. 試算の前提

| 項目 | 個人組織（1 店舗） | 法人組織（10 店舗） |
| --- | --- | --- |
| 月の回答数 | 100 | 1,000 |
| 順位キーワード数（毎日計測） | 5 | 30 |

| 共通の前提 | 値 |
| --- | --- |
| 条件合致率 | 70% |
| 下書きの生成回数（作り直しを含む） | 1 回答あたり 1.3 回 |
| 1 回の生成のトークン数 | 入力 約 1,000・出力 約 300 |
| 組織の内訳 | 個人 8 割・法人 2 割（A: 8 + 2、B: 80 + 20、C: 400 + 100） |
| 順位計測 1 件の実行時間 | 10 秒（2GiB・1 vCPU） |

### 月の呼び出し回数

| 項目 | A. 10 組織 | B. 100 組織 | C. 500 組織 |
| --- | --- | --- | --- |
| 回答数 | 2,800 | 28,000 | 140,000 |
| 順位計測（ワーカーの実行） | 3,000 | 30,000 | 150,000 |
| 下書きの生成 | 2,548 | 25,480 | 127,400 |
| ワーカーの vCPU 秒 / GiB 秒 | 3 万 / 6 万 | 30 万 / 60 万 | 150 万 / 300 万 |

## 4. 内訳

| 項目 | A. 10 組織 | B. 100 組織 | C. 500 組織 |
| --- | --- | --- | --- |
| 順位計測のワーカー（Functions・2GiB） | 0 円（無料枠内） | 約 520 円 | 約 5,750 円 |
| Cloud Tasks | 0 円 | 0 円 | 0 円（無料枠内） |
| 口コミ下書き（Gemini Flash） | 700 円 | 7,200 円 | 35,800 円 |
| bot 対策（reCAPTCHA） | 0 円 | 1,200 円 | 約 20,000 円 |
| Firestore | 0 円 | 約 1,000 円 | 約 5,000 円 |
| その他の Functions / Scheduler | 0 円 | 0 円 | 0 円（無料枠内） |
| Hosting / Secret Manager / KMS | 0 円 | 数十円 | 約 1,000 円 |
| GBP API | 0 円 | 0 円 | 0 円 |
| **合計** | **約 0.1 万円** | **約 1.0 万円** | **約 6.8 万円** |

### 組織 1 つあたりの原価（B 規模・無料枠を使い切った後）

| 組織 | 原価 | 内訳 |
| --- | --- | --- |
| 個人（1 店舗） | 約 35 円 | 順位計測 150 件 約 7 円・下書き 約 26 円 |
| 法人（10 店舗） | 約 300 円 | 順位計測 900 件 約 40 円・下書き 約 260 円 |

料金プランを決めるときの原価の下限の目安にする（I-16）。

## 5. 変動要因

| 要因 | 影響 |
| --- | --- |
| **Gemini Flash の値上げ（2027-01）** | 導入価格の終了で下書きの費用が約 2 倍。C 規模で約 3.6 万円から約 7.2 万円 |
| ブロックと再試行 | Google にブロックされると再試行（最大 3 回）で実行時間が増える。日次計測は `blocked` が続くと打ち切る |
| 回答数・キーワード数 | 下書き・Firestore・reCAPTCHA は回答数に、ワーカーの費用はキーワード数と手動 / その場計測の回数に比例する |
| LLM の提供元（I-06） | Claude Haiku 4.5 にすると下書きの費用は約 1.3 倍（B 規模で 7,200 円から 9,600 円） |
| 順位の取得元（I-07） | SERP API に切り替えるとワーカーの費用は不要になるが、API 料金が発生する（B 規模で約 2,700 円）。口コミ件数も安定して取れる |

## 6. 確度が低い項目・計上していない費用

**確度が低い項目**（いずれも金額が小さく、合計への影響は軽微）

- Firestore の東京リージョン（asia-northeast1）の単価。us-central1 の単価から推定した
- Cloud Functions のワーカーの単価（vCPU 秒・GiB 秒）と無料枠、Cloud Tasks の無料枠（月 100 万件）、Secret Manager・KMS の単価。記憶または一般に知られる値で、公式ページでは確認していない
- ワーカーの実行時間。実画面では 1 件 5.6〜7.6 秒（手元の Chrome）。Chromium の起動を含む本番の時間は未計測
- reCAPTCHA の 10 万回超の課金方法。安全側（全件に課金）で計算した

**計上していない費用**

- メール送信（招待・通知。送信手段は未決 I-17）
- ドメイン・SSL
- 決済手数料（I-16）
- 開発・保守の人件費
- 手動の「今すぐ計測」・その場計測の分のワーカー費用（回数は利用状況による）
- プロキシ（使わない前提。ブロックが続く場合は別途検討）

## 7. 推奨と次のステップ

1. 本番での `rankCheckWorker` の実行時間とブロック率を記録し、この試算と突き合わせる
2. LLM の提供元を決める（I-06）。費用差は小さいので、品質とデータの取り扱い条件で選んでよい
3. 利用規模の想定を決めて再計算する（I-23）
4. ブロックが続く場合は `RankProvider` を SERP API に差し替える（I-07）

## 出典

- [Google Maps Platform core services pricing list](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Pricing - Claude Platform Docs](https://platform.claude.com/docs/en/about-claude/pricing)
- [Pricing | Google Business Profile APIs](https://developers.google.com/my-business/content/pricing)
- [reCAPTCHA billing information](https://docs.cloud.google.com/recaptcha/docs/billing-information)
- [Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing)
- [Pricing | Cloud Functions](https://cloud.google.com/functions/pricing?hl=ID)
- [Firestore pricing](https://cloud.google.com/firestore/pricing)
- [DataForSEO Google Maps SERP API pricing](https://dataforseo.com/pricing/serp/google-maps-serp-api)
