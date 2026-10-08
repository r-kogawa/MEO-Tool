/**
 * 複数の購読（例: 自分の所属一覧と、表示中の組織のメンバー一覧）の結果を 1 つの配列にまとめる。
 * 同じキーの要素は後から登録した購読の値で上書きする。
 */
export class MirrorCollection<T> {
  private readonly sources = new Map<string, T[]>()

  constructor(
    private readonly keyOf: (item: T) => string,
    private readonly publish: (items: T[]) => void,
  ) {}

  set(source: string, items: T[]): void {
    this.sources.set(source, items)
    this.flush()
  }

  delete(source: string): void {
    if (this.sources.delete(source)) this.flush()
  }

  clear(): void {
    this.sources.clear()
    this.flush()
  }

  private flush(): void {
    const merged = new Map<string, T>()
    for (const items of this.sources.values()) {
      for (const item of items) merged.set(this.keyOf(item), item)
    }
    this.publish([...merged.values()])
  }
}
