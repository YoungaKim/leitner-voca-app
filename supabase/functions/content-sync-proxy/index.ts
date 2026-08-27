// 2d 콘텐츠 동기화 프록시 — 공식 Google Sheets API(v4)로 시트 값을 읽어와 CSV 텍스트로 변환해 돌려준다.
//
// 이전 버전은 "웹에 게시 > CSV" 방식(docs.google.com/.../pub?output=csv)을 그대로 fetch했는데,
// Supabase Edge Function(Deno Deploy) 서버 IP에서 구글이 CSV 대신 사람이 보는 pubhtml 뷰어
// 페이지를 계속 돌려주는 문제가 있었다(브라우저 fetch도 마찬가지로 막힘, curl은 됨 — IP 평판성
// 이슈로 추정, 재시도로도 해결 안 됨). 공식 API(sheets.googleapis.com)는 그런 안티스크래핑
// 휴리스틱 대상이 아니라 안정적으로 동작한다.
//
// 필요한 환경: GOOGLE_SHEETS_API_KEY 시크릿(Edge Functions > Secrets에 등록), 대상 시트는
// "공유 > 일반 액세스 > 링크가 있는 모든 사용자(뷰어)"로 설정돼있어야 함(API 키만으로 읽으려면
// 필수 — "웹에 게시"와는 별개 설정).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extractSpreadsheetId(url: string): string | null {
  // 일반 공유/편집 링크: https://docs.google.com/spreadsheets/d/{ID}/edit?...
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url);
  return m ? m[1] : null;
}

/** 셀 값 배열(행 단위)을 CSV 텍스트로 직렬화. 콤마/따옴표/줄바꿈 포함 시 따옴표로 감싸고 이스케이프. */
function rowsToCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell ?? "";
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("GOOGLE_SHEETS_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "서버에 GOOGLE_SHEETS_API_KEY가 설정돼있지 않습니다." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { url } = await req.json();
    if (typeof url !== "string" || !/^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(url)) {
      return new Response(
        JSON.stringify({ error: "허용되지 않은 URL입니다 (구글시트 공유 링크만 가능)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const spreadsheetId = extractSpreadsheetId(url);
    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: "URL에서 스프레드시트 ID를 찾지 못했습니다." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) 첫 번째 시트(탭) 이름 조회
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title&key=${apiKey}`
    );
    if (!metaRes.ok) {
      const body = await metaRes.text();
      return new Response(
        JSON.stringify({ error: `시트 정보 조회 실패(HTTP ${metaRes.status}): ${body.slice(0, 300)}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const meta = await metaRes.json();
    const sheetTitle = meta?.sheets?.[0]?.properties?.title;
    if (!sheetTitle) {
      return new Response(JSON.stringify({ error: "시트 탭을 찾지 못했습니다." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) 값 조회
    const valuesRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetTitle)}?key=${apiKey}`
    );
    if (!valuesRes.ok) {
      const body = await valuesRes.text();
      return new Response(
        JSON.stringify({ error: `시트 값 조회 실패(HTTP ${valuesRes.status}): ${body.slice(0, 300)}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const data = await valuesRes.json();
    const rows: string[][] = data.values ?? [];
    const csv = rowsToCsv(rows);

    return new Response(csv, {
      headers: { ...corsHeaders, "Content-Type": "text/csv; charset=utf-8" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
