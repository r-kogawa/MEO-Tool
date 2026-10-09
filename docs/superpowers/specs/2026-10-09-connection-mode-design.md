# 接続先とデモ判定の変更 設計

- 作成日: 2026-10-09
- 対象: 画面（Nuxt SPA）の Firebase 接続、モック（デモ）判定、ローカル起動スクリプト、Functions の Emulator 判定
- 範囲外: 運営画面の本接続（本番の運営者アカウント・Custom Claims の判定）。次の仕様書で扱う

## 1. 目的

ビルド時の環境変数（`NUXT_PUBLIC_USE_MOCK` / `NUXT_PUBLIC_USE_EMULATOR`）でモードを決める今の作りは、`npm run generate` を使うとモックのまま Hosting に公開されるという事故が起きた（2026-10-09）。次のように変える。

1. 画面は**常に本番の Firebase**（Auth / Firestore / Storage / Functions）に接続する
2. **モックかどうかは、デモアカウント 3 人のどれかでログインしているか**で実行時に決める
3. ローカル（`localhost` / `127.0.0.1`）で開いたときは、**Functions だけ** `connectFunctionsEmulator(functions, '127.0.0.1', 5001)` で手元の Emulator に向ける

## 2. 決定事項（2026-10-09 ユーザー確認済み）

| 項目 | 決定 |
| --- | --- |
| デモアカウント | `DEMO_ACCOUNTS` の 3 人（`u-kobayashi` / `u-tanaka` / `u-sato`）だけ。仮データ内のそれ以外のユーザー（suzuki / kimura / ops）はログインできない |
| メールとパスワードのデモログイン | 残す。3 人のメールアドレス + `DEMO_PASSWORD` ならデモ、それ以外は Firebase Auth |
| 運営画面のデモ | 削除する（`u-ops` の運営フラグでのログイン手段をなくす）。本番の運営者は次の仕様書で作る |
| 本番の Hosting | ビルド 1 種類。`npm run generate` がそのまま本番用 |

## 3. 設計

### 3.1 接続（`app/plugins/firebase.client.ts`）

- `runtimeConfig.public.useMock` / `useEmulator` を `nuxt.config.ts` から削除する
- Auth / Firestore / Storage の Emulator 接続（`connectAuthEmulator` / `connectFirestoreEmulator` / `connectStorageEmulator`）を削除する
- `location.hostname` が `localhost` か `127.0.0.1` のときだけ `connectFunctionsEmulator(functions, '127.0.0.1', 5001)` を呼ぶ。判定は `app/utils/firebase/isLocalHost.ts`（`isLocalHost(hostname: string): boolean`）に切り出す

### 3.2 デモの判定（新規 `app/composables/useDemoSession.ts`）

```ts
export function useDemoSession(): {
  demoUid: Ref<string | null>          // useState('demo-uid')。localStorage 'meo-tool:mock-uid' から復元
  isMock: ComputedRef<boolean>         // demoUid が DEMO_ACCOUNTS の uid のどれか
  enterDemo(uid: string): void         // DEMO_ACCOUNTS 以外の uid は受け付けない（何もしない）
  leaveDemo(): void
}
```

- 保存キーは今と同じ `meo-tool:mock-uid`。保存されている uid が 3 人以外（旧 `u-ops` など）なら、復元時に捨てる
- localStorage の読み書きは今の `useAuth.ts` の `readStoredUid` / `writeStoredUid` を移す（try/catch 付き）

### 3.3 `isMock` の置き換え

`useRuntimeConfig().public.useMock` を読んでいる 28 ファイルを `const { isMock } = useDemoSession()` に置き換え、使う側を `isMock.value` にする（テンプレートでは自動でアンラップされる）。

`useState` の初期値など、**一度だけ評価される場所**は次のように個別に直す。

