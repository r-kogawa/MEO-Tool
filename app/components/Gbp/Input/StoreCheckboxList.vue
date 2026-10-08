<script setup lang="ts">
import type { Store } from '~/types/domain'

// 投稿先の店舗を選ぶ。1 店舗なら個別、複数なら一括投稿になる

interface Props {
  stores: Store[]
  maxItems: number
}

const props = defineProps<Props>()
const model = defineModel<string[]>({ required: true })

const isAllSelected = computed(() =>
  props.stores.length > 0 && props.stores.slice(0, props.maxItems).every(store => model.value.includes(store.id)))

function onToggle(storeId: string, isChecked: boolean): void {
  model.value = isChecked ? [...model.value, storeId] : model.value.filter(id => id !== storeId)
}

function onToggleAll(isChecked: boolean): void {
  model.value = isChecked ? props.stores.slice(0, props.maxItems).map(store => store.id) : []
}
</script>

<template>
  <div class="space-y-2">
    <label v-if="stores.length > 1" class="flex items-center gap-2 text-sm font-medium text-slate-700">
      <input type="checkbox" class="size-4" :checked="isAllSelected" @change="onToggleAll(($event.target as HTMLInputElement).checked)">
      すべて選択（最大 {{ maxItems }} 店舗）
    </label>
    <ul class="grid gap-2 sm:grid-cols-2">
      <li v-for="store in stores" :key="store.id">
        <label class="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <input
            type="checkbox"
            class="size-4"
            :checked="model.includes(store.id)"
            @change="onToggle(store.id, ($event.target as HTMLInputElement).checked)"
          >
          {{ store.name }}
        </label>
      </li>
    </ul>
    <p v-if="stores.length === 0" class="text-sm text-slate-500">Google ビジネスプロフィールと連携した店舗がありません。</p>
    <p v-if="model.length > maxItems" class="text-xs text-rose-700">一度に投稿できるのは {{ maxItems }} 店舗までです。</p>
  </div>
</template>
