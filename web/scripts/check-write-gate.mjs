/**
 * 글쓰기 경로에 회원 확인이 빠지지 않았는지 검사한다.
 *
 * 등록된 시민만 글을 쓸 수 있다는 것이 이 플랫폼의 전제다. 새 쓰기 경로를
 * 추가하면서 확인을 잊으면 아무나 글을 쓸 수 있게 되는데, 겉보기에는
 * 정상 동작하므로 알아채기 어렵다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const apiDir = join(root, "app/api");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name === "route.ts") out.push(full);
  }
  return out;
}

// 인증 경로 자체는 회원이 아닌 사람이 쓰는 곳이므로 제외한다.
const EXEMPT = ["app/api/auth/"];

let failed = 0;
for (const file of walk(apiDir)) {
  const rel = relative(root, file).replace(/\\/g, "/");
  if (EXEMPT.some((e) => rel.startsWith(e))) continue;

  const source = readFileSync(file, "utf8");
  const writes = /export\s+async\s+function\s+(POST|PUT|PATCH)\b/.test(source);
  if (!writes) continue;

  if (!source.includes("isMember")) {
    console.error(`  FAIL ${rel}  쓰기 경로에 회원 확인(isMember)이 없습니다`);
    failed += 1;
  } else {
    console.log(`  OK   ${rel}`);
  }
}

if (failed > 0) {
  console.error(`\n회원 확인이 빠진 쓰기 경로 ${failed}건.`);
  process.exit(1);
}
console.log("  OK   모든 쓰기 경로에 회원 확인이 있음");
