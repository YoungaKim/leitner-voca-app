import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { DEFAULT_SETTINGS, NEW_CARD_BOX, today as todayStr } from "@leitner/core";
import type { Card, Deck, NewPoolItem, ReviewLog, Settings, SyncState } from "@leitner/core";
import {
  cardsRepo,
  replaceCloudCache,
  clearAllLocal,
  deckRepo,
  newPoolRepo,
  reviewLogRepo,
  settingsRepo,
  syncStateRepo,
} from "./lib/db";
import { getCurrentUserId } from "./lib/auth";
import { runContentSync } from "./lib/contentSync";
import {
  deleteCardRemote,
  deleteDeckRemote,
  fullSync,
  pushCard,
  pushDeck,
  pushPoolItems,
  saveReviewRemote,
  introduceRemote,
  pushSettings,
  pushSyncState,
} from "./lib/sync";

const LAST_SYNCED_USER_KEY = "leitner-last-synced-user-id";

// 로그인된 계정은 서버 저장이 성공한 뒤 로컬 캐시를 갱신한다.
async function mirrorToCloud(fn: (userId: string) => Promise<void>) {
  const userId = getCurrentUserId();
  if (!userId) return;
  try {
    await fn(userId);
    useAppStore.setState({ cloudError: null });
  } catch (err) {
    useAppStore.setState({ cloudError: "서버에 저장하지 못했습니다. 연결을 확인하고 다시 시도하세요." });
    throw err;
  }
}

interface AppState {
  loaded: boolean;
  cloudReady: boolean;
  cloudError: string | null;
  decks: Deck[];
  cards: Card[];
  newPool: NewPoolItem[];
  settings: Settings;
  syncState: SyncState;
  syncing: boolean;
  contentSyncing: boolean;
  contentSyncErrors: string[];

  load(): Promise<void>;
  mergeFromCloud(userId: string): Promise<void>;
  syncNow(): Promise<void>;
  resetLocal(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  syncContentNow(): Promise<void>;

  addDeck(name: string, description?: string, examDate?: string | null): Promise<Deck>;
  renameDeck(id: string, name: string): Promise<void>;
  deleteDeck(id: string): Promise<void>;
  addCard(input: {
    deckId: string;
    promptKo: string;
    answerEn: string;
    chunkNote?: string;
    tags?: string[];
  }): Promise<void>;
  updateCard(card: Card): Promise<void>;
  deleteCard(id: string): Promise<void>;

  importNewPoolItems(items: NewPoolItem[]): Promise<void>;

  applyReview(cardId: string, updated: Card, log: ReviewLog): Promise<void>;
  introduceCard(card: Card, poolId: string): Promise<void>;
}

// Serialize cache replacements with saves so a slow pull cannot overwrite a just-saved review.
let dataQueue: Promise<unknown> = Promise.resolve();
function serialized<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  return ((...args: Parameters<T>) => {
    const result = dataQueue.then(() => fn(...args));
    dataQueue = result.catch(() => undefined);
    return result;
  }) as T;
}

