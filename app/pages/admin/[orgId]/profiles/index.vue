<script setup lang="ts">
import type { BatchResult } from '~/types/domain'

definePageMeta({ layout: 'admin' })
useHead({ title: 'プロフィール' })

// GBP プロフィールの一覧と同期

const { adminPath, storeName } = useCurrentOrg()
const { profiles, syncProfiles } = useGbpProfiles()
const { show } = useToast()
const { isPending, errorMessage, run } = useActionState()
const lastFailures = ref<BatchResult['failed']>([])

async function onSync(): Promise<void> {
  const result = await run(() => syncProfiles())
  if (!result) return
  lastFailures.value = result.failed
  if (result.failed.length === 0) show(`${result.succeeded.length} 店舗を同期しました`)
  else show(`${result.failed.length} 店舗の同期に失敗しました`, 'danger')
}
</script>

<template>
  <AdminCommonGoogleRequired>
    <div>
      <UiCommonPageHeader title="プロフィール" description="Google ビジネスプロフィールの店舗情報を確認・編集します">
        <template #actions>
          <UiCommonButton icon="refresh" variant="secondary" :is-loading="isPending" @click="onSync">すべて同期</UiCommonButton>
        </template>
      </UiCommonPageHeader>

      <UiCommonAlert v-if="errorMessage" tone="danger" class="mb-4">{{ errorMessage }}</UiCommonAlert>
      <UiCommonAlert v-if="lastFailures.length > 0" tone="danger" title="同期できなかった店舗" class="mb-4">
        <ul class="list-disc pl-5">
          <li v-for="failure in lastFailures" :key="failure.id">{{ storeName(failure.id) }}: {{ failure.message }}</li>
        </ul>
      </UiCommonAlert>

      <p v-if="profiles.length === 0" class="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
        店舗がありません。店舗画面から Google ビジネスプロフィールのロケーションを取り込んでください。
      </p>

      <ul v-else class="grid gap-3">
        <li v-for="{ store, profile } in profiles" :key="store.id" class="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div class="flex flex-wrap items-start gap-3">
            <div class="min-w-0 flex-1 space-y-1.5">
              <p class="font-semibold text-slate-900">{{ store.name }}</p>
              <template v-if="profile">
                <p class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                  <span>電話 {{ profile.primaryPhone || '未設定' }}</span>
                  <span class="break-all">サイト {{ profile.websiteUri || '未設定' }}</span>
                  <span>{{ summarizeRegularHours(profile.regularHours) }}</span>
                </p>
                <p class="text-xs text-slate-400">最終同期 {{ formatDateTime(profile.syncedAt) }}</p>
              </template>
              <p v-else-if="store.gbpLocationName" class="text-sm text-slate-500">まだ同期していません。</p>
              <UiCommonBadge v-else tone="neutral">GBP 未連携</UiCommonBadge>
            </div>
            <UiCommonButton v-if="store.gbpLocationName" variant="secondary" size="sm" :to="adminPath(`/profiles/${store.id}`)">
              {{ profile ? '詳細・編集' : '開く' }}
            </UiCommonButton>
          </div>
        </li>
      </ul>
    </div>
  </AdminCommonGoogleRequired>
</template>
