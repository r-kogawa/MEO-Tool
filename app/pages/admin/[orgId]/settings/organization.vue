<script setup lang="ts">
// F-02 組織設定（owner のみ）

definePageMeta({ layout: 'admin', roles: ['owner'] })
useHead({ title: '組織設定' })

const { org, updateOrganizationName } = useCurrentOrg()
const { show } = useToast()
const state = useActionState()

const name = ref(org.value?.name ?? '')
const nameError = ref<string | null>(null)
const hasChanges = computed(() => name.value.trim() !== (org.value?.name ?? ''))

async function onSave(): Promise<void> {
  nameError.value = name.value.trim() === '' ? '組織名を入力してください' : null
  if (nameError.value) return
  await state.run(() => updateOrganizationName(name.value))
  if (!state.errorMessage.value) show('組織名を保存しました')
}
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <UiCommonPageHeader title="組織設定" />

    <UiCommonCard title="基本情報">
      <form class="space-y-4" @submit.prevent="onSave">
        <UiInputTextField v-model="name" :label="org?.type === 'corporate' ? '法人名' : '屋号'" :error="nameError" is-required :maxlength="60" />
        <div class="space-y-1.5">
          <p class="text-sm font-medium text-slate-700">組織の種別</p>
          <div class="flex items-center gap-2">
            <UiCommonBadge v-if="org" :tone="org.type === 'corporate' ? 'brand' : 'neutral'">{{ ORG_TYPE_LABELS[org.type] }}</UiCommonBadge>
            <span class="text-xs text-slate-500">種別の変更は運営にお問い合わせください</span>
          </div>
        </div>
        <div class="space-y-1.5">
          <p class="text-sm font-medium text-slate-700">プラン</p>
          <p class="text-sm text-slate-800">{{ org?.plan }}</p>
        </div>
        <UiCommonAlert v-if="state.errorMessage.value" tone="danger">{{ state.errorMessage.value }}</UiCommonAlert>
        <div class="flex justify-end">
          <UiCommonButton type="submit" :is-disabled="!hasChanges" :is-loading="state.isPending.value">保存</UiCommonButton>
        </div>
      </form>
    </UiCommonCard>

    <UiCommonCard title="退会">
      <div class="space-y-3 text-sm text-slate-600">
        <p>退会すると、公開中のアンケートはすべて停止し、回答・順位の履歴は所定の期間の後に削除されます。</p>
        <p>退会の手続きは運営窓口で承ります。お手数ですが運営までご連絡ください。</p>
        <UiCommonButton variant="danger" is-disabled>退会する</UiCommonButton>
      </div>
    </UiCommonCard>
  </div>
</template>
