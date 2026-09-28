import { NextRequest, NextResponse } from "next/server";
import { collect, render } from "@/lib/brief";
import { migrate } from "@/lib/db";
import { migrateReplies } from "@/lib/replies";
import { migrateConsensus } from "@/lib/consensus";
import { migrateMap } from "@/lib/opinionmap";
import { migrateAnchor } from "@/lib/anchor";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * 정책 권고서 (VS-H1).
 *
 * `?format=txt` 면 내려받기용 평문으로 줍니다. 그 밖에는 JSON 입니다.
 *
 * **누구나 받을 수 있습니다.** 이 문서는 공론장의 집계 결과이고, 집계는
 * 이미 공개되어 있습니다. 문서로 묶었다고 감출 이유가 없습니다.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await migrate();
    await migrateReplies();
    await migrateConsensus();
    await migrateMap();
    await migrateAnchor();

    const { id } = await params;
    const data = await collect(id);
    if (!data) {
      return NextResponse.json({ error: "없는 주제입니다" }, { status: 404 });
    }

    const base = request.nextUrl.origin;
    const markdown = render(data, base);

    const format = request.nextUrl.searchParams.get("format");
    // 파일 이름에 제목을 넣으면 한글이 헤더에서 깨진다. 식별자만 쓴다.
    const name = `civicagora-brief-${id.slice(0, 12)}`;

    if (format === "docx") {
      const { toDocx } = await import("@/lib/brief-docx");
      const bytes = await toDocx(markdown);
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${name}.docx"`,
        },
      });
    }

    if (format === "txt") {
      return new NextResponse(markdown, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}.txt"`,
        },
      });
    }

    return NextResponse.json({
      eligible: data.eligible,
      gates: data.gates,
      participants: data.participants,
      opinions: data.opinions,
      replies: data.replies,
      clusters: data.clusters,
      convergence: data.convergence,
      consensus_count: data.consensus.length,
      markdown,
    });
  } catch (error) {
    return fail(error);
  }
}
