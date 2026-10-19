<script setup lang="ts">
const { toasts } = useToast()
</script>

<template>
  <div class="pointer-events-none fixed inset-x-4 bottom-20 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end" aria-live="polite">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="pointer-events-auto flex items-center gap-2 rounded-lg px-4 py-3 text-sm text-white shadow-lg"
      :class="toast.tone === 'success' ? 'bg-slate-900' : 'bg-rose-700'"
    >
      <UiCommonIcon :name="toast.tone === 'success' ? 'check' : 'alert'" size-class="size-4" />
      {{ toast.message }}
    </div>
  </div>
</template>
