package com.leitner.voca.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CsvTest {

    // 아래 기대값은 PC 웹 lib/csv.ts 의 contentId 를 그대로 돌려 얻은 것 —
    // 웹/안드로이드가 같은 문장에서 같은 id 를 내야 다기기 중복이 안 생긴다.
    @Test
    fun `contentId는 PC 웹 구현과 동일한 해시를 낸다`() {
        assertEquals("hoiw15m", contentId("x", "y"))
        assertEquals(
            "h1edoyms",
            contentId("회의가 끝나면 보고서를 보내겠다.", "I will send the report when the meeting ends."),
        )
    }

    @Test
    fun `contentId는 결정적이다`() {
        assertEquals(contentId("가나다", "abc"), contentId("가나다", "abc"))
    }

    @Test
    fun `id 열이 없어도 파싱되고 내용 해시로 id가 채워진다`() {
        val csv = "한글 문장,영어 문장\n안녕,hi\n"
        val result = parseCsv(csv)
        assertTrue(result.errors.isEmpty())
        assertEquals(1, result.rows.size)
        assertEquals(contentId("안녕", "hi"), result.rows[0].id)
    }

    @Test
    fun `id 칸이 빈 행은 내용 해시로 채우고 값이 있으면 그대로 쓴다`() {
        val csv = "id,한글 문장,영어 문장\n,안녕,hi\nsheet-2,잘가,bye\n"
        val result = parseCsv(csv)
        assertEquals(2, result.rows.size)
        assertEquals(contentId("안녕", "hi"), result.rows[0].id)
        assertEquals("sheet-2", result.rows[1].id)
    }
}
