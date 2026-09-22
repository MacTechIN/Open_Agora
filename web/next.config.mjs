/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // contracts/limits.json 을 웹에서 직접 읽는다. 한도를 두 군데 적으면
  // 반드시 어긋나고, 어긋나면 앱에서 통과한 글이 서버에서 거부된다.
  outputFileTracingIncludes: {
    "/**": ["../contracts/**"],
  },
};

export default nextConfig;
