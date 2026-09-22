/**
 * 검증 — Rust 코어와 같은 규칙.
 *
 * 한도는 contracts/limits.json 한 곳에서 온다. 규칙 자체는 두 언어로 구현할
 * 수밖에 없으므로, 어느 한쪽만 고치는 일이 없도록 이 파일과
 * core/src/card.rs 를 함께 본다.
 */
import { LIMITS, graphemeCount } from "./limits";
import type { Category, Stance } from "./types";

export class ValidationError extends Error {}

function field(label: string, value: string, limit: number): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) throw new ValidationError(`${label}을(를) 입력해야 합니다`);
  const count = graphemeCount(trimmed);
  if (count > limit) {
    // 한도만 알려주면 얼마나 줄여야 하는지 알 수 없다.
    throw new ValidationError(
      `${label}이(가) ${limit}자를 넘습니다 (현재 ${count}자)`
    );
  }
  return trimmed;
}

/**
 * 출처 URL을 검증한다.
 *
 * 형식만 본다. 허용 도메인 화이트리스트는 VS-D5에서 붙는다.
 */
function url(value: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) throw new ValidationError("근거 URL은 필수입니다");
  if (trimmed.length > LIMITS.url) {
    throw new ValidationError(`근거 URL이 ${LIMITS.url}자를 넘습니다`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ValidationError("근거 URL이 올바르지 않습니다");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("http:// 또는 https:// 로 시작해야 합니다");
  }
  if (!parsed.hostname.includes(".")) {
    throw new ValidationError("호스트 이름이 올바르지 않습니다");
  }
  return trimmed;
}

const STANCES: Stance[] = ["SUPPORT", "ALTERNATIVE", "OPPOSE"];
const CATEGORIES: Category[] = [
  "GOV_POLICY", "LEGISLATION", "PARTY_POLICY", "LOCAL",
  "PUBLIC_ORG", "SOCIAL_ISSUE", "WHISTLEBLOW",
];

export interface CleanCard {
  stance: Stance;
  problem_definition: string;
  evidence_source: string;
  evidence_url: string;
  actionable_solution: string;
}

export function validateCard(input: Record<string, unknown>): CleanCard {
  const stance = String(input.stance ?? "") as Stance;
  if (!STANCES.includes(stance)) throw new ValidationError("입장을 선택해야 합니다");

  return {
    stance,
    problem_definition: field("논점", String(input.problem_definition ?? ""), LIMITS.card.problemDefinition),
    evidence_source: field("근거", String(input.evidence_source ?? ""), LIMITS.card.evidenceSource),
    evidence_url: url(String(input.evidence_url ?? "")),
    actionable_solution: field("제안", String(input.actionable_solution ?? ""), LIMITS.card.actionableSolution),
  };
}

export interface CleanPolicy {
  title: string;
  category: Category;
  background: string;
  core_question: string;
  official_source_url: string;
  target_agency: string | null;
}

export function validatePolicy(input: Record<string, unknown>): CleanPolicy {
  const category = String(input.category ?? "") as Category;
  if (!CATEGORIES.includes(category)) throw new ValidationError("분류를 선택해야 합니다");

  const agency = String(input.target_agency ?? "").trim();
  return {
    title: field("주제 제목", String(input.title ?? ""), LIMITS.policy.title),
    category,
    background: field("배경", String(input.background ?? ""), LIMITS.policy.background),
    core_question: field("쟁점 질문", String(input.core_question ?? ""), LIMITS.policy.coreQuestion),
    official_source_url: url(String(input.official_source_url ?? "")),
    target_agency: agency || null,
  };
}

/**
 * 식별자를 만든다. 코어와 같은 방식 — 내용 해시.
 *
 * 난수를 쓰지 않으므로 같은 입력이 같은 식별자를 만들고, 버튼을 두 번 눌러도
 * 글이 두 개 생기지 않는다. 필드마다 길이를 함께 넣어 경계가 섞이지 않게 한다.
 */
export async function contentId(parts: string[]): Promise<string> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    const bytes = encoder.encode(part);
    const length = new Uint8Array(8);
    new DataView(length.buffer).setBigUint64(0, BigInt(bytes.length));
    chunks.push(length, bytes);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { joined.set(c, offset); offset += c.length; }

  const digest = await crypto.subtle.digest("SHA-256", joined);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
