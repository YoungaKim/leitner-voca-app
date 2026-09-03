// DESIGN §3.4 시트 스키마 고정: id | 한글 문장 | 영어 문장 | 청크·문법 메모 | level | topic | added_at
// 이 파서는 content-sync-proxy가 Sheets API 값을 CSV 텍스트로 변환해 돌려준 것을 파싱하는 데 쓴다
// (contentSync.ts). 수동 CSV 파일 업로드 UI는 스펙 아웃(2026-08-26) — 콘텐츠 소스는 구글시트 자동 동기화로 단일화.
import type { NewPoolItem } from "@leitner/core";

export interface ParsedCsvRow {
  id: string;
  promptKo: string;
  answerEn: string;
  chunkNote?: string;
  level?: string;
  topic?: string;
}

const HEADER_MAP: Record<string, keyof ParsedCsvRow> = {
  id: "id",
  "한글 문장": "promptKo",
  "영어 문장": "answerEn",
  "청크·문법 메모": "chunkNote",
  level: "level",
  topic: "topic",
};

/** 아주 단순한 CSV 파서. 셀 안에 콤마가 있을 경우를 대비해 큰따옴표 인용을 지원한다. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

export interface CsvParseResult {
  rows: ParsedCsvRow[];
  errors: string[];
}

export function parseCsv(text: string): CsvParseResult {
  // 구글시트 CSV export는 종종 UTF-8 BOM(﻿)을 파일 맨 앞에 붙인다. 안 지우면 첫 헤더 셀이
  // "﻿id"가 되어 HEADER_MAP["id"]와 문자열이 안 맞아 "필수 열 id가 없다"는 오탐이 난다.
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], errors: ["빈 파일입니다."] };

  const headers = parseCsvLine(lines[0]);
  const fieldIndex: Partial<Record<keyof ParsedCsvRow, number>> = {};
  headers.forEach((h, i) => {
    const field = HEADER_MAP[h];
    if (field) fieldIndex[field] = i;
  });

  const errors: string[] = [];
  if (fieldIndex.id === undefined) errors.push('필수 열 "id"가 없습니다.');
  if (fieldIndex.promptKo === undefined) errors.push('필수 열 "한글 문장"이 없습니다.');
  if (fieldIndex.answerEn === undefined) errors.push('필수 열 "영어 문장"이 없습니다.');
  if (errors.length > 0) {
    // 헤더가 안 맞을 땐 "왜"가 안 보이면 디버깅이 브라우저 devtools 없이는 불가능해서,
    // 실제로 받은 첫 줄을 그대로 보여준다 — CSV가 아니라 로그인 페이지/차단 페이지 HTML을
    // 받은 경우 등을 텍스트만 보고도 바로 알 수 있게.
    const preview = lines[0].slice(0, 120);
    errors.push(`(참고: 읽은 첫 줄 → "${preview}${lines[0].length > 120 ? "…" : ""}")`);
    return { rows: [], errors };
  }

  const rows: ParsedCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const id = cells[fieldIndex.id!];
    const promptKo = cells[fieldIndex.promptKo!];
    const answerEn = cells[fieldIndex.answerEn!];
    if (!id || !promptKo || !answerEn) {
      errors.push(`${i + 1}행: id/한글 문장/영어 문장이 비어 있어 건너뜀`);
      continue;
    }
    rows.push({
      id,
      promptKo,
      answerEn,
      chunkNote: fieldIndex.chunkNote !== undefined ? cells[fieldIndex.chunkNote] : undefined,
      level: fieldIndex.level !== undefined ? cells[fieldIndex.level] : undefined,
      topic: fieldIndex.topic !== undefined ? cells[fieldIndex.topic] : undefined,
    });
  }
  return { rows, errors };
}

/** §3.4 id 기준 dedupe — 이미 가져온 id는 건너뛰고 새 id만 NewPool로 흡수. */
export function toNewPoolItems(
  rows: ParsedCsvRow[],
  deckId: string,
  alreadyImportedIds: Set<string>
): { items: NewPoolItem[]; skipped: number } {
  const now = new Date().toISOString();
  const items: NewPoolItem[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (alreadyImportedIds.has(row.id)) {
      skipped++;
      continue;
    }
    items.push({
      id: row.id,
      deckId,
      promptKo: row.promptKo,
      answerEn: row.answerEn,
      chunkNote: row.chunkNote,
      level: row.level,
      topic: row.topic,
      status: "pending",
      importedAt: now,
    });
  }
  return { items, skipped };
}
