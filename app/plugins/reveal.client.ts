// v-reveal: 画面に入ったときにふわっと表示する（LP 用）。値には遅延のミリ秒を渡せる（例: v-reveal="150"）
export default defineNuxtPlugin((nuxtApp) => {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('is-revealed')
      observer.unobserve(entry.target)
    }
  }, { rootMargin: '0px 0px -10% 0px' })

  nuxtApp.vueApp.directive<HTMLElement, number | undefined>('reveal', {
    mounted(el, binding) {
      el.classList.add('reveal')
      if (binding.value) el.style.setProperty('--reveal-delay', `${binding.value}ms`)
      observer.observe(el)
    },
    unmounted(el) {
      observer.unobserve(el)
    },
  })
})
