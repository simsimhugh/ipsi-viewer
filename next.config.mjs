/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Server Components가 큰 정적 JSONL 파일 읽도록 허용
    serverComponentsExternalPackages: [],
  },
};

export default nextConfig;
