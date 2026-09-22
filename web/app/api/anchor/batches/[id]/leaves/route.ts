import { NextResponse } from "next/server";
import { migrateAnchor } from "@/lib/anchor";
import { requireDb } from "@/lib/db";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * 배치의 잎 목록 전부 (VS-F6).
 *
 * **공개합니다.** 앵커는 루트가 그때 존재했다만 말하므로, 나중에 운영자가
 * 글과 잎을 함께 지우면 아무도 그것을 되살려 증명할 수 없습니다. 잎 목록을
 * 누구나 내려받아 보관할 수 있어야 그 구멍이 메워집니다.
 *
 * 보관해 두면 나중에 이 서버가 협조하지 않아도 루트를 직접 다시 계산해
 * 비트코인 영수증과 대조할 수 있습니다.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await migrateAnchor();
    const { id } = await params;
    const batchId = Number(id);
    if (!Number.isInteger(batchId)) {
      return NextResponse.json({ error: "배치 번호가 올바르지 않습니다" }, { status: 400 });
    }

    const db = requireDb();
    const [batch] = await db`SELECT root, leaf_count FROM anchor_batches WHERE id = ${batchId}`;
    if (!batch) return NextResponse.json({ error: "없는 배치입니다" }, { status: 404 });

    const leaves = await db`
      SELECT position, kind, item_id, leaf FROM anchor_leaves
       WHERE batch_id = ${batchId} ORDER BY position`;

    return NextResponse.json({
      batch_id: batchId,
      root: batch.root,
      leaf_count: Number(batch.leaf_count),
      // 순서가 증명의 일부다. position 을 함께 주어 다시 계산할 수 있게 한다.
      leaves: leaves.map((l) => ({
        position: Number(l.position),
        kind: l.kind,
        item_id: l.item_id,
        leaf: l.leaf,
      })),
    });
  } catch (error) {
    return fail(error);
  }
}
