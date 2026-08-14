const DATABASE = 'quake3-wasm-assets-v1';
const STORE = 'assets';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transaction(db, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(tx.error || new Error('asset cache transaction aborted'));
  });
}

export async function getCachedAsset(key) {
  const db = await openDatabase();
  try {
    const result = await transaction(db, 'readonly', (store) => store.get(key));
    return result instanceof ArrayBuffer ? new Uint8Array(result) : null;
  } finally { db.close(); }
}

export async function putCachedAsset(key, bytes) {
  const db = await openDatabase();
  try { await transaction(db, 'readwrite', (store) => store.put(bytes.buffer, key)); }
  finally { db.close(); }
}

export async function deleteCachedAsset(key) {
  const db = await openDatabase();
  try { await transaction(db, 'readwrite', (store) => store.delete(key)); }
  finally { db.close(); }
}

export const CACHE_DATABASE = DATABASE;
