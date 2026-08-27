package com.leitner.voca.domain

// packages/core/src/scheduler.ts 포팅 — DESIGN §1 라이트너 알고리즘. 순수 함수, UI/DB 의존 없음.
// PC 웹(TS)과 로직이 갈라지지 않도록 함수 이름·동작을 그대로 맞춘다.

/** DESIGN §1.3 힌트 사다리 판정.
 * correct = (힌트레벨 <= hintFreeLevel) AND (사용자가 [알았어] 선택)
 * 힌트레벨이 자유 레벨을 넘으면 [알았어]를 눌러도 무조건 오답.
 */
fun isCorrect(hintLevel: Int, userClaimedKnew: Boolean, settings: Settings): Boolean =
    hintLevel <= settings.hintFreeLevel && userClaimedKnew

/** DESIGN §1.3 onAnswer — 정답/오답에 따른 박스·복습일 갱신. */
fun onAnswer(card: Card, correct: Boolean, settings: Settings, todayStr: String): Card {
    val box: Int
    val correctStreak: Int
    var lapseCount = card.lapseCount

    if (correct) {
        box = minOf(card.box + 1, GRADUATED_BOX)
        correctStreak = card.correctStreak + 1
    } else {
        box = if (settings.lapseMode == LapseMode.SOFT) maxOf(1, card.box - 2) else 1
        correctStreak = 0
        lapseCount += 1
    }

    val nextReviewDate = if (box == GRADUATED_BOX) null else addDays(todayStr, settings.intervals[box - 1])

    return card.copy(
        box = box,
        correctStreak = correctStreak,
        lapseCount = lapseCount,
        nextReviewDate = nextReviewDate,
        lastReviewedAt = todayStr,
    )
}

/** DESIGN §1.3 하단 — 취약(leech) 판정. */
fun isLeech(card: Card): Boolean = card.lapseCount >= LEECH_LAPSE_THRESHOLD

/** DESIGN §1.6① D-day 주기 압축 — 시험 임박 시 복습 주기를 클램프. */
fun applyExamCompression(box: Int, intervals: List<Int>, daysUntilExam: Int): Int {
    val base = intervals[box - 1]
    return minOf(base, maxOf(1, daysUntilExam / 2))
}

/** DESIGN §1.4 오늘의 복습 큐 — 복습 카드(정렬·상한 적용) + 저수지에서 끌어올 신규 후보. */
data class TodayQueue(val due: List<Card>, val newFromPool: List<NewPoolItem>)

fun buildTodayQueue(
    cards: List<Card>,
    newPool: List<NewPoolItem>,
    settings: Settings,
    todayStr: String,
): TodayQueue {
    val due = cards
        .filter { it.box < GRADUATED_BOX && it.nextReviewDate != null && it.nextReviewDate <= todayStr }
        .sortedWith(
            compareBy(
                { it.box }, // (1) 낮은 박스 먼저
                { it.nextReviewDate ?: "" }, // (2) 오래 밀린 것 먼저
            )
        )
        .take(settings.reviewCap)

    // maxActiveCards(WIP 상한): 박스1~6 누적 카드 수가 상한에 도달하면 신규 유입 중단(예방적 안전장치).
    val activeCount = cards.count { it.box < GRADUATED_BOX }
    val roomUnderActiveCap = maxOf(0, settings.maxActiveCards - activeCount)

    val capacity = maxOf(0, settings.dailyGoal - due.size)
    val newFromPool = newPool.take(minOf(capacity, minOf(settings.newCap, roomUnderActiveCap)))

    return TodayQueue(due, newFromPool)
}

/** 저수지 항목을 실제 학습 카드(박스 1)로 승격. */
fun introduceFromPool(pool: NewPoolItem, todayStr: String): Card = Card(
    id = pool.id,
    deckId = pool.deckId,
    sourceId = pool.id,
    promptKo = pool.promptKo,
    answerEn = pool.answerEn,
    chunkNote = pool.chunkNote,
    box = 1,
    nextReviewDate = todayStr,
    lastReviewedAt = null,
    correctStreak = 0,
    lapseCount = 0,
    introducedAt = todayStr,
    tags = emptyList(),
)
