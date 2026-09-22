/**
 * 시민 등록 — 이메일 인증 (다리 단계)
 *
 * ## 두 가지를 동시에 지켜야 한다
 *
 * 1. **아무나 글을 쓸 수 없다.** 검증된 이메일 하나당 시민 하나.
 * 2. **글쓴이를 추적할 수 없다.** 어떤 글이 어떤 이메일의 것인지 알 수 없어야 한다.
 *
 * ## 어떻게 지키는가
 *
 * 이메일과 신원(DID)을 **연결해서 저장하지 않는다.** 표를 둘로 나눈다.
 *
 *   consumed_emails  이 이메일이 이미 가입했는가   (email_hash)
 *   members          이 DID 가 회원인가            (did)
 *
 * 두 표 사이에 외래키도 공통 식별자도 없다. 가입 시각은 **날짜 단위**로만
 * 남긴다 — 밀리초까지 남기면 같은 순간에 기록된 두 행을 맞춰 볼 수 있다.
 *
 * 이메일은 원문을 저장하지 않고 HMAC 해시만 둔다. 서버 데이터가 통째로
 * 유출돼도 누가 가입했는지 알 수 없다.
 *
 * ## 남는 신뢰 가정
 *
 * **인증하는 순간에는 서버가 이메일과 DID 를 동시에 본다.** 그 시점에 몰래
 * 기록하면 연결할 수 있다. 저장하지 않는다는 약속을 믿어야 한다.
 *
 * 이 가정은 ZK-Email(VS-C3)이 붙으면 사라진다. 그때는 서버가 이메일을
 * 아예 보지 못하고, 증명만 검증한다. → docs/15_BRIDGE_SERVER.md
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { requireDb } from "./db";

/** 인증코드 유효 시간. 짧게 두어 유출된 코드의 수명을 줄인다. */
const CODE_TTL_MINUTES = 10;

/** 한 이메일에 허용하는 코드 발송 횟수(시간당). 발송 폭주를 막는다. */
const MAX_REQUESTS_PER_HOUR = 5;

/** 코드 입력 시도 횟수. 6자리를 무차별 대입하는 것을 막는다. */
const MAX_ATTEMPTS = 5;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "AUTH_SECRET 이 없거나 너무 짧습니다(32자 이상). 이메일 해시의 안전이 여기에 달려 있습니다."
    );
  }
  return value;
}

/**
 * 이메일을 해시한다.
 *
 * 정규화를 먼저 한다. 같은 사람이 대소문자나 앞뒤 공백을 달리 입력해도
 * 같은 해시가 나와야 두 번 가입하지 못한다.
 *
 * HMAC 을 쓰는 이유: 단순 SHA-256 은 이메일 주소 목록을 미리 해시해 두고
 * 맞춰보는 공격에 뚫린다. 서버만 아는 열쇠가 섞여야 한다.
 */
export function hashEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  return createHmac("sha256", secret()).update(normalized).digest("hex");
}

function hashCode(code: string, emailHash: string): string {
  return createHmac("sha256", secret()).update(`${emailHash}:${code}`).digest("hex");
}

/** 가입 날짜. 날짜 단위로만 남겨 두 표를 시각으로 맞춰 보지 못하게 한다. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function migrateAuth() {
  const db = requireDb();
  await db`
    CREATE TABLE IF NOT EXISTS consumed_emails (
      email_hash    TEXT PRIMARY KEY,
      registered_on DATE NOT NULL
    )`;
  await db`
    CREATE TABLE IF NOT EXISTS members (
      did           TEXT PRIMARY KEY,
      registered_on DATE NOT NULL
    )`;
  await db`
    CREATE TABLE IF NOT EXISTS verification_codes (
      email_hash  TEXT PRIMARY KEY,
      code_hash   TEXT NOT NULL,
      expires_at  BIGINT NOT NULL,
      attempts    INT NOT NULL DEFAULT 0,
      sent_count  INT NOT NULL DEFAULT 1,
      window_from BIGINT NOT NULL
    )`;
}

export class AuthError extends Error {}

/** 이메일이 이미 가입했는가. */
export async function emailAlreadyUsed(emailHash: string): Promise<boolean> {
  const db = requireDb();
  const rows = await db`SELECT 1 FROM consumed_emails WHERE email_hash = ${emailHash}`;
  return rows.length > 0;
}

