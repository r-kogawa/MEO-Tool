import type { GbpPost, GbpProfile, GbpReview, ReplyTemplate, Store } from '~/types/domain'
import { createRandom, pick, randomInt } from './random'

// GBP のプロフィール・口コミ・返信テンプレートの仮データ（シード付き乱数で毎回同じ内容）

const REVIEWERS = ['山田 花子', '佐々木 健', 'T. Suzuki', '高橋 美穂', '中村 翔', '小川 由美', 'K. Ito', '森 大樹']
const GOOD_COMMENTS = [
  'ランチで利用しました。味噌汁が絶品で、また来たいです。',
  '店員さんの対応がとても丁寧でした。',
  '落ち着いた雰囲気で、ゆっくり過ごせました。',
  '提供が早くて、昼休みでも安心して使えます。',
]
const BAD_COMMENTS = ['少し待ち時間が長かったです。', '量がもう少し多いと嬉しいです。']
const REPLIES = ['ご来店ありがとうございました。またのお越しをお待ちしております。', '貴重なご意見ありがとうございます。改善に努めます。']

export function createGbpSeed(stores: Store[], now: Date): { gbpProfiles: GbpProfile[]; gbpReviews: GbpReview[]; gbpPosts: GbpPost[]; replyTemplates: ReplyTemplate[] } {
  const random = createRandom(20261007)
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86400000).toISOString()
  const linked = stores.filter(store => store.gbpLocationName)

  const gbpProfiles: GbpProfile[] = linked.map(store => ({
    orgId: store.orgId,
    storeId: store.id,
    title: store.name,
    address: store.address,
    categories: store.orgId === 'org-komorebi' ? ['カフェ'] : ['定食屋', '和食店'],
    description: `${store.name}の公式プロフィールです。季節の食材を使ったメニューをご用意しています。`,
    primaryPhone: `03-${randomInt(random, 1000, 9999)}-${randomInt(random, 1000, 9999)}`,
    websiteUri: 'https://example.com/',
    regularHours: (['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const).map(day => ({
      openDay: day, openTime: '11:00', closeDay: day, closeTime: day === 'SATURDAY' ? '23:00' : '22:00',
    })),
    specialHours: [{ date: `${now.getFullYear()}-12-31`, isClosed: true, openTime: null, closeTime: null }],
    syncedAt: daysAgo(1),
  }))

  const gbpReviews: GbpReview[] = linked.flatMap(store => Array.from({ length: randomInt(random, 6, 12) }, (_, index) => {
    const starRating = pick(random, [5, 5, 5, 4, 4, 3, 2])
    const isAnonymous = random() < 0.1
    const hasComment = random() > 0.15
    const hasReply = random() < 0.5
    const created = daysAgo(index * 3 + randomInt(random, 0, 2))
    return {
      id: `rv-${store.id}-${index + 1}`,
      orgId: store.orgId,
      storeId: store.id,
      reviewName: `${store.gbpLocationName}/reviews/rv-${index + 1}`,
      reviewerName: isAnonymous ? '匿名' : pick(random, REVIEWERS),
      reviewerPhotoUrl: null,
      isAnonymous,
      starRating,
      comment: hasComment ? pick(random, starRating >= 4 ? GOOD_COMMENTS : BAD_COMMENTS) : null,
      reviewCreatedAt: created,
      reviewUpdatedAt: created,
      reply: hasReply ? { comment: pick(random, REPLIES), updatedAt: created } : null,
      hasReply,
    }
  }))

  const orgIds = [...new Set(linked.map(store => store.orgId))]
  const replyTemplates: ReplyTemplate[] = orgIds.flatMap(orgId => [
    { id: `tpl-${orgId}-thanks`, orgId, name: 'お礼（高評価）', body: '{投稿者名}様\n{店舗名}をご利用いただきありがとうございました。またのお越しを心よりお待ちしております。', createdAt: daysAgo(30) },
    { id: `tpl-${orgId}-improve`, orgId, name: 'お詫び（改善）', body: '{投稿者名}様\n貴重なご意見ありがとうございます。{店舗名}一同、改善に努めてまいります。', createdAt: daysAgo(30) },
  ])


  const gbpPosts: GbpPost[] = linked.flatMap((store, index) => {
    const base = { orgId: store.orgId, storeId: store.id, mediaUrl: null, searchUrl: null, errorMessage: null, offer: null }
    const year = now.getFullYear()
    return [
      {
        ...base, id: `post-${store.id}-1`, postName: `${store.gbpLocationName}/localPosts/1`, topicType: 'STANDARD' as const, state: 'LIVE' as const,
        summary: '秋の新メニューが始まりました。季節の食材を使った定食をぜひお試しください。',
        callToAction: { actionType: 'LEARN_MORE' as const, url: 'https://example.com/menu' }, event: null, createdAt: daysAgo(2),
      },
      {
        ...base, id: `post-${store.id}-2`, postName: `${store.gbpLocationName}/localPosts/2`, topicType: 'EVENT' as const, state: 'LIVE' as const,
        summary: '店内で秋の収穫祭を開催します。', callToAction: null,
        event: { title: '秋の収穫祭', startAt: `${year}-11-01T11:00`, endAt: `${year}-11-03T20:00` }, createdAt: daysAgo(10),
      },
      {
        ...base, id: `post-${store.id}-3`, postName: `${store.gbpLocationName}/localPosts/3`, topicType: 'OFFER' as const,
        // 1 店舗目だけ却下の例にする
        state: index === 0 ? 'REJECTED' as const : 'PROCESSING' as const,
        summary: 'ランチタイムのドリンク 100 円引き', callToAction: null,
        event: { title: 'ランチドリンク割', startAt: `${year}-10-01T11:00`, endAt: `${year}-10-31T15:00` },
        offer: { couponCode: 'LUNCH100', redeemOnlineUrl: '', termsConditions: 'ランチタイム限定' }, createdAt: daysAgo(20),
      },
    ]
  })

  return { gbpProfiles, gbpReviews, gbpPosts, replyTemplates }
}
