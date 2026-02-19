/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@figwork/shared'],
  images: {
    domains: ['res.cloudinary.com'],
  },
  // Reduce file watcher overhead
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
        ignored: ['**/node_modules/**', '**/.git/**', '**/.next/**'],
      };
    }
    return config;
  },
};

module.exports = nextConfig;
