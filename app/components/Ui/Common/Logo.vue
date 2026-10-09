<script setup lang="ts">
// MFF のロゴ + サービス名。画像は logo-simple.png を表示サイズに合わせて縮小した WebP（元の PNG は重いため）
import logoUrl from '~/assets/img/logo-simple-600.webp'

export type LogoSize = 'sm' | 'lg'

interface Props {
  size?: LogoSize
  /** 暗い背景の上に置くか（サービス名を白にする） */
  isOnDark?: boolean
  /** スマホ幅ではサービス名を隠してロゴだけにするか（横幅に余裕のないヘッダー向け） */
  isLabelHiddenOnMobile?: boolean
}

withDefaults(defineProps<Props>(), { size: 'sm', isOnDark: false, isLabelHiddenOnMobile: false })

// ロゴ画像の上 1/3 は矢印で、文字（MFF）は下寄り（高さの約 32〜97%）にある。
// 画像の中央ではなく文字部分の中央（約 64%）にサービス名がそろうよう、画像の高さの約 15% 下げる
const SIZE_CLASSES: Record<LogoSize, { image: string, label: string }> = {
  sm: { image: 'h-6', label: 'text-sm translate-y-1' },
  lg: { image: 'h-12', label: 'text-lg translate-y-2' },
}
</script>

<template>
  <span class="inline-flex items-center gap-2 whitespace-nowrap">
    <img :src="logoUrl" alt="MFF" :class="SIZE_CLASSES[size].image" class="w-auto">
    <span class="font-bold" :class="[SIZE_CLASSES[size].label, isOnDark ? 'text-white' : 'text-slate-800', { 'hidden sm:inline': isLabelHiddenOnMobile }]">MEOツール</span>
  </span>
</template>
