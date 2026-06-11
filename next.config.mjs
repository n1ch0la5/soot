/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  env: {
    // baked at build time — the footer stamp changes on every deploy
    NEXT_PUBLIC_VERSION: process.env.npm_package_version || "0.0.0",
    NEXT_PUBLIC_BUILT: new Date().toISOString().slice(0, 10),
  },
};

export default nextConfig;
