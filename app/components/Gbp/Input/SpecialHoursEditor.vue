<script setup lang="ts">
import type { GbpSpecialHoursPeriod } from '~/types/domain'

// 特別営業時間（祝日・年末年始など）。休業日か、その日の営業時間を指定する

interface Props {
  isDisabled?: boolean
}

withDefaults(defineProps<Props>(), { isDisabled: false })
const periods = defineModel<GbpSpecialHoursPeriod[]>({ required: true })

function onChange(index: number, patch: Partial<GbpSpecialHoursPeriod>): void {
  periods.value = periods.value.map((period, position) => {
    if (position !== index) return period
    const next = { ...period, ...patch }
    return next.isClosed
      ? { ...next, openTime: null, closeTime: null }
      : { ...next, openTime: next.openTime ?? '10:00', closeTime: next.closeTime ?? '18:00' }
  })
}

function onAdd(): void {
  periods.value = [...periods.value, { date: toDayKey(new Date()), isClosed: true, openTime: null, closeTime: null }]
}

function onRemove(index: number): void {
  periods.value = periods.value.filter((_, position) => position !== index)
}
</script>

<template>
  <div class="space-y-2">
    <p v-if="periods.length === 0" class="text-sm text-slate-500">特別営業時間はありません。</p>
    <div v-for="(period, index) in periods" :key="index" class="flex flex-wrap items-center gap-2">
      <input
        type="date"
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
        :value="period.date"
        :disabled="isDisabled"
        aria-label="日付"
        @change="onChange(index, { date: ($event.target as HTMLInputElement).value })"
      >
      <label class="flex items-center gap-1.5 text-sm text-slate-700">
        <input type="checkbox" :checked="period.isClosed" :disabled="isDisabled" @change="onChange(index, { isClosed: ($event.target as HTMLInputElement).checked })">
        休業
      </label>
      <template v-if="!period.isClosed">
        <input
          type="time"
          class="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
          :value="period.openTime ?? ''"
          :disabled="isDisabled"
          aria-label="開店"
          @change="onChange(index, { openTime: ($event.target as HTMLInputElement).value })"
        >
        <span class="text-sm text-slate-500">〜</span>
        <input
          type="time"
          class="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
          :value="period.closeTime ?? ''"
          :disabled="isDisabled"
          aria-label="閉店"
          @change="onChange(index, { closeTime: ($event.target as HTMLInputElement).value })"
        >
      </template>
      <UiCommonButton v-if="!isDisabled" variant="ghost" size="sm" icon="trash" :aria-label="`${period.date} の特別営業時間を削除`" @click="onRemove(index)" />
    </div>
    <UiCommonButton v-if="!isDisabled" variant="secondary" size="sm" icon="plus" @click="onAdd">日付を追加</UiCommonButton>
  </div>
</template>
