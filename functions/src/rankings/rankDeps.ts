import { getFunctions } from 'firebase-admin/functions'
import type { RankProvider } from './providers/rankProvider'
import type { RankTask } from './types'

// 順位計測の外部依存（Google マップの取得・Cloud Tasks への投入・現在時刻）。テストでは偽物に差し替える

export interface EnqueueOptions {
  /** Cloud Tasks のタスク名。同じ名前の再投入は無視される（冪等） */
  id: string
}

export interface RankDeps {
  provider: RankProvider
  enqueue(task: RankTask, options: EnqueueOptions): Promise<void>
  now(): Date
}

const WORKER_QUEUE = 'locations/asia-northeast1/functions/rankCheckWorker'

export const defaultRankDeps: RankDeps = {
  provider: {
    // Chromium はワーカーだけで読み込む（callable の起動を重くしない）
    async search(keyword, at) {
      const { gmapsProvider } = await import('./providers/gmapsScraper.js')
      return gmapsProvider.search(keyword, at)
    },
  },
  async enqueue(task, options) {
    try {
      await getFunctions().taskQueue<RankTask>(WORKER_QUEUE).enqueue(task, { id: options.id })
    }
    catch (error) {
      if ((error as { code?: string }).code === 'functions/task-already-exists') return
      throw error
    }
  },
  now: () => new Date(),
}
