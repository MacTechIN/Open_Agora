import { NextRequest, NextResponse } from "next/server";
import { addReply, migrateReplies, repliesFor } from "@/lib/replies";
import { contentId, validateReply, ValidationError } from "@/lib/validate";
import { migrate, requireDb } from "@/lib/db";
import { fail } from "@/lib/api";
import { isMember, migrateAuth } from "@/lib/auth";
import { resolveCreatedAt } from "@/lib/authorship";
import { checkSignature } from "@/lib/verify.ts";
import { replyPayload } from "@/lib/signing.ts";

export const dynamic = "force-dynamic";

/** 한 카드의 댓글 목록. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await migrate();
    await migrateReplies();
    const { id } = await params;
    return NextResponse.json({ replies: (await repliesFor([id]))[id] ?? [] });
  } catch (error) {
    return fail(error);
  }
}

/**
 * 댓글을 단다 (VS-D3).
 *
 * **댓글의 댓글은 없습니다.** 부모를 받는 자리가 없으므로 한 단계로 고정됩니다.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const authorDid = String(body.author_did ?? "").trim();
    if (!authorDid.startsWith("did:key:")) {
      throw new ValidationError("시민 ID가 필요합니다");
    }
    const reply = validateReply(body);
    const now = resolveCreatedAt(body.created_at);

    await migrate();
    await migrateAuth();
    await migrateReplies();

    // 등록된 시민만 글을 쓸 수 있다. 댓글도 글이다.
    if (!(await isMember(authorDid))) {
      throw new ValidationError("글을 쓰려면 먼저 시민 인증을 해 주세요.");
    }

    const db = requireDb();
    const [card] = await db`SELECT id FROM cards WHERE id = ${id}`;
    if (!card) throw new ValidationError("없는 의견입니다");

    // 서명 확인을 저장보다 먼저 한다. 서명이 맞지 않는 글은 저장하지 않는다.
    const signature = String(body.signature ?? "").trim() || null;
    if (signature) {
      const payload = replyPayload({
        card_id: id, author_did: authorDid, created_at: now, body: reply.body,
      });
      const verdict = checkSignature(authorDid, payload, signature);
      if (verdict !== "valid") {
        throw new ValidationError("댓글의 서명이 내용과 맞지 않습니다. 저장하지 않았습니다.");
      }
    }

    const replyId = await contentId([id, authorDid, String(now), reply.body]);
    await addReply({
      id: replyId, card_id: id, body: reply.body,
      author_did: authorDid, created_at: now, signature,
    });

    return NextResponse.json({ reply_id: replyId }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
