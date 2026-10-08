<script setup lang="ts">
// 店舗の絞り込み。店舗が 1 つしか見えない場合（個人・担当 1 店舗の staff）は表示しない。

interface Props {
  /** 「すべての店舗」を選択肢に含める */
  hasAllOption?: boolean
}

const props = withDefaults(defineProps<Props>(), { hasAllOption: true })

const model = defineModel<string | null>({ required: true })
const { visibleStores, hasMultipleStores } = useCurrentOrg()

const options = computed(() => [
  ...(props.hasAllOption ? [{ value: null, label: 'すべての店舗' }] : []),
  ...visibleStores.value.map(store => ({ value: store.id, label: store.name })),
])
</script>

<template>
  <div v-if="hasMultipleStores" class="w-full sm:w-60">
    <UiInputSelectField v-model="model" label="店舗" :options="options" is-label-hidden />
  </div>
</template>
