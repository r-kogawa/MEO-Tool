<script setup lang="ts">
// 組織ごとに自社の GCP で GBP API と OAuth クライアントを用意してもらうための手順

interface Props {
  callbackUrl: string | null
}

defineProps<Props>()
</script>

<template>
  <ol class="list-decimal space-y-3 pl-5 text-sm text-slate-700">
    <li>
      Google Cloud でプロジェクトを作成し、<span class="font-medium">Google Business Profile API の利用申請</span>を行います。
      承認後、「My Business Account Management API」「My Business Business Information API」「Google My Business API」を有効にします。
    </li>
    <li>
      「OAuth 同意画面」を設定し、公開ステータスを<span class="font-medium">「本番環境」</span>にします。
      <span class="text-rose-700">「テスト」のままだと 7 日で連携が切れます。</span>
    </li>
    <li>
      「認証情報」で OAuth クライアント ID（種類: ウェブアプリケーション）を作成し、「承認済みのリダイレクト URI」に次の URL を登録します。
      <div v-if="callbackUrl" class="mt-2 flex flex-wrap items-center gap-2">
        <code class="rounded bg-slate-100 px-2 py-1 text-xs break-all">{{ callbackUrl }}</code>
        <UiCommonButton size="sm" variant="secondary" icon="copy" @click="copyToClipboard(callbackUrl, 'リダイレクト URI をコピーしました')">コピー</UiCommonButton>
      </div>
    </li>
    <li>作成したクライアント ID とクライアントシークレットを下のフォームに登録します。</li>
    <li>「Google で連携する」を押し、ビジネスプロフィールのオーナーまたは管理者の Google アカウントで許可します。</li>
  </ol>
</template>
