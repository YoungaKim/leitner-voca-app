// AI 질문 답변 등 짧은 마크다운 텍스트를 렌더한다. 외부 라이브러리 없이,
// 이 앱에서 실제로 쓰이는 부분집합만 처리한다: 문단, #~#### 제목, - / * / 1. 목록,
// **굵게**, *기울임* / _기울임_, `코드`, 문단 내 줄바꿈.
// raw HTML은 지원하지 않는다(그대로 텍스트로 노출 → XSS 없음).
import { Fragment, type ReactNode } from "react";

/** 한 줄 안의 인라인 문법(**굵게**, *기울임*, `코드`)을 React 노드로 변환. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // 굵게 → 코드 → 기울임 순으로 매칭. 기울임은 ** 를 건드리지 않도록 뒤에 둔다.
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|_([^_]+)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined) nodes.push(<strong key={`${keyPrefix}-${i}`}>{m[2]}</strong>);
    else if (m[3] !== undefined) nodes.push(<code key={`${keyPrefix}-${i}`}>{m[3]}</code>);
    else nodes.push(<em key={`${keyPrefix}-${i}`}>{m[4] ?? m[5]}</em>);
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

interface Props {
  text: string;
  className?: string;
}

export default function Markdown({ text, className }: Props) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushPara = () => {
    if (!para.length) return;
    const joined = para.join("\n");
    blocks.push(
      <p key={key++}>
        {joined.split("\n").map((ln, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {renderInline(ln, `p${key}-${i}`)}
          </Fragment>
        ))}
      </p>
    );
    para = [];
  };

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{renderInline(it, `li${key}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushPara();
      flushList();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      const Tag = (["h3", "h4", "h5", "h6"][level - 1] ?? "h6") as "h3" | "h4" | "h5" | "h6";
      blocks.push(<Tag key={key++}>{renderInline(heading[2], `h${key}`)}</Tag>);
      continue;
    }

    const ul = /^[-*•]\s+(.*)$/.exec(trimmed);
    const ol = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (ul || ol) {
      flushPara();
      const ordered = Boolean(ol);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((ul ? ul[1] : ol![1]).trim());
      continue;
    }

    // 목록 항목의 이어지는 줄(들여쓰기된 연속 텍스트)은 마지막 항목에 붙인다.
    if (list && /^\s+\S/.test(rawLine)) {
      list.items[list.items.length - 1] += ` ${trimmed}`;
      continue;
    }

    flushList();
    para.push(trimmed);
  }
  flushPara();
  flushList();

  return <div className={className}>{blocks}</div>;
}
