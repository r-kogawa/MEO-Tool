<script setup lang="ts">
// 順位の推移（1 系列の折れ線）。縦軸は反転し 1 位を上に置く。
// 圏外（null）は線を途切れさせ、グラフ下端の「圏外」帯にマーカーを置く。
// 取得エラー（isError）の日も圏外帯に置き、色を変える（圏外とは区別する）。
// spark: 一覧用の小さな線のみ / full: 軸・クロスヘア・ツールチップ付き

export interface RankPoint {
  day: string
  rank: number | null
  isError?: boolean
}

interface Props {
  points: RankPoint[]
  variant?: 'spark' | 'full'
  /** 計測範囲（この順位より下は圏外） */
  range?: number
  selectedDay?: string | null
  /** 読み上げ用の説明 */
  label?: string
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'full',
  range: 20,
  selectedDay: null,
  label: '順位の推移',
})

const emit = defineEmits<{ select: [day: string] }>()

const SPARK = { width: 120, height: 32 }
const FULL_HEIGHT = 260
const PADDING = { top: 12, right: 16, bottom: 28, left: 44 }
/** 圏外帯の高さ（full のみ） */
const OUT_BAND = 24

const container = ref<HTMLElement | null>(null)
const measuredWidth = ref(640)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (props.variant !== 'full' || !container.value) return
  observer = new ResizeObserver(([entry]) => {
    if (entry) measuredWidth.value = Math.max(280, entry.contentRect.width)
  })
  observer.observe(container.value)
})
onBeforeUnmount(() => observer?.disconnect())

const isSpark = computed(() => props.variant === 'spark')
const width = computed(() => (isSpark.value ? SPARK.width : measuredWidth.value))
const height = computed(() => (isSpark.value ? SPARK.height : FULL_HEIGHT))
const pad = computed(() => (isSpark.value ? { top: 3, right: 4, bottom: 3, left: 2 } : PADDING))

const plotBottom = computed(() => height.value - pad.value.bottom - (isSpark.value ? 0 : OUT_BAND))
const outY = computed(() => (isSpark.value ? height.value - pad.value.bottom : height.value - pad.value.bottom - OUT_BAND / 2))

function xAt(index: number): number {
  const count = props.points.length
  const inner = width.value - pad.value.left - pad.value.right
  return count <= 1 ? pad.value.left + inner / 2 : pad.value.left + (index / (count - 1)) * inner
}

function yAt(rank: number): number {
  const span = plotBottom.value - pad.value.top
  return pad.value.top + ((rank - 1) / Math.max(1, props.range - 1)) * span
}

/** 圏外で途切れる線分ごとの path */
const segments = computed(() => {
  const result: string[] = []
  let current = ''
  props.points.forEach((point, index) => {
    if (point.rank === null) {
      if (current) result.push(current)
      current = ''
      return
    }
    current += `${current ? 'L' : 'M'}${xAt(index).toFixed(1)},${yAt(point.rank).toFixed(1)}`
  })
  if (current) result.push(current)
  return result
})

const lastIndex = computed(() => props.points.length - 1)
const lastPoint = computed(() => props.points[lastIndex.value] ?? null)

const yTicks = computed(() => [1, 5, 10, 15, 20].filter(tick => tick <= props.range))
/** 横軸ラベルは 5 つ程度に間引く */
const xTicks = computed(() => {
  const count = props.points.length
  if (count === 0) return []
  const step = Math.max(1, Math.ceil(count / 5))
  const indexes = new Set<number>()
  for (let index = 0; index < count; index += step) indexes.add(index)
  indexes.add(count - 1)
  return [...indexes].map(index => ({ index, label: formatShortDate(props.points[index]!.day) }))
})

// クロスヘア: ポインタに最も近い日付へ吸着する
const hoverIndex = ref<number | null>(null)
const selectedIndex = computed(() => props.points.findIndex(point => point.day === props.selectedDay))
const activeIndex = computed(() => hoverIndex.value ?? (selectedIndex.value >= 0 ? selectedIndex.value : null))
const activePoint = computed(() => (activeIndex.value === null ? null : props.points[activeIndex.value] ?? null))

function onPointerMove(event: PointerEvent): void {
  const svg = event.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * width.value
  const count = props.points.length
  if (count === 0) return
  const inner = width.value - pad.value.left - pad.value.right
  const ratio = (x - pad.value.left) / Math.max(1, inner)
  hoverIndex.value = Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))))
}

function onSelect(): void {
  const point = activePoint.value
  if (point) emit('select', point.day)
}

function onKeydown(event: KeyboardEvent): void {
  const count = props.points.length
  if (count === 0) return
  const base = selectedIndex.value >= 0 ? selectedIndex.value : count - 1
  const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
  if (delta === 0) return
  event.preventDefault()
  const next = Math.min(count - 1, Math.max(0, base + delta))
  emit('select', props.points[next]!.day)
}

function rankLabel(point: RankPoint): string {
  if (point.isError) return '取得エラー'
  return point.rank === null ? `${props.range}位圏外` : `${point.rank}位`
}

/** ツールチップはグラフの端ではみ出さないよう左右を切り替える */
const tooltipStyle = computed(() => {
  if (activeIndex.value === null) return {}
  const x = xAt(activeIndex.value)
  const isRightHalf = x > width.value / 2
  return isRightHalf
    ? { right: `${width.value - x + 10}px`, top: `${pad.value.top}px` }
    : { left: `${x + 10}px`, top: `${pad.value.top}px` }
})

