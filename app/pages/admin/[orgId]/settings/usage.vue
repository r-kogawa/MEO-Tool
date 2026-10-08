<script setup lang="ts">
import type { UsageItem } from '~/composables/useUsage'

// F-19 利用状況（owner / admin）

definePageMeta({ layout: 'admin', roles: ['owner', 'admin'] })
useHead({ title: '利用状況' })

const { org } = useCurrentOrg()
const { items, warnings, monthlyResponses } = useUsage()

const monthlyItems = computed(() => items.value.filter(item => item.isMonthly))
const totalItems = computed(() => items.value.filter(item => !item.isMonthly))
const monthLabel = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long' }).format(new Date())

function ratio(item: UsageItem): number {
  return item.limit === 0 ? 1 : Math.min(1, item.used / item.limit)
}

/** メーターの塗りは深刻度で変える（未満 / 8 割以上 / 上限到達） */
function levelOf(item: UsageItem): 'normal' | 'warning' | 'full' {
  const value = item.limit === 0 ? 1 : item.used / item.limit
  if (value >= 1) return 'full'
  if (value >= USAGE_WARNING_RATIO) return 'warning'
  return 'normal'
}

const FILL_CLASSES = { normal: 'bg-brand-600', warning: 'bg-amber-500', full: 'bg-rose-600' } as const
const TRACK_CLASSES = { normal: 'bg-brand-100', warning: 'bg-amber-100', full: 'bg-rose-100' } as const
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <UiCommonPageHeader title="利用状況" :description="`プラン: ${org?.plan ?? '—'}`" />

    <UiCommonAlert v-if="warnings.length > 0" tone="warning" title="上限に近づいている項目があります">
      {{ warnings.map(item => item.label).join('、') }}。上限に達すると、対象の機能が使えなくなります。
      プランの変更は運営にお問い合わせください。
    </UiCommonAlert>

    <template v-for="group in [{ title: `今月の利用（${monthLabel}）`, description: '毎月 1 日にリセットされます', list: monthlyItems }, { title: '登録数', description: 'プランで登録できる上限です', list: totalItems }]" :key="group.title">
      <UiCommonCard :title="group.title" :description="group.description">
        <ul class="space-y-5">
          <li v-for="item in group.list" :key="item.label" class="space-y-1.5">
            <div class="flex items-baseline justify-between gap-3 text-sm">
              <span class="font-medium text-slate-800">{{ item.label }}</span>
              <span class="text-slate-600">
                <span class="font-semibold text-slate-900 tabular-nums">{{ item.used.toLocaleString() }}</span>
                / {{ item.limit.toLocaleString() }}{{ item.unit }}
              </span>
            </div>
            <div
              class="h-2 overflow-hidden rounded-full"
              :class="TRACK_CLASSES[levelOf(item)]"
              role="meter"
              :aria-label="item.label"
              :aria-valuenow="item.used"
              aria-valuemin="0"
              :aria-valuemax="item.limit"
            >
              <div class="h-full rounded-full" :class="FILL_CLASSES[levelOf(item)]" :style="{ width: `${ratio(item) * 100}%` }" />
            </div>
            <p v-if="levelOf(item) !== 'normal'" class="flex items-center gap-1 text-xs" :class="levelOf(item) === 'full' ? 'text-rose-700' : 'text-amber-800'">
              <UiCommonIcon name="alert" size-class="size-3.5" />
              {{ levelOf(item) === 'full' ? '上限に達しています' : '上限の 8 割を超えています' }}
            </p>
          </li>
        </ul>
      </UiCommonCard>
    </template>

    <p class="text-sm text-slate-500">今月の回答数: <span class="font-medium text-slate-800 tabular-nums">{{ monthlyResponses.toLocaleString() }}</span> 件（回答数に上限はありません）</p>
  </div>
</template>
