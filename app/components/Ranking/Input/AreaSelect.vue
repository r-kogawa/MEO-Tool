<script setup lang="ts">
import { searchMunicipalities, type Municipality } from '~/utils/geo/municipality'

// 順位計測の検索地点（市区町村）。文字を入力して候補から選ぶ

interface Props {
  label?: string
  hint?: string
  error?: string | null
}

withDefaults(defineProps<Props>(), {
  label: '地域',
  hint: '市区町村名の一部を入力して選びます（例: 渋谷）',
  error: null,
})

const model = defineModel<Municipality | null>({ required: true })
const id = useId()
const listId = `${id}-list`
const query = ref(model.value?.label ?? '')
const isOpen = ref(false)
const activeIndex = ref(0)
const options = computed(() => searchMunicipalities(query.value))

// 入力で選択を外したときは、入力途中の文字を残す（外から変わったときだけ入力欄へ反映する）
let isClearingByInput = false

watch(model, (value) => {
  if (isClearingByInput) {
    isClearingByInput = false
    return
  }
  query.value = value?.label ?? ''
})

function onInput(): void {
  isOpen.value = true
  activeIndex.value = 0
  // 選択後に文字を変えたら、選択を外す（入力途中の文字列を地点として扱わない）
  if (model.value && query.value !== model.value.label) {
    isClearingByInput = true
    model.value = null
  }
}

function onSelect(option: Municipality): void {
  model.value = option
  query.value = option.label
  isOpen.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    isOpen.value = false
    return
  }
  if (!isOpen.value || options.value.length === 0) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const delta = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = (activeIndex.value + delta + options.value.length) % options.value.length
  }
  else if (event.key === 'Enter') {
    event.preventDefault()
    const option = options.value[activeIndex.value]
    if (option) onSelect(option)
  }
}
</script>

<template>
  <div class="relative space-y-1.5">
    <label :for="id" class="block text-sm font-medium text-slate-700">
      {{ label }}
      <span class="ml-1 text-xs text-rose-600">必須</span>
    </label>
    <input
      :id="id"
      v-model="query"
      type="text"
      role="combobox"
      autocomplete="off"
      placeholder="例: 東京都渋谷区"
      :aria-expanded="isOpen && options.length > 0"
      :aria-controls="listId"
      :aria-activedescendant="isOpen && options[activeIndex] ? `${listId}-${options[activeIndex]!.code}` : undefined"
      :aria-invalid="error ? 'true' : undefined"
      class="block h-10 w-full rounded-lg border bg-white px-3 text-sm placeholder:text-slate-400 focus:outline-2 focus:outline-offset-0 focus:outline-brand-500"
      :class="error ? 'border-rose-400' : 'border-slate-300'"
      @input="onInput"
      @focus="isOpen = query !== '' && !model"
      @blur="isOpen = false"
      @keydown="onKeydown"
    >
    <ul
      v-if="isOpen && options.length > 0"
      :id="listId"
      role="listbox"
      class="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
    >
      <li
        v-for="(option, index) in options"
        :id="`${listId}-${option.code}`"
        :key="option.code"
        role="option"
        :aria-selected="index === activeIndex"
        class="cursor-pointer px-3 py-2"
        :class="index === activeIndex ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-50'"
        @mousedown.prevent="onSelect(option)"
        @mouseenter="activeIndex = index"
      >
        {{ option.label }}
      </li>
    </ul>
    <p v-if="isOpen && query !== '' && options.length === 0" class="text-xs text-slate-500">該当する市区町村がありません</p>
    <p v-if="error" class="text-xs text-rose-700">{{ error }}</p>
    <p v-else-if="hint" class="text-xs text-slate-500">{{ hint }}</p>
    <p class="text-[11px] text-slate-400">地域データ: 国土数値情報（行政区域データ）国土交通省 を加工して作成</p>
  </div>
</template>
