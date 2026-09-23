/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * snarkjs 는 번들하지 않는다 (VS-C3a).
   *
   * 번들에 넣으면 ffjavascript 의 워커 스레드 로딩이 깨져, 서버에서
   * 증명 검증 한 번이 **300초** 걸렸다. 같은 검증이 순수 Node 에서는
   * 11밀리초다. webpack 이 web-worker 의 동적 require 를 풀지 못해 나는
   * 문제이며, 빌드 경고("Critical dependency")로만 드러나 원인을 찾기 어렵다.
   *
   * 외부 패키지로 두면 Next 가 번들하지 않고 그대로 require 하므로 정상
   * 속도가 나온다.
   */
  serverExternalPackages: ["snarkjs", "@semaphore-protocol/proof", "@semaphore-protocol/group"],
};

export default nextConfig;