/** DID 가 회원인가. 글쓰기 모든 경로에서 확인한다. */
export async function isMember(did: string): Promise<boolean> {
  const db = requireDb();
  const rows = await db`SELECT 1 FROM members WHERE did = ${did}`;
  return rows.length > 0;
}

/**
 * 인증코드를 만들고 저장한다. 반환값은 이메일로 보낼 코드.
 *
 * 코드 자체는 저장하지 않고 해시만 둔다. 데이터가 유출돼도 대기 중인 코드로
 * 가입할 수 없다.
 */
export async function issueCode(emailHash: string): Promise<string> {
  const db = requireDb();
  const now = Date.now();
  const hourAgo = now - 3600_000;

  const [existing] = await db`
    SELECT sent_count, window_from FROM verification_codes WHERE email_hash = ${emailHash}`;
  if (existing && Number(existing.window_from) > hourAgo) {
    if (existing.sent_count >= MAX_REQUESTS_PER_HOUR) {
      throw new AuthError("인증 메일을 너무 자주 요청했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  // 6자리. randomInt 는 암호학적 난수를 쓴다 — Math.random 은 예측 가능하다.
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = now + CODE_TTL_MINUTES * 60_000;
  const windowFrom = existing && Number(existing.window_from) > hourAgo
    ? Number(existing.window_from)
    : now;
  const sentCount = existing && Number(existing.window_from) > hourAgo
    ? existing.sent_count + 1
    : 1;

  await db`
    INSERT INTO verification_codes (email_hash, code_hash, expires_at, attempts, sent_count, window_from)
    VALUES (${emailHash}, ${hashCode(code, emailHash)}, ${expiresAt}, 0, ${sentCount}, ${windowFrom})
    ON CONFLICT (email_hash) DO UPDATE SET
      code_hash = EXCLUDED.code_hash,
      expires_at = EXCLUDED.expires_at,
      attempts = 0,
      sent_count = EXCLUDED.sent_count,
      window_from = EXCLUDED.window_from`;

  return code;
}

/**
 * 코드를 확인하고 시민으로 등록한다.
 *
 * 이메일 기록과 회원 기록을 한 트랜잭션에 넣되 **서로 연결하지 않는다.**
 * 둘 다 날짜만 남기므로 나중에 시각으로 맞춰 볼 수 없다.
 */
export async function verifyAndRegister(
  emailHash: string,
  code: string,
  did: string
): Promise<void> {
  const db = requireDb();

  const [row] = await db`
    SELECT code_hash, expires_at, attempts FROM verification_codes
     WHERE email_hash = ${emailHash}`;
  if (!row) throw new AuthError("인증 요청을 먼저 해 주세요.");
  if (Number(row.expires_at) < Date.now()) {
    throw new AuthError("인증코드가 만료되었습니다. 다시 요청해 주세요.");
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    throw new AuthError("입력 횟수를 초과했습니다. 인증을 다시 요청해 주세요.");
  }

  // 길이가 같을 때만 상수 시간 비교가 의미가 있다.
  const expected = Buffer.from(String(row.code_hash), "hex");
  const actual = Buffer.from(hashCode(code.trim(), emailHash), "hex");
  const matched = expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!matched) {
    await db`UPDATE verification_codes SET attempts = attempts + 1 WHERE email_hash = ${emailHash}`;
    throw new AuthError("인증코드가 맞지 않습니다.");
  }

  if (await emailAlreadyUsed(emailHash)) {
    throw new AuthError("이미 가입한 이메일입니다.");
  }

  const day = today();
  await db.begin(async (tx) => {
    // 두 표를 연결하지 않는다. 공통 식별자도, 외래키도 두지 않는다.
    await tx`INSERT INTO consumed_emails (email_hash, registered_on)
             VALUES (${emailHash}, ${day}) ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO members (did, registered_on)
             VALUES (${did}, ${day}) ON CONFLICT DO NOTHING`;
    await tx`DELETE FROM verification_codes WHERE email_hash = ${emailHash}`;
  });
}
