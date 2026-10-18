<template>
  <!-- 集客ページ（LP）用。ログイン後の画面は admin / auth レイアウトを使う -->
  <div class="flex min-h-screen flex-col bg-white">
    <LandingLayoutHeader />
    <main class="flex-1">
      <slot />
    </main>
    <LandingLayoutFooter />
  </div>
</template>
