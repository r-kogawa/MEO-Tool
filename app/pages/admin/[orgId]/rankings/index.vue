<script setup lang="ts">
import type { KeywordRow } from '~/composables/useRankKeywords'
import { RANK_DISCLAIMER } from '~/utils/rankKeyword'

// F-15 / F-16 / F-17 順位一覧。staff は閲覧のみ。

definePageMeta({ layout: 'admin' })
useHead({ title: '検索順位' })

const { org, canManage, hasMultipleStores, adminPath } = useCurrentOrg()
const { rows, setActive, deleteKeyword, checkNow } = useRankKeywords()
const { show } = useToast()

const storeId = ref<string | null>(null)
const filteredRows = computed(() => rows.value.filter(row => storeId.value === null || row.keyword.storeId === storeId.value))
const isAtLimit = computed(() => (org.value ? rows.value.length >= org.value.limits.maxKeywords : false))

const isFormOpen = ref(false)
const checkingId = ref<string | null>(null)
const deleteTarget = ref<KeywordRow | null>(null)
const isDeleteOpen = computed({
  get: () => deleteTarget.value !== null,
  set: (value: boolean) => { if (!value) deleteTarget.value = null },
})
const actionState = useActionState()
const deleteState = useActionState()

function rankText(row: KeywordRow): string {
  if (row.latest?.status === 'error') return '取得エラー'
  return row.latest?.rank == null ? `${RANK_RANGE}位圏外` : `${row.latest.rank}位`
}

async function onCheckNow(row: KeywordRow): Promise<void> {
  checkingId.value = row.keyword.id
  const outcome = await actionState.run(() => checkNow(row.keyword.id))
  checkingId.value = null
  if (actionState.errorMessage.value) show(actionState.errorMessage.value, 'danger')
  else show(outcome === 'started' ? `「${row.keyword.keyword}」の計測を開始しました（10 秒ほどで反映されます）` : `「${row.keyword.keyword}」を計測しました`)
}

async function onToggleActive(row: KeywordRow): Promise<void> {
  await actionState.run(() => setActive(row.keyword.id, !row.keyword.isActive))
  if (actionState.errorMessage.value) show(actionState.errorMessage.value, 'danger')
  else show(row.keyword.isActive ? '定期計測を再開しました' : '定期計測を停止しました')
}

async function onDelete(): Promise<void> {
  const target = deleteTarget.value
  if (!target) return
  await deleteState.run(() => deleteKeyword(target.keyword.id))
  if (deleteState.errorMessage.value) return
  deleteTarget.value = null
  show('キーワードを削除しました')
}

function onCreated(keyword: string, isChecking: boolean, checkError?: 'limit' | 'unavailable'): void {
  if (isChecking) show(`「${keyword}」を追加し、初回の計測を開始しました`)
  else if (checkError === 'unavailable') show(`「${keyword}」を追加しました（計測を開始できなかったため、今すぐ計測から再度お試しください）`)
  else show(`「${keyword}」を追加しました（今月の計測数の上限に達しているため、計測は来月から行います）`)
}
</script>

