/**
 * contracts/ 의 계약 파일을 web/lib/generated/ 로 복사한다.
 *
 * 웹이 상위 디렉터리를 import 하면 호스팅 환경에 따라 빌드가 깨진다
 * (Root Directory 를 web 으로 잡으면 그 바깥이 보이지 않을 수 있다).
 * 복사본을 저장소에 함께 커밋해 web 패키지를 자족적으로 만든다.
 *
 * 복사본이 원본과 갈리지 않도록 CI가 이 스크립트를 --check 로 돌린다.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "../../contracts");
const target = join(here, "../lib/generated");
const files = ["limits.json", "validation-fixtures.json", "signing-vectors.json",
               "anchor-vectors.json",
               "screening-vectors.json"];
const check = process.argv.includes("--check");

mkdirSync(target, { recursive: true });

let stale = 0;
for (const name of files) {
  const from = readFileSync(join(source, name), "utf8");
  if (check) {
    let to = "";
    try { to = readFileSync(join(target, name), "utf8"); } catch { /* 없음 */ }
    if (from !== to) {
      console.error(`  FAIL ${name} — 복사본이 contracts/ 와 다릅니다`);
      stale += 1;
    } else {
      console.log(`  OK   ${name}`);
    }
  } else {
    writeFileSync(join(target, name), from);
    console.log(`  복사 ${name}`);
  }
}

if (check && stale > 0) {
  console.error("\nweb/scripts/sync-contracts.mjs 를 실행해 복사본을 갱신하십시오.");
  process.exit(1);
}
if (check) console.log("\n계약 복사본 최신");
