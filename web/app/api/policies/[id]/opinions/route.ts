import { NextRequest, NextResponse } from "next/server";
import { migrate, requireDb } from "@/lib/db";
import { contentId, validateCard, ValidationError } from "@/lib/validate";
import { fail } from "@/lib/api";
import { isMember, migrateAuth } from "@/lib/auth";
import { resolveCreatedAt, verifyOpinionSignature } from "@/lib/authorship";

export const dynamic = "force-dynamic";

/** 기존 주제에 의견을 추가한다. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 검증이 먼저다 (같은 이유 — app/api/policies/route.ts 참조).
    const { id } = await params;
    const body = await request.json();
    const authorDid = String(body.author_did ?? "").trim();
    if (!authorDid.startsWith("did:key:")) {
      throw new ValidationError("시민 ID가 필요합니다");
    }
    const card = validateCard(body);

    await migrate();
    await migrateAuth();

    // 등록된 시민만 글을 쓸 수 있다 (app/api/policies/route.ts 와 같은 이유).
    if (!(await isMember(authorDid))) {
      throw new ValidationError("글을 쓰려면 먼저 시민 인증을 해 주세요.");
    }

    const db = requireDb();
    // 없는 주제에 의견을 달면 어디에도 보이지 않는 글이 된다.
    const [policy] = await db`SELECT id FROM policies WHERE id = ${id}`;
    if (!policy) throw new ValidationError("없는 주제입니다");

    const now = resolveCreatedAt(body.created_at);
    // 서명 확인을 저장보다 먼저 한다.
    const signature = verifyOpinionSignature(
      { ...card, policy_id: id, author_did: authorDid, created_at: now },
      body.signature
    );

    const cardId = await contentId([
      id, authorDid, String(now), card.stance,
      card.problem_definition, card.evidence_source, card.evidence_url, card.actionable_solution,
    ]);

    await db`
      INSERT INTO cards (id, policy_id, stance, problem_definition, evidence_source,
                         evidence_url, actionable_solution, author_did, created_at,
                         signature)
      VALUES (${cardId}, ${id}, ${card.stance}, ${card.problem_definition},
              ${card.evidence_source}, ${card.evidence_url},
              ${card.actionable_solution}, ${authorDid}, ${now}, ${signature})
      ON CONFLICT (id) DO NOTHING`;

    return NextResponse.json({ card_id: cardId }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
