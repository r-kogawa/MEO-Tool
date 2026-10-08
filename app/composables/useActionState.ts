import { errorMessageOf } from '~/utils/mock/functions/shared'

/** Functions 呼び出しなどの非同期処理の「実行中」と「エラー」を持つ */
export function useActionState() {
  const isPending = ref(false)
  const errorMessage = ref<string | null>(null)

  async function run<T>(action: () => Promise<T> | T): Promise<T | undefined> {
    isPending.value = true
    errorMessage.value = null
    try {
      return await action()
    }
    catch (error) {
      errorMessage.value = errorMessageOf(error)
      return undefined
    }
    finally {
      isPending.value = false
    }
  }

  return { isPending, errorMessage, run }
}
