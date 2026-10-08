<script setup lang="ts">
definePageMeta({ layout: 'survey' })
useSeoMeta({ title: 'ご回答ありがとうございました', robots: 'noindex, nofollow' })

const route = useRoute()
const slug = String(route.params.slug)
const { snapshot, lastResult } = usePublicSurvey(slug)

const isFeedbackOnly = computed(() => lastResult.value !== null && !lastResult.value.isEligible)
</script>

<template>
  <div class="space-y-4 py-10 text-center">
    <div class="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
      <UiCommonIcon name="check" size-class="size-7" />
    </div>
    <p v-if="snapshot" class="text-sm font-medium text-brand-700">{{ snapshot.storeName }}</p>
    <h1 class="text-xl font-bold text-slate-900">ご回答ありがとうございました</h1>
    <p v-if="isFeedbackOnly" class="text-sm leading-relaxed text-slate-600">
      ご意見は店舗に届きました。いただいた内容をもとに、より良いお店づくりに努めます。
    </p>
    <p class="text-sm leading-relaxed text-slate-600">
      {{ snapshot?.design.thanksMessage ?? 'またのご来店をお待ちしております。' }}
    </p>
  </div>
</template>
