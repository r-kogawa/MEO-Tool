<script setup lang="ts">
// F-04 OAuth クライアントの設定手順（owner / admin）。非エンジニア向けに Google Cloud の操作を順に説明する

definePageMeta({ layout: 'admin', roles: ['owner', 'admin'] })
useHead({ title: 'OAuth クライアントの設定手順' })

const { adminPath } = useCurrentOrg()
const { callbackUrl, loadCallbackUrl } = useGoogleConnection()

onMounted(() => {
  void loadCallbackUrl().catch(() => { callbackUrl.value = null })
})

const OVERVIEW = [
  { step: 1, task: 'プロジェクトを作る', place: 'Google Cloud', time: '5 分' },
  { step: 2, task: 'ビジネスプロフィール API の利用を申請する', place: 'Google のフォーム', time: '10 分＋承認待ち' },
  { step: 3, task: 'API を 3 つ有効にする', place: 'Google Cloud', time: '5 分' },
  { step: 4, task: '同意画面を設定し、本番に公開する', place: 'Google Cloud', time: '10 分' },
  { step: 5, task: 'OAuth クライアント ID を作る', place: 'Google Cloud', time: '10 分' },
  { step: 6, task: 'ID とシークレットを登録し、連携する', place: '本ツール', time: '5 分' },
]

const TERMS = [
  { term: 'Google Cloud', meaning: 'Google のサービスを他のツールから使うための設定画面。無料の範囲で使えます' },
  { term: 'プロジェクト', meaning: 'Google Cloud の中の「設定の箱」。今回の設定はすべてこの箱に入れます' },
  { term: 'API', meaning: '本ツールが Google に口コミや店舗情報を問い合わせるための窓口' },
  { term: 'OAuth クライアント', meaning: '本ツールが「この会社の許可を得たツールです」と Google に名乗るための証明書' },
  { term: 'クライアント ID', meaning: '証明書の番号。「数字-英数字.apps.googleusercontent.com」の形です' },
  { term: 'クライアントシークレット', meaning: '証明書の合い鍵。パスワードと同じく、他人に教えないでください' },
  { term: 'リダイレクト URI', meaning: 'Google で許可したあとに戻ってくる先のアドレス。本ツールが指定したものをそのまま使います' },
]

const REQUIRED_APIS = ['My Business Account Management API', 'My Business Business Information API', 'Google My Business API']

