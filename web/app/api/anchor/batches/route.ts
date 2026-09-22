import { NextResponse } from "next/server";
import { migrateAnchor } from "@/lib/anchor";
import { requireDb } from "@/lib/db";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** 앵커 배치 목록 (VS-F6). 최신순. */
export async function GET() {
  try {
    await migrateAnchor();
    const db = requireDb();
    const rows = await db`
      SELECT b.id, b.root, b.leaf_count, b.period_start, b.period_end,
             b.created_at, b.ots_status, b.chain_tx,
             COALESCE(ARRAY_AGG(r.calendar) FILTER (WHERE r.calendar IS NOT NULL), '{}') AS calendars
        FROM anchor_batches b
        LEFT JOIN anchor_receipts r ON r.batch_id = b.id
       GROUP BY b.id
       ORDER BY b.id DESC
       LIMIT 200`;
    // BIGINT 는 정밀도 손실을 막으려 문자열로 온다. 화면과 CLI 가 숫자로
    // 쓰므로 여기서 바꾼다 — lib/api.ts 의 normalize 는 created_at 만 본다.
    return NextResponse.json(rows.map((row) => ({
      ...row,
      leaf_count: Number(row.leaf_count),
      period_start: Number(row.period_start),
      period_end: Number(row.period_end),
      created_at: Number(row.created_at),
    })));
  } catch (error) {
    return fail(error);
  }
}
