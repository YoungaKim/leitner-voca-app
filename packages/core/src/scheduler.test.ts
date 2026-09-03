import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  applyExamCompression,
  buildTodayQueue,
  Card,
  introduceFromPool,
  isCorrect,
  isLeech,
  matchesAnswer,
  onAnswer,
} from "./index.js";

const settings = DEFAULT_SETTINGS;

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "c1",
    deckId: "d1",
    promptKo: "스마트폰은 어디에나 있다.",
    answerEn: "Smartphones are ubiquitous.",
    box: 3,
    nextReviewDate: "2026-08-20",
    lastReviewedAt: "2026-08-16",
    correctStreak: 2,
    lapseCount: 0,
    introducedAt: "2026-08-01",
    tags: [],
    ...overrides,
  };
}

describe("onAnswer — 정답 승급", () => {
  it("박스가 1 오르고 다음 복습일이 intervals[box-1]만큼 뒤로 간다", () => {
    const card = makeCard({ box: 3 });
    const next = onAnswer(card, true, settings, "2026-08-24");
    expect(next.box).toBe(4);
    expect(next.correctStreak).toBe(3);
    expect(next.nextReviewDate).toBe("2026-09-01"); // intervals[3]=8일
    expect(next.lastReviewedAt).toBe("2026-08-24");
  });

  it("박스 6에서 정답이면 졸업(7)하고 nextReviewDate가 null이 된다", () => {
    const card = makeCard({ box: 6 });
    const next = onAnswer(card, true, settings, "2026-08-24");
    expect(next.box).toBe(7);
    expect(next.nextReviewDate).toBeNull();
  });
});

describe("onAnswer — 오답 강등", () => {
  it("완화(soft) 모드: box = max(1, box-2)", () => {
    const card = makeCard({ box: 3, correctStreak: 5 });
    const next = onAnswer(card, false, { ...settings, lapseMode: "soft" }, "2026-08-24");
    expect(next.box).toBe(1);
    expect(next.correctStreak).toBe(0);
    expect(next.lapseCount).toBe(1);
  });

  it("완화 모드 박스 5 → 3 (최소 1 보장 확인용 박스 2 → 1)", () => {
    const card = makeCard({ box: 5 });
    const next = onAnswer(card, false, { ...settings, lapseMode: "soft" }, "2026-08-24");
    expect(next.box).toBe(3);

    const lowBoxCard = makeCard({ box: 2 });
    const lowNext = onAnswer(lowBoxCard, false, { ...settings, lapseMode: "soft" }, "2026-08-24");
    expect(lowNext.box).toBe(1);
  });

  it("순수 리셋(reset) 모드: box = 1", () => {
    const card = makeCard({ box: 5 });
    const next = onAnswer(card, false, { ...settings, lapseMode: "reset" }, "2026-08-24");
    expect(next.box).toBe(1);
    expect(next.lapseCount).toBe(1);
  });
});

describe("isCorrect — 힌트레벨 채점", () => {
  it("힌트레벨 0~1에서 [알았어]면 정답", () => {
    expect(isCorrect(0, true, settings)).toBe(true);
    expect(isCorrect(1, true, settings)).toBe(true);
  });

  it("힌트레벨 2 이상이면 [알았어]를 눌러도 강제 오답", () => {
    expect(isCorrect(2, true, settings)).toBe(false);
    expect(isCorrect(3, true, settings)).toBe(false);
  });

  it("[몰랐어]를 선택하면 힌트레벨과 무관하게 오답", () => {
    expect(isCorrect(0, false, settings)).toBe(false);
  });
});

describe("박스0 — DESIGN §1.3b 신규 카드 초기 도입", () => {
  it("introduceFromPool은 box:0(NEW_CARD_BOX)으로 카드를 생성한다", () => {
    const card = introduceFromPool(
      { id: "p1", deckId: "d1", promptKo: "x", answerEn: "y", status: "pending", importedAt: "2026-08-01" },
      "2026-08-24"
    );
    expect(card.box).toBe(0);
    expect(card.nextReviewDate).toBe("2026-08-24");
  });

  it("box:0 카드는 정답이든 오답이든 onAnswer 결과가 항상 박스1로 착지한다", () => {
    const newCard = makeCard({ box: 0, correctStreak: 0, lapseCount: 0 });

    const correctNext = onAnswer(newCard, true, settings, "2026-08-24");
    expect(correctNext.box).toBe(1);

    const wrongNext = onAnswer(newCard, false, { ...settings, lapseMode: "soft" }, "2026-08-24");
    expect(wrongNext.box).toBe(1);
  });
});

