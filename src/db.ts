import type { ImageEntry, BenchmarkRun } from './types'

const DB_NAME = 'bp-extractor-db'
const DB_VERSION = 2
const STORE_IMAGES = 'images'
const STORE_RUNS   = 'benchmark_runs'

let _db: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'id' })
      }
      if ((event as IDBVersionChangeEvent).oldVersion < 2) {
        db.createObjectStore(STORE_RUNS, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => { _db = req.result; resolve(_db) }
    req.onerror  = () => reject(req.error)
  })
}

function run<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror  = () => reject(req.error)
  })
}

// ── Images ─────────────────────────────────────────────────────────

export async function getAllImages(): Promise<ImageEntry[]> {
  const db = await openDB()
  const all = await run<ImageEntry[]>(
    db.transaction(STORE_IMAGES, 'readonly').objectStore(STORE_IMAGES).getAll(),
  )
  return all.sort((a, b) => b.savedAt - a.savedAt)
}

export async function saveImage(entry: ImageEntry): Promise<void> {
  const db = await openDB()
  await run(db.transaction(STORE_IMAGES, 'readwrite').objectStore(STORE_IMAGES).put(entry))
}

export async function deleteImage(id: string): Promise<void> {
  const db = await openDB()
  await run(db.transaction(STORE_IMAGES, 'readwrite').objectStore(STORE_IMAGES).delete(id))
}

// ── Benchmark runs ─────────────────────────────────────────────────

export async function getAllBenchmarkRuns(): Promise<BenchmarkRun[]> {
  const db = await openDB()
  const all = await run<BenchmarkRun[]>(
    db.transaction(STORE_RUNS, 'readonly').objectStore(STORE_RUNS).getAll(),
  )
  return all.sort((a, b) => b.timestamp - a.timestamp)
}

export async function saveBenchmarkRun(entry: BenchmarkRun): Promise<void> {
  const db = await openDB()
  await run(db.transaction(STORE_RUNS, 'readwrite').objectStore(STORE_RUNS).put(entry))
}

export async function deleteBenchmarkRun(id: string): Promise<void> {
  const db = await openDB()
  await run(db.transaction(STORE_RUNS, 'readwrite').objectStore(STORE_RUNS).delete(id))
}
