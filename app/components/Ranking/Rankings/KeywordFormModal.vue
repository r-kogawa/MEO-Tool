<script setup lang="ts">
import { nearestMunicipality, type Municipality } from '~/utils/geo/municipality'
import { KEYWORD_MAX_LENGTH, keywordErrorOf } from '~/utils/rankKeyword'

// F-15 順位キーワードの追加。検索地点は市区町村から選ぶ（既定は店舗に最も近い市区町村）

interface Props {
  /** 開いたときに選択しておく店舗 */
  initialStoreId?: string | null
  /** その場計測から登録するときのキーワードと地域 */
  initialKeyword?: string
  initialArea?: Municipality | null
}

const props = withDefaults(defineProps<Props>(), { initialStoreId: null, initialKeyword: '', initialArea: null })
const isOpen = defineModel<boolean>({ required: true })
const emit = defineEmits<{ created: [keyword: string, isChecking: boolean, checkError?: 'limit' | 'unavailable'] }>()

const { visibleStores } = useCurrentOrg()
const { createKeyword } = useRankKeywords()
const state = useActionState()

const storeId = ref('')
const keyword = ref('')
const area = ref<Municipality | null>(null)
const keywordError = ref<string | null>(null)
const areaError = ref<string | null>(null)

const storeOptions = computed(() => visibleStores.value.map(store => ({ value: store.id, label: store.name })))

function onApplyStoreArea(): void {
  const store = visibleStores.value.find(item => item.id === storeId.value)
  if (store) area.value = nearestMunicipality(store.lat, store.lng)
}

function onReset(): void {
  storeId.value = props.initialStoreId ?? visibleStores.value[0]?.id ?? ''
  keyword.value = props.initialKeyword
  keywordError.value = null
  areaError.value = null
  state.errorMessage.value = null
  if (props.initialArea) area.value = props.initialArea
  else onApplyStoreArea()
}

watch(isOpen, (value) => {
  if (value) onReset()
})

/** 利用者が店舗を変えたときだけ地域を合わせ直す（onReset の initialArea を上書きしないよう watch は使わない） */
function onChangeStore(value: string): void {
  storeId.value = value
  onApplyStoreArea()
}

function validate(): boolean {
  keywordError.value = keywordErrorOf(keyword.value)
  areaError.value = area.value ? null : '地域を候補から選んでください'
  return keywordError.value === null && areaError.value === null
}

async function onSubmit(): Promise<void> {
  if (!validate() || !area.value) return
  const created = await state.run(() => createKeyword({
    storeId: storeId.value,
    keyword: keyword.value,
    searchLocation: { lat: area.value!.lat, lng: area.value!.lng, label: area.value!.label },
  }))
  if (!created) return
  emit('created', created.keyword, created.isChecking, created.checkError)
  isOpen.value = false
}
</script>

<template>
  <UiCommonModal v-model="isOpen" title="キーワードを追加">
    <form id="keyword-form" class="space-y-4" @submit.prevent="onSubmit">
      <UiInputSelectField :model-value="storeId" label="店舗" :options="storeOptions" @update:model-value="onChangeStore" />
      <UiInputTextField
        v-model="keyword"
        label="キーワード"
        placeholder="例: 渋谷 定食"
        hint="Google マップで検索される語句を入力します。スペースで区切ると AND 検索になります（2〜100 文字）"
        :error="keywordError"
        is-required
        :maxlength="KEYWORD_MAX_LENGTH"
      />
      <RankingInputAreaSelect v-model="area" label="検索地点（地域）" :error="areaError" />
      <div class="flex flex-wrap items-center gap-2">
        <UiCommonButton size="sm" variant="ghost" icon="map-pin" @click="onApplyStoreArea">店舗の所在地に戻す</UiCommonButton>
      </div>
      <p class="text-xs text-slate-500">
        地点が変わると過去の順位と比較できなくなるため、登録後に地点は変更できません。別の地点で計測したい場合は、別のキーワードとして追加してください。
      </p>
      <UiCommonAlert v-if="state.errorMessage.value" tone="danger">{{ state.errorMessage.value }}</UiCommonAlert>
    </form>
    <template #footer>
      <UiCommonButton variant="secondary" @click="isOpen = false">キャンセル</UiCommonButton>
      <UiCommonButton type="submit" form="keyword-form" :is-loading="state.isPending.value">追加して計測する</UiCommonButton>
    </template>
  </UiCommonModal>
</template>
