import {
  copyDepthPaintFieldAsset,
  validateDepthPaintFieldAsset,
  type DepthPaintFieldAsset,
} from "./field";

/** Separate versioned database so photo and signed-depth migrations are isolated. */
export const DEPTH_PAINT_DATABASE_NAME = "relief-forge-depth-paint-assets-v1";
export const DEPTH_PAINT_STORE_NAME = "depth-paint-fields";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB depth-paint storage is unavailable in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEPTH_PAINT_DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DEPTH_PAINT_STORE_NAME)) {
        request.result.createObjectStore(DEPTH_PAINT_STORE_NAME, {
          keyPath: "sha256",
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("Unable to open local depth-paint storage."),
    );
  });
}

function transactionRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(DEPTH_PAINT_STORE_NAME, mode);
    const request = run(transaction.objectStore(DEPTH_PAINT_STORE_NAME));
    let result!: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("Local depth-paint storage failed."));
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onabort = () => {
      database.close();
      reject(
        transaction.error ?? new Error("Local depth-paint storage was interrupted."),
      );
    };
  }));
}

function validateSha256(sha256: string): void {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("Depth-paint storage keys must be lowercase SHA-256 digests.");
  }
}

export async function saveDepthPaintFieldAsset(
  asset: DepthPaintFieldAsset,
): Promise<void> {
  validateDepthPaintFieldAsset(asset);
  const stable = copyDepthPaintFieldAsset(asset);
  await transactionRequest("readwrite", (store) => store.put(stable));
}

export async function loadDepthPaintFieldAsset(
  sha256: string,
): Promise<DepthPaintFieldAsset | undefined> {
  validateSha256(sha256);
  const stored = await transactionRequest<DepthPaintFieldAsset | undefined>(
    "readonly",
    (store) => store.get(sha256),
  );
  if (!stored) return undefined;
  const asset: DepthPaintFieldAsset = {
    ...stored,
    values: stored.values instanceof Int16Array
      ? stored.values.slice()
      : new Int16Array(stored.values as unknown as ArrayBuffer),
  };
  validateDepthPaintFieldAsset(asset);
  return asset;
}

export async function deleteDepthPaintFieldAsset(sha256: string): Promise<void> {
  validateSha256(sha256);
  await transactionRequest("readwrite", (store) => store.delete(sha256));
}

export async function clearDepthPaintFieldAssets(): Promise<void> {
  await transactionRequest("readwrite", (store) => store.clear());
}
