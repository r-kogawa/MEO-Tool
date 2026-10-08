<script setup lang="ts">
import type { ReplyTemplate } from '~/types/domain'

// 返信テンプレートの追加・編集・削除（owner / admin）

const isOpen = defineModel<boolean>({ required: true })
const { templates, createTemplate, updateTemplate, deleteTemplate } = useReplyTemplates()
const { canManage } = useCurrentOrg()
const { isPending, errorMessage, run } = useActionState()

const editingId = ref<string | null>(null)
const name = ref('')
const body = ref('')

function onEdit(template: ReplyTemplate | null): void {
  editingId.value = template?.id ?? 'new'
  name.value = template?.name ?? ''
  body.value = template?.body ?? ''
}

async function onSave(): Promise<void> {
  const input = { name: name.value, body: body.value }
  const isDone = await run(async () => {
    if (editingId.value === 'new') await createTemplate(input)
    else await updateTemplate(editingId.value!, input)
    return true
  })
  if (isDone) editingId.value = null
}

async function onDelete(templateId: string): Promise<void> {
  await run(() => deleteTemplate(templateId))
}
</script>

<template>
  <UiCommonModal v-model="isOpen" title="返信テンプレート" size="lg">
    <div class="space-y-4">
      <p class="text-sm text-slate-600">差し込み {{ REPLY_PLACEHOLDERS.join(' ') }} は、返信するときに口コミごとの値に置き換わります。</p>
      <ul class="divide-y divide-slate-100 rounded-lg border border-slate-200">
        <li v-if="templates.length === 0" class="p-4 text-sm text-slate-500">テンプレートはまだありません。</li>
        <li v-for="template in templates" :key="template.id" class="flex flex-wrap items-start gap-3 p-4">
          <div class="min-w-0 flex-1">
            <p class="font-medium text-slate-900">{{ template.name }}</p>
            <p class="text-sm whitespace-pre-wrap text-slate-600">{{ template.body }}</p>
          </div>
          <div v-if="canManage" class="flex gap-2">
            <UiCommonButton size="sm" variant="secondary" @click="onEdit(template)">編集</UiCommonButton>
            <UiCommonButton size="sm" variant="ghost" @click="onDelete(template.id)">削除</UiCommonButton>
          </div>
        </li>
      </ul>
      <form v-if="editingId" class="space-y-3 rounded-lg bg-slate-50 p-4" @submit.prevent="onSave">
        <UiInputTextField v-model="name" label="テンプレート名" :maxlength="50" is-required />
        <UiInputTextareaField v-model="body" label="本文" :rows="5" :maxlength="2000" is-required />
        <div class="flex justify-end gap-2">
          <UiCommonButton variant="secondary" size="sm" @click="editingId = null">キャンセル</UiCommonButton>
          <UiCommonButton type="submit" size="sm" :is-loading="isPending">保存</UiCommonButton>
        </div>
      </form>
      <UiCommonButton v-else-if="canManage" variant="secondary" size="sm" icon="plus" @click="onEdit(null)">テンプレートを追加</UiCommonButton>
      <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
    </div>
  </UiCommonModal>
</template>
