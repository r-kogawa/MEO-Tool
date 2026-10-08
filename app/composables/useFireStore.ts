import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  Timestamp,
  getCountFromServer,
  type CollectionReference,
  type WhereFilterOp,
  type Firestore,
  type Query,
  type Unsubscribe,
} from "firebase/firestore";

export const useFirestore = <T>(path: string) => {
  const { $db } = useNuxtApp();
  const db = $db as Firestore;

  const documents = ref<T[]>([]);
  const document = ref<T | null>(null);

  const isClient = import.meta.client;

  const getCollectionRef = (path: string): CollectionReference => {
    if (!isClient || !db) {
      throw new Error("useFirestore is only available on the client");
    }

    const pathSplit = path.split("/");
    let collectionRef: CollectionReference;
    collectionRef = collection(db, pathSplit[0] || "");

    for (let i = 1; i < pathSplit.length; i += 2) {
      const docId = pathSplit[i];
      const subCollection = pathSplit[i + 1];
      if (!docId || !subCollection) break;
      collectionRef = collection(doc(collectionRef, docId), subCollection);
    }
    return collectionRef;
  };

  /**
   * ドキュメント一覧を取得
   * @param filters
   */
  const fetchDocuments = async (
    filters?: { field: string; operator: WhereFilterOp; value: any }[]
  ): Promise<void> => {
    if (!isClient || !db) {
      throw new Error("useFirestore is only available on the client");
    }

    try {
      const collectionRef = getCollectionRef(path);

      let q: Query = query(collectionRef);
      for (const filter of filters || []) {
        q = query(q, where(filter.field, filter.operator, filter.value));
      }

      const snapshot = await getDocs(q);

      documents.value = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          ...data,
          id: doc.id,
          createAt: data?.createAt?.toDate(),
          updateAt: data?.updateAt?.toDate(),
        } as T;
      });
    } catch (e) {
      console.error("ドキュメント取得エラー:", e);
      throw new Error("ドキュメント取得エラー: " + e);
    }
  };

  const fetchDocumentsCount = async (
    filters?: { field: string; operator: WhereFilterOp; value: any }[]
  ): Promise<number> => {
    if (!isClient || !db) {
      throw new Error("useFirestore is only available on the client");
    }
    const collectionRef = getCollectionRef(path);
    let q: Query = query(collectionRef);
    for (const filter of filters || []) {
      q = query(q, where(filter.field, filter.operator, filter.value));
    }
    const snapshot = await getCountFromServer(q);
    return snapshot.data().count || 0;
  };

  const fetchDocumentById = async (id: string): Promise<void> => {
    if (!isClient || !db) {
      throw new Error("useFirestore is only available on the client");
    }

    try {
      const collectionRef = getCollectionRef(path);

      const docRef = doc(collectionRef, id);
      const snapshot = await getDoc(docRef);
      const data = snapshot.data();
      document.value = {
        ...data,
        id: docRef.id,
        createAt: data?.createAt?.toDate(),
        updateAt: data?.updateAt?.toDate(),
      } as T;
    } catch (e) {
      console.error("ドキュメント取得エラー:" + e);
      throw new Error("ドキュメント取得エラー: " + e);
    }
  };

  const addDocument = async (
    add_document: Omit<Partial<T>, "id" | "createAt" | "updateAt">
  ): Promise<void> => {
    if (!isClient || !db) {
      throw new Error("useFirestore is only available on the client");
    }

    try {
      const collectionRef = getCollectionRef(path);
      const docRef = await addDoc(collectionRef, {
        ...add_document,
        createAt: Timestamp.now(),
        updateAt: Timestamp.now(),
      } as any);
      document.value = {
        id: docRef.id,
        ...document,
      } as T;
    } catch (e) {
      console.error("ドキュメント追加エラー:" + e);
      throw new Error("ドキュメント追加エラー: " + e);
    }
  };

  const setDocument = async (
    id: string,
    set_document: Omit<Partial<T>, "createAt" | "updateAt">
  ) => {
    if (!isClient || !db) {
      throw new Error("useFirestore is only available on the client");
    }

    try {
      const collectionRef = getCollectionRef(path);
      const docRef = doc(collectionRef, id);
      await setDoc(docRef, {
        ...set_document,
        createAt: Timestamp.now(),
        updateAt: Timestamp.now(),
      } as any);
      document.value = {
        id: docRef.id,
        ...set_document,
        createAt: Timestamp.now(),
        updateAt: Timestamp.now(),
      } as T;
    } catch (e) {
      console.error("ドキュメント作成エラー:" + e);
      throw new Error("ドキュメント作成エラー: " + e);
    }
  };

  const updateDocument = async (
    id: string,
    update_document: Partial<T>
  ): Promise<void> => {
    if (!isClient || !db) {
      throw new Error("useFirestore is only available on the client");
    }

    try {
      const collectionRef = getCollectionRef(path);
      const docRef = doc(collectionRef, id);
      await updateDoc(docRef, {
        ...update_document,
        updateAt: Timestamp.now(),
      });
    } catch (e) {
      console.error("ドキュメント更新エラー:" + e);
      throw new Error("ドキュメント更新エラー: " + e);
    }
  };

  /**
   * ドキュメント削除
   * @param id ドキュメントID
   */
  const deleteDocument = async (id: string): Promise<void> => {
    if (!isClient || !db) {
      throw new Error("useFirestore is only available on the client");
    }

    try {
      const collectionRef = getCollectionRef(path);
      const docRef = doc(collectionRef, id);
      await deleteDoc(docRef);
    } catch (e) {
      console.error("ドキュメント削除エラー:" + e);
      throw new Error("ドキュメント削除エラー: " + e);
    }
  };

  return {
    documents,
    fetchDocuments,
    fetchDocumentsCount,
    document,
    fetchDocumentById,
    addDocument,
    setDocument,
    updateDocument,
    deleteDocument,
    getCollectionRef,
  };
};
