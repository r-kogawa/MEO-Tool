<script setup lang="ts">
// F-05 店舗一覧・GBP からの取込

definePageMeta({ layout: 'admin' })
useHead({ title: '店舗' })

const { org, canManage, isStaff, adminPath } = useCurrentOrg()
const { stores, storeSummary } = useStores()
const { isConnected } = useGoogleConnection()
const { show } = useToast()

const isImportOpen = ref(false)
const isAtLimit = computed(() => (org.value ? stores.value.length >= org.value.limits.maxStores : false))

function onImported(count: number): void {
  show(`${count} 店舗を取り込みました`)
}
</script>

<template>
  <div>
    <UiCommonPageHeader
      title="店舗"
      :description="isStaff ? '担当している店舗です' : 'Google ビジネスプロフィールと連携した店舗です'"
    >
      <template v-if="canManage && isConnected" #actions>
        <UiCommonButton icon="plus" :is-disabled="isAtLimit" @click="isImportOpen = true">GBP から取り込む</UiCommonButton>
      </template>
    </UiCommonPageHeader>

    <div class="space-y-4">
      <UiCommonAlert v-if="canManage && !isConnected" tone="warning" title="Google と連携すると店舗を取り込めます">
        Google ビジネスプロフィールのロケーションを店舗として取り込みます。
        <NuxtLink :to="adminPath('/settings/google')" class="font-medium underline">Google と連携する</NuxtLink>
      </UiCommonAlert>
      <UiCommonAlert v-if="canManage && isConnected && isAtLimit" tone="info">
        店舗数がプランの上限（{{ org?.limits.maxStores }} 店舗）に達しています。
      </UiCommonAlert>

      <p v-if="stores.length === 0" class="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-500">
        {{ isStaff ? '担当店舗が割り当てられていません。' : '店舗がまだありません。' }}
      </p>

      <ul v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <li v-for="store in stores" :key="store.id">
          <NuxtLink
            :to="adminPath(`/stores/${store.id}`)"
            class="flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
          >
            <div class="flex items-start gap-3">
              <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <UiCommonIcon name="store" />
              </span>
              <div class="min-w-0">
                <p class="font-semibold text-slate-900">{{ store.name }}</p>
                <p class="text-xs text-slate-500">{{ store.address }}</p>
              </div>
            </div>
            <dl class="mt-auto grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
              <div>
                <dt class="text-xs text-slate-500">公開中</dt>
                <dd class="text-lg font-semibold">{{ storeSummary(store.id).publishedSurveys }}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">回答</dt>
                <dd class="text-lg font-semibold">{{ storeSummary(store.id).responses }}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">キーワード</dt>
                <dd class="text-lg font-semibold">{{ storeSummary(store.id).keywords }}</dd>
              </div>
            </dl>
          </NuxtLink>
        </li>
      </ul>
    </div>

    <StoreStoresGbpImportModal v-if="canManage" v-model="isImportOpen" @imported="onImported" />
  </div>
</template>
