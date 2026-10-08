<script setup lang="ts">
import type { Member, MemberRole } from '~/types/domain'

// F-03 メンバーの権限・担当店舗の変更

interface Props {
  member: Member | null
}

const props = defineProps<Props>()
const isOpen = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [] }>()

const { updateRole } = useMembers()
const state = useActionState()
const role = ref<Exclude<MemberRole, 'owner'>>('staff')
const storeIds = ref<string[]>([])
const storeError = ref<string | null>(null)

const roleOptions = [
  { value: 'admin' as const, label: '管理者（全店舗・設定を管理）' },
  { value: 'staff' as const, label: 'スタッフ（担当店舗のみ）' },
]

watch(isOpen, (value) => {
  if (!value || !props.member || props.member.role === 'owner') return
  role.value = props.member.role
  storeIds.value = [...props.member.storeIds]
  storeError.value = null
  state.errorMessage.value = null
})

async function onSave(): Promise<void> {
  if (!props.member) return
  storeError.value = role.value === 'staff' && storeIds.value.length === 0 ? '担当店舗を 1 つ以上選んでください' : null
  if (storeError.value) return
  const targetUid = props.member.uid
  await state.run(() => updateRole(targetUid, role.value, storeIds.value))
  if (state.errorMessage.value) return
  emit('saved')
  isOpen.value = false
}
</script>

<template>
  <UiCommonModal v-model="isOpen" :title="`${member?.displayName ?? ''} の権限`">
    <form id="member-edit-form" class="space-y-4" @submit.prevent="onSave">
      <UiInputSelectField v-model="role" label="ロール" :options="roleOptions" />
      <SettingsInputStoreCheckboxGroup v-if="role === 'staff'" v-model="storeIds" :error="storeError" />
      <UiCommonAlert v-if="state.errorMessage.value" tone="danger">{{ state.errorMessage.value }}</UiCommonAlert>
    </form>
    <template #footer>
      <UiCommonButton variant="secondary" @click="isOpen = false">キャンセル</UiCommonButton>
      <UiCommonButton type="submit" form="member-edit-form" :is-loading="state.isPending.value">保存</UiCommonButton>
    </template>
  </UiCommonModal>
</template>
