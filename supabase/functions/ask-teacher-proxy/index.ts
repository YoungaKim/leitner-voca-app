// DESIGN §6 AI 질문 프록시 ("선생님한테 질문") — 학습 세션에서 카드 컨텍스트 기반 1회성 Q&A.
// content-sync-proxy와 같은 이유로 서버 프록시를 둔다: API 키(ANTHROPIC_API_KEY / GEMINI_API_KEY /
// OPENAI_API_KEY)를 클라이언트에 절대 노출하지 않고 Edge Function 시크릿으로만 보관한다.
//
// 요청: { model: "claude" | "gemini" | "gpt", question: string, context: { promptKo, answerEn, chunkNote? } }
// 응답: 성공 시 { answer: string } (200), 실패 시 { error: string } + 4xx/5xx.
// 대화 히스토리는 저장하지 않는다 — 매 요청은 카드 컨텍스트를 새로 포함한 독립적인 1문 1답이다.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CardContext {
  promptKo: string;
  answerEn: string;
  chunkNote?: string;
  /** 학습자가 이번 카드에서 직접 입력한 영어 답안(있을 때만). 첨삭 요청에 쓰인다. */
  userAnswer?: string;
}

/** "?", "??", "?????" 처럼 물음표(전각 포함)·공백만 있는 입력 → 답안 첨삭 요청으로 해석한다. */
function isBareCorrectionRequest(question: string): boolean {
  return /^[?？\s]+$/.test(question);
}

function buildPrompt(question: string, context: CardContext): string {
  const bareCorrection = isBareCorrectionRequest(question);
  return [
    "당신은 토익 문장 암기 학습자를 돕는 영어 선생님입니다.",
    "아래는 학습자가 방금 풀던 문장 카드입니다.",
    `- 한글 제시문: ${context.promptKo}`,
    `- 영어 정답 문장: ${context.answerEn}`,
    context.chunkNote ? `- 청크·문법 메모: ${context.chunkNote}` : null,
    context.userAnswer
      ? `- 학습자가 이번에 직접 입력한 답안: ${context.userAnswer}`
      : null,
    "",
    bareCorrection
      ? '학습자가 물음표만 입력했습니다. 이는 "내 답이 왜 틀렸는지 설명하고 첨삭해 달라"는 뜻입니다.'
      : `학습자의 질문: ${question}`,
    "",
    bareCorrection && context.userAnswer
      ? '위의 "학습자가 직접 입력한 답안"을 정답 문장과 단어 단위로 비교하세요. (1) 무엇이 틀렸고 왜 틀렸는지, (2) 맞은 부분, (3) 고친 문장을 순서대로 짚어 주세요. 틀린 곳이 없으면 정답이라고 알려 주세요.'
      : bareCorrection
        ? "학습자가 입력한 답안 정보가 없습니다. 정답 문장의 핵심 문법·표현 포인트를 짚어 설명해 주세요."
        : null,
    !bareCorrection && context.userAnswer
      ? '학습자가 "내 답변 수정해줘", "내 답은 틀려?" 같은 요청을 하면, 위의 "학습자가 직접 입력한 답안"을 기준으로 첨삭하세요. 정답 문장과 비교해 무엇이 맞고 무엇이 틀렸는지, 어떻게 고치면 되는지 구체적으로 짚어 주세요.'
      : null,
    "이 카드 맥락에 맞춰 한국어로 간결하고 명확하게 답변하세요.",
    "다음 규칙을 지키세요:",
    '- 인사말("안녕하세요")이나 자기소개("~선생님입니다")로 시작하지 말고 곧바로 본론부터 답하세요.',
    '- "잘 살펴봤어요", "아주 좋아요", "거의 완벽하게 잘 쓰셨어요" 같은 습관적인 인사치례·빈말은 쓰지 마세요.',
    "- 칭찬은 정말로 인상적인 부분이 있을 때만, 무엇이 왜 좋은지 구체적으로 짚어서 하세요. 그런 부분이 없으면 칭찬하지 마세요.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

async function askClaude(question: string, context: CardContext, apiKey: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content: buildPrompt(question, context) }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API 실패(HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("Claude 응답 형식이 올바르지 않습니다.");
  return text;
}

async function askGemini(question: string, context: CardContext, apiKey: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(question, context) }] }],
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API 실패(HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new Error("Gemini 응답 형식이 올바르지 않습니다.");
  return text;
}

async function askGpt(question: string, context: CardContext, apiKey: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: buildPrompt(question, context) }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GPT API 실패(HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("GPT 응답 형식이 올바르지 않습니다.");
  return text;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { model, question, context, apiKey: userApiKey } = await req.json();

    if (model !== "claude" && model !== "gemini" && model !== "gpt") {
      return new Response(JSON.stringify({ error: "model은 'claude', 'gemini', 'gpt' 중 하나여야 합니다." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof question !== "string" || !question.trim()) {
      return new Response(JSON.stringify({ error: "질문을 입력해주세요." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!context || typeof context.promptKo !== "string" || typeof context.answerEn !== "string") {
      return new Response(JSON.stringify({ error: "카드 컨텍스트가 올바르지 않습니다." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 사용자가 설정에서 입력한 모델별 API 키가 오면 그걸 우선 사용하고, 없으면 서버 공용 시크릿으로 fallback.
    const secretName =
      model === "claude" ? "ANTHROPIC_API_KEY" : model === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
    const apiKey =
      (typeof userApiKey === "string" && userApiKey.trim()) || Deno.env.get(secretName);
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: `${model} API 키가 없습니다. 설정에서 직접 입력하거나 서버에 ${secretName}를 설정하세요.` }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const answer =
      model === "claude"
        ? await askClaude(question, context, apiKey)
        : model === "gemini"
          ? await askGemini(question, context, apiKey)
          : await askGpt(question, context, apiKey);

    return new Response(JSON.stringify({ answer }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
