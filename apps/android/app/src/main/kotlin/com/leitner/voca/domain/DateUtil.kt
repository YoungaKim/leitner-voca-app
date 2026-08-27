package com.leitner.voca.domain

import java.time.LocalDate

// packages/core/src/date.ts 포팅 — java.time.LocalDate는 타임존 없이 순수 날짜 산술이라
// TS 버전의 "로컬 자정 기준 문자열 산술" 의도와 그대로 맞아떨어진다.

fun addDays(dateStr: String, days: Int): String =
    LocalDate.parse(dateStr).plusDays(days.toLong()).toString()

fun daysBetween(fromStr: String, toStr: String): Int =
    java.time.temporal.ChronoUnit.DAYS.between(LocalDate.parse(fromStr), LocalDate.parse(toStr)).toInt()

fun today(): String = LocalDate.now().toString()
