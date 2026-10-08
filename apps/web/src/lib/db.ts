// DESIGN §2 로컬 엔티티를 IndexedDB(idb)에 저장하는 리포지토리 계층.
// 로그인된 계정에서는 Supabase의 공통 상태를 캐시하며 동기화 시 전체 교체한다.
import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import { DEFAULT_SETTINGS } from "@leitner/core";
import type { Card, Deck, NewPoolItem, ReviewLog, Settings, SyncState } from "@leitner/core";

interface LeitnerDB extends DBSchema {
  cacheBackup: { key: string; value: unknown };
  decks: { key: string; value: Deck };
  cards: { key: string; value: Card; indexes: { byDeck: string } };
  newPool: { key: string; value: NewPoolItem; indexes: { byDeck: string } };
  reviewLog: { key: string; value: ReviewLog };
  settings: { key: string; value: Settings }; // 단일 행, key = "singleton"
  syncState: { key: string; value: SyncState }; // 단일 행, key = "singleton" (2d 콘텐츠 동기화 진행 상태)
}

const DB_NAME = "leitner-voca";
const DB_VERSION = 3; // v3: 공통 서버 상태로 전환하기 전 캐시 백업
const SETTINGS_KEY = "singleton";
const SYNC_STATE_KEY = "singleton";

let dbPromise: Promise<IDBPDatabase<LeitnerDB>> | null = null;

function getDB(): Promise<IDBPDatabase<LeitnerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LeitnerDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("decks", { keyPath: "id" });
          const cardStore = db.createObjectStore("cards", { keyPath: "id" });
          cardStore.createIndex("byDeck", "deckId");
          const poolStore = db.createObjectStore("newPool", { keyPath: "id" });
          poolStore.createIndex("byDeck", "deckId");
          db.createObjectStore("reviewLog", { keyPath: "id" });
          db.createObjectStore("settings");
        }
        if (oldVersion < 3) db.createObjectStore("cacheBackup");
        if (oldVersion < 2) {
          db.createObjectStore("syncState");
        }
      },
    });
  }
  return dbPromise;
}

