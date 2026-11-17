/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  experimental: {
    serverComponentsExternalPackages: ['googleapis', '@google/genai', 'groq-sdk'],
  },
  webpack: (config) => {
    config.cache = false;
    return config;
  },
};
export default nextConfig;
