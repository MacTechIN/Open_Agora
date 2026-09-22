import { NextRequest, NextResponse } from "next/server";
import { migrate, requireDb } from "@/lib/db";
import { contentId, validateCard, validatePolicy, ValidationError } from "@/lib/validate";
import { fail, normalize } from "@/lib/api";
import { isMember, migrateAuth } from "@/lib/auth";
import { resolveCreatedAt, verifyOpinionSignature, verifyPolicySignature } from "@/lib/authorship";

export const dynamic = "force-dynamic";

/** 광장 목록 — 안건과 찬반 분포를 한 질의로 집계한다. */
export async function GET() {
  try {
    await migrate();
    const db = requireDb();
    const rows = await db`
      SELECT p.*,
             COALESCE(COUNT(*) FILTER (WHERE c.stance = 'SUPPORT'), 0)::int      AS support_count,
             COALESCE(COUNT(*) FILTER (WHERE c.stance = 'ALTERNATIVE'), 0)::int  AS alternative_count,
             COALESCE(COUNT(*) FILTER (WHERE c.stance = 'OPPOSE'), 0)::int       AS oppose_count,
             COALESCE(MAX(c.created_at), p.created_at)::bigint                   AS last_activity_at
        FROM policies p
        LEFT JOIN cards c ON c.policy_id = p.id
       GROUP BY p.id
       ORDER BY COALESCE(MAX(c.created_at), p.created_at) DESC
       LIMIT 100`;
    return NextResponse.json(rows.map(normalize));
  } catch (error) {
    return fail(error);
  }
}

/**
 * 주제를 열고 첫 의견을 함께 등록한다.
 *
 * 둘을 한 트랜잭션으로 묶는다. 주제만 남고 의견이 실패하면 토론이 빈 상태로
 * 시작되고, 여는 사람이 자기 입장을 밝히지 않은 채 주제만 던지게 된다.
 */
export async function POST(request: NextRequest) {
  try {
    // 검증을 DB 접근보다 먼저 한다. 잘못된 입력에 DB 왕복을 쓸 이유가 없고,
    // 저장소가 막혀 있을 때도 사용자는 자기 입력 문제를 먼저 알아야 한다.
    const body = await request.json();
    const authorDid = String(body.author_did ?? "").trim();
    if (!authorDid.startsWith("did:key:")) {
      throw new ValidationError("시민 ID가 필요합니다");
    }

    const policy = validatePolicy(body.policy ?? {});
    const card = validateCard(body.first_opinion ?? {});
    // 시각을 클라이언트가 정한다. 서명이 시각을 덮어야 하기 때문이다
    // (lib/authorship.ts). 대신 허용 범위를 좁게 본다.
    const now = resolveCreatedAt(body.created_at);

    await migrate();
    await migrateAuth();

    // 등록된 시민만 글을 쓸 수 있다. 신원 자체는 익명이지만 아무나 쓸 수는 없다.
    if (!(await isMember(authorDid))) {
      throw new ValidationError("글을 쓰려면 먼저 시민 인증을 해 주세요.");
    }

    // 서명 확인을 저장보다 먼저 한다. 서명이 맞지 않는 글은 저장하지 않는다 —
    // 저장한 뒤 표시만 달리하면 이미 운영자가 고칠 수 있는 자리에 들어간 것이다.
    const policySignature = verifyPolicySignature(
      { ...policy, author_did: authorDid, created_at: now },
      body.policy_signature
    );

    const policyId = await contentId([
      authorDid, String(now), policy.title, policy.background, policy.core_question,
    ]);
    const cardId = await contentId([
      policyId, authorDid, String(now), card.stance,
      card.problem_definition, card.evidence_source, card.evidence_url, card.actionable_solution,
    ]);

    const opinionSignature = verifyOpinionSignature(
      { ...card, policy_id: policyId, author_did: authorDid, created_at: now },
      body.opinion_signature
    );

    const db = requireDb();
    await db.begin(async (tx) => {
      await tx`
        INSERT INTO policies (id, title, category, background, core_question,
                              official_source_url, target_agency, author_did, created_at,
                              signature)
        VALUES (${policyId}, ${policy.title}, ${policy.category}, ${policy.background},
                ${policy.core_question}, ${policy.official_source_url},
                ${policy.target_agency}, ${authorDid}, ${now}, ${policySignature})
        ON CONFLICT (id) DO NOTHING`;
      await tx`
        INSERT INTO cards (id, policy_id, stance, problem_definition, evidence_source,
                           evidence_url, actionable_solution, author_did, created_at,
                           signature)
        VALUES (${cardId}, ${policyId}, ${card.stance}, ${card.problem_definition},
                ${card.evidence_source}, ${card.evidence_url},
                ${card.actionable_solution}, ${authorDid}, ${now}, ${opinionSignature})
        ON CONFLICT (id) DO NOTHING`;
    });

    return NextResponse.json({ policy_id: policyId }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
