import { validatePhotoFieldAsset } from "../core/photo-field";
import type { PhotoFieldAsset } from "../core/types";

const DATABASE_NAME = "relief-forge-assets-v1";
const STORE_NAME = "photo-fields";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "sha256" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open local photo storage."));
  });
}

function transactionRequest<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    let result!: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("Local photo storage failed."));
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("Local photo storage was interrupted."));
    };
  }));
}

export async function savePhotoFieldAsset(asset: PhotoFieldAsset): Promise<void> {
  validatePhotoFieldAsset(asset);
  await transactionRequest("readwrite", (store) => store.put({
    ...asset,
    rgba8: asset.rgba8.slice(),
  }));
}

export async function loadPhotoFieldAsset(sha256: string): Promise<PhotoFieldAsset | undefined> {
  const stored = await transactionRequest<PhotoFieldAsset | undefined>("readonly", (store) => store.get(sha256));
  if (!stored) return undefined;
  const asset: PhotoFieldAsset = {
    ...stored,
    rgba8: stored.rgba8 instanceof Uint8Array
      ? stored.rgba8
      : new Uint8Array(stored.rgba8 as unknown as ArrayBuffer),
  };
  validatePhotoFieldAsset(asset);
  return asset;
}

export async function deletePhotoFieldAsset(sha256: string): Promise<void> {
  await transactionRequest("readwrite", (store) => store.delete(sha256));
}

export async function clearPhotoFieldAssets(): Promise<void> {
  await transactionRequest("readwrite", (store) => store.clear());
}
