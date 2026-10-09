import { initializeApp, getApps, type FirebaseOptions } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { isLocalHost } from "~/utils/firebase/isLocalHost";

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();
  const firebaseConfig: FirebaseOptions = {
    apiKey: config.public.FIREBASE_API_KEY,
    authDomain: config.public.FIREBASE_AUTH_DOMAIN,
    projectId: config.public.FIREBASE_PROJECT_ID,
    storageBucket: config.public.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: config.public.FIREBASE_MESSAGING_SENDER_ID,
    appId: config.public.FIREBASE_APP_ID,
  };

  const apps = getApps();
  const firebaseApp = apps.length ? apps[0] : initializeApp(firebaseConfig);

  if (!firebaseApp) {
    console.error("Firebase app not initialized");
    return;
  }

  const db = getFirestore(firebaseApp);
  const storage = getStorage(firebaseApp);
  const auth = getAuth(firebaseApp);
  const functions = getFunctions(firebaseApp, "asia-northeast1");

  // Auth / Firestore / Storage は常に本番。手元（localhost）で開いたときだけ Functions を手元の Emulator に向ける。
  // ポートは firebase.json の emulators と合わせる
  if (isLocalHost(window.location.hostname)) {
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  }

  return {
    provide: {
      db,
      storage,
      auth,
      functions,
    },
  };
});
