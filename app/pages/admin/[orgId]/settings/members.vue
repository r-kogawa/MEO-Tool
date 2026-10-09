<script setup lang="ts">
import type { Invitation, InvitationStatus, Member, MemberRole } from '~/types/domain'
import type { BadgeTone } from '~/components/Ui/Common/Badge.vue'

// F-03 メンバー招待・権限管理（法人の owner / admin）

definePageMeta({ layout: 'admin', roles: ['owner', 'admin'], orgTypes: ['corporate'] })
useHead({ title: 'メンバー' })

const { user } = useAuth()
const { storeName } = useCurrentOrg()
const { members, invitations, invite, revokeInvitation, removeMember, invitationUrl } = useMembers()
const { show } = useToast()

const INVITATION_STATUS: Record<InvitationStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: '招待中', tone: 'brand' },
  accepted: { label: '参加済み', tone: 'success' },
  revoked: { label: '取消済み', tone: 'neutral' },
  expired: { label: '期限切れ', tone: 'warning' },
}

// 招待フォーム
const email = ref('')
const role = ref<Exclude<MemberRole, 'owner'>>('staff')
const storeIds = ref<string[]>([])
const emailError = ref<string | null>(null)
const storeError = ref<string | null>(null)
const inviteState = useActionState()
const lastInvitation = ref<(Invitation & { isMailSent: boolean }) | null>(null)

const roleOptions = [
  { value: 'admin' as const, label: '管理者（全店舗・設定を管理）' },
  { value: 'staff' as const, label: 'スタッフ（担当店舗のみ）' },
]

async function onInvite(): Promise<void> {
  emailError.value = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) ? null : 'メールアドレスを正しく入力してください'
  storeError.value = role.value === 'staff' && storeIds.value.length === 0 ? '担当店舗を 1 つ以上選んでください' : null
  if (emailError.value || storeError.value) return
  const created = await inviteState.run(() => invite({ email: email.value, role: role.value, storeIds: storeIds.value }))
  if (!created) return
  lastInvitation.value = created
  email.value = ''
  storeIds.value = []
  show(created.isMailSent ? '招待メールを送信しました' : '招待を作成しました')
}

// メンバー編集・削除
const editTarget = ref<Member | null>(null)
const isEditOpen = computed({
  get: () => editTarget.value !== null,
  set: (value: boolean) => { if (!value) editTarget.value = null },
})
const removeTarget = ref<Member | null>(null)
const isRemoveOpen = computed({
  get: () => removeTarget.value !== null,
  set: (value: boolean) => { if (!value) removeTarget.value = null },
})
const removeState = useActionState()
const rowState = useActionState()

function canEdit(member: Member): boolean {
  return member.role !== 'owner' && member.uid !== user.value?.uid
}

async function onRemove(): Promise<void> {
  const target = removeTarget.value
  if (!target) return
  await removeState.run(() => removeMember(target.uid))
  if (removeState.errorMessage.value) return
  removeTarget.value = null
  show('メンバーを削除しました')
}

async function onRevoke(invitation: Invitation): Promise<void> {
  await rowState.run(() => revokeInvitation(invitation.id))
  if (rowState.errorMessage.value) show(rowState.errorMessage.value, 'danger')
  else show('招待を取り消しました')
}

function storeNames(ids: string[]): string {
  return ids.map(storeName).join('、')
}
</script>

