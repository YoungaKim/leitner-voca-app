// DESIGN §6 AI 질문 프록시 클라이언트 — '선생님한테 질문' 기능. contentSync.ts의 fetchSheetCsv와
// 같은 방식으로 supabase.functions.invoke를 호출하고, Edge Function이 { error } JSON으로 돌려주는
// 상세 사유를 꺼내 보여준다. Supabase 미설정(로컬 전용 모드)이면 이 기능 자체를 쓸 수 없다.
import { supabase } from "./supabase";

export interface AskTeacherContext {
  promptKo: string;
  answerEn: string;
  chunkNote?: string;
  /** 학습자가 이번 카드에서 직접 입력한 영어 답안(있을 때만). 선생님이 이걸 알고 첨삭할 수 있게 함. */
  userAnswer?: string;
}

export type AiModel = "claude" | "gemini" | "gpt";

export async function askTeacher(
  model: AiModel,
  question: string,
  context: AskTeacherContext,
  apiKey?: string
): Promise<string> {
  if (!supabase) {
    throw new Error("이 기능은 클라우드 로그인 상태에서만 사용할 수 있어요.");
  }

  // apiKey가 있으면 서버 공용 키 대신 사용자 키로 호출한다(DESIGN §6). 없으면 서버 시크릿 fallback.
  const { data, error } = await supabase.functions.invoke("ask-teacher-proxy", {
    body: { model, question, context, apiKey: apiKey?.trim() || undefined },
  });

  if (error) {
    const errContext = (error as { context?: Response }).context;
    let detail: string | undefined;
    if (errContext) {
      try {
        const body = await errContext.clone().json();
        if (typeof body?.error === "string") detail = body.error;
      } catch {
        /* JSON 파싱 실패 시 아래 폴백 메시지 사용 */
      }
    }
    throw new Error(detail ?? error.message ?? "질문 요청에 실패했습니다.");
  }

  if (typeof data?.answer !== "string") {
    throw new Error("응답 형식이 올바르지 않습니다.");
  }
  return data.answer;
}
