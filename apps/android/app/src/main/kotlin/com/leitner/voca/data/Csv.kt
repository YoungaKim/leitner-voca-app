package com.leitner.voca.data

import com.leitner.voca.domain.NewPoolItem
import java.time.Instant

// PC 웹 lib/csv.ts 포팅 — DESIGN §3.4 시트 스키마 고정: id | 한글 문장 | 영어 문장 | 청크·문법 메모 | level | topic | added_at

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
    if ("id" !in fieldIndex) errors.add("필수 열 \"id\"가 없습니다.")
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
        val id = cell("id"); val promptKo = cell("promptKo"); val answerEn = cell("answerEn")
        if (id.isNullOrEmpty() || promptKo.isNullOrEmpty() || answerEn.isNullOrEmpty()) {
            errors.add("${i + 1}행: id/한글 문장/영어 문장이 비어 있어 건너뜀")
            continue
        }
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