export const deckRepo = {
  async all(): Promise<Deck[]> {
    return (await getDB()).getAll("decks");
  },
  async get(id: string): Promise<Deck | undefined> {
    return (await getDB()).get("decks", id);
  },
  async put(deck: Deck): Promise<void> {
    await (await getDB()).put("decks", deck);
  },
  async remove(id: string): Promise<void> {
    await (await getDB()).delete("decks", id);
  },
  async putMany(decks: Deck[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("decks", "readwrite");
    await Promise.all(decks.map((d) => tx.store.put(d)));
    await tx.done;
  },
  /** 덱 삭제 + 그 덱에 딸린 카드/저수지 항목까지 로컬에서 전부 제거(cascade).
   * 클라우드 쪽은 schema.sql의 FK on delete cascade가 알아서 처리해준다. */
  async removeCascade(id: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(["decks", "cards", "newPool"], "readwrite");
    const [cardKeys, poolKeys] = await Promise.all([
      tx.objectStore("cards").index("byDeck").getAllKeys(id),
      tx.objectStore("newPool").index("byDeck").getAllKeys(id),
    ]);
    await Promise.all([
      tx.objectStore("decks").delete(id),
      ...cardKeys.map((k) => tx.objectStore("cards").delete(k)),
      ...poolKeys.map((k) => tx.objectStore("newPool").delete(k)),
    ]);
    await tx.done;
  },
};

export const cardsRepo = {
  async all(): Promise<Card[]> {
    return (await getDB()).getAll("cards");
  },
  async byDeck(deckId: string): Promise<Card[]> {
    return (await getDB()).getAllFromIndex("cards", "byDeck", deckId);
  },
  async get(id: string): Promise<Card | undefined> {
    return (await getDB()).get("cards", id);
  },
  async put(card: Card): Promise<void> {
    await (await getDB()).put("cards", card);
  },
  async putMany(cards: Card[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("cards", "readwrite");
    await Promise.all(cards.map((c) => tx.store.put(c)));
    await tx.done;
  },
  async remove(id: string): Promise<void> {
    await (await getDB()).delete("cards", id);
  },
};

export const newPoolRepo = {
  async all(): Promise<NewPoolItem[]> {
    return (await getDB()).getAll("newPool");
  },
  async pending(): Promise<NewPoolItem[]> {
    const all = await (await getDB()).getAll("newPool");
    return all.filter((p) => p.status === "pending");
  },
  async put(item: NewPoolItem): Promise<void> {
    await (await getDB()).put("newPool", item);
  },
  async putMany(items: NewPoolItem[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("newPool", "readwrite");
    await Promise.all(items.map((i) => tx.store.put(i)));
    await tx.done;
  },
  async remove(id: string): Promise<void> {
    await (await getDB()).delete("newPool", id);
  },
};

export const reviewLogRepo = {
  async all(): Promise<ReviewLog[]> {
    return (await getDB()).getAll("reviewLog");
  },
  async add(entry: ReviewLog): Promise<void> {
    await (await getDB()).put("reviewLog", entry);
  },
  async putMany(entries: ReviewLog[]): Promise<void> {
    if (entries.length === 0) return;
    const tx = (await getDB()).transaction("reviewLog", "readwrite");
    await Promise.all([...entries.map((e) => tx.store.put(e)), tx.done]);
  },
};

export const settingsRepo = {
  async get(): Promise<Settings> {
    const s = await (await getDB()).get("settings", SETTINGS_KEY);
    // 예전에 저장된 레코드엔 이후 추가된 필드(예: preferredAiModel)가 없을 수 있으므로 기본값과 병합.
    return s ? { ...DEFAULT_SETTINGS, ...s } : DEFAULT_SETTINGS;
  },
  async put(settings: Settings): Promise<void> {
    await (await getDB()).put("settings", settings, SETTINGS_KEY);
  },
};

export const syncStateRepo = {
  async get(): Promise<SyncState> {
    const s = await (await getDB()).get("syncState", SYNC_STATE_KEY);
    return s ?? { importedIds: [] };
  },
  async put(state: SyncState): Promise<void> {
    await (await getDB()).put("syncState", state, SYNC_STATE_KEY);
  },
};

/** 2a: 다른 구글 계정으로 로그인할 때 이전 계정의 로컬 캐시가 섞이지 않도록 전부 비운다. */
export async function clearAllLocal(): Promise<void> {
  const db = await getDB();
  await Promise.all([
    db.clear("cacheBackup"),
    db.clear("decks"),
    db.clear("cards"),
    db.clear("newPool"),
    db.clear("reviewLog"),
    db.clear("settings"),
    db.clear("syncState"),
  ]);
}

/** Replace all stores together so deleted/consumed records cannot survive a sync. */
export async function replaceCloudCache(snapshot: {
  decks: Deck[]; cards: Card[]; newPool: NewPoolItem[]; reviewLog: ReviewLog[];
  settings: Settings; syncState: SyncState;
}): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["cacheBackup", "decks", "cards", "newPool", "reviewLog", "settings", "syncState"], "readwrite");
  const backup = tx.objectStore("cacheBackup");
  if (!(await backup.get("before-cloud-authority"))) {
    const stores = ["decks", "cards", "newPool", "reviewLog", "settings", "syncState"] as const;
    const values = await Promise.all(stores.map(name => tx.objectStore(name).getAll()));
    await backup.put(Object.fromEntries(stores.map((name, i) => [name, values[i]])), "before-cloud-authority");
  }
  for (const name of ["decks", "cards", "newPool", "reviewLog"] as const) {
    const store = tx.objectStore(name);
    await store.clear();
    for (const value of snapshot[name]) await store.put(value as never);
  }
  await tx.objectStore("settings").put(snapshot.settings, SETTINGS_KEY);
  await tx.objectStore("syncState").put(snapshot.syncState, SYNC_STATE_KEY);
  await tx.done;
}
