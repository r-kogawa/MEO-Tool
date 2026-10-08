<script setup lang="ts">
import { nearestMunicipality, type Municipality } from '~/utils/geo/municipality'
import { KEYWORD_MAX_LENGTH, keywordErrorOf } from '~/utils/rankKeyword'

// その場計測の入力（地域・キーワード・店舗は任意）

interface Props {
  isPending?: boolean
}

withDefaults(defineProps<Props>(), { isPending: false })
const emit = defineEmits<{ submit: [input: { keyword: string; area: Municipality; storeId: string | null }] }>()

const { visibleStores } = useCurrentOrg()
const NO_STORE = ''
const storeId = ref(NO_STORE)
const keyword = ref('')
const area = ref<Municipality | null>(null)
const keywordError = ref<string | null>(null)
const areaError = ref<string | null>(null)

const storeOptions = computed(() => [
  { value: NO_STORE, label: '指定しない（上位 20 件だけ見る）' },
  ...visibleStores.value.map(store => ({ value: store.id, label: store.name })),
])

watch(storeId, (value) => {
  const store = visibleStores.value.find(item => item.id === value)
  if (store) area.value = nearestMunicipality(store.lat, store.lng) ?? area.value
})

function onSubmit(): void {
  keywordError.value = keywordErrorOf(keyword.value)
  areaError.value = area.value ? null : '地域を候補から選んでください'
  if (keywordError.value || !area.value) return
  emit('submit', { keyword: keyword.value, area: area.value, storeId: storeId.value === NO_STORE ? null : storeId.value })
}
</script>

<template>
  <form class="grid gap-4 md:grid-cols-2" @submit.prevent="onSubmit">
    <RankingInputAreaSelect v-model="area" :error="areaError" />
    <UiInputSelectField v-model="storeId" label="店舗（任意）" :options="storeOptions" />
    <div class="md:col-span-2">
      <UiInputTextField
        v-model="keyword"
        label="キーワード"
        placeholder="例: 渋谷 カフェ"
        hint="スペースで区切ると AND 検索になります（2〜100 文字）"
        :error="keywordError"
        is-required
        :maxlength="KEYWORD_MAX_LENGTH"
      />
    </div>
    <div class="md:col-span-2">
      <UiCommonButton type="submit" icon="refresh" :is-loading="isPending">順位を計測する</UiCommonButton>
    </div>
  </form>
</template>
