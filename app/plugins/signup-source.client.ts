// auth ミドルウェアのリダイレクトで URL が変わる前に、起動時に経路を読む
export default defineNuxtPlugin(() => {
  const signupSource = useSignupSource()
  signupSource.capture()
  // 登録しない訪問者の端末にも期限切れ・壊れた値を残さないため、起動のたびに掃除する
  signupSource.load()
})