describe("matchesAnswer — DESIGN §1.3a 텍스트 정답 매칭", () => {
  const answer = "Smartphones are ubiquitous.";

  it("정확히 일치하면 true", () => {
    expect(matchesAnswer("Smartphones are ubiquitous.", answer)).toBe(true);
  });

  it("관사 차이만 있으면 true", () => {
    expect(matchesAnswer("Smartphones are the ubiquitous.", answer)).toBe(true);
    expect(matchesAnswer("A dog runs.", "The dog runs.")).toBe(true);
  });

  it("대소문자 차이는 무시한다", () => {
    expect(matchesAnswer("smartphones ARE Ubiquitous", answer)).toBe(true);
  });

  it("구두점 차이는 무시한다", () => {
    expect(matchesAnswer("Smartphones are ubiquitous", answer)).toBe(true);
  });

  it("실제 오답(내용 단어가 다름)이면 false", () => {
    expect(matchesAnswer("Smartphones are everywhere.", answer)).toBe(false);
  });

  it("빈 입력이면 false", () => {
    expect(matchesAnswer("", answer)).toBe(false);
  });

  it("텍스트가 정확히 일치해도 힌트레벨 강제 규칙(isCorrect)은 그대로 적용된다", () => {
    const typed = matchesAnswer("Smartphones are ubiquitous.", answer);
    expect(typed).toBe(true);
    // 힌트레벨 2 이상이면 텍스트가 맞아도 최종 correct는 false여야 한다(DESIGN §1.3).
    expect(isCorrect(2, typed, settings)).toBe(false);
    // 힌트레벨 0~1이면 텍스트 일치가 그대로 정답으로 반영된다.
    expect(isCorrect(1, typed, settings)).toBe(true);
  });
});

describe("isLeech — 취약 판정", () => {
  it("lapseCount >= 5면 취약으로 표시", () => {
    expect(isLeech(makeCard({ lapseCount: 4 }))).toBe(false);
    expect(isLeech(makeCard({ lapseCount: 5 }))).toBe(true);
  });
});

