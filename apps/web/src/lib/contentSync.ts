// 2d. 콘텐츠 자동 동기화 — DESIGN §3.3~3.8. 구글시트 공유 링크를 서버 프록시로 읽어와 새 id만 저수지로 흡수.
// dedupe는 "덱 하나" 범위가 아니라 계정 전체 범위로 한다 — 이미 카드로 있거나(어느 덱이든)
// 저수지에 있거나(어느 덱이든), syncState.importedIds에 기록된 id는 전부 건너뛴다.
import type { Card, NewPoolItem, SyncState } from "@leitner/core";
import { parseCsv, toNewPoolItems } from "./csv";
import { supabase } from "./supabase";

/**
 * 구글시트 fetch는 Supabase Edge Function(content-sync-proxy) 경유로만 한다.
 * (이력: 원래는 "웹에 게시 > CSV" 링크를 앱이 직접 fetch했으나, 구글이 서버·브라우저 IP의 pub CSV
 *  요청을 안티스크래핑성으로 자주 차단 — CSV 대신 pubhtml 뷰어 HTML 응답 — 실사용 불가로 판명.
 *  프록시가 공식 Google Sheets API v4로 읽는 방식으로 교체. sourceUrl은 "웹에 게시 URL"이 아니라
 *  평범한 구글시트 공유/편집 링크(/d/{ID}/edit)이며, 시트는 "링크가 있는 모든 사용자(뷰어)" 공유 필수.)
 *
 * 비로그인(로컬 전용, supabase == null) 모드에선 프록시를 쓸 수 없다 — 콘텐츠 소스는 클라우드
 * 계정 전제라 이 경로는 애초에 도달하지 않아야 하고, 직접 fetch는 위 이유로 어차피 실패하므로
 * 명확한 에러를 던진다(HTML을 CSV로 잘못 파싱해 이상한 결과가 나오는 것을 방지).
 */
async function fetchSheetCsv(sourceUrl: string): Promise<string> {
  if (!supabase) {
    throw new Error("콘텐츠 동기화는 클라우드 로그인 상태에서만 가능합니다.");
  }
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

export interface ContentSyncResult {
  items: NewPoolItem[]; // 새로 저수지에 넣을 항목
  skipped: number;
  fetchedCount: number;
  errors: string[];
  syncState: SyncState;
}

/** 계정 전체 범위(덱 무관) dedupe 키 집합. */
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
