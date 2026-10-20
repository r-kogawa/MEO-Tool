<script setup lang="ts">
import type { TermsArticle } from '~/utils/terms'

// 利用規約・プライバシーポリシーの本文。条・項・号に番号を振って表示する
interface Props {
  title: string
  articles: TermsArticle[]
  /** 制定日の表記（例: 2026年10月18日） */
  enactedOn: string
  /** 改定日の表記。改定していない文書では渡さない */
  revisedOn?: string
  operator: string
}

defineProps<Props>()
</script>

<template>
  <article class="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
    <h1 class="text-2xl font-bold text-slate-900 sm:text-3xl">{{ title }}</h1>

    <ol class="mt-10 space-y-10">
      <li v-for="(article, index) in articles" :key="article.title">
        <h2 class="text-base font-bold text-slate-900">第 {{ index + 1 }} 条（{{ article.title }}）</h2>
        <ol class="mt-3 space-y-3 text-sm leading-relaxed text-slate-700">
          <li v-for="(clause, clauseIndex) in article.clauses" :key="clauseIndex" class="flex gap-2">
            <span v-if="article.clauses.length > 1" class="shrink-0">{{ clauseIndex + 1 }}.</span>
            <div>
              <p>{{ clause.text }}</p>
              <ol v-if="clause.items" class="mt-2 space-y-1">
                <li v-for="(item, itemIndex) in clause.items" :key="itemIndex" class="flex gap-2">
                  <span class="shrink-0">（{{ itemIndex + 1 }}）</span>
                  <span>{{ item }}</span>
                </li>
              </ol>
            </div>
          </li>
        </ol>
      </li>
    </ol>

    <p class="mt-14 border-t border-slate-200 pt-6 text-right text-sm text-slate-500">
      {{ enactedOn }} 制定<br><template v-if="revisedOn">{{ revisedOn }} 改定<br></template>{{ operator }}
    </p>
  </article>
</template>