<template>
  <div class="space-y-6">
    <UiCommonPageHeader title="メンバー" description="法人のメンバーと権限を管理します" />

    <UiCommonCard title="メンバー一覧" :description="`${members.length} 名`" is-flush>
      <div class="relative overflow-x-auto">
        <table class="w-full min-w-[640px] text-sm">
          <thead class="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th scope="col" class="px-5 py-2.5 font-medium">名前</th>
              <th scope="col" class="px-3 py-2.5 font-medium">ロール</th>
              <th scope="col" class="px-3 py-2.5 font-medium">担当店舗</th>
              <th scope="col" class="px-3 py-2.5 font-medium">参加日</th>
              <th scope="col" class="px-5 py-2.5"><span class="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="member in members" :key="member.uid">
              <th scope="row" class="px-5 py-3 text-left font-normal">
                <span class="block font-medium text-slate-900">
                  {{ member.displayName }}
                  <span v-if="member.uid === user?.uid" class="ml-1 text-xs text-slate-500">（あなた）</span>
                </span>
                <span class="block text-xs text-slate-500">{{ member.email }}</span>
              </th>
              <td class="px-3 py-3">
                <UiCommonBadge :tone="member.role === 'owner' ? 'brand' : 'neutral'">{{ ROLE_LABELS[member.role] }}</UiCommonBadge>
              </td>
              <td class="px-3 py-3 text-slate-600">{{ member.role === 'staff' ? storeNames(member.storeIds) : 'すべての店舗' }}</td>
              <td class="px-3 py-3 text-slate-600 tabular-nums">{{ formatDate(member.joinedAt) }}</td>
              <td class="px-5 py-3">
                <div v-if="canEdit(member)" class="flex justify-end gap-1">
                  <UiCommonButton size="sm" variant="secondary" @click="editTarget = member">権限を変更</UiCommonButton>
                  <UiCommonButton size="sm" variant="ghost" icon="trash" :aria-label="`${member.displayName} を削除`" @click="removeTarget = member" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCommonCard>

    <div class="grid gap-6 lg:grid-cols-2">
      <UiCommonCard title="メンバーを招待" description="招待 URL は 7 日間有効です">
        <form class="space-y-4" @submit.prevent="onInvite">
          <UiInputTextField v-model="email" label="メールアドレス" type="email" :error="emailError" is-required autocomplete="off" />
          <UiInputSelectField v-model="role" label="ロール" :options="roleOptions" />
          <SettingsInputStoreCheckboxGroup v-if="role === 'staff'" v-model="storeIds" :error="storeError" />
          <UiCommonAlert v-if="inviteState.errorMessage.value" tone="danger">{{ inviteState.errorMessage.value }}</UiCommonAlert>
          <UiCommonAlert
            v-if="lastInvitation"
            :tone="lastInvitation.isMailSent ? 'success' : 'warning'"
            :title="lastInvitation.isMailSent ? '招待メールを送信しました' : '招待を作成しました（メールは送信できませんでした）'"
          >
            <template v-if="lastInvitation.isMailSent">{{ lastInvitation.email }} 宛てに招待 URL を送りました。届かない場合は、下の URL を直接共有してください。</template>
            <template v-else>{{ lastInvitation.email }} さんに下の URL を直接共有してください。</template>
            <span class="mt-2 flex flex-wrap items-center gap-2">
              <code class="rounded bg-white px-2 py-1 text-xs break-all">{{ invitationUrl(lastInvitation.token) }}</code>
              <UiCommonButton size="sm" variant="secondary" icon="copy" @click="copyToClipboard(invitationUrl(lastInvitation.token), '招待 URL をコピーしました')">
                コピー
              </UiCommonButton>
            </span>
          </UiCommonAlert>
          <div class="flex justify-end">
            <UiCommonButton type="submit" :is-loading="inviteState.isPending.value">招待する</UiCommonButton>
          </div>
        </form>
      </UiCommonCard>

      <UiCommonCard title="招待" :description="`${invitations.length} 件`" is-flush>
        <p v-if="invitations.length === 0" class="p-5 text-sm text-slate-500">招待はありません。</p>
        <ul v-else class="divide-y divide-slate-100">
          <li v-for="invitation in invitations" :key="invitation.id" class="space-y-2 px-5 py-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ invitation.email }}</span>
              <UiCommonBadge :tone="INVITATION_STATUS[invitationStatusOf(invitation)].tone">
                {{ INVITATION_STATUS[invitationStatusOf(invitation)].label }}
              </UiCommonBadge>
            </div>
            <p class="text-xs text-slate-500">
              {{ ROLE_LABELS[invitation.role] }}
              <template v-if="invitation.role === 'staff'">（{{ storeNames(invitation.storeIds) }}）</template>
              ・有効期限 {{ formatDate(invitation.expiresAt) }}
            </p>
            <div v-if="invitationStatusOf(invitation) === 'pending'" class="flex gap-2">
              <!-- 本物モードはトークンを保存しないため、URL は作成直後にだけ表示できる -->
              <UiCommonButton v-if="invitation.token" size="sm" variant="secondary" icon="copy" @click="copyToClipboard(invitationUrl(invitation.token), '招待 URL をコピーしました')">
                URL をコピー
              </UiCommonButton>
              <UiCommonButton size="sm" variant="ghost" @click="onRevoke(invitation)">取り消す</UiCommonButton>
            </div>
          </li>
        </ul>
      </UiCommonCard>
    </div>

    <SettingsMembersMemberEditModal v-model="isEditOpen" :member="editTarget" @saved="show('権限を変更しました')" />

    <UiCommonModal v-model="isRemoveOpen" title="メンバーを削除しますか？">
      <div class="space-y-3 text-sm text-slate-700">
        <p>{{ removeTarget?.displayName }}（{{ removeTarget?.email }}）はこの組織の管理画面を開けなくなります。</p>
        <UiCommonAlert v-if="removeState.errorMessage.value" tone="danger">{{ removeState.errorMessage.value }}</UiCommonAlert>
      </div>
      <template #footer>
        <UiCommonButton variant="secondary" @click="removeTarget = null">キャンセル</UiCommonButton>
        <UiCommonButton variant="danger" :is-loading="removeState.isPending.value" @click="onRemove">削除する</UiCommonButton>
      </template>
    </UiCommonModal>
  </div>
</template>
