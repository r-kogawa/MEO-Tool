// 画面右下に短時間だけ出す通知（コピー完了・保存完了など）

export interface Toast {
  id: number
  message: string
  tone: 'success' | 'danger'
}

const DISPLAY_MS = 3000
let nextId = 1

export function useToast() {
  const toasts = useState<Toast[]>('toasts', () => [])

  function show(message: string, tone: Toast['tone'] = 'success'): void {
    const toast = { id: nextId++, message, tone }
    toasts.value.push(toast)
    setTimeout(() => {
      toasts.value = toasts.value.filter(item => item.id !== toast.id)
    }, DISPLAY_MS)
  }

  return { toasts, show }
}

/** クリップボードにコピーして結果をトーストで知らせる */
export async function copyToClipboard(text: string, message = 'コピーしました'): Promise<void> {
  const { show } = useToast()
  try {
    await navigator.clipboard.writeText(text)
    show(message)
  }
  catch {
    show('コピーできませんでした。手動で選択してコピーしてください。', 'danger')
  }
}
