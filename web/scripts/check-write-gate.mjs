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
 * 주석을 걷어낸다.
 *
 * 이것이 없어서 오래 속고 있었다. "회원 확인(isMember)을 쓰지 않습니다"라고
 * 적은 **주석** 때문에 검사가 통과했다. 게이트가 코드가 아니라 산문을 보고
 * 있었던 것이다.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

/**
 * 영지식 증명으로 인증하는 경로.
 *
 * 회원 확인(isMember)을 **쓰면 안 되는** 곳이다. DID 로 사람을 특정하는
 * 방식이라, 익명이어야 하는 행동에 쓰면 누가 무엇을 했는지가 남는다.
 *
 * 대신 증명을 검증하는 함수를 부르는지 본다. 이름만 여기 적으면 통과하는
 * 면제가 아니라, **실제로 그 함수를 부르는지**까지 확인한다.
 */
const PROOF_AUTHENTICATED = {
  "app/api/policies/[id]/endorse/route.ts": "act",
  "app/api/cards/[id]/react/route.ts": "react",
  "app/api/opinion-map/me/route.ts": "myPosition",
};

/**
 * 사용자 글이 아니라 **운영이 부르는** 쓰기 경로.
 *
 * 회원 확인 대신 비밀값으로 잠근다. 통째로 면제하지 않고 어떤 비밀값을 써야
 * 하는지까지 적는 이유는, 잠그지 않은 운영 경로도 여기 적기만 하면 통과하는
 * 일을 막기 위해서다.
 */
const OPERATOR = {
  "app/api/anchor/build/route.ts": "ANCHOR_SECRET",
  "app/api/bridging/scores/route.ts": "BRIDGING_SECRET",
  "app/api/opinion-map/route.ts": "BRIDGING_SECRET",
};

let failed = 0;
for (const file of walk(apiDir)) {
  const rel = relative(root, file).replace(/\\/g, "/");
  if (EXEMPT.some((e) => rel.startsWith(e))) continue;

  const source = stripComments(readFileSync(file, "utf8"));
  const writes = /export\s+async\s+function\s+(POST|PUT|PATCH)\b/.test(source);
  if (!writes) continue;

  const verifier = PROOF_AUTHENTICATED[rel];
  if (verifier) {
    if (new RegExp(`\\b${verifier}\\s*\\(`).test(source)) {
      console.log(`  OK   ${rel}  (증명 인증 — ${verifier} 호출)`);
    } else {
      console.error(`  FAIL ${rel}  증명 인증 경로인데 ${verifier} 를 부르지 않습니다`);
      failed += 1;
    }
    continue;
  }

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
