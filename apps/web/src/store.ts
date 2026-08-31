import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { DEFAULT_SETTINGS, NEW_CARD_BOX, today as todayStr } from "@leitner/core";
import type { Card, Deck, NewPoolItem, ReviewLog, Settings, SyncState } from "@leitner/core";
import {
  cardsRepo,
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
  deletePoolItemRemote,
  fullSync,
  pushCard,
  pushDeck,
  pushPoolItems,
  pushSettings,
  pushSyncState,
} from "./lib/sync";

const LAST_SYNCED_USER_KEY = "leitner-last-synced-user-id";

// 2a: 로그인 상태면 로컬 저장과 동시에 클라우드에도 반영(write-through)한다.
// 실패해도 로컬 저장은 이미 끝났으니 UI는 막지 않는다 — 다음 fullSync에서 다시 맞춰진다.
function mirrorToCloud(fn: (userId: string) => Promise<void>) {
  const userId = getCurrentUserId();
  if (!userId) return;
  fn(userId).catch((err) => console.warn("cloud sync failed (will retry on next sync)", err));
}

interface AppState {
  loaded: boolean;
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

export const useAppStore = create<AppState>((set, get) => ({
  loaded: false,
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
    set({ syncing: true });
    try {
      // 이 브라우저에 마지막으로 로그인했던 계정과 다르면, 이전 계정의 로컬 캐시가
      // 새 계정 데이터와 섞이거나(심지어 클라우드로 push까지 돼) 계정 간 데이터가 오염되므로
      // 병합 전에 로컬을 완전히 비운다.
      const lastUserId = localStorage.getItem(LAST_SYNCED_USER_KEY);
      if (lastUserId && lastUserId !== userId) {
        await clearAllLocal();
        set({ decks: [], cards: [], newPool: [], settings: DEFAULT_SETTINGS });
      }

      const { decks, cards, newPool, settings } = get();
      const merged = await fullSync(userId, { decks, cards, newPool, settings });
      await Promise.all([
        deckRepo.putMany(merged.decks),
        cardsRepo.putMany(merged.cards),
        newPoolRepo.putMany(merged.newPool),
        settingsRepo.put(merged.settings),
      ]);
      set({ ...merged, syncing: false });
      localStorage.setItem(LAST_SYNCED_USER_KEY, userId);
    } catch (err) {
      console.warn("초기 동기화 실패", err);
      set({ syncing: false });
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
    set({ decks: [], cards: [], newPool: [], settings: DEFAULT_SETTINGS, syncState: { importedIds: [] } });
  },

  async updateSettings(patch) {
    const updated: Settings = { ...get().settings, ...patch, updatedAt: new Date().toISOString() };
    await settingsRepo.put(updated);
    set({ settings: updated });
    mirrorToCloud((userId) => pushSettings(userId, updated));
  },

  /** 2d — 설정 화면 [지금 동기화] 버튼 및 앱 시작 시 자동 동기화(하루 1회)에서 사용. */
  async syncContentNow() {
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
      await syncStateRepo.put(result.syncState);
      set({ syncState: result.syncState, contentSyncing: false, contentSyncErrors: result.errors });
      mirrorToCloud((userId) => pushSyncState(userId, result.syncState));
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
    await deckRepo.put(deck);
    set((s) => ({ decks: [...s.decks, deck] }));
    mirrorToCloud((userId) => pushDeck(userId, deck));
    return deck;
  },

  async deleteDeck(id) {
    await deckRepo.removeCascade(id);
    set((s) => ({
      decks: s.decks.filter((d) => d.id !== id),
      cards: s.cards.filter((c) => c.deckId !== id),
      newPool: s.newPool.filter((p) => p.deckId !== id),
    }));
    mirrorToCloud((userId) => deleteDeckRemote(userId, id));
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
    await cardsRepo.put(card);
    set((s) => ({ cards: [...s.cards, card] }));
    mirrorToCloud((userId) => pushCard(userId, card));
  },

  async updateCard(card) {
    const updated = { ...card, updatedAt: new Date().toISOString() };
    await cardsRepo.put(updated);
    set((s) => ({ cards: s.cards.map((c) => (c.id === updated.id ? updated : c)) }));
    mirrorToCloud((userId) => pushCard(userId, updated));
  },

  async deleteCard(id) {
    await cardsRepo.remove(id);
    set((s) => ({ cards: s.cards.filter((c) => c.id !== id) }));
    mirrorToCloud((userId) => deleteCardRemote(userId, id));
  },

  async importNewPoolItems(items) {
    if (items.length === 0) return;
    await newPoolRepo.putMany(items);
    set((s) => ({ newPool: [...s.newPool, ...items] }));
    mirrorToCloud((userId) => pushPoolItems(userId, items));
  },

  async applyReview(cardId, updated, log) {
    const card = { ...updated, updatedAt: new Date().toISOString() };
    await cardsRepo.put(card);
    await reviewLogRepo.add(log);
    set((s) => ({ cards: s.cards.map((c) => (c.id === cardId ? card : c)) }));
    mirrorToCloud((userId) => pushCard(userId, card));
  },

  async introduceCard(card, poolId) {
    const withTimestamp = { ...card, updatedAt: new Date().toISOString() };
    await cardsRepo.put(withTimestamp);
    await newPoolRepo.remove(poolId);
    set((s) => ({
      cards: [...s.cards, withTimestamp],
      newPool: s.newPool.filter((p) => p.id !== poolId),
    }));
    mirrorToCloud(async (userId) => {
      await pushCard(userId, withTimestamp);
      await deletePoolItemRemote(userId, poolId);
    });
  },
}));
