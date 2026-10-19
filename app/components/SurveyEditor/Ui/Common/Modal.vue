<script setup lang="ts">
interface Props {
  title: string
  size?: 'md' | 'lg'
}

withDefaults(defineProps<Props>(), { size: 'md' })

const isOpen = defineModel<boolean>({ required: true })

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') isOpen.value = false
}

watch(isOpen, (value) => {
  if (value) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" @click.self="isOpen = false">
      <div
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        class="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        :class="size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg'"
      >
        <header class="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 class="text-base font-semibold">{{ title }}</h2>
          <button type="button" class="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="閉じる" @click="isOpen = false">
            <UiCommonIcon name="x" />
          </button>
        </header>
        <div class="overflow-y-auto px-5 py-4">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
