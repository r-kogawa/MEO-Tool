<script setup lang="ts">
import type { IconName } from './Icon.vue'

interface Props {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  type?: 'button' | 'submit'
  /** 指定するとリンク（NuxtLink）として描画する */
  to?: string
  icon?: IconName
  isLoading?: boolean
  isDisabled?: boolean
  isBlock?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  type: 'button',
  to: undefined,
  icon: undefined,
  isLoading: false,
  isDisabled: false,
  isBlock: false,
})

// クラス名は文字列連結で作らず、完全な名前をここに並べる（Tailwind のスキャン対象にするため）
const VARIANT_CLASSES = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-200',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300',
  ghost: 'text-slate-600 hover:bg-slate-100 disabled:text-slate-300',
} as const

const SIZE_CLASSES = {
  sm: 'h-8 gap-1.5 px-3 text-sm',
  md: 'h-10 gap-2 px-4 text-sm',
} as const

const classes = computed(() => [
  'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed',
  VARIANT_CLASSES[props.variant],
  SIZE_CLASSES[props.size],
  props.isBlock ? 'w-full' : '',
])
</script>

<template>
  <NuxtLink v-if="to" :to="to" :class="classes">
    <UiCommonIcon v-if="icon" :name="icon" size-class="size-4" />
    <slot />
  </NuxtLink>
  <button v-else :type="type" :class="classes" :disabled="isDisabled || isLoading">
    <span v-if="isLoading" class="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
    <UiCommonIcon v-else-if="icon" :name="icon" size-class="size-4" />
    <slot />
  </button>
</template>