| 場所 | 今 | 変更後 |
| --- | --- | --- |
| `useAppDb` | 呼んだ時点のモードで `useMockDb()` か Firestore の state を返す | `computed(() => isMock.value ? mock.value : firestore.value)` を返す。`db.value = …` の代入はしない前提（代入しているのは `useFirestoreSync` だけで、下で直す） |
| `useFirestoreSync` | `useAppDb()` に書き込む | 新規 `useFirestoreDb()`（`useState<MockDb>('firestore-db', createEmptyDb)`）に書き込む。デモ中も購読は動いているが、Firebase はログアウト済みなので空のまま |
| `firestore-sync.client.ts` | 本物モードだけ購読を開始 | 常に開始する |
| `useBackendReady` | `useState` の初期値を `isMock` にしている | state は Firebase の状態だけを持つ。`waitForAuth` / `waitForOrgs` は `isMock.value \|\| state.…` で判定する |
| `useAuth` の `uid` | モックだけ localStorage から復元 | `useDemoSession().demoUid` を使う |
| `usePublicSurvey` | `isLoading = ref(!isMock)`、`if (!isMock) void load()` | 呼んだ時点の `isMock.value` で決めてよい（ページを開くたびに呼ばれ、ページ内でモードは変わらない）。コメントでそう明記する |

### 3.4 ログイン・ログアウト（`useAuth`）

| 操作 | 処理 |
| --- | --- |
| `login(email, password)` | メールが 3 人のどれかで、パスワードが `DEMO_PASSWORD` なら：`signOut($auth)` → `enterDemo(uid)`。それ以外：`leaveDemo()` → `signInWithEmailAndPassword` |
| `loginAs(uid)`（デモボタン） | `signOut($auth)` → `enterDemo(uid)` |
| `logout()` | デモ中なら `leaveDemo()`、それ以外は `signOut($auth)` |
| `signup` / `registerUser` | 常に本番の処理だけにする（モックの分岐を削除）。先に `leaveDemo()` を呼ぶ |
| `requestPasswordReset` | 常に本番の処理だけにする。ログインではないので `leaveDemo()` は呼ばない |

- `user` は `isMock.value ? 仮データのユーザー : Firestore 側の users[0]`
- 3 人のメールは仮データの `users` から uid で引く（`DEMO_ACCOUNTS` にメールは持たせない）
- デモ中に `signOut` が失敗しても、デモへの切り替えは続ける（Firebase の状態は購読側で空になる）

### 3.5 画面

- `login.vue`：デモアカウントのボタンとパスワードの案内（`DEMO_PASSWORD`）を**常に**表示する
- `layouts/auth.vue`：「Firebase 未接続のため仮データ」の文言を「デモアカウントでログイン中のため、仮データで動作しています」に変え、デモ中だけ表示する
- `pages/index.vue`：説明文を「デモアカウントでログインすると、仮の固定データで動作します。…」に変えて常に表示する。「回答画面のデモ」（仮データの公開アンケートへのリンク）はデモ中だけ表示する（デモ以外では本番の Firestore を読むため、リンク先が見つからない）
- `org-ready.global.ts` / `useAdminNav`：準備中の判定はデモでないときだけ（今の `!useMock` を `!isMock.value` に）
- `settings/google.vue`：デモ中だけ仮の連携フォームを出す（今と同じ判定を `isMock.value` に）

### 3.6 仮データ

- `u-ops` は運営フラグ（`isOperator: true`）を持つが、ログインできなくなる。仮データからは消さない（運営画面の仮データや組織のメンバー表示の参照元のため）。次の仕様書で運営画面を本接続するときに整理する

### 3.7 Functions の Emulator 判定

手元の Functions Emulator は本番の Firestore を読み書きするようになる。次の 2 か所は「Emulator ならローカル用の値」としているため、本番データを壊す。

| ファイル | 問題 | 変更 |
| --- | --- | --- |
| `functions/src/shared/secrets.ts:66` | 手元で Google 連携すると、ローカル暗号で暗号化したトークンが本番に保存され、本番の Functions で復号できない | ローカル暗号を使う条件を `SECRET_CIPHER === 'local'` または「`FUNCTIONS_EMULATOR === 'true'` かつ `FIRESTORE_EMULATOR_HOST` が設定済み」（＝データも Emulator）にする |
| `functions/src/responses/ipHash.ts:18` | 手元からの回答が固定ソルトでハッシュされ、本番の回答とハッシュがそろわない | 固定ソルトを使う条件を同じく「`FUNCTIONS_EMULATOR === 'true'` かつ `FIRESTORE_EMULATOR_HOST` 設定済み」にする |