export const useAppStore = create<AppState>((set, get) => {
  const state: AppState = {
  loaded: false,
  cloudReady: false,
  cloudError: null,
  decks: [],
  cards: [],
  newPool: [],
  settings: DEFAULT_SETTINGS,
  syncState: { importedIds: [] },
  syncing: false,
  contentSyncing: false,
  contentSyncErrors: [],

  async load() {
    const [decks, cards, newPool, settings, syncState] = await Promise.all([
      deckRepo.all(),
      cardsRepo.all(),
      newPoolRepo.all(),
      settingsRepo.get(),
      syncStateRepo.get(),
    ]);
    set({ decks, cards, newPool, settings, syncState, loaded: true });
  },

  /** 로그인 직후 1회 호출(DESIGN §3.9) — 클라우드와 병합해 로컬/스토어를 덮어쓴다. */
  async mergeFromCloud(userId) {
    if (get().syncing) return;
    set({ syncing: true, cloudError: null });
    try {
      // 로컬(IndexedDB) 로드가 끝나기 전에 이게 먼저 돌면 get()이 DEFAULT_SETTINGS를
      // 돌려주고, fullSync의 LWW가 "local.updatedAt 없음 → remote 채택"으로 빠져 방금까지
      // 쓰던 설정(모델 선택·시트 URL 등)이 원격 기본값으로 덮여버린다. 반드시 먼저 로드한다.
      if (!get().loaded) await get().load();

      // 이 브라우저에 마지막으로 로그인했던 계정과 다르면, 이전 계정의 로컬 캐시가
      // 새 계정 데이터와 섞이거나(심지어 클라우드로 push까지 돼) 계정 간 데이터가 오염되므로
      // 병합 전에 로컬을 완전히 비운다.
      const lastUserId = localStorage.getItem(LAST_SYNCED_USER_KEY);
      if (lastUserId && lastUserId !== userId) {
        await clearAllLocal();
        set({ decks: [], cards: [], newPool: [], settings: DEFAULT_SETTINGS, cloudReady: false });
      }

      const merged = await fullSync(userId, { settings: get().settings });
      await replaceCloudCache(merged);
      // reviewLog는 스토어 상태가 아니라 IndexedDB에만 두므로 set에서 제외한다.
      const { reviewLog: _rl, ...mergedState } = merged;
      set({ ...mergedState, syncing: false, cloudReady: true });
      localStorage.setItem(LAST_SYNCED_USER_KEY, userId);
    } catch (err) {
      console.warn("초기 동기화 실패", err);
      set({ syncing: false, cloudError: "서버 동기화에 실패했습니다. 다시 시도하세요." });
    }
  },

  /** 설정 화면의 "지금 동기화" 버튼(§3.9 수동 동기화)에서 사용. */
  async syncNow() {
    const userId = getCurrentUserId();
    if (!userId) return;
    await get().mergeFromCloud(userId);
  },

  /** 로그아웃 시 호출 — 클라우드에 이미 안전하게 저장돼 있으니, 화면/로컬 캐시에서는
   * 학습 데이터를 완전히 지워서 "로그아웃 = 데이터 안 보임"이 되게 한다.
   * (같은 계정으로 재로그인하면 mergeFromCloud가 클라우드에서 다시 채워준다.) */
  async resetLocal() {
    await clearAllLocal();
    localStorage.removeItem(LAST_SYNCED_USER_KEY);
    set({ decks: [], cards: [], newPool: [], settings: DEFAULT_SETTINGS, syncState: { importedIds: [] }, cloudReady: false, cloudError: null });
  },

  async updateSettings(patch) {
    const updated: Settings = { ...get().settings, ...patch, updatedAt: new Date().toISOString() };
    await mirrorToCloud((userId) => pushSettings(userId, updated));
    await settingsRepo.put(updated);
    set({ settings: updated });

  },

  /** 2d — 설정 화면 [지금 동기화] 버튼 및 앱 시작 시 자동 동기화(하루 1회)에서 사용. */
  async syncContentNow() {
    // 자동 동기화와 사용자의 [지금 동기화]가 겹치면 같은 항목을 메모리에 두 번 추가할 수 있다.
    if (get().contentSyncing) return;
    if (getCurrentUserId()) {
      await get().syncNow();
      if (get().cloudError) return;
    }
    const { settings, cards, newPool, syncState } = get();
    if (!settings.contentSourceUrl || !settings.contentSourceDeckId) return;
    set({ contentSyncing: true, contentSyncErrors: [] });
    try {
      const result = await runContentSync(
        settings.contentSourceUrl,
        settings.contentSourceDeckId,
        cards,
        newPool,
        syncState
      );
      if (result.items.length > 0) {
        await get().importNewPoolItems(result.items);
      }
      await mirrorToCloud((userId) => pushSyncState(userId, result.syncState));
      await syncStateRepo.put(result.syncState);
      set({ syncState: result.syncState, contentSyncing: false, contentSyncErrors: result.errors });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ contentSyncing: false, contentSyncErrors: [message] });
    }
  },

  async addDeck(name, description, examDate) {
    const deck: Deck = {
      id: uuid(),
      name,
      description,
      examDate: examDate ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await mirrorToCloud((userId) => pushDeck(userId, deck, true));
    await deckRepo.put(deck);
    set((s) => ({ decks: [...s.decks, deck] }));

    return deck;
  },

  async renameDeck(id, name) {
    const trimmed = name.trim();
    const existing = get().decks.find((d) => d.id === id);
    if (!trimmed || !existing || trimmed === existing.name) return;
    const updated: Deck = { ...existing, name: trimmed, updatedAt: new Date().toISOString() };
    await mirrorToCloud((userId) => pushDeck(userId, updated));
    await deckRepo.put(updated);
    set((s) => ({ decks: s.decks.map((d) => (d.id === id ? updated : d)) }));

  },

  async deleteDeck(id) {
    await mirrorToCloud((userId) => deleteDeckRemote(userId, id));
    await deckRepo.removeCascade(id);
    set((s) => ({
      decks: s.decks.filter((d) => d.id !== id),
      cards: s.cards.filter((c) => c.deckId !== id),
      newPool: s.newPool.filter((p) => p.deckId !== id),
    }));

  },

  async addCard({ deckId, promptKo, answerEn, chunkNote, tags }) {
    const now = todayStr();
    const card: Card = {
      id: uuid(),
      deckId,
      promptKo,
      answerEn,
      chunkNote,
      // 수작업 추가 카드도 저수지 도입과 동일하게 박스0(신규)으로 시작 — 첫 노출은
      // 채점 전이라 복습 기한 없이 항상 due, 첫 채점 후 박스1로 올라간다(DESIGN §1.3b).
      box: NEW_CARD_BOX,
      nextReviewDate: now,
      lastReviewedAt: null,
      correctStreak: 0,
      lapseCount: 0,
      introducedAt: now,
      tags: tags ?? [],
      updatedAt: new Date().toISOString(),
    };
    await mirrorToCloud((userId) => pushCard(userId, card, true));
    await cardsRepo.put(card);
    set((s) => ({ cards: [...s.cards, card] }));

  },

  async updateCard(card) {
    const updated = { ...card, updatedAt: new Date().toISOString() };
    await mirrorToCloud((userId) => pushCard(userId, updated));
    await cardsRepo.put(updated);
    set((s) => ({ cards: s.cards.map((c) => (c.id === updated.id ? updated : c)) }));

  },

  async deleteCard(id) {
    await mirrorToCloud((userId) => deleteCardRemote(userId, id));
    await cardsRepo.remove(id);
    set((s) => ({ cards: s.cards.filter((c) => c.id !== id) }));

  },

  async importNewPoolItems(items) {
    if (items.length === 0) return;
    // IndexedDB upsert만으로는 Zustand 배열의 중복 append를 막지 못한다.
    const existingIds = new Set(get().newPool.map((item) => item.id));
    const uniqueItems = items.filter((item) => !existingIds.has(item.id));
    if (uniqueItems.length === 0) return;
    await mirrorToCloud((userId) => pushPoolItems(userId, uniqueItems));
    await newPoolRepo.putMany(uniqueItems);
    set((s) => ({ newPool: [...s.newPool, ...uniqueItems] }));

  },

  async applyReview(cardId, updated, log) {
    const card = { ...updated, updatedAt: new Date().toISOString() };
    await mirrorToCloud(userId => saveReviewRemote(userId, card, log, get().cards.find(c => c.id === cardId)?.updatedAt));
    await cardsRepo.put(card);
    await reviewLogRepo.add(log);
    set((s) => ({ cards: s.cards.map((c) => (c.id === cardId ? card : c)) }));

  },

  async introduceCard(card, poolId) {
    let withTimestamp: Card = { ...card, updatedAt: new Date().toISOString() };
    await mirrorToCloud(async userId => {
      withTimestamp = (await introduceRemote(userId, withTimestamp, poolId)) ?? withTimestamp;
    });
    await cardsRepo.put(withTimestamp);
    await newPoolRepo.remove(poolId);
    set((s) => ({
      cards: s.cards.some((existing) => existing.id === card.id)
        ? s.cards.map((existing) => (existing.id === card.id ? withTimestamp : existing))
        : [...s.cards, withTimestamp],
      newPool: s.newPool.filter((p) => p.id !== poolId),
    }));

  },
  };
  const actions = ["mergeFromCloud", "resetLocal", "updateSettings", "addDeck", "renameDeck", "deleteDeck",
    "addCard", "updateCard", "deleteCard", "importNewPoolItems", "applyReview", "introduceCard"] as const;
  for (const action of actions) (state as any)[action] = serialized(state[action]);
  return state;
});
