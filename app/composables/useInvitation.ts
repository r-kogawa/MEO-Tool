import type { Invitation, OrgType } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { findInvitationByToken, updateInvitationAcceptFunc } from '~/utils/mock/functions/identity'
import { errorMessageOf, mockLatency } from '~/utils/mock/functions/shared'

// F-03 招待の受諾（/invite/[token]）

interface InvitationLookup {
  invitation: Invitation | null
  org: { name: string; type: OrgType } | null
  storeNames: string[]
  errorMessage: string | null
}

export function useInvitation(token: string) {
  const { isMock } = useDemoSession()
  const db = useAppDb()
  const { user } = useAuth()
  const { $functions } = useNuxtApp()
  const { waitForOrg } = useBackendReady()

  // 仮データを使うのは、デモ中で、かつ仮データにそのトークンの招待がある場合だけ
  const isMockInvitation = computed(() => isMock.value && db.value.invitations.some(item => item.token === token))

  const mockLookup = computed<InvitationLookup>(() => {
    try {
      const invitation = findInvitationByToken(db.value, token)
      const org = db.value.organizations.find(item => item.id === invitation.orgId) ?? null
      return {
        invitation,
        org: org ? { name: org.name, type: org.type } : null,
        storeNames: invitation.storeIds.map(id => db.value.stores.find(store => store.id === id)?.name ?? id),
        errorMessage: null,
      }
    }
    catch (error) {
      return { invitation: null, org: null, storeNames: [], errorMessage: errorMessageOf(error) }
    }
  })

  // 本物モードでは招待コレクションを読めない（owner / admin のみ）ため、Functions で確認する
  const remoteLookup = ref<InvitationLookup>({ invitation: null, org: null, storeNames: [], errorMessage: null })
  const isLoading = ref(!isMockInvitation.value)
  // 仮データを使わなくなった時点（デモ状態が残っていない、またはデモから抜けた）で 1 回だけ Functions から読む
  watch(isMockInvitation, (isMockNow) => {
    if (isMockNow) return
    isLoading.value = true
    callFunction<object, { invitation: Invitation; org: { name: string; type: OrgType }; storeNames: string[] }>(
      $functions,
      'getInvitation',
      { token },
    )
      .then((result) => { remoteLookup.value = { ...result, errorMessage: null } })
      .catch((error) => { remoteLookup.value = { invitation: null, org: null, storeNames: [], errorMessage: errorMessageOf(error) } })
      .finally(() => { isLoading.value = false })
  }, { immediate: true })

  const lookup = computed(() => (isMockInvitation.value ? mockLookup.value : remoteLookup.value))

  /** 受諾して参加した組織 ID を返す */
  async function accept(): Promise<string> {
    if (!isMockInvitation.value) {
      const { orgId } = await callFunction<object, { orgId: string }>($functions, 'updateInvitationAccept', {
        token,
        displayName: user.value?.displayName ?? '',
      })
      await waitForOrg(orgId)
      return orgId
    }
    await mockLatency()
    return updateInvitationAcceptFunc(db.value, user.value!.uid, token)
  }

  return {
    invitation: computed(() => lookup.value.invitation),
    lookupError: computed(() => lookup.value.errorMessage),
    org: computed(() => lookup.value.org),
    storeNames: computed(() => lookup.value.storeNames),
    isLoading,
    accept,
  }
}
