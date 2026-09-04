package com.leitner.voca.data

import com.leitner.voca.domain.NewPoolItem
import java.time.Instant

// PC 웹 lib/csv.ts 포팅 — DESIGN §3.4 시트 스키마: id | 한글 문장 | 영어 문장 | 청크·문법 메모 | level | topic | added_at
// id 열은 선택 — 없거나 칸이 비면 문장 내용 해시(contentId)로 안정적인 dedupe 키를 만든다.

// 시트에 id 열이 없거나 특정 행의 id 칸이 비었을 때 쓰는 폴백. 랜덤 uuid를 붙이면 매
// 동기화마다 "새 id"가 되어 전체가 다시 흡수되므로(중복 방지 키가 id다, §3.4), 문장 내용
// (한글+영어)에서 결정적으로 해시를 만들어 안정적인 id로 삼는다. PC 웹 lib/csv.ts의
// contentId와 완전히 동일한 FNV-1a 32bit 계산이라 같은 문장이면 웹/안드로이드가 같은 id를 낸다.
// (시트에서 문장을 고치면 그 행은 새 id → 새 항목이 된다 — id 변경과 동일.)
internal fun contentId(promptKo: String, answerEn: String): String {
    val s = promptKo + answerEn
    var h = 0x811c9dc5.toInt() // FNV-1a offset basis
    for (ch in s) {
        h = h xor ch.code       // JS charCodeAt(i) == UTF-16 code unit (한글은 BMP라 동일)
        h *= 0x01000193         // Int*Int는 하위 32bit로 wrap → JS Math.imul과 동일
    }
    return "h" + (h.toLong() and 0xFFFFFFFFL).toString(36)
}

data class ParsedCsvRow(
    val id: String,
    val promptKo: String,
    val answerEn: String,
    val chunkNote: String? = null,
    val level: String? = null,
    val topic: String? = null,
)

private val HEADER_MAP = mapOf(
    "id" to "id",
    "한글 문장" to "promptKo",
    "영어 문장" to "answerEn",
    "청크·문법 메모" to "chunkNote",
    "level" to "level",
    "topic" to "topic",
)

private fun parseCsvLine(line: String): List<String> {
    val cells = mutableListOf<String>()
    val cur = StringBuilder()
    var inQuotes = false
    var i = 0
    while (i < line.length) {
        val ch = line[i]
        if (inQuotes) {
            if (ch == '"' && i + 1 < line.length && line[i + 1] == '"') {
                cur.append('"'); i++
            } else if (ch == '"') {
                inQuotes = false
            } else {
                cur.append(ch)
            }
        } else if (ch == '"') {
            inQuotes = true
        } else if (ch == ',') {
            cells.add(cur.toString()); cur.clear()
        } else {
            cur.append(ch)
        }
        i++
    }
    cells.add(cur.toString())
    return cells.map { it.trim() }
}

data class CsvParseResult(val rows: List<ParsedCsvRow>, val errors: List<String>)

fun parseCsv(text: String): CsvParseResult {
    // 구글시트 CSV export가 UTF-8 BOM을 앞에 붙이는 경우가 있어 제거(PC 웹 lib/csv.ts와 동일 처리).
    val clean = text.removePrefix("﻿")
    val lines = clean.split(Regex("\r?\n")).filter { it.trim().isNotEmpty() }
    if (lines.isEmpty()) return CsvParseResult(emptyList(), listOf("빈 파일입니다."))

    val headers = parseCsvLine(lines[0])
    val fieldIndex = mutableMapOf<String, Int>()
    headers.forEachIndexed { i, h -> HEADER_MAP[h]?.let { fieldIndex[it] = i } }

    val errors = mutableListOf<String>()
    // id 열은 선택 — 없으면 문장 내용 해시로 안정적 id를 생성한다(contentId).
    if ("promptKo" !in fieldIndex) errors.add("필수 열 \"한글 문장\"이 없습니다.")
    if ("answerEn" !in fieldIndex) errors.add("필수 열 \"영어 문장\"이 없습니다.")
    if (errors.isNotEmpty()) {
        val preview = lines[0].take(120)
        errors.add("(참고: 읽은 첫 줄 → \"$preview${if (lines[0].length > 120) "…" else ""}\")")
        return CsvParseResult(emptyList(), errors)
    }

    val rows = mutableListOf<ParsedCsvRow>()
    for (i in 1 until lines.size) {
        val cells = parseCsvLine(lines[i])
        fun cell(key: String): String? = fieldIndex[key]?.let { cells.getOrNull(it) }
        val promptKo = cell("promptKo"); val answerEn = cell("answerEn")
        if (promptKo.isNullOrEmpty() || answerEn.isNullOrEmpty()) {
            errors.add("${i + 1}행: 한글 문장/영어 문장이 비어 있어 건너뜀")
            continue
        }
        val rawId = cell("id")
        val id = if (!rawId.isNullOrEmpty()) rawId else contentId(promptKo, answerEn)
        rows.add(
            ParsedCsvRow(
                id = id, promptKo = promptKo, answerEn = answerEn,
                chunkNote = cell("chunkNote")?.ifEmpty { null },
                level = cell("level")?.ifEmpty { null },
                topic = cell("topic")?.ifEmpty { null },
            )
        )
    }
    return CsvParseResult(rows, errors)
}

/** §3.4 id 기준 dedupe — 이미 가져온 id는 건너뛰고 새 id만 NewPool로 흡수. */
fun toNewPoolItems(rows: List<ParsedCsvRow>, deckId: String, alreadyImportedIds: Set<String>): Pair<List<NewPoolItem>, Int> {
    val now = Instant.now().toString()
    val items = mutableListOf<NewPoolItem>()
    var skipped = 0
    for (row in rows) {
        if (row.id in alreadyImportedIds) { skipped++; continue }
        items.add(
            NewPoolItem(
                id = row.id, deckId = deckId, promptKo = row.promptKo, answerEn = row.answerEn,
                chunkNote = row.chunkNote, level = row.level, topic = row.topic, importedAt = now,
            )
        )
    }
    return items to skipped
}
