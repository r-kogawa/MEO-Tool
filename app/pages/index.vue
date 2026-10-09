<script setup lang="ts">
// トップページは表示せず、ログイン済みなら管理画面（組織選択から自動で遷移）へ、未ログインならログイン画面へ送る
definePageMeta({
  middleware: async () => {
    await useBackendReady().waitForAuth()
    const { isLoggedIn } = useAuth()
    return navigateTo(isLoggedIn.value ? '/orgs' : '/login', { replace: true })
  },
})
</script>

<template>
  <div />
</template>
