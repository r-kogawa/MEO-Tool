import type { Invitation, MemberRole } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import {
  createInvitationFunc,
  deleteMemberFunc,
  updateInvitationRevokeFunc,
  updateMemberRoleFunc,
} from '~/utils/mock/functions/identity'
import { mockLatency } from '~/utils/mock/functions/shared'

// F-03 メンバー招待・権限管理（法人のみ）

export function useMembers() {
  const { isMock } = useDemoSession()
  const { $functions } = useNuxtApp()
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId } = useCurrentOrg()

  const members = computed(() => db.value.members.filter(item => item.orgId === orgId.value))
  const invitations = computed(() =>
    db.value.invitations
      .filter(item => item.orgId === orgId.value && item.status !== 'accepted')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))

  /** 招待を作り、招待メールを送る。isMailSent は送れたか（送れなければ画面の URL を共有してもらう） */
  async function invite(input: { email: string; role: Exclude<MemberRole, 'owner'>; storeIds: string[] }): Promise<Invitation & { isMailSent: boolean }> {
    if (!isMock.value) return callFunction($functions, 'createInvitation', { orgId: orgId.value, ...input })
    await mockLatency()
    // 仮データではメールを送らない
    return { ...createInvitationFunc(db.value, user.value!.uid, { orgId: orgId.value, ...input }), isMailSent: false }
  }

  async function revokeInvitation(invitationId: string) {
    if (!isMock.value) return callFunction<object, void>($functions, 'updateInvitationRevoke', { orgId: orgId.value, invitationId })
    await mockLatency()
    updateInvitationRevokeFunc(db.value, user.value!.uid, orgId.value, invitationId)
  }

  async function updateRole(targetUid: string, role: Exclude<MemberRole, 'owner'>, storeIds: string[]) {
    if (!isMock.value) return callFunction<object, void>($functions, 'updateMemberRole', { orgId: orgId.value, targetUid, role, storeIds })
    await mockLatency()
    updateMemberRoleFunc(db.value, user.value!.uid, { orgId: orgId.value, targetUid, role, storeIds })
  }

  async function removeMember(targetUid: string) {
    if (!isMock.value) return callFunction<object, void>($functions, 'deleteMember', { orgId: orgId.value, targetUid })
    await mockLatency()
    deleteMemberFunc(db.value, user.value!.uid, orgId.value, targetUid)
  }

  /** 招待 URL（メールは送らず、画面からコピーして渡す） */
  function invitationUrl(token: string): string {
    return `${window.location.origin}/invite/${token}`
  }

  return { members, invitations, invite, revokeInvitation, updateRole, removeMember, invitationUrl }
}
