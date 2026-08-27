// DESIGN §6 AI 질문 프록시 클라이언트 — '선생님한테 질문' 기능. contentSync.ts의 fetchSheetCsv와
// 같은 방식으로 supabase.functions.invoke를 호출하고, Edge Function이 { error } JSON으로 돌려주는
// 상세 사유를 꺼내 보여준다. Supabase 미설정(로컬 전용 모드)이면 이 기능 자체를 쓸 수 없다.
import { supabase } from "./supabase";

export interface AskTeacherContext {
  promptKo: string;
  answerEn: string;
  chunkNote?: string;
}

export type AiModel = "claude" | "gemini" | "gpt";

export async function askTeacher(
  model: AiModel,
  question: string,
  context: AskTeacherContext
): Promise<string> {
  if (!supabase) {
    throw new Error("이 기능은 클라우드 로그인 상태에서만 사용할 수 있어요.");
  }

  const { data, error } = await supabase.functions.invoke("ask-teacher-proxy", {
    body: { model, question, context },
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
