<script setup lang="ts">
// 組織の OAuth クライアントの登録・変更（owner のみ）

interface Props {
  currentClientId: string | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ saved: [] }>()

const { registerOAuthClient } = useGoogleConnection()
const { isPending, errorMessage, run } = useActionState()

const clientId = ref(props.currentClientId ?? '')
const clientSecret = ref('')
const canSubmit = computed(() => clientId.value.trim() !== '' && clientSecret.value.trim() !== '')

async function onSubmit(): Promise<void> {
  const isDone = await run(async () => {
    await registerOAuthClient(clientId.value, clientSecret.value)
    return true
  })
  if (!isDone) return
  clientSecret.value = ''
  emit('saved')
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="onSubmit">
    <UiInputTextField
      v-model="clientId"
      label="クライアント ID"
      placeholder="123456789-xxxx.apps.googleusercontent.com"
      is-required
    />
    <UiInputTextField
      v-model="clientSecret"
      label="クライアントシークレット"
      type="password"
      autocomplete="off"
      :hint="currentClientId ? '変更時もシークレットの再入力が必要です（登録済みのシークレットは表示できません）。連携中はクライアント ID を変更できません' : '暗号化して保存し、画面には表示しません'"
      is-required
    />
    <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
    <div class="flex justify-end">
      <UiCommonButton type="submit" :is-loading="isPending" :is-disabled="!canSubmit">
        {{ currentClientId ? '更新する' : '登録する' }}
      </UiCommonButton>
    </div>
  </form>
</template>
