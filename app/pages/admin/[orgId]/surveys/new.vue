<script setup lang="ts">
import { SURVEY_TEMPLATES } from '~/utils/surveyTemplates'

definePageMeta({ layout: 'admin' })
useHead({ title: 'アンケートを作成' })

// F-06 店舗とテンプレートを選んで作成する

type TemplateId = typeof SURVEY_TEMPLATES[number]['id']

const route = useRoute()
const { adminPath, visibleStores } = useCurrentOrg()
const { createSurvey } = useSurveys()
const { isPending, errorMessage, run } = useActionState()

const storeOptions = computed(() => visibleStores.value.map(store => ({ value: store.id, label: store.name })))
const initialStoreId = typeof route.query.storeId === 'string' ? route.query.storeId : ''
const storeId = ref(visibleStores.value.some(store => store.id === initialStoreId) ? initialStoreId : visibleStores.value[0]?.id ?? '')
// 直接開いたときは店舗の購読が届く前なので、届いたら先頭を選ぶ
watch(visibleStores, (stores) => {
  if (storeId.value === '' && stores[0]) storeId.value = stores[0].id
})
const title = ref('ご来店アンケート')
const templateId = ref<TemplateId>('standard')
const isTitleTouched = ref(false)

const titleError = computed(() => (isTitleTouched.value && !title.value.trim() ? 'タイトルを入力してください' : null))
const canSubmit = computed(() => storeId.value !== '' && title.value.trim() !== '')

async function onSubmit(): Promise<void> {
  isTitleTouched.value = true
  if (!canSubmit.value) return
  const template = SURVEY_TEMPLATES.find(item => item.id === templateId.value)!
  const survey = await run(() => createSurvey({ storeId: storeId.value, title: title.value, content: template.create() }))
  if (survey) await navigateTo(adminPath(`/surveys/${survey.id}/edit`))
}
</script>

<template>
  <div class="max-w-2xl">
    <UiCommonPageHeader title="アンケートを作成" :back-to="adminPath('/surveys')" back-label="アンケート一覧" />

    <UiCommonAlert v-if="visibleStores.length === 0" tone="warning" title="店舗がありません">
      アンケートを作るには、先に店舗を登録してください。
      <NuxtLink :to="adminPath('/stores')" class="font-medium underline">店舗一覧へ</NuxtLink>
    </UiCommonAlert>

    <form v-else class="space-y-6 rounded-xl border border-slate-200 bg-white p-5" @submit.prevent="onSubmit">
      <UiInputSelectField v-model="storeId" label="店舗" :options="storeOptions" />
      <UiInputTextField
        v-model="title"
        label="管理用のタイトル"
        is-required
        :maxlength="60"
        :error="titleError"
        hint="回答者には表示されません"
        @focusout="isTitleTouched = true"
      />

      <fieldset class="space-y-2">
        <legend class="mb-2 text-sm font-medium text-slate-700">テンプレート</legend>
        <label
          v-for="template in SURVEY_TEMPLATES"
          :key="template.id"
          class="flex cursor-pointer gap-3 rounded-lg border p-4"
          :class="templateId === template.id ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'"
        >
          <input v-model="templateId" type="radio" name="template" :value="template.id" class="mt-1 accent-brand-600">
          <span>
            <span class="block text-sm font-medium text-slate-900">{{ template.label }}</span>
            <span class="block text-xs text-slate-500">{{ template.description }}</span>
          </span>
        </label>
      </fieldset>

      <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>

      <div class="flex justify-end gap-2">
        <UiCommonButton variant="secondary" :to="adminPath('/surveys')">キャンセル</UiCommonButton>
        <UiCommonButton type="submit" :is-loading="isPending">作成して編集へ</UiCommonButton>
      </div>
    </form>
  </div>
</template>
