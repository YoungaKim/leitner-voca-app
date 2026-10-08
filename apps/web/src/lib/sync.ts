// 계정의 공통 Supabase 상태를 읽고, 온라인 변경을 서버에 먼저 저장한다.
import { DEFAULT_SETTINGS } from "@leitner/core";
import type { Card, Deck, NewPoolItem, ReviewLog, Settings, SyncState } from "@leitner/core";
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
    content_source_deck_id: s.contentSourceDeckId ?? null,
    auto_sync_enabled: s.autoSyncEnabled,
    refill_threshold_days: s.refillThresholdDays,
    tts_auto_play: s.ttsAutoPlay,
    preferred_ai_model: s.preferredAiModel,
    ai_api_keys: s.aiApiKeys ?? {},
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
    contentSourceDeckId: r.content_source_deck_id ?? undefined,
    autoSyncEnabled: r.auto_sync_enabled,
    refillThresholdDays: r.refill_threshold_days,
    ttsAutoPlay: r.tts_auto_play,
    preferredAiModel: r.preferred_ai_model ?? "claude",
    aiApiKeys: r.ai_api_keys ?? {},
    updatedAt: r.updated_at,
  };
}

// review_log 는 append-only(수정·삭제 없음)라 LWW가 필요 없다 — id 합집합만 하면 된다.
function reviewLogToRow(userId: string, l: ReviewLog) {
  return {
    id: l.id,
    user_id: userId,
    card_id: l.cardId,
    date: l.date,
    result: l.result,
    box_before: l.boxBefore,
    box_after: l.boxAfter,
    hint_level: l.hintLevel,
    input_method: l.inputMethod ?? null,
  };
}
function rowToReviewLog(r: any): ReviewLog {
  return {
    id: r.id,
    cardId: r.card_id,
    date: r.date,
    result: r.result,
    boxBefore: r.box_before,
    boxAfter: r.box_after,
    hintLevel: r.hint_level,
    inputMethod: r.input_method ?? undefined,
  };
}

// ---- push (로컬 → 클라우드, upsert) ----------------------------------------

export async function pushDeck(userId: string, deck: Deck, create = false): Promise<void> {
  if (!supabase) return;
  if (create) await checked(supabase.from("decks").insert(deckToRow(userId, deck)));
  else await checked(supabase.from("decks").update({ name: deck.name, updated_at: deck.updatedAt }).eq("id", deck.id).eq("user_id", userId).select("id").single());
}

export async function pushCard(userId: string, card: Card, create = false): Promise<void> {
  if (!supabase) return;
  if (create) await checked(supabase.from("cards").insert(cardToRow(userId, card)));
  else await checked(supabase.from("cards").update({
    prompt_ko: card.promptKo, answer_en: card.answerEn, chunk_note: card.chunkNote ?? null,
    tags: card.tags, updated_at: card.updatedAt,
  }).eq("id", card.id).eq("user_id", userId).select("id").single());
}

export async function deleteCardRemote(userId: string, id: string): Promise<void> {
  if (!supabase) return;
  await checked(supabase.from("cards").delete().eq("user_id", userId).eq("id", id));
}

/** 덱 삭제 — schema.sql의 cards/new_pool FK가 on delete cascade라 이 한 줄로 딸린 것도 다 지워진다. */
export async function deleteDeckRemote(userId: string, id: string): Promise<void> {
  if (!supabase) return;
  await checked(supabase.from("decks").delete().eq("user_id", userId).eq("id", id));
}

export async function pushPoolItems(userId: string, items: NewPoolItem[]): Promise<void> {
  if (!supabase || items.length === 0) return;
  await checked(supabase.from("new_pool").upsert(items.map((p) => poolToRow(userId, p))));
}

export async function pushSettings(userId: string, settings: Settings): Promise<void> {
  if (!supabase) return;
  await checked(supabase.from("settings").upsert(settingsToRow(userId, settings)));
}

// ---- sync_state (2d 콘텐츠 동기화 진행 상태) --------------------------------

export async function pushSyncState(userId: string, state: SyncState): Promise<void> {
  if (!supabase) return;
  await checked(supabase.from("sync_state").upsert({
    user_id: userId,
    source_url: state.sourceUrl ?? null,
    imported_ids: state.importedIds,
    last_sync_at: state.lastSyncAt ?? null,
    last_sync_result: state.lastSyncResult ?? null,
  }));
}

// ---- pull (클라우드 → 로컬) --------------------------------------------------

export async function checked<T extends { error: unknown }>(request: PromiseLike<T>): Promise<T> {
  const result = await request;
  if (result.error) throw result.error;
  return result;
}

// PostgREST caps responses at 1000 rows. Read every page in a stable order.
async function readRows(table: string, userId: string, pendingOnly = false) {
  if (!supabase) return [];
  const rows: any[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = supabase.from(table).select("*").eq("user_id", userId).order("id");
    if (pendingOnly) query = query.eq("status", "pending");
    const result = await checked(query.range(offset, offset + 499));
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

export async function saveReviewRemote(userId: string, card: Card, log: ReviewLog, expectedUpdatedAt?: string) {
  if (!supabase) return;
  await checked(supabase.rpc("save_shared_review", {
    card_data: cardToRow(userId, card), log_data: reviewLogToRow(userId, log),
    expected_updated_at: expectedUpdatedAt ?? null,
  }));
}

export async function introduceRemote(userId: string, card: Card, poolId: string) {
  if (!supabase) return;
  const result = await checked(supabase.rpc("introduce_shared_card", {
    card_data: cardToRow(userId, card), pool_id: poolId,
  }));
  return rowToCard(result.data);
}

/** Cloud is authoritative. Never upload an old cache during a read/sync. */
export async function fullSync(userId: string, _local?: { settings: Settings }) {
  if (!supabase) throw new Error("클라우드가 설정되지 않았습니다.");
  const [decks, cards, newPool, reviewLog, settingsResult, syncResult] = await Promise.all([
    readRows("decks", userId), readRows("cards", userId), readRows("new_pool", userId, true),
    readRows("review_log", userId),
    checked(supabase.from("settings").select("*").eq("user_id", userId).maybeSingle()),
    checked(supabase.from("sync_state").select("*").eq("user_id", userId).maybeSingle()),
  ]);
  const legacyTarget = _local?.settings.contentSourceDeckId;
  if (settingsResult.data && !settingsResult.data.content_source_deck_id && legacyTarget && decks.some(d => d.id === legacyTarget)) {
    await checked(supabase.from("settings").update({ content_source_deck_id: legacyTarget }).eq("user_id", userId));
    settingsResult.data.content_source_deck_id = legacyTarget;
  }
  const mappedCards = cards.map(rowToCard);
  const consumed = new Set(mappedCards.map(c => c.sourceId ?? c.id));
  return {
    decks: decks.map(rowToDeck), cards: mappedCards,
    newPool: newPool.map(rowToPool).filter(p => !consumed.has(p.id)),
    reviewLog: reviewLog.map(rowToReviewLog),
    settings: settingsResult.data ? { ...DEFAULT_SETTINGS, ...rowToSettings(settingsResult.data) } : DEFAULT_SETTINGS,
    syncState: syncResult.data ? {
      sourceUrl: syncResult.data.source_url ?? undefined,
      importedIds: syncResult.data.imported_ids ?? [],
      lastSyncAt: syncResult.data.last_sync_at ?? undefined,
      lastSyncResult: syncResult.data.last_sync_result ?? undefined,
    } as SyncState : { importedIds: [] } as SyncState,
  };
}