const TROUBLES = [
  { message: 'Google 側の画面で「redirect_uri_mismatch」', cause: 'リダイレクト URI の登録漏れ・入力間違い', action: '手順 5 の 4 をやり直し、上のコピーボタンの値を貼り付ける' },
  { message: 'OAuth クライアントの設定が正しくありません', cause: 'クライアント ID かシークレットの貼り付け間違い', action: 'Google 連携画面の「変更」から、ID とシークレットを貼り直す' },
  { message: 'Google の同意画面でアクセスが許可されませんでした', cause: 'Google の画面で「キャンセル」を押した', action: 'もう一度「Google で連携する」を押し、許可する' },
  { message: 'ビジネスプロフィールのアカウントを取得できませんでした', cause: '手順 2 が未承認、手順 3 の API が無効、または管理者でないアカウントで許可した', action: '承認メール・3 つの API・アカウントを確かめてから連携し直す' },
  { message: 'Google から長期利用の許可を受け取れませんでした', cause: '以前の許可が Google 側に残っている', action: 'Google アカウントの「サードパーティ製のアプリとサービス」で手順 4 のアプリ名へのアクセスを削除し、連携し直す' },
  { message: '連携の有効期限が切れました', cause: 'Google の画面を開いたまま時間がたった', action: '「Google で連携する」からやり直す' },
  { message: '連携中のアカウントが 7 日後に「要再認証」になる', cause: '同意画面が「テスト」のまま', action: '手順 4 の 5 で「本番環境」にし、「再認証」を押す' },
  { message: '「運営にお問い合わせください」を含むメッセージ', cause: '本ツール側の設定の問題', action: 'お客様側での対処は不要です。メッセージを添えて運営に連絡する' },
]
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <UiCommonPageHeader
      title="OAuth クライアントの設定手順"
      description="自社の Google Cloud で OAuth クライアントを作り、本ツールに登録するまでの手順です。Google の申請の承認待ちを除けば 30〜60 分ほどで終わります。"
      :back-to="adminPath('/settings/google')"
      back-label="Google 連携に戻る"
    />

    <UiCommonCard title="全体の流れ" description="手順 1〜5 は Google Cloud の画面、手順 6 だけが本ツールの画面で行います" is-flush>
      <p class="px-5 pt-4 text-sm text-slate-700">手順 2 の申請は承認まで数日かかることがあるので、最初に済ませておくと待ち時間を減らせます。</p>
      <div class="overflow-x-auto pt-3">
        <table class="w-full min-w-[520px] text-sm">
          <thead class="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th scope="col" class="px-5 py-2.5 font-medium">手順</th>
              <th scope="col" class="px-3 py-2.5 font-medium">やること</th>
              <th scope="col" class="px-3 py-2.5 font-medium">作業する場所</th>
              <th scope="col" class="px-5 py-2.5 font-medium">目安</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="row in OVERVIEW" :key="row.step">
              <td class="px-5 py-3 text-slate-600 tabular-nums">{{ row.step }}</td>
              <td class="px-3 py-3 text-slate-900">{{ row.task }}</td>
              <td class="px-3 py-3 text-slate-600">{{ row.place }}</td>
              <td class="px-5 py-3 text-slate-600">{{ row.time }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCommonCard>

    <UiCommonCard title="始める前に">
      <div class="space-y-4 text-sm text-slate-700">
        <p>作業には、店舗のビジネスプロフィールを管理している Google アカウントが必要です。次の 3 つを手元に用意してください。</p>
        <ul class="list-disc space-y-1 pl-5">
          <li>店舗のビジネスプロフィールの「オーナー」または「管理者」になっている Google アカウント</li>
          <li>本ツールの「オーナー」権限のログイン（登録フォームはオーナーにしか表示されません）</li>
          <li>パソコンのブラウザ（Google Chrome 推奨。スマートフォンでは操作しづらい画面です）</li>
        </ul>
        <p>手順に出てくる言葉は、次の意味です。</p>
        <dl class="divide-y divide-slate-100 rounded-lg border border-slate-200">
          <div v-for="item in TERMS" :key="item.term" class="grid gap-1 px-4 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
            <dt class="font-medium text-slate-900">{{ item.term }}</dt>
            <dd class="text-slate-600">{{ item.meaning }}</dd>
          </div>
        </dl>
      </div>
    </UiCommonCard>

    <UiCommonCard title="手順 1: プロジェクトを作る">
      <ol class="list-decimal space-y-2 pl-5 text-sm text-slate-700">
        <li>
          <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" class="text-brand-700 underline">Google Cloud コンソール</a>
          を開き、ビジネスプロフィールを管理している Google アカウントでログインします。初めての場合は利用規約への同意を求められます。
        </li>
        <li>画面左上のプロジェクト名の欄（「プロジェクトを選択」）を押し、「新しいプロジェクト」を押します。</li>
        <li>プロジェクト名に分かりやすい名前（例: 社名-MEO連携）を入れ、「作成」を押します。</li>
        <li>作成後、左上の欄が今作ったプロジェクト名になっていることを確かめます。以降の手順はすべてこのプロジェクトで行います。</li>
        <li>ダッシュボードに表示される「プロジェクト番号」（12 桁前後の数字）を控えておきます。手順 2 の申請で使います。</li>
      </ol>
    </UiCommonCard>

    <UiCommonCard title="手順 2: ビジネスプロフィール API の利用を申請する">
      <div class="space-y-4 text-sm text-slate-700">
        <p>ビジネスプロフィールの API は、Google の承認を受けるまで使えません。承認前に連携すると、手順 6 で「ビジネスプロフィールのアカウントを取得できませんでした」と表示されます。</p>
        <ol class="list-decimal space-y-2 pl-5">
          <li>
            <a href="https://developers.google.com/my-business/content/prereqs" target="_blank" rel="noopener noreferrer" class="text-brand-700 underline">Google ビジネスプロフィール API の利用開始ページ</a>
            を開き、「アクセスをリクエスト」のフォームへ進みます。
          </li>
          <li>会社名、会社のウェブサイト、手順 1 で控えたプロジェクト番号などを入力して送信します。利用目的は「自社店舗の口コミ返信・投稿・店舗情報の管理」のように書けば十分です。</li>
          <li>審査結果はメールで届きます。数日かかることがあるので、待つ間に手順 3〜5 を進めて構いません。</li>
        </ol>
        <p class="text-slate-500">申請には、確認済みで一定期間運用しているビジネスプロフィールや、会社のウェブサイトなどの条件があります。最新の条件は上のページで確認してください。</p>
      </div>
    </UiCommonCard>

    <UiCommonCard title="手順 3: API を 3 つ有効にする">
      <div class="space-y-4 text-sm text-slate-700">
        <ol class="list-decimal space-y-2 pl-5">
          <li>Google Cloud コンソール左上のメニュー（≡）から「API とサービス」→「ライブラリ」を開きます。</li>
          <li>
            検索欄に次の名前を 1 つずつ入れ、出てきた API を開いて「有効にする」を押します。
            <ul class="mt-2 list-disc space-y-1 pl-5">
              <li v-for="api in REQUIRED_APIS" :key="api" class="font-medium text-slate-900">{{ api }}</li>
            </ul>
          </li>
          <li>3 つとも「API とサービス」の一覧に表示されていれば完了です。</li>
        </ol>
        <p class="text-slate-500">「Google My Business API」は、手順 2 の承認後でないと検索に出てこないことがあります。その場合は承認メールを受け取ってから有効にしてください。</p>
      </div>
    </UiCommonCard>

    <UiCommonCard title="手順 4: 同意画面を設定し、本番に公開する">
      <div class="space-y-4 text-sm text-slate-700">
        <p>同意画面は、手順 6 で「このツールにビジネスプロフィールの管理を許可しますか？」と聞かれる Google の画面です。</p>
        <UiCommonAlert tone="warning">公開ステータスは必ず「本番環境」にしてください。「テスト」のままだと、連携が 7 日で切れます。</UiCommonAlert>
        <ol class="list-decimal space-y-2 pl-5">
          <li>メニュー（≡）から「API とサービス」→「OAuth 同意画面」を開きます。「Google Auth Platform」という画面に移るので、「開始」を押します。</li>
          <li>
            「アプリ情報」に入力します。
            <ul class="mt-2 list-disc space-y-1 pl-5">
              <li>アプリ名: 分かりやすい名前（例: 社名 MEO 管理）。同意画面に表示されます</li>
              <li>ユーザーサポートメール: 自分のメールアドレスを選ぶ</li>
            </ul>
          </li>
          <li>
            「対象」で「外部」を選びます。
            <ul class="mt-2 list-disc space-y-1 pl-5">
              <li>会社で Google Workspace を使っていて、連携するアカウントがすべて自社ドメイン（@自社.co.jp など）なら「内部」でも構いません。「内部」には 7 日で切れる制限がなく、手順 4 の 5 の公開作業も不要です</li>
              <li>Gmail（@gmail.com）のアカウントで連携する場合は「外部」を選んでください</li>
            </ul>
          </li>
          <li>「連絡先情報」に自分のメールアドレスを入れ、ポリシーに同意して「作成」を押します。</li>
          <li>「外部」を選んだ場合は、左のメニューの「対象」を開き、公開ステータスの「アプリを公開」を押して「本番環境」にします。</li>
          <li>公開ステータスが「本番環境」と表示されていれば完了です。</li>
        </ol>
        <p class="text-slate-500">Google の審査を受けていないアプリは、手順 6 で「このアプリは Google で確認されていません」と表示されることがあります。自社で作ったアプリなので、「詳細」→「（アプリ名）に移動」と進んで問題ありません。</p>
      </div>
    </UiCommonCard>

    <UiCommonCard title="手順 5: OAuth クライアント ID を作る">
      <div class="space-y-4 text-sm text-slate-700">
        <p>この手順で、本ツールに登録する「クライアント ID」と「クライアントシークレット」が発行されます。</p>
        <ol class="list-decimal space-y-2 pl-5">
          <li>Google Auth Platform の左メニューで「クライアント」を開き、「クライアントを作成」を押します。</li>
          <li>「アプリケーションの種類」で「ウェブ アプリケーション」を選びます。</li>
          <li>「名前」に分かりやすい名前（例: MEOツール連携）を入れます。この名前は社内の管理用で、外には表示されません。</li>
          <li>
            「承認済みのリダイレクト URI」の「URI を追加」を押し、次のアドレスを貼り付けます。1 文字でも違うと連携できないので、必ずコピーして貼り付けてください。
            <div v-if="callbackUrl" class="mt-2 flex flex-wrap items-center gap-2">
              <code class="rounded bg-slate-100 px-2 py-1 text-xs break-all">{{ callbackUrl }}</code>
              <UiCommonButton size="sm" variant="secondary" icon="copy" @click="copyToClipboard(callbackUrl, 'リダイレクト URI をコピーしました')">コピー</UiCommonButton>
            </div>
            <p v-else class="mt-2 text-slate-500">アドレスを読み込めませんでした。Google 連携の画面で確認してください。</p>
          </li>
          <li>「承認済みの JavaScript 生成元」は空欄のままで構いません。「作成」を押します。</li>
          <li>クライアント ID とクライアントシークレットが表示されます。「JSON をダウンロード」を押すか、両方をコピーして安全な場所に控えてください。</li>
        </ol>
        <p class="text-slate-500">シークレットは、この画面を閉じると後から全文を見られない場合があります。控え忘れたときは、同じクライアントの画面で新しいシークレットを追加してください。</p>
      </div>
    </UiCommonCard>

    <UiCommonCard title="手順 6: 本ツールに登録して連携する">
      <div class="space-y-4 text-sm text-slate-700">
        <ol class="list-decimal space-y-2 pl-5">
          <li>本ツールにオーナーでログインし、<NuxtLink :to="adminPath('/settings/google')" class="text-brand-700 underline">「設定」→「Google 連携」</NuxtLink>を開きます。</li>
          <li>「OAuth クライアント」欄のフォームに、手順 5 で控えた「クライアント ID」と「クライアントシークレット」を貼り付け、「登録する」を押します。前後に余分な空白が入らないように注意してください。</li>
          <li>「OAuth クライアントを登録しました」と表示され、クライアント ID と登録日が並んでいれば登録完了です。シークレットは暗号化して保存され、画面には表示されません。</li>
          <li>「Google と連携する」欄の「Google で連携する」を押します。</li>
          <li>Google の画面に移るので、ビジネスプロフィールのオーナーまたは管理者のアカウントを選び、「ビジネスプロフィールの管理」を許可します。チェックボックスが出た場合は、すべてチェックしてください。</li>
          <li>本ツールに戻り「Google と連携しました」と表示され、「連携中のアカウント」に「連携中」のアカウントが並べば完了です。</li>
          <li><NuxtLink :to="adminPath('/stores')" class="text-brand-700 underline">「店舗」画面</NuxtLink>から、ビジネスプロフィールの店舗を取り込めます。</li>
        </ol>
        <p class="text-slate-500">クライアントの登録はオーナーだけができますが、登録後の「Google で連携する」は管理者も押せます。</p>
      </div>
    </UiCommonCard>

    <UiCommonCard title="うまくいかないとき" description="解決しない場合は、表示されたメッセージをそのまま添えて運営にお問い合わせください" is-flush>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[640px] text-sm">
          <thead class="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th scope="col" class="px-5 py-2.5 font-medium">表示されるメッセージ（冒頭）</th>
              <th scope="col" class="px-3 py-2.5 font-medium">よくある原因</th>
              <th scope="col" class="px-5 py-2.5 font-medium">対処</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="row in TROUBLES" :key="row.message" class="align-top">
              <th scope="row" class="px-5 py-3 text-left font-medium text-slate-900">{{ row.message }}</th>
              <td class="px-3 py-3 text-slate-600">{{ row.cause }}</td>
              <td class="px-5 py-3 text-slate-600">{{ row.action }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCommonCard>
  </div>
</template>
