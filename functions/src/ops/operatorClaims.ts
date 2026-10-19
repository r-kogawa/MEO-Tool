/** 運営者の付与・剥奪後の Custom Claims。operator 以外の claims は保つ */
export function nextOperatorClaims(current: Record<string, unknown> | undefined, isRevoke: boolean): Record<string, unknown> {
  const { operator: _operator, ...rest } = current ?? {}
  return isRevoke ? rest : { ...rest, operator: true }
}