const summaryLabel = computed(() => {
  const latest = lastPoint.value
  return latest ? `${props.label}。最新 ${formatShortDate(latest.day)} は ${rankLabel(latest)}` : `${props.label}（データなし）`
})
</script>

<template>
  <!-- spark: 一覧用。値は隣の数値で読めるので、線は補助として扱う -->
  <svg
    v-if="isSpark"
    :width="SPARK.width"
    :height="SPARK.height"
    :viewBox="`0 0 ${SPARK.width} ${SPARK.height}`"
    role="img"
    :aria-label="summaryLabel"
    class="overflow-visible"
  >
    <path
      v-for="(d, index) in segments"
      :key="index"
      :d="d"
      fill="none"
      class="stroke-brand-500"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <template v-for="(point, index) in points" :key="point.day">
      <circle v-if="point.rank === null" :cx="xAt(index)" :cy="outY" r="1.5" :class="point.isError ? 'fill-amber-400' : 'fill-slate-300'" />
    </template>
    <circle
      v-if="lastPoint"
      :cx="xAt(lastIndex)"
      :cy="lastPoint.rank === null ? outY : yAt(lastPoint.rank)"
      r="3.5"
      class="stroke-white"
      stroke-width="2"
      :class="lastPoint.isError ? 'fill-amber-400' : lastPoint.rank === null ? 'fill-slate-400' : 'fill-brand-600'"
    />
  </svg>

  <div v-else ref="container" class="relative w-full">
    <p v-if="points.length === 0" class="py-16 text-center text-sm text-slate-500">この期間の計測データはありません</p>
    <template v-else>
      <svg
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        role="img"
        :aria-label="`${summaryLabel}。左右キーで日付を選べます`"
        tabindex="0"
        class="block cursor-crosshair touch-pan-y select-none focus-visible:outline-2 focus-visible:outline-brand-500"
        @pointermove="onPointerMove"
        @pointerleave="hoverIndex = null"
        @click="onSelect"
        @keydown="onKeydown"
      >
        <!-- グリッド（1px・実線・控えめ） -->
        <g>
          <template v-for="tick in yTicks" :key="tick">
            <line :x1="pad.left" :x2="width - pad.right" :y1="yAt(tick)" :y2="yAt(tick)" class="stroke-slate-200" stroke-width="1" />
            <text :x="pad.left - 8" :y="yAt(tick)" text-anchor="end" dominant-baseline="middle" class="fill-slate-500 text-[11px] tabular-nums">{{ tick }}位</text>
          </template>
          <rect :x="pad.left" :y="plotBottom + 4" :width="width - pad.left - pad.right" :height="OUT_BAND - 8" rx="4" class="fill-slate-100" />
          <text :x="pad.left - 8" :y="outY" text-anchor="end" dominant-baseline="middle" class="fill-slate-500 text-[11px]">圏外</text>
          <text
            v-for="tick in xTicks"
            :key="tick.index"
            :x="xAt(tick.index)"
            :y="height - 8"
            text-anchor="middle"
            class="fill-slate-500 text-[11px] tabular-nums"
          >
            {{ tick.label }}
          </text>
        </g>

        <!-- クロスヘア -->
        <line
          v-if="activeIndex !== null"
          :x1="xAt(activeIndex)"
          :x2="xAt(activeIndex)"
          :y1="pad.top"
          :y2="plotBottom + OUT_BAND"
          class="stroke-slate-400"
          stroke-width="1"
        />

        <path
          v-for="(d, index) in segments"
          :key="index"
          :d="d"
          fill="none"
          class="stroke-brand-600"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />

        <!-- 圏外・取得エラーの日 -->
        <template v-for="(point, index) in points" :key="point.day">
          <circle v-if="point.rank === null" :cx="xAt(index)" :cy="outY" r="3" :class="point.isError ? 'fill-amber-400' : 'fill-slate-400'" />
        </template>

        <!-- 最新値（終点）と、選択 / ホバー中の点 -->
        <circle
          v-if="lastPoint && lastPoint.rank !== null"
          :cx="xAt(lastIndex)"
          :cy="yAt(lastPoint.rank)"
          r="4"
          class="fill-brand-600 stroke-white"
          stroke-width="2"
        />
        <circle
          v-if="activePoint && activeIndex !== null"
          :cx="xAt(activeIndex)"
          :cy="activePoint.rank === null ? outY : yAt(activePoint.rank)"
          r="5"
          class="stroke-white"
          :class="activePoint.isError ? 'fill-amber-500' : activePoint.rank === null ? 'fill-slate-500' : 'fill-brand-700'"
          stroke-width="2"
        />
        <text
          v-if="lastPoint && activeIndex === null"
          :x="xAt(lastIndex) - 8"
          :y="(lastPoint.rank === null ? outY : yAt(lastPoint.rank)) - 10"
          text-anchor="end"
          class="fill-slate-700 text-xs font-semibold"
        >
          {{ rankLabel(lastPoint) }}
        </text>
      </svg>

      <div
        v-if="activePoint"
        class="pointer-events-none absolute rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
        :style="tooltipStyle"
      >
        <p class="text-sm font-semibold text-slate-900">{{ rankLabel(activePoint) }}</p>
        <p class="text-slate-500">{{ formatDate(`${activePoint.day}T00:00:00`) }}</p>
      </div>
    </template>
  </div>
</template>
