// 一括処理（口コミの一括返信・複数店舗の同期など）。並列数を制限し、部分失敗は結果で返す。

export interface BatchResult<TId> {
  /** 入力順 */
  succeeded: TId[]
  failed: { id: TId; message: string }[]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '処理に失敗しました。'
}

export async function runBatch<TItem, TId>(
  items: TItem[],
  idOf: (item: TItem) => TId,
  worker: (item: TItem) => Promise<void>,
  options: { concurrency: number } = { concurrency: 3 },
): Promise<BatchResult<TId>> {
  const outcomes: ({ ok: true } | { ok: false; message: string })[] = new Array(items.length)
  let next = 0
  async function lane(): Promise<void> {
    while (next < items.length) {
      const index = next++
      try {
        await worker(items[index]!)
        outcomes[index] = { ok: true }
      }
      catch (error) {
        outcomes[index] = { ok: false, message: messageOf(error) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, items.length) }, lane))

  const result: BatchResult<TId> = { succeeded: [], failed: [] }
  items.forEach((item, index) => {
    const outcome = outcomes[index]!
    if (outcome.ok) result.succeeded.push(idOf(item))
    else result.failed.push({ id: idOf(item), message: outcome.message })
  })
  return result
}
