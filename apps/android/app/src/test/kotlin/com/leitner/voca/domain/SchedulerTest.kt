package com.leitner.voca.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// packages/core/src/scheduler.test.ts 포팅 — PC 웹과 같은 케이스로 라이트너 로직을 검증한다.

private val settings = Settings.DEFAULT

private fun makeCard(
    id: String = "c1",
    box: Int = 3,
    nextReviewDate: String? = "2026-08-20",
    correctStreak: Int = 2,
    lapseCount: Int = 0,
    introducedAt: String = "2026-08-01",
    lastReviewedAt: String? = "2026-08-16",
): Card = Card(
    id = id,
    deckId = "d1",
    promptKo = "스마트폰은 어디에나 있다.",
    answerEn = "Smartphones are ubiquitous.",
    box = box,
    nextReviewDate = nextReviewDate,
    lastReviewedAt = lastReviewedAt,
    correctStreak = correctStreak,
    lapseCount = lapseCount,
    introducedAt = introducedAt,
)

class SchedulerTest {

    @Test
    fun `정답이면 박스가 1 오르고 다음 복습일이 intervals만큼 뒤로 간다`() {
        val card = makeCard(box = 3)
        val next = onAnswer(card, true, settings, "2026-08-24")
        assertEquals(4, next.box)
        assertEquals(3, next.correctStreak)
        assertEquals("2026-09-01", next.nextReviewDate) // intervals[3]=8일
        assertEquals("2026-08-24", next.lastReviewedAt)
    }

    @Test
    fun `박스 6에서 정답이면 졸업하고 nextReviewDate가 null이 된다`() {
        val card = makeCard(box = 6)
        val next = onAnswer(card, true, settings, "2026-08-24")
        assertEquals(GRADUATED_BOX, next.box)
        assertNull(next.nextReviewDate)
    }

    @Test
    fun `완화 모드는 box = max(1, box-2)로 강등된다`() {
        val card = makeCard(box = 3, correctStreak = 5)
        val next = onAnswer(card, false, settings.copy(lapseMode = LapseMode.SOFT), "2026-08-24")
        assertEquals(1, next.box)
        assertEquals(0, next.correctStreak)
        assertEquals(1, next.lapseCount)

        val low = onAnswer(makeCard(box = 2), false, settings.copy(lapseMode = LapseMode.SOFT), "2026-08-24")
        assertEquals(1, low.box) // 최소 1 보장
    }

    @Test
    fun `리셋 모드는 box=1로 강등된다`() {
        val next = onAnswer(makeCard(box = 5), false, settings.copy(lapseMode = LapseMode.RESET), "2026-08-24")
        assertEquals(1, next.box)
        assertEquals(1, next.lapseCount)
    }

    @Test
    fun `힌트레벨 0~1에서 알았어면 정답`() {
        assertTrue(isCorrect(0, true, settings))
        assertTrue(isCorrect(1, true, settings))
    }

    @Test
    fun `힌트레벨 2 이상이면 알았어를 눌러도 강제 오답`() {
        assertFalse(isCorrect(2, true, settings))
        assertFalse(isCorrect(3, true, settings))
    }

    @Test
    fun `몰랐어를 선택하면 힌트레벨과 무관하게 오답`() {
        assertFalse(isCorrect(0, false, settings))
    }

    @Test
    fun `lapseCount 5 이상이면 취약으로 표시`() {
        assertFalse(isLeech(makeCard(lapseCount = 4)))
        assertTrue(isLeech(makeCard(lapseCount = 5)))
    }

    @Test
    fun `오늘 복습 큐는 박스 오름차순, 그 다음 nextReviewDate 오름차순으로 정렬한다`() {
        val cards = listOf(
            makeCard(id = "a", box = 3, nextReviewDate = "2026-08-20"),
            makeCard(id = "b", box = 1, nextReviewDate = "2026-08-22"),
            makeCard(id = "c", box = 1, nextReviewDate = "2026-08-19"),
        )
        val queue = buildTodayQueue(cards, emptyList(), settings, "2026-08-24")
        assertEquals(listOf("c", "b", "a"), queue.due.map { it.id })
    }

    @Test
    fun `졸업 카드와 아직 안 밀린 카드는 큐에서 제외한다`() {
        val cards = listOf(
            makeCard(id = "grad", box = GRADUATED_BOX, nextReviewDate = null),
            makeCard(id = "future", box = 2, nextReviewDate = "2099-01-01"),
            makeCard(id = "due", box = 2, nextReviewDate = "2026-08-24"),
        )
        val queue = buildTodayQueue(cards, emptyList(), settings, "2026-08-24")
        assertEquals(listOf("due"), queue.due.map { it.id })
    }