describe("buildTodayQueue — 정렬·상한", () => {
  it("박스 오름차순 → nextReviewDate 오름차순으로 정렬한다", () => {
    const cards = [
      makeCard({ id: "a", box: 3, nextReviewDate: "2026-08-20" }),
      makeCard({ id: "b", box: 1, nextReviewDate: "2026-08-22" }),
      makeCard({ id: "c", box: 1, nextReviewDate: "2026-08-19" }),
    ];
    const { due } = buildTodayQueue(cards, [], settings, "2026-08-24");
    expect(due.map((c) => c.id)).toEqual(["c", "b", "a"]);
  });

  it("졸업(box=7) 카드와 아직 안 밀린 카드는 큐에서 제외한다", () => {
    const cards = [
      makeCard({ id: "grad", box: 7, nextReviewDate: null }),
      makeCard({ id: "future", box: 2, nextReviewDate: "2099-01-01" }),
      makeCard({ id: "due", box: 2, nextReviewDate: "2026-08-24" }),
    ];
    const { due } = buildTodayQueue(cards, [], settings, "2026-08-24");
    expect(due.map((c) => c.id)).toEqual(["due"]);
  });

  it("박스0(신규) 잔류 카드는 due에서 빠지고 leftoverNew로, 복습 뒤 순서가 된다", () => {
    const cards = [
      makeCard({ id: "new-old", box: 0, nextReviewDate: "2026-08-24", introducedAt: "2026-08-10" }),
      makeCard({ id: "new-recent", box: 0, nextReviewDate: "2026-08-24", introducedAt: "2026-08-20" }),
      makeCard({ id: "box1", box: 1, nextReviewDate: "2026-08-24" }),
    ];
    const { due, leftoverNew } = buildTodayQueue(cards, [], settings, "2026-08-24");
    expect(due.map((c) => c.id)).toEqual(["box1"]);
    expect(leftoverNew.map((c) => c.id)).toEqual(["new-old", "new-recent"]); // 도입 오래된 것 먼저
  });

  it("leftoverNew도 dailyGoal 여력을 소진해 신규 도입을 밀어낸다", () => {
    const cards = [
      ...Array.from({ length: 20 }, (_, i) => makeCard({ id: `r${i}`, box: 1, nextReviewDate: "2026-08-24" })),
      ...Array.from({ length: 10 }, (_, i) => makeCard({ id: `n${i}`, box: 0, nextReviewDate: "2026-08-24" })),
    ];
    const pool = [{ id: "p1", deckId: "d1", promptKo: "x", answerEn: "y", status: "pending" as const, importedAt: "2026-08-01" }];
    const { newFromPool } = buildTodayQueue(cards, pool, settings, "2026-08-24"); // dailyGoal 30 = 20 + 10
    expect(newFromPool).toHaveLength(0);
  });

  it("박스0 잔류 신규도 newCap에 포함해 신규 도입을 제한한다", () => {
    // newCap 8, 박스0 잔류 5개 → 신규는 3개까지만 추가로 도입.
    const cards = Array.from({ length: 5 }, (_, i) =>
      makeCard({ id: `n${i}`, box: 0, nextReviewDate: "2026-08-24" })
    );
    const pool = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`, deckId: "d1", promptKo: "x", answerEn: "y", status: "pending" as const, importedAt: "2026-08-01",
    }));
    const { leftoverNew, newFromPool } = buildTodayQueue(cards, pool, settings, "2026-08-24");
    expect(leftoverNew).toHaveLength(5);
    expect(newFromPool).toHaveLength(3); // 8 - 5
  });

  it("오늘 기한이 된 복습은 상한 없이 전부 큐에 넣는다", () => {
    const cards = Array.from({ length: 120 }, (_, i) =>
      makeCard({ id: `c${i}`, box: 1, nextReviewDate: "2026-08-24" })
    );
    const { due } = buildTodayQueue(cards, [], settings, "2026-08-24");
    expect(due).toHaveLength(120);
  });

  it("복습이 dailyGoal을 다 채우면 신규를 넣지 않는다(복습 우선)", () => {
    const cards = Array.from({ length: 30 }, (_, i) =>
      makeCard({ id: `c${i}`, box: 1, nextReviewDate: "2026-08-24" })
    );
    const pool = [{ id: "p1", deckId: "d1", promptKo: "x", answerEn: "y", status: "pending" as const, importedAt: "2026-08-01" }];
    const { newFromPool } = buildTodayQueue(cards, pool, settings, "2026-08-24");
    expect(newFromPool).toHaveLength(0);
  });

  it("maxActiveCards 상한에 도달하면 여력이 있어도 신규를 넣지 않는다", () => {
    // 박스1~6(미졸업) 카드가 이미 상한만큼 있음 → due는 0이어도 신규 유입은 0이어야 함.
    const cards = Array.from({ length: 150 }, (_, i) =>
      makeCard({ id: `c${i}`, box: 6, nextReviewDate: "2099-01-01" }) // 아직 안 밀림 → due=0
    );
    const pool = [{ id: "p1", deckId: "d1", promptKo: "x", answerEn: "y", status: "pending" as const, importedAt: "2026-08-01" }];
    const { due, newFromPool } = buildTodayQueue(cards, pool, { ...settings, maxActiveCards: 150 }, "2026-08-24");
    expect(due).toHaveLength(0);
    expect(newFromPool).toHaveLength(0);
  });

  it("maxActiveCards에 여유가 있으면 그만큼만 신규를 넣는다", () => {
    const cards = Array.from({ length: 148 }, (_, i) =>
      makeCard({ id: `c${i}`, box: 6, nextReviewDate: "2099-01-01" })
    );
    const pool = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      deckId: "d1",
      promptKo: "x",
      answerEn: "y",
      status: "pending" as const,
      importedAt: "2026-08-01",
    }));
    const { newFromPool } = buildTodayQueue(cards, pool, { ...settings, maxActiveCards: 150, newCap: 8 }, "2026-08-24");
    expect(newFromPool).toHaveLength(2); // 여력 = 150-148 = 2 < newCap(8)
  });
});

describe("applyExamCompression — D-day 주기 클램프", () => {
  it("시험이 임박하면 기본 주기보다 짧게 클램프된다", () => {
    // box=5 → 기본 interval 16일, D-day가 4일 남았으면 max(1, 4/2)=2일로 압축
    expect(applyExamCompression(5, settings.intervals, 4)).toBe(2);
  });

  it("기본 주기가 이미 더 짧으면 그대로 유지한다", () => {
    // box=1 → 기본 interval 1일, D-day 20일 남아도 압축값(10)보다 작으니 1일 유지
    expect(applyExamCompression(1, settings.intervals, 20)).toBe(1);
  });

  it("시험 당일(daysUntilExam=0)이어도 최소 1일은 보장한다", () => {
    expect(applyExamCompression(3, settings.intervals, 0)).toBe(1);
  });
});
