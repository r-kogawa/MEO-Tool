<script setup lang="ts">
import type { GbpDayOfWeek, GbpRegularHoursPeriod } from '~/types/domain'

// 通常の営業時間。閉店が開店より前（深夜営業）のときは翌日の閉店として扱う

interface Props {
  isDisabled?: boolean
}

withDefaults(defineProps<Props>(), { isDisabled: false })
const periods = defineModel<GbpRegularHoursPeriod[]>({ required: true })

const dayOptions = DAYS_OF_WEEK.map(day => ({ value: day, label: `${DAY_LABELS[day]}曜日` }))

function nextDay(day: GbpDayOfWeek): GbpDayOfWeek {
  return DAYS_OF_WEEK[(DAYS_OF_WEEK.indexOf(day) + 1) % DAYS_OF_WEEK.length]!
}

function onChange(index: number, field: 'openDay' | 'openTime' | 'closeTime', value: string): void {
  const next = periods.value.map(period => ({ ...period }))
  const period = { ...next[index]!, [field]: value } as GbpRegularHoursPeriod
  period.closeDay = period.closeTime !== '24:00' && period.closeTime <= period.openTime ? nextDay(period.openDay) : period.openDay
  next[index] = period
  periods.value = next
}

function onAdd(): void {
  const usedDays = periods.value.map(period => period.openDay)
  const day = DAYS_OF_WEEK.find(item => !usedDays.includes(item)) ?? 'MONDAY'
  periods.value = [...periods.value, { openDay: day, openTime: '10:00', closeDay: day, closeTime: '20:00' }]
}

function onRemove(index: number): void {
  periods.value = periods.value.filter((_, position) => position !== index)
}
</script>

<template>
  <div class="space-y-2">
    <p v-if="periods.length === 0" class="text-sm text-slate-500">営業時間が設定されていません。</p>
    <div v-for="(period, index) in periods" :key="index" class="flex flex-wrap items-end gap-2">
      <div class="w-28">
        <UiInputSelectField
          :model-value="period.openDay"
          label="曜日"
          :options="dayOptions"
          is-label-hidden
          :is-disabled="isDisabled"
          @update:model-value="onChange(index, 'openDay', $event)"
        />
      </div>
      <input
        type="time"
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
        :value="period.openTime"
        :disabled="isDisabled"
        aria-label="開店"
        @change="onChange(index, 'openTime', ($event.target as HTMLInputElement).value)"
      >
      <span class="pb-2 text-sm text-slate-500">〜</span>
      <input
        type="time"
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
        :value="period.closeTime === '24:00' ? '00:00' : period.closeTime"
        :disabled="isDisabled"
        aria-label="閉店"
        @change="onChange(index, 'closeTime', ($event.target as HTMLInputElement).value)"
      >
      <span v-if="period.closeDay !== period.openDay" class="pb-2 text-xs text-slate-500">（翌日）</span>
      <UiCommonButton v-if="!isDisabled" variant="ghost" size="sm" icon="trash" :aria-label="`${DAY_LABELS[period.openDay]}曜日の営業時間を削除`" @click="onRemove(index)" />
    </div>
    <UiCommonButton v-if="!isDisabled" variant="secondary" size="sm" icon="plus" @click="onAdd">時間帯を追加</UiCommonButton>
  </div>
</template>
