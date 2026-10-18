<script setup lang="ts">
// 利用規約。未ログインでも読めるよう LP のレイアウトを使う。検索結果に出すのは LP だけのため noindex
definePageMeta({ layout: 'landing' })
useSeoMeta({ title: '利用規約', robots: 'noindex, follow' })
</script>

<template>
  <article class="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
    <h1 class="text-2xl font-bold text-slate-900 sm:text-3xl">利用規約</h1>

    <ol class="mt-10 space-y-10">
      <li v-for="(article, index) in TERMS_ARTICLES" :key="article.title">
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
      {{ TERMS_ENACTED_ON }} 制定<br>{{ TERMS_OPERATOR }}
    </p>
  </article>
</template>