判定は `functions/src/shared/emulator.ts` の `isFullyEmulated(): boolean` にまとめる。`test:emulator`（Firestore Emulator 上の結合テスト）は `FIRESTORE_EMULATOR_HOST` が入るので今のまま動く。

### 3.8 起動スクリプト

| スクリプト | 変更 |
| --- | --- |
| `dev` | `nuxt dev` のまま。localhost で開くので Functions は 127.0.0.1:5001 に向く。Functions Emulator（`npm --prefix functions run serve`）を起動していないと、Functions を呼ぶ操作は失敗する（デモと閲覧は動く） |
| `dev:emulator` | **削除**（`scripts/dev-emulator.sh` も削除）。ローカルかどうかは画面を開いたホスト名だけで決める（3.1）。手元で Functions を呼ぶときは、別のターミナルで `npm --prefix functions run serve`（既存。Functions Emulator だけを起動）を動かす。スクリプトが渡していた `OAUTH_CALLBACK_URL` / `ADMIN_APP_URL` / `CHROME_PATH` は `functions/.env.local`（Functions Emulator だけが読む。`functions/.gitignore` の `*.local` で追跡外、`firebase.json` の ignore でデプロイ対象外）に置く（2026-10-09 ユーザー指示） |
| `dev:firebase` / `generate:firebase` | 削除 |
| `generate` | そのまま（本番用） |
| `test:emulator` | そのまま |

`.emulator-data/` は使わなくなる。`.gitignore` の行は残す（手元に古いフォルダが残っていても追跡されないように）。

### 3.9 ドキュメント

- `.claude/PROJECT.md`：「モード（モック / 本接続）」と「npm scripts」「Emulator」の節を新しい作りに書き直す。手元で Functions Emulator を動かす前提（`gcloud auth application-default login`、`functions/.secret.local`、本番データに書き込まれること）を書く
- `docs/` で `NUXT_PUBLIC_USE_MOCK` に触れている箇所を更新する

## 4. 注意点（ユーザーに伝える）

- 手元の Functions が**本番のデータ**を読み書きする。手元で作った組織や計測結果は本番に残る
- 手元で Functions を動かすには、本番の Firestore / Auth / KMS に触れる認証情報（`gcloud auth application-default login`）と、`KMS_KEY_NAME` などの Secret が要る
- 定期実行（`scheduledRankCheck` / `scheduledGbpReviewsSync`）は手元では発火しない。手動の順位計測（タスクキュー）は Functions Emulator 内で動く
- `localhost` で画面を開いて Functions Emulator を起動していないと、Functions を呼ぶ操作（組織作成など）はすべて失敗する

## 5. テスト

| 観点 | 内容 |
| --- | --- |
| 正常系 | デモボタン 3 人それぞれでログインし仮データが出る / 3 人のメール + `password` でデモに入る / 本物のアカウントで本番データが出る / ログアウトで両方抜ける |
| 異常系 | 3 人のメール + 違うパスワード → Firebase Auth で認証（失敗表示） / `ops@example.com` + `password` → Firebase Auth で認証 / localStorage に `u-ops` が残っている → 未ログイン扱い |
| 境界値 | 本番ログイン中にデモボタン → Firebase からログアウトしてデモに入る / デモ中に新規登録 → デモを抜けて本番で登録 / 再読み込みでデモ・本番どちらの状態も保たれる |
| 既存機能への影響 | `/s/{slug}` は未ログインで本番の公開アンケートを読む / `test:emulator` が通る / 本番ビルドに Emulator 接続が入らない（`localhost` 以外では `connectFunctionsEmulator` を呼ばない） |

自動テスト：`isFullyEmulated` を Functions の単体テスト（`functions` の `npm test`）にする。画面側にはテストの仕組みが無いため（ルートの `package.json` にテストランナーなし）、新しく入れずに `npm run typecheck` と Playwright の手動確認で代える。`isLocalHost` と `isDemoUid`（`useDemoSession` の uid 判定）は確認しやすいよう純粋関数に切り出しておく。
