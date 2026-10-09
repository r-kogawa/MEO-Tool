// Firestore の購読を常に始める（firebase.client.ts の初期化後に動く）。デモ中は Firebase からログアウトしているので何も読まない
export default defineNuxtPlugin(() => {
  startFirestoreSync()
})
