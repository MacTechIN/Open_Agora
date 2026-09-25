/**
 * 내 위치 조회 (VS-F4) — 서버 전용.
 *
 * 라우트가 필명을 다루지 않도록 여기서 감쌉니다. 필명이 화면·라우트 쪽
 * 코드에 나타나면 `check-no-reactor-list.mjs` 가 막습니다 — 한 줄만 새어도
 * 그것이 곧 "타인의 위치 조회" 경로가 되기 때문입니다.
 */
import { verifyProof, type SemaphoreProof } from "@semaphore-protocol/proof";
import { requireDb } from "./db.ts";
import { migrateAnon } from "./anon.ts";
import { positionOf } from "./opinionmap.ts";
import { PSEUDONYM_SCOPE } from "./scope.ts";

export type MyPosition =
  | { ok: true; position: { x: number; y: number; cluster: number } | null }
  | { ok: false; reason: string };

export async function myPosition(proof: SemaphoreProof): Promise<MyPosition> {
  await migrateAnon();
  const db = requireDb();

  // 반응과 같은 scope 여야 한다. 그래야 나오는 필명이 반응에 쓴 것과 같다.
  if (String(proof?.scope) !== PSEUDONYM_SCOPE) {
    return { ok: false, reason: "증명의 용도가 다릅니다" };
  }

  const [known] = await db`
    SELECT 1 FROM anon_roots WHERE root = ${String(proof.merkleTreeRoot)}`;
  if (!known) {
    return { ok: false, reason: "회원 명부가 바뀌었습니다. 새로고침 후 다시 시도해 주세요." };
  }
  if (!(await verifyProof(proof))) {
    return { ok: false, reason: "증명이 유효하지 않습니다" };
  }

  // 아직 군집화에 들어가지 않았으면 null 이다 — 반응이 모자라거나 배치가
  // 아직 돌지 않은 것이고, 둘 다 오류가 아니다.
  return { ok: true, position: await positionOf(String(proof.nullifier)) };
}
