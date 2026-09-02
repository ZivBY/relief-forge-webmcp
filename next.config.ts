import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: '/',
      headers: [
        { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
        { key: 'Cloudflare-CDN-Cache-Control', value: 'no-store' },
        { key: 'X-Relief-Forge-Gate', value: 'vinext-auth-v1' },
      ],
    }]
  },
}

export default nextConfig
