/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: "/home/devdeep/Documents/nexus/landing",
  images: {
    remotePatterns: [{ protocol: "https", hostname: "cdn.simpleicons.org" }],
  },
};
export default nextConfig;
