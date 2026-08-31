// DESIGN §1 라이트너 알고리즘 — 순수 함수. UI/스토리지 의존 없음.
import { addDays } from "./date.js";
import { GRADUATED_BOX, LEECH_LAPSE_THRESHOLD, NEW_CARD_BOX } from "./types.js";
import type { Card, NewPoolItem, Settings } from "./types.js";

/** DESIGN §1.3 힌트 사다리 판정.
 * correct = (힌트레벨 <= hintFreeLevel) AND (사용자가 [알았어] 선택)
 * 힌트레벨이 자유 레벨을 넘으면 [알았어]를 눌러도 무조건 오답.
 */
export function isCorrect(
  hintLevel: number,
  userClaimedKnew: boolean,
  settings: Pick<Settings, "hintFreeLevel">
): boolean {
  return hintLevel <= settings.hintFreeLevel && userClaimedKnew;
}

const ARTICLES = new Set(["a", "an", "the"]);

/** DESIGN §1.3a 텍스트 정답 입력 정규화 — 소문자화, 구두점 제거, 관사 토큰 제거. */
function normalizeAnswerTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !ARTICLES.has(t));
}

/** DESIGN §1.3a — 사용자가 입력한 영어 문장이 정답과 일치하는지 판정.
 * 관사(a/an/the)·대소문자·구두점 차이는 무시하고 나머지 토큰 시퀀스가 정확히 같아야 true.
 * 편집거리 등 모호한 유사도 임계값은 쓰지 않는다(실제 오답을 정답으로 오판하지 않기 위함).
 */
export function matchesAnswer(userText: string, answerEn: string): boolean {
  const user = normalizeAnswerTokens(userText);
  const answer = normalizeAnswerTokens(answerEn);
  return user.length > 0 && user.join(" ") === answer.join(" ");
}

/** DESIGN §1.3 onAnswer — 정답/오답에 따른 박스·복습일 갱신. */
export function onAnswer(
  card: Card,
  correct: boolean,
  settings: Pick<Settings, "intervals" | "lapseMode">,
  todayStr: string
): Card {
  let box: number;
  let correctStreak: number;
  let lapseCount = card.lapseCount;

  if (correct) {
    box = Math.min(card.box + 1, GRADUATED_BOX);
    correctStreak = card.correctStreak + 1;
  } else {
    box = settings.lapseMode === "soft" ? Math.max(1, card.box - 2) : 1;
    correctStreak = 0;
    lapseCount += 1;
  }

  const nextReviewDate = box === GRADUATED_BOX ? null : addDays(todayStr, settings.intervals[box - 1]);

  return {
    ...card,
    box,
    correctStreak,
    lapseCount,
    nextReviewDate,
    lastReviewedAt: todayStr,
  };
}

/** DESIGN §1.3 하단 — 취약(leech) 판정. */
export function isLeech(card: Card): boolean {
  return card.lapseCount >= LEECH_LAPSE_THRESHOLD;
}

/** DESIGN §1.6① D-day 주기 압축 — 시험 임박 시 복습 주기를 클램프. */
export function applyExamCompression(
  box: number,
  intervals: number[],
  daysUntilExam: number
): number {
  const base = intervals[box - 1];
  return Math.min(base, Math.max(1, Math.floor(daysUntilExam / 2)));
}

/** DESIGN §1.4 오늘의 복습 큐.
 * 출제 순서: due(복습, 박스1~6) → leftoverNew(박스0 잔류 신규) → newFromPool(이번 세션 신규 도입).
 * 신규 카드는 "처음 보는 것"이므로 복습이 끝난 뒤에 배치한다. 지난 세션에 채점을 못 끝내
 * 박스0으로 남은 카드도 마찬가지로 복습 뒤·신규 도입 앞에 둔다(박스 번호로 정렬하면
 * 박스0이 박스1보다 앞서 나오는 문제를 막기 위함).
 */
export interface TodayQueue {
  due: Card[];
  leftoverNew: Card[];
  newFromPool: NewPoolItem[];
}

export function buildTodayQueue(
  cards: Card[],
  newPool: NewPoolItem[],
  settings: Pick<Settings, "dailyGoal" | "reviewCap" | "newCap" | "maxActiveCards">,
  todayStr: string
): TodayQueue {
  const isDue = (c: Card) => c.nextReviewDate !== null && c.nextReviewDate <= todayStr;

  const due = cards
    .filter((c) => c.box >= 1 && c.box < GRADUATED_BOX && isDue(c))
    .sort((a, b) => {
      if (a.box !== b.box) return a.box - b.box; // (1) 낮은 박스 먼저
      return (a.nextReviewDate ?? "").localeCompare(b.nextReviewDate ?? ""); // (2) 오래 밀린 것 먼저
    })
    .slice(0, settings.reviewCap);

  // 박스0(신규)으로 남아 아직 채점되지 않은 카드 — 도입이 오래된 것 먼저.
  const leftoverNew = cards
    .filter((c) => c.box === NEW_CARD_BOX && isDue(c))
    .sort((a, b) => (a.introducedAt ?? "").localeCompare(b.introducedAt ?? ""));

  // maxActiveCards(WIP 상한): 박스0~6 누적 카드 수가 상한에 도달하면 신규 유입 중단(예방적 안전장치).
  const activeCount = cards.filter((c) => c.box < GRADUATED_BOX).length;
  const roomUnderActiveCap = Math.max(0, settings.maxActiveCards - activeCount);

  const capacity = Math.max(0, settings.dailyGoal - due.length - leftoverNew.length);
  const newFromPool = newPool
    .filter((p) => p.status === "pending")
    .slice(0, Math.min(capacity, settings.newCap, roomUnderActiveCap));

  return { due, leftoverNew, newFromPool };
}

/** 저수지 항목을 실제 학습 카드(박스 1)로 승격. */
export function introduceFromPool(pool: NewPoolItem, todayStr: string): Card {
  return {
    id: pool.id,
    deckId: pool.deckId,
    sourceId: pool.id,
    promptKo: pool.promptKo,
    answerEn: pool.answerEn,
    chunkNote: pool.chunkNote,
    box: NEW_CARD_BOX, // DESIGN §1.3b — 복습 기한 없이 도입, 채점 후 무조건 박스1로
    nextReviewDate: todayStr,
    lastReviewedAt: null,
    correctStreak: 0,
    lapseCount: 0,
    introducedAt: todayStr,
    tags: [],
  };
}
