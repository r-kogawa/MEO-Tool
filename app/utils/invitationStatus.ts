import type { Invitation, InvitationStatus } from '~/types/domain'

/** 期限切れを反映した招待の状態（保存値は書き換えない） */
export function invitationStatusOf(invitation: Invitation, now = Date.now()): InvitationStatus {
  return invitation.status === 'pending' && Date.parse(invitation.expiresAt) < now ? 'expired' : invitation.status
}