    @Test
    fun `박스0 신규 잔류 카드는 due에서 빠지고 leftoverNew로, 복습 뒤 순서가 된다`() {
        val cards = listOf(
            makeCard(id = "new-old", box = 0, nextReviewDate = "2026-08-24", introducedAt = "2026-08-10"),
            makeCard(id = "new-recent", box = 0, nextReviewDate = "2026-08-24", introducedAt = "2026-08-20"),
            makeCard(id = "box1", box = 1, nextReviewDate = "2026-08-24"),
        )
        val queue = buildTodayQueue(cards, emptyList(), settings, "2026-08-24")
        assertEquals(listOf("box1"), queue.due.map { it.id })
        assertEquals(listOf("new-old", "new-recent"), queue.leftoverNew.map { it.id })
    }

    @Test
    fun `leftoverNew도 dailyGoal 여력을 소진해 신규 도입을 밀어낸다`() {
        val cards = (0 until 20).map { makeCard(id = "r$it", box = 1, nextReviewDate = "2026-08-24") } +
            (0 until 10).map { makeCard(id = "n$it", box = 0, nextReviewDate = "2026-08-24") }
        val pool = listOf(NewPoolItem(id = "p1", deckId = "d1", promptKo = "x", answerEn = "y", importedAt = "2026-08-01"))
        val queue = buildTodayQueue(cards, pool, settings, "2026-08-24") // dailyGoal 30 = 20 + 10
        assertTrue(queue.newFromPool.isEmpty())
    }

    @Test
    fun `박스0 잔류 신규도 newCap에 포함해 신규 도입을 제한한다`() {
        val cards = (0 until 5).map { makeCard(id = "n$it", box = 0, nextReviewDate = "2026-08-24") }
        val pool = (0 until 20).map {
            NewPoolItem(id = "p$it", deckId = "d1", promptKo = "x", answerEn = "y", importedAt = "2026-08-01")
        }
        val queue = buildTodayQueue(cards, pool, settings, "2026-08-24")
        assertEquals(5, queue.leftoverNew.size)
        assertEquals(3, queue.newFromPool.size) // newCap 8 - 잔류 5
    }

    @Test
    fun `오늘 기한이 된 복습은 상한 없이 전부 큐에 넣는다`() {
        val cards = (0 until 120).map { makeCard(id = "c$it", box = 1, nextReviewDate = "2026-08-24") }
        val queue = buildTodayQueue(cards, emptyList(), settings, "2026-08-24")
        assertEquals(120, queue.due.size)
    }

    @Test
    fun `복습이 dailyGoal을 다 채우면 신규를 넣지 않는다`() {
        val cards = (0 until 30).map { makeCard(id = "c$it", box = 1, nextReviewDate = "2026-08-24") }
        val pool = listOf(NewPoolItem(id = "p1", deckId = "d1", promptKo = "x", answerEn = "y", importedAt = "2026-08-01"))
        val queue = buildTodayQueue(cards, pool, settings, "2026-08-24")
        assertTrue(queue.newFromPool.isEmpty())
    }

    @Test
    fun `오늘 이미 채점한 카드가 dailyGoal을 넘겼으면 due를 다 비워도 신규가 안 생긴다`() {
        val cards = (0 until 35).map {
            makeCard(id = "d$it", box = 2, nextReviewDate = "2026-09-01", lastReviewedAt = "2026-08-24")
        }
        val pool = (0 until 10).map {
            NewPoolItem(id = "p$it", deckId = "d1", promptKo = "x", answerEn = "y", importedAt = "2026-08-01")
        }
        val queue = buildTodayQueue(cards, pool, settings, "2026-08-24")
        assertTrue(queue.due.isEmpty())
        assertTrue(queue.newFromPool.isEmpty()) // 30 - 35 < 0
    }

    @Test
    fun `시험이 임박하면 기본 주기보다 짧게 클램프된다`() {
        // box=5 → 기본 interval 16일, D-day가 4일 남았으면 max(1, 4/2)=2일로 압축
        assertEquals(2, applyExamCompression(5, settings.intervals, 4))
    }

    @Test
    fun `기본 주기가 이미 더 짧으면 그대로 유지한다`() {
        assertEquals(1, applyExamCompression(1, settings.intervals, 20))
    }

    @Test
    fun `시험 당일이어도 최소 1일은 보장한다`() {
        assertEquals(1, applyExamCompression(3, settings.intervals, 0))
    }

    @Test
    fun `introduceFromPool은 카드 id sourceId를 pool_id로 고정한다 - 어느 기기에서 승격해도 같은 카드가 되어 동기화 병합 시 중복이 안 생긴다`() {
        val pool = NewPoolItem(id = "sheet-42", deckId = "d1", promptKo = "x", answerEn = "y", importedAt = "2026-08-01")
        val a = introduceFromPool(pool, "2026-08-24")
        val b = introduceFromPool(pool, "2026-09-01") // 다른 날, 다른 기기 가정
        assertEquals("sheet-42", a.id)
        assertEquals("sheet-42", a.sourceId)
        assertEquals(a.id, b.id) // 결정적 — 랜덤 uuid 아님
    }
}
