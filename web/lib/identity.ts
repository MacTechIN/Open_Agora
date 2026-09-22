"use client";

/**
 * 브라우저 시민 ID.
 *
 * 네이티브 앱은 키를 OS 하드웨어 저장소(TPM·Keystore)에 두지만, 브라우저에는
 * 그런 보관처가 없다. WebCrypto의 추출 불가 키를 IndexedDB에 저장해 최대한
 * 맞춘다 — 자바스크립트로도 개인키를 꺼낼 수 없다.
 *
 * 다만 브라우저 데이터를 지우면 신원이 사라진다. 네이티브 앱보다 약한
 * 보장이므로 화면에 그 점을 알린다. 복구 구문은 VS-C4에서 붙는다.
 *
 * DID 형식은 네이티브와 같은 did:key(P-256)다. 같은 사람이 웹과 앱에서
 * 서로 다른 신원을 갖는 것은 VS-C3(ZK 가입)에서 하나로 합친다.
 */

const DB_NAME = "civicagora";
const STORE = "identity";
const KEY_ID = "device-key-v1";

/** did:key 의 P-256 multicodec(0x1200) varint 인코딩. */
const P256_MULTICODEC = [0x80, 0x24];

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  // 앞쪽 0 바이트는 '1'로 표현한다.
  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading += 1;
  return "1".repeat(leading) + digits.reverse().map((d) => BASE58[d]).join("");
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  }));
}

/** 압축 P-256 공개키를 did:key 로 바꾼다. 코어와 같은 형식이다. */
async function toDid(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key)); // 04 || X || Y
  const x = raw.slice(1, 33);
  const y = raw.slice(33, 65);
  // 압축: y가 짝수면 0x02, 홀수면 0x03
  const compressed = new Uint8Array(33);
  compressed[0] = (y[31] & 1) === 0 ? 0x02 : 0x03;
  compressed.set(x, 1);

  const payload = new Uint8Array(P256_MULTICODEC.length + compressed.length);
  payload.set(P256_MULTICODEC, 0);
  payload.set(compressed, P256_MULTICODEC.length);
  return `did:key:z${base58(payload)}`;
}

/** 시민 ID를 가져오거나 없으면 만든다. */
export async function loadOrCreateDid(): Promise<string> {
  const stored = await idb<CryptoKeyPair | undefined>("readonly", (s) => s.get(KEY_ID));
  if (stored?.publicKey) return toDid(stored.publicKey);

  // extractable: false — 자바스크립트로도 개인키를 꺼낼 수 없다.
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  );
  await idb("readwrite", (s) => s.put(pair, KEY_ID));
  return toDid(pair.publicKey);
}
