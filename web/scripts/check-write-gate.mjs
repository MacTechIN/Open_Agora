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

/**
 * 사용자 글이 아니라 **운영이 부르는** 쓰기 경로.
 *
 * 회원 확인 대신 비밀값으로 잠근다. 통째로 면제하지 않고 어떤 비밀값을 써야
 * 하는지까지 적는 이유는, 잠그지 않은 운영 경로도 여기 적기만 하면 통과하는
 * 일을 막기 위해서다.
 */
const OPERATOR = {
  "app/api/anchor/build/route.ts": "ANCHOR_SECRET",
};

let failed = 0;
for (const file of walk(apiDir)) {
  const rel = relative(root, file).replace(/\\/g, "/");
  if (EXEMPT.some((e) => rel.startsWith(e))) continue;

  const source = readFileSync(file, "utf8");
  const writes = /export\s+async\s+function\s+(POST|PUT|PATCH)\b/.test(source);
  if (!writes) continue;

  const secret = OPERATOR[rel];
  if (secret) {
    if (source.includes(secret)) {
      console.log(`  OK   ${rel}  (운영 경로 — ${secret} 로 잠김)`);
    } else {
      console.error(`  FAIL ${rel}  운영 경로인데 ${secret} 확인이 없습니다`);
      failed += 1;
    }
    continue;
  }

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