<template>
  <div class="space-y-4">
    <UiCommonPageHeader title="検索順位" description="Google マップ検索での表示順位を毎日計測しています">
      <template v-if="canManage" #actions>
        <UiCommonButton variant="secondary" icon="refresh" :to="adminPath('/rankings/search')">その場で計測</UiCommonButton>
        <UiCommonButton icon="plus" :is-disabled="isAtLimit" @click="isFormOpen = true">キーワードを追加</UiCommonButton>
      </template>
    </UiCommonPageHeader>

    <UiCommonAlert tone="info">{{ RANK_DISCLAIMER }}</UiCommonAlert>
    <UiCommonAlert v-if="canManage && isAtLimit" tone="warning">
      キーワード数がプランの上限（{{ org?.limits.maxKeywords }} 件）に達しています。
    </UiCommonAlert>

    <AdminCommonStoreFilter v-model="storeId" />

    <p v-if="filteredRows.length === 0" class="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-500">
      計測中のキーワードはありません。
    </p>

    <UiCommonCard v-else is-flush>
      <div class="relative overflow-x-auto">
        <table class="w-full min-w-[760px] text-sm">
          <thead class="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th scope="col" class="px-5 py-2.5 font-medium">キーワード</th>
              <th scope="col" class="px-3 py-2.5 text-right font-medium">最新順位</th>
              <th scope="col" class="px-3 py-2.5 text-right font-medium">前日比</th>
              <th scope="col" class="px-3 py-2.5 text-right font-medium">前週比</th>
              <th scope="col" class="px-3 py-2.5 font-medium">30 日の推移</th>
              <th v-if="canManage" scope="col" class="px-5 py-2.5 text-right font-medium"><span class="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="row in filteredRows" :key="row.keyword.id" :class="row.keyword.isActive ? '' : 'bg-slate-50/60'">
              <th scope="row" class="px-5 py-3 text-left font-normal">
                <NuxtLink :to="adminPath(`/rankings/${row.keyword.id}`)" class="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                  {{ row.keyword.keyword }}
                </NuxtLink>
                <span class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span v-if="hasMultipleStores">{{ row.storeName }}</span>
                  <span>{{ row.keyword.searchLocation.label }}</span>
                  <UiCommonBadge v-if="!row.keyword.isActive">停止中</UiCommonBadge>
                  <UiCommonBadge v-if="row.isChecking" tone="brand">計測中</UiCommonBadge>
                </span>
              </th>
              <td class="px-3 py-3 text-right">
                <span class="text-base font-semibold tabular-nums" :class="row.latest?.status === 'error' ? 'text-amber-700' : row.latest?.rank == null ? 'text-slate-500' : 'text-slate-900'">
                  {{ rankText(row) }}
                </span>
                <span v-if="row.latest" class="block text-xs text-slate-400">{{ formatShortDate(row.latest.checkedOn) }}</span>
              </td>
              <td class="px-3 py-3 text-right"><RankingCommonRankDiff :diff="row.dayDiff" label="前日比" /></td>
              <td class="px-3 py-3 text-right"><RankingCommonRankDiff :diff="row.weekDiff" label="前週比" /></td>
              <td class="px-3 py-3">
                <RankingCommonRankTrendChart variant="spark" :points="row.recentPoints" :range="RANK_RANGE" :label="`${row.keyword.keyword} の順位推移`" />
              </td>
              <td v-if="canManage" class="px-5 py-3">
                <div class="flex justify-end gap-1">
                  <UiCommonButton
                    size="sm"
                    variant="secondary"
                    icon="refresh"
                    :is-loading="checkingId === row.keyword.id || row.isChecking"
                    :is-disabled="!row.keyword.isActive || row.isChecking"
                    @click="onCheckNow(row)"
                  >
                    今すぐ計測
                  </UiCommonButton>
                  <UiCommonButton size="sm" variant="ghost" @click="onToggleActive(row)">
                    {{ row.keyword.isActive ? '停止' : '再開' }}
                  </UiCommonButton>
                  <UiCommonButton size="sm" variant="ghost" icon="trash" :aria-label="`${row.keyword.keyword} を削除`" @click="deleteTarget = row" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCommonCard>

    <RankingRankingsKeywordFormModal v-if="canManage" v-model="isFormOpen" :initial-store-id="storeId" @created="onCreated" />

    <UiCommonModal v-model="isDeleteOpen" title="キーワードを削除しますか？">
      <div class="space-y-3 text-sm text-slate-700">
        <p>「{{ deleteTarget?.keyword.keyword }}」と、これまでの順位の履歴をすべて削除します。この操作は取り消せません。</p>
        <p class="text-slate-500">履歴を残したい場合は「停止」を使ってください。</p>
        <UiCommonAlert v-if="deleteState.errorMessage.value" tone="danger">{{ deleteState.errorMessage.value }}</UiCommonAlert>
      </div>
      <template #footer>
        <UiCommonButton variant="secondary" @click="deleteTarget = null">キャンセル</UiCommonButton>
        <UiCommonButton variant="danger" :is-loading="deleteState.isPending.value" @click="onDelete">削除する</UiCommonButton>
      </template>
    </UiCommonModal>
  </div>
</template>
