import { callFunction } from '~/utils/firebase/callFunction'
import { createReplyTemplateFunc, deleteReplyTemplateFunc, updateReplyTemplateFunc } from '~/utils/mock/functions/gbp'
import { mockLatency } from '~/utils/mock/functions/shared'

// 口コミ返信のテンプレート（owner / admin が管理し、メンバー全員が使える）

export function useReplyTemplates() {
  const { isMock } = useDemoSession()
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId } = useCurrentOrg()
  const { $functions } = useNuxtApp()

  const templates = computed(() =>
    db.value.replyTemplates.filter(item => item.orgId === orgId.value).sort((a, b) => a.createdAt.localeCompare(b.createdAt)))

  async function createTemplate(input: { name: string; body: string }): Promise<void> {
    if (!isMock.value) {
      await callFunction($functions, 'createReplyTemplate', { orgId: orgId.value, ...input })
      return
    }
    await mockLatency()
    createReplyTemplateFunc(db.value, user.value!.uid, orgId.value, input)
  }

  async function updateTemplate(templateId: string, input: { name: string; body: string }): Promise<void> {
    if (!isMock.value) {
      await callFunction($functions, 'updateReplyTemplate', { orgId: orgId.value, templateId, ...input })
      return
    }
    await mockLatency()
    updateReplyTemplateFunc(db.value, user.value!.uid, orgId.value, templateId, input)
  }

  async function deleteTemplate(templateId: string): Promise<void> {
    if (!isMock.value) {
      await callFunction($functions, 'deleteReplyTemplate', { orgId: orgId.value, templateId })
      return
    }
    await mockLatency()
    deleteReplyTemplateFunc(db.value, user.value!.uid, orgId.value, templateId)
  }

  return { templates, createTemplate, updateTemplate, deleteTemplate }
}
