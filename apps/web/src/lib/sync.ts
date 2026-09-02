// 2a. 로컬(IndexedDB) ↔ Supabase 클라우드 동기화. DESIGN §2.1 스키마 / §3.7 LWW / §3.9 push·pull.
// snake_case(DB 컬럼) <-> camelCase(TS 타입) 매핑 + updatedAt 기준 Last-Write-Wins 병합.
import type { Card, Deck, NewPoolItem, Settings, SyncState } from "@leitner/core";
import { supabase } from "./supabase";

function nowIso() {
  return new Date().toISOString();
}

// ---- row <-> entity 매핑 --------------------------------------------------

function deckToRow(userId: string, d: Deck) {
  return {
    id: d.id,
    user_id: userId,
    name: d.name,
    description: d.description ?? null,
    exam_date: d.examDate ?? null,
    created_at: d.createdAt,
    updated_at: d.updatedAt ?? d.createdAt,
  };
}
function rowToDeck(r: any): Deck {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    examDate: r.exam_date,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function cardToRow(userId: string, c: Card) {
  return {
    id: c.id,
    user_id: userId,
    deck_id: c.deckId,
    source_id: c.sourceId ?? null,
    prompt_ko: c.promptKo,
    answer_en: c.answerEn,
    chunk_note: c.chunkNote ?? null,
    audio_url: c.audioUrl ?? null,
    box: c.box,
    next_review_date: c.nextReviewDate,
    last_reviewed_at: c.lastReviewedAt,
    correct_streak: c.correctStreak,
    lapse_count: c.lapseCount,
    introduced_at: c.introducedAt,
    tags: c.tags,
    updated_at: c.updatedAt ?? nowIso(),
  };
}
function rowToCard(r: any): Card {
  return {
    id: r.id,
    deckId: r.deck_id,
    sourceId: r.source_id ?? undefined,
    promptKo: r.prompt_ko,
    answerEn: r.answer_en,
    chunkNote: r.chunk_note ?? undefined,
    audioUrl: r.audio_url ?? undefined,
    box: r.box,
    nextReviewDate: r.next_review_date,
    lastReviewedAt: r.last_reviewed_at,
    correctStreak: r.correct_streak,
    lapseCount: r.lapse_count,
    introducedAt: r.introduced_at,
    tags: r.tags ?? [],
    updatedAt: r.updated_at,
  };
}

function poolToRow(userId: string, p: NewPoolItem) {
  return {
    id: p.id,
    user_id: userId,
    deck_id: p.deckId,
    prompt_ko: p.promptKo,
    answer_en: p.answerEn,
    chunk_note: p.chunkNote ?? null,
    level: p.level ?? null,
    topic: p.topic ?? null,
    status: p.status,
    imported_at: p.importedAt,
  };
}
function rowToPool(r: any): NewPoolItem {
  return {
    id: r.id,
    deckId: r.deck_id,
    promptKo: r.prompt_ko,
    answerEn: r.answer_en,
    chunkNote: r.chunk_note ?? undefined,
    level: r.level ?? undefined,
    topic: r.topic ?? undefined,
    status: "pending",
    importedAt: r.imported_at,
  };
}

function settingsToRow(userId: string, s: Settings) {
  return {
    user_id: userId,
    intervals: s.intervals,
    daily_goal: s.dailyGoal,
    review_cap: 9999, // 폐기된 필드 — 원격 스키마(NOT NULL) 호환용 더미. 앱에서 더는 사용 안 함.
    new_cap: s.newCap,
    max_active_cards: s.maxActiveCards,
    lapse_mode: s.lapseMode,
    hint_free_level: s.hintFreeLevel,
    notify_time: s.notifyTime ?? null,
    recovery_ease: s.recoveryEase,
    content_source_url: s.contentSourceUrl ?? null,
    auto_sync_enabled: s.autoSyncEnabled,
    refill_threshold_days: s.refillThresholdDays,
    tts_auto_play: s.ttsAutoPlay,
    preferred_ai_model: s.preferredAiModel,
    updated_at: s.updatedAt ?? nowIso(),
  };
}
function rowToSettings(r: any): Settings {
  return {
    intervals: r.intervals,
    dailyGoal: r.daily_goal,
    newCap: r.new_cap,
    maxActiveCards: r.max_active_cards,
    lapseMode: r.lapse_mode,
    hintFreeLevel: r.hint_free_level,
    notifyTime: r.notify_time ?? undefined,
    recoveryEase: r.recovery_ease,
    contentSourceUrl: r.content_source_url ?? undefined,
    autoSyncEnabled: r.auto_sync_enabled,
    refillThresholdDays: r.refill_threshold_days,
    ttsAutoPlay: r.tts_auto_play,
    preferredAiModel: r.preferred_ai_model ?? "claude",
    updatedAt: r.updated_at,
  };
}

// ---- LWW 병합 --------------------------------------------------------------

/** id 기준 합집합, 같은 id면 updatedAt이 더 최신인 쪽이 이긴다(DESIGN §3.7). */
export function mergeByUpdatedAt<T extends { id: string; updatedAt?: string }>(
  local: T[],
  remote: T[]
): T[] {
  const byId = new Map<string, T>();
  for (const item of local) byId.set(item.id, item);
  for (const item of remote) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    const existingTime = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;
    const incomingTime = item.updatedAt ? Date.parse(item.updatedAt) : 0;
    if (incomingTime > existingTime) byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

// ---- push (로컬 → 클라우드, upsert) ----------------------------------------

export async function pushDeck(userId: string, deck: Deck): Promise<void> {
  if (!supabase) return;
  await supabase.from("decks").upsert(deckToRow(userId, deck));
}

export async function pushCard(userId: string, card: Card): Promise<void> {
  if (!supabase) return;
  await supabase.from("cards").upsert(cardToRow(userId, card));
}

export async function deleteCardRemote(userId: string, id: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("cards").delete().eq("user_id", userId).eq("id", id);
}

/** 덱 삭제 — schema.sql의 cards/new_pool FK가 on delete cascade라 이 한 줄로 딸린 것도 다 지워진다. */
export async function deleteDeckRemote(userId: string, id: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("decks").delete().eq("user_id", userId).eq("id", id);
}

export async function pushPoolItems(userId: string, items: NewPoolItem[]): Promise<void> {
  if (!supabase || items.length === 0) return;
  await supabase.from("new_pool").upsert(items.map((p) => poolToRow(userId, p)));
}

export async function deletePoolItemRemote(userId: string, id: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("new_pool").delete().eq("user_id", userId).eq("id", id);
}

export async function pushSettings(userId: string, settings: Settings): Promise<void> {
  if (!supabase) return;
  await supabase.from("settings").upsert(settingsToRow(userId, settings));
}

// ---- sync_state (2d 콘텐츠 동기화 진행 상태) --------------------------------

export async function pushSyncState(userId: string, state: SyncState): Promise<void> {
  if (!supabase) return;
  await supabase.from("sync_state").upsert({
    user_id: userId,
    source_url: state.sourceUrl ?? null,
    imported_ids: state.importedIds,
    last_sync_at: state.lastSyncAt ?? null,
    last_sync_result: state.lastSyncResult ?? null,
  });
}

async function pushAll(
  userId: string,
  data: { decks: Deck[]; cards: Card[]; newPool: NewPoolItem[]; settings: Settings }
): Promise<void> {
  if (!supabase) return;
  if (data.decks.length) await supabase.from("decks").upsert(data.decks.map((d) => deckToRow(userId, d)));
  if (data.cards.length) await supabase.from("cards").upsert(data.cards.map((c) => cardToRow(userId, c)));
  const pending = data.newPool.filter((p) => p.status === "pending");
  if (pending.length) await supabase.from("new_pool").upsert(pending.map((p) => poolToRow(userId, p)));
  await supabase.from("settings").upsert(settingsToRow(userId, data.settings));
}

// ---- pull (클라우드 → 로컬) --------------------------------------------------

async function pullAll(userId: string) {
  if (!supabase) return { decks: [] as Deck[], cards: [] as Card[], newPool: [] as NewPoolItem[], settings: null as Settings | null };
  const [decksRes, cardsRes, poolRes, settingsRes] = await Promise.all([
    supabase.from("decks").select("*").eq("user_id", userId),
    supabase.from("cards").select("*").eq("user_id", userId),
    supabase.from("new_pool").select("*").eq("user_id", userId).eq("status", "pending"),
    supabase.from("settings").select("*").eq("user_id", userId).maybeSingle(),
  ]);
  return {
    decks: (decksRes.data ?? []).map(rowToDeck),
    cards: (cardsRes.data ?? []).map(rowToCard),
    newPool: (poolRes.data ?? []).map(rowToPool),
    settings: settingsRes.data ? rowToSettings(settingsRes.data) : null,
  };
}

/**
 * 로그인 시점 전체 병합(§3.9). 원격 데이터를 가져와 로컬과 LWW 병합한 뒤,
 * 병합 결과를 다시 클라우드에 반영(둘 중 한쪽에만 있던 데이터가 상대에도 생기도록)한다.
 * newPool은 "이미 소비된(카드로 승격된) 항목"이 원격에 남아있으면 걸러낸다.
 */
export async function fullSync(
  userId: string,
  local: { decks: Deck[]; cards: Card[]; newPool: NewPoolItem[]; settings: Settings }
): Promise<{ decks: Deck[]; cards: Card[]; newPool: NewPoolItem[]; settings: Settings }> {
  if (!supabase) return local;

  const remote = await pullAll(userId);

  const decks = mergeByUpdatedAt(local.decks, remote.decks);
  const cards = mergeByUpdatedAt(local.cards, remote.cards);
  const cardIds = new Set(cards.map((c) => c.sourceId ?? c.id));
  const poolById = new Map<string, NewPoolItem>();
  for (const p of [...local.newPool, ...remote.newPool]) {
    if (cardIds.has(p.id)) continue; // 이미 카드로 승격된 저수지 항목은 제외
    poolById.set(p.id, p);
  }
  const newPool = Array.from(poolById.values());

  const settings: Settings =
    remote.settings && (!local.settings.updatedAt || (remote.settings.updatedAt ?? "") > local.settings.updatedAt)
      ? remote.settings
      : local.settings;

  await pushAll(userId, { decks, cards, newPool, settings });
  return { decks, cards, newPool, settings };
}
