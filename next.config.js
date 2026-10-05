/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server-only email libraries: load them as-is instead of bundling.
  serverExternalPackages: ['imapflow', 'mailparser'],
};

module.exports = nextConfig;
