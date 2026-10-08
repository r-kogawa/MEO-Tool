<script setup lang="ts">
import type { GbpLocationCandidate } from '~/types/domain'

// F-05 GBP のロケーションを店舗として取り込む

const isOpen = defineModel<boolean>({ required: true })
const emit = defineEmits<{ imported: [count: number] }>()

const { fetchGbpCandidates, importStores } = useStores()
const candidates = ref<GbpLocationCandidate[]>([])
const selected = ref<string[]>([])
const loadState = useActionState()
const importState = useActionState()

async function onLoad(): Promise<void> {
  selected.value = []
  const result = await loadState.run(fetchGbpCandidates)
  candidates.value = result ?? []
}

watch(isOpen, (value) => {
  if (value) void onLoad()
}, { immediate: true })

function disabledReason(candidate: GbpLocationCandidate): string | null {
  if (candidate.isImported) return '取込済み'
  if (!candidate.isImportable) return 'Place ID がないため取り込めません（GBP でオーナー確認が完了していない可能性があります）'
  return null
}

function onToggle(locationName: string, isChecked: boolean): void {
  selected.value = isChecked ? [...selected.value, locationName] : selected.value.filter(name => name !== locationName)
}

async function onImport(): Promise<void> {
  const created = await importState.run(() => importStores(selected.value))
  if (!created) return
  emit('imported', created.length)
  isOpen.value = false
}
</script>

<template>
  <UiCommonModal v-model="isOpen" title="Google ビジネスプロフィールから取り込む" size="lg">
    <div class="space-y-4">
      <p class="text-sm text-slate-600">連携中の Google アカウントで管理しているロケーションです。取り込む店舗を選んでください。</p>
      <div v-if="loadState.isPending.value" class="py-8 text-center text-sm text-slate-500">ロケーションを取得しています…</div>
      <UiCommonAlert v-else-if="loadState.errorMessage.value" tone="danger">{{ loadState.errorMessage.value }}</UiCommonAlert>
      <p v-else-if="candidates.length === 0" class="py-6 text-center text-sm text-slate-500">取り込めるロケーションがありません。</p>
      <ul v-else class="divide-y divide-slate-100 rounded-lg border border-slate-200">
        <li v-for="candidate in candidates" :key="candidate.locationName">
          <label
            class="flex items-start gap-3 px-4 py-3"
            :class="disabledReason(candidate) ? 'cursor-not-allowed bg-slate-50' : 'cursor-pointer hover:bg-slate-50'"
          >
            <input
              type="checkbox"
              class="mt-1 size-4 accent-brand-600"
              :checked="selected.includes(candidate.locationName)"
              :disabled="disabledReason(candidate) !== null"
              @change="onToggle(candidate.locationName, ($event.target as HTMLInputElement).checked)"
            >
            <span class="min-w-0 flex-1 space-y-0.5">
              <span class="block text-sm font-medium" :class="disabledReason(candidate) ? 'text-slate-500' : 'text-slate-900'">{{ candidate.title }}</span>
              <span class="block text-xs text-slate-500">{{ candidate.address }}</span>
              <span v-if="disabledReason(candidate)" class="block text-xs text-amber-700">{{ disabledReason(candidate) }}</span>
            </span>
          </label>
        </li>
      </ul>
      <UiCommonAlert v-if="importState.errorMessage.value" tone="danger">{{ importState.errorMessage.value }}</UiCommonAlert>
    </div>
    <template #footer>
      <UiCommonButton variant="secondary" @click="isOpen = false">キャンセル</UiCommonButton>
      <UiCommonButton :is-disabled="selected.length === 0" :is-loading="importState.isPending.value" @click="onImport">
        {{ selected.length > 0 ? `${selected.length} 店舗を取り込む` : '取り込む' }}
      </UiCommonButton>
    </template>
  </UiCommonModal>
</template>
