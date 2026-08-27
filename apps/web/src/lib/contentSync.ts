// 2d. 콘텐츠 자동 동기화 — DESIGN §3.3~3.8. 게시된 구글시트 CSV를 읽어와 새 id만 저수지로 흡수.
// dedupe는 "덱 하나" 범위가 아니라 계정 전체 범위로 한다 — 덱 간 중복 문장이 안 걸러지던
// 문제(수동 CSV 가져오기 때부터 있던 것)를 여기서 함께 고친다: 이미 카드로 있거나(어느 덱이든)
// 저수지에 있거나(어느 덱이든), syncState.importedIds에 기록된 id는 전부 건너뛴다.
import type { Card, NewPoolItem, SyncState } from "@leitner/core";
import { parseCsv, toNewPoolItems } from "./csv";
import { supabase } from "./supabase";

/**
 * 구글시트 fetch는 Supabase Edge Function(content-sync-proxy)을 통해 한다 —
 * "웹에 게시 > CSV" 링크는 브라우저 fetch·서버(Edge Function) fetch 둘 다에서 구글이 가끔/자주
 * CSV 대신 사람이 보는 뷰어 페이지(HTML)를 돌려주는 안티스크래핑성 비일관성이 실측 확인됨
 * (curl은 매번 성공 — IP 평판성 이슈로 추정). 그래서 프록시 쪽에서 공식 Google Sheets API
 * (sheets.googleapis.com, API 키 필요)로 완전히 교체함 — 클라이언트 쪽 인터페이스(URL 문자열
 * 하나 넘기기)는 그대로라 여기 코드는 안 바뀜, sourceUrl은 이제 "웹에 게시 URL"이 아니라
 * 평범한 구글시트 공유/편집 링크. 로그인 안 한 로컬 전용 모드(supabase가 null)에선 프록시를
 * 쓸 수 없으니 직접 fetch로 폴백한다(구글시트 소스는 어차피 클라우드 계정 전제라 이 경로는
 * 사실상 안 씀 — 폴백 상태로는 어차피 예전과 같은 이유로 불안정할 수 있음).
 */
async function fetchSheetCsv(sourceUrl: string): Promise<string> {
  if (supabase) {
    const { data, error } = await supabase.functions.invoke("content-sync-proxy", {
      body: { url: sourceUrl },
    });
    if (error) {
      // supabase-js는 4xx/5xx를 FunctionsHttpError로 감싸면서 .message를 "Edge Function
      // returned a non-2xx status code"라는 뻔한 문구로 덮어써버린다 — 실제 이유는 응답 바디
      // (error.context, Response 객체)에 우리가 JSON으로 넣어둔 { error: "..." }에 있으니
      // 그걸 파싱해서 보여준다. 파싱 실패하면 원래 메시지로 폴백.
      const context = (error as { context?: Response }).context;
      let detail: string | undefined;
      if (context) {
        try {
          const body = await context.clone().json();
          if (typeof body?.error === "string") detail = body.error;
        } catch {
          /* JSON 파싱 실패 시 아래 폴백 메시지 사용 */
        }
      }
      throw new Error(detail ?? error.message ?? "프록시 호출 실패");
    }
    if (typeof data !== "string") throw new Error("프록시 응답 형식이 올바르지 않습니다.");
    return data;
  }
  const res = await fetch(sourceUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export interface ContentSyncResult {
  items: NewPoolItem[]; // 새로 저수지에 넣을 항목
  skipped: number;
  fetchedCount: number;
  errors: string[];
  syncState: SyncState;
}

/** 계정 전체 범위(덱 무관) dedupe 키 집합. 수동 CSV 가져오기에서도 이 함수를 재사용한다. */
export function accountWideImportedIds(cards: Card[], newPool: NewPoolItem[], syncState: SyncState): Set<string> {
  const ids = new Set<string>(syncState.importedIds);
  for (const c of cards) ids.add(c.sourceId ?? c.id);
  for (const p of newPool) ids.add(p.id);
  return ids;
}

export async function runContentSync(
  sourceUrl: string,
  targetDeckId: string,
  cards: Card[],
  newPool: NewPoolItem[],
  syncState: SyncState
): Promise<ContentSyncResult> {
  const now = new Date().toISOString();
  let text: string;
  try {
    // §3.8: 오프라인/URL 오류 시 조용히 스킵 후 재시도(로컬 우선) — 여기선 호출부가 결과의
    // errors를 보고 배너/토스트로만 알리고, 로컬 데이터는 절대 건드리지 않는다.
    text = await fetchSheetCsv(sourceUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      items: [],
      skipped: 0,
      fetchedCount: 0,
      errors: [`시트를 가져오지 못했습니다: ${message}`],
      syncState: { ...syncState, sourceUrl, lastSyncAt: now, lastSyncResult: `실패: ${message}` },
    };
  }

  const { rows, errors } = parseCsv(text);
  const already = accountWideImportedIds(cards, newPool, syncState);
  const { items, skipped } = toNewPoolItems(rows, targetDeckId, already);

  const importedIds = Array.from(new Set([...syncState.importedIds, ...items.map((i) => i.id)]));
  const resultSummary =
    errors.length > 0
      ? `${items.length}개 흡수, ${skipped}개 건너뜀, 형식 오류 ${errors.length}행`
      : `${items.length}개 흡수, ${skipped}개 건너뜀`;

  return {
    items,
    skipped,
    fetchedCount: rows.length,
    errors,
    syncState: { sourceUrl, importedIds, lastSyncAt: now, lastSyncResult: resultSummary },
  };
}

/** §3.2 보충 트리거: 남은 신규 문장 < newCap × refillThresholdDays. */
export function needsRefill(pendingPoolCount: number, newCap: number, refillThresholdDays: number): boolean {
  return pendingPoolCount < newCap * refillThresholdDays;
}
