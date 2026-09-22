import { NextRequest, NextResponse } from "next/server";
import { migrateAnchor } from "@/lib/anchor";
import { requireDb } from "@/lib/db";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * 배치의 OpenTimestamps 영수증 (VS-F6).
 *
 * 표준 `.ots` 파일을 그대로 내려준다. 공식 도구로 검증할 수 있어야 하기
 * 때문이다 — 우리가 만든 검증기를 믿어야 한다면 앵커링의 뜻이 없다.
 *
 *   ots verify --digest <루트> batch-7.ots
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await migrateAnchor();
    const { id } = await params;
    const batchId = Number(id);
    if (!Number.isInteger(batchId)) {
      return NextResponse.json({ error: "배치 번호가 올바르지 않습니다" }, { status: 400 });
    }

    const calendar = request.nextUrl.searchParams.get("calendar");
    const db = requireDb();
    const rows = calendar
      ? await db`SELECT * FROM anchor_receipts WHERE batch_id = ${batchId} AND calendar = ${calendar}`
      : await db`SELECT * FROM anchor_receipts WHERE batch_id = ${batchId} ORDER BY calendar LIMIT 1`;

    const [row] = rows;
    if (!row) {
      return NextResponse.json({ error: "영수증이 없습니다" }, { status: 404 });
    }

    return new NextResponse(Buffer.from(row.receipt as string, "base64"), {
      headers: {
        "Content-Type": "application/vnd.opentimestamps.ots",
        "Content-Disposition": `attachment; filename="civicagora-batch-${batchId}.ots"`,
      },
    });
  } catch (error) {
    return fail(error);
  }
}
