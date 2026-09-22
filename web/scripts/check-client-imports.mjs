/**
 * 클라이언트 컴포넌트가 서버 전용 모듈을 끌어오지 않는지 검사한다.
 *
 * "use client" 파일이 데이터베이스를 쓰는 모듈을 import 하면 postgres 같은
 * Node 전용 패키지가 브라우저 번들로 끌려가 빌드가 깨진다. 상수 하나를
 * 가져오려다 모듈 전체가 딸려오는 식이라 의도를 알아채기 어렵다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** 서버에서만 쓸 수 있는 모듈. 직접 또는 간접으로 끌어오면 안 된다. */
// lib/verify.ts 는 node:crypto 를, lib/authorship.ts 는 그것을 쓴다.
const SERVER_ONLY = ["@/lib/db", "@/lib/auth", "@/lib/plaza", "@/lib/api", "@/lib/mail",
                     "@/lib/verify", "@/lib/authorship"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".tsx") || name.endsWith(".ts")) out.push(full);
  }
  return out;
}

let failed = 0;
for (const file of walk(join(root, "app")).concat(walk(join(root, "components")))) {
  const source = readFileSync(file, "utf8");
  if (!/^\s*["']use client["']/m.test(source)) continue;

  for (const mod of SERVER_ONLY) {
    const pattern = new RegExp(`from\\s+["']${mod.replace("/", "\\/")}["']`);
    if (pattern.test(source)) {
      console.error(
        `  FAIL ${relative(root, file)}  클라이언트 컴포넌트가 ${mod} 를 import 합니다`
      );
      failed += 1;
    }
  }
}

if (failed > 0) {
  console.error(
    `\n서버 전용 모듈을 끌어오는 클라이언트 컴포넌트 ${failed}건.\n` +
    `공유할 상수나 타입은 서버 의존이 없는 파일로 분리하십시오.`
  );
  process.exit(1);
}
console.log("  OK   클라이언트 컴포넌트가 서버 전용 모듈을 쓰지 않음");
