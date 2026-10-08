<script setup lang="ts">
// スタッフの担当店舗を選ぶチェックボックス群

interface Props {
  label?: string
  error?: string | null
}

withDefaults(defineProps<Props>(), { label: '担当店舗', error: null })

const model = defineModel<string[]>({ required: true })
const { visibleStores } = useCurrentOrg()

function onToggle(storeId: string, isChecked: boolean): void {
  model.value = isChecked ? [...model.value, storeId] : model.value.filter(id => id !== storeId)
}
</script>

<template>
  <fieldset class="space-y-2">
    <legend class="text-sm font-medium text-slate-700">{{ label }}</legend>
    <div class="grid gap-2 sm:grid-cols-2">
      <label
        v-for="store in visibleStores"
        :key="store.id"
        class="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
      >
        <input
          type="checkbox"
          class="size-4 accent-brand-600"
          :checked="model.includes(store.id)"
          @change="onToggle(store.id, ($event.target as HTMLInputElement).checked)"
        >
        {{ store.name }}
      </label>
    </div>
    <p v-if="error" class="text-xs text-rose-700">{{ error }}</p>
    <p v-else class="text-xs text-slate-500">スタッフは担当店舗のアンケート・回答・順位だけを扱えます</p>
  </fieldset>
</template>
