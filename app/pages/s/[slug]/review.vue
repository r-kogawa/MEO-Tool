<script setup lang="ts">
definePageMeta({ layout: 'survey' })
useSeoMeta({ title: '口コミのお願い', robots: 'noindex, nofollow' })

// F-13 Google 口コミへの案内。文面の生成・コピーは今回は作らず、Google の口コミ画面を開くボタンだけを置く

const route = useRoute()
const slug = String(route.params.slug)
const { snapshot, lastResult } = usePublicSurvey(slug)
const { openGoogle } = useReviewDraft(slug)

// 直接開かれた場合（回答していない・条件を満たしていない・口コミ URL が手元にない）は回答画面へ戻す
if (!lastResult.value?.isEligible || !lastResult.value.reviewUrl) {
  await navigateTo(`/s/${slug}`, { replace: true })
}

const isOpened = ref(false)

function onOpenGoogle(): void {
  const result = lastResult.value
  if (!result?.reviewUrl) return
  openGoogle(result.responseId, result.reviewUrl)
  isOpened.value = true
}
</script>

<template>
  <div class="space-y-5">
    <header class="space-y-2 text-center">
      <p class="text-sm font-medium text-brand-700">{{ snapshot?.storeName }}</p>
      <h1 class="text-xl font-bold text-slate-900">ご回答ありがとうございます</h1>
      <p class="text-sm leading-relaxed text-slate-600">
        よろしければ、Google マップに口コミを投稿していただけると励みになります。投稿は任意です。
      </p>
    </header>

    <UiCommonButton is-block icon="google" @click="onOpenGoogle">Google に口コミを書く</UiCommonButton>

    <section v-if="isOpened" class="space-y-3 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800">
      <p class="font-medium">開いた Google の画面で、次の手順で投稿してください。</p>
      <ol class="list-decimal space-y-1 pl-5">
        <li><strong>星の数</strong>を選ぶ</li>
        <li>ご感想を書く</li>
        <li>「<strong>投稿</strong>」をタップ</li>
      </ol>
      <p class="text-xs text-brand-700">Google の画面が開かない場合は、ポップアップのブロックを解除してもう一度お試しください。</p>
      <UiCommonButton :to="`/s/${slug}/thanks`" variant="secondary" is-block>完了</UiCommonButton>
    </section>

    <NuxtLink v-else :to="`/s/${slug}/thanks`" class="block text-center text-sm text-slate-500 hover:underline">
      投稿しない
    </NuxtLink>
  </div>
</template>
