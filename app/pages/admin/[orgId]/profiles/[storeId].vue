<script setup lang="ts">
import type { GbpProfile, GbpProfilePatch } from '~/types/domain'

definePageMeta({ layout: 'admin' })

// GBP プロフィールの詳細・編集（編集は owner / admin）。変更した項目だけを送る

const route = useRoute()
const storeId = String(route.params.storeId)
const { adminPath, storeName, canManage, canAccessStore } = useCurrentOrg()
const { findProfile, syncProfiles, updateProfile } = useGbpProfiles()
const { show } = useToast()
const profile = findProfile(storeId)
useHead({ title: () => `${storeName(storeId)} のプロフィール` })

type EditableFields = Required<GbpProfilePatch>
const form = ref<EditableFields | null>(null)

function toForm(source: GbpProfile): EditableFields {
  // 元データ（リアクティブ）と切り離すため JSON で複製する
  return JSON.parse(JSON.stringify({
    description: source.description,
    primaryPhone: source.primaryPhone,
    websiteUri: source.websiteUri,
    regularHours: source.regularHours,
    specialHours: source.specialHours,
  })) as EditableFields
}

const changes = computed<GbpProfilePatch>(() => {
  if (!profile.value || !form.value) return {}
  const original = toForm(profile.value)
  return Object.fromEntries((Object.keys(form.value) as (keyof EditableFields)[])
    .filter(key => JSON.stringify(form.value![key]) !== JSON.stringify(original[key]))
    .map(key => [key, form.value![key]]))
})
const hasChanges = computed(() => Object.keys(changes.value).length > 0)

// 保存・同期の結果は購読でプロフィールに届く。未編集のときだけフォームに反映し、編集中の内容は消さない
// （保存直後に手動で入れ直すと、購読が届く前の古い値に戻ってしまう）
let lastSource = ''
watch(profile, (value) => {
  if (!value) return
  const isPristine = !form.value || JSON.stringify(form.value) === lastSource
  lastSource = JSON.stringify(toForm(value))
  if (isPristine) form.value = toForm(value)
}, { immediate: true })

const syncState = useActionState()
const saveState = useActionState()

async function onSync(): Promise<void> {
  const result = await syncState.run(() => syncProfiles([storeId]))
  if (!result) return
  if (result.failed.length > 0) {
    syncState.errorMessage.value = result.failed[0]!.message
    return
  }
  show('Google から最新の内容を取得しました')
}

async function onSave(): Promise<void> {
  const isDone = await saveState.run(async () => {
    await updateProfile(storeId, changes.value)
    return true
  })
  if (!isDone) return
  show('Google ビジネスプロフィールを更新しました')
}

function onReset(): void {
  if (profile.value) form.value = toForm(profile.value)
}
</script>

<template>
  <AdminCommonGoogleRequired>
    <div class="max-w-3xl space-y-6">
      <UiCommonPageHeader :title="storeName(storeId)" description="Google ビジネスプロフィール" :back-to="adminPath('/profiles')" back-label="プロフィール一覧">
        <template #actions>
          <UiCommonButton icon="refresh" variant="secondary" :is-loading="syncState.isPending.value" @click="onSync">同期</UiCommonButton>
        </template>
      </UiCommonPageHeader>

      <UiCommonAlert v-if="!canAccessStore(storeId)" tone="danger">担当外の店舗です。</UiCommonAlert>
      <UiCommonAlert v-if="syncState.errorMessage.value" tone="danger">{{ syncState.errorMessage.value }}</UiCommonAlert>

      <div v-if="!profile" class="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p class="text-sm text-slate-500">まだ同期していません。「同期」で Google から取得してください。</p>
      </div>

      <template v-else-if="form">
        <UiCommonCard title="基本情報">
          <dl class="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
            <dt class="text-slate-500">店名</dt>
            <dd class="text-slate-900">{{ profile.title }}</dd>
            <dt class="text-slate-500">住所</dt>
            <dd class="text-slate-900">{{ profile.address || '未設定' }}</dd>
            <dt class="text-slate-500">カテゴリ</dt>
            <dd class="text-slate-900">{{ profile.categories.join('、') || '未設定' }}</dd>
            <dt class="text-slate-500">最終同期</dt>
            <dd class="text-slate-900">{{ formatDateTime(profile.syncedAt) }}</dd>
          </dl>
          <p class="mt-3 text-xs text-slate-500">店名・住所・カテゴリの変更は Google の再確認が必要になることがあるため、Google ビジネスプロフィールの管理画面で行ってください。</p>
        </UiCommonCard>

        <UiCommonCard title="編集できる項目">
          <div class="space-y-5">
            <UiInputTextareaField v-model="form.description" label="ビジネスの説明" :rows="5" :maxlength="750" :hint="`${form.description.length} / 750 文字`" :is-disabled="!canManage" />
            <UiInputTextField v-model="form.primaryPhone" label="電話番号" placeholder="03-1234-5678" :is-disabled="!canManage" />
            <UiInputTextField v-model="form.websiteUri" label="ウェブサイト" type="url" placeholder="https://example.com" :is-disabled="!canManage" />
            <div class="space-y-2">
              <p class="text-sm font-medium text-slate-700">営業時間</p>
              <GbpInputRegularHoursEditor v-model="form.regularHours" :is-disabled="!canManage" />
            </div>
            <div class="space-y-2">
              <p class="text-sm font-medium text-slate-700">特別営業時間</p>
              <GbpInputSpecialHoursEditor v-model="form.specialHours" :is-disabled="!canManage" />
            </div>
          </div>
        </UiCommonCard>

        <UiCommonAlert v-if="saveState.errorMessage.value" tone="danger">{{ saveState.errorMessage.value }}</UiCommonAlert>
        <div v-if="canManage" class="flex justify-end gap-2">
          <UiCommonButton variant="secondary" :is-disabled="!hasChanges" @click="onReset">元に戻す</UiCommonButton>
          <UiCommonButton :is-loading="saveState.isPending.value" :is-disabled="!hasChanges" @click="onSave">Google に反映する</UiCommonButton>
        </div>
        <p v-else class="text-sm text-slate-500">プロフィールの編集はオーナーまたは管理者が行います。</p>
      </template>
    </div>
  </AdminCommonGoogleRequired>
</template>
