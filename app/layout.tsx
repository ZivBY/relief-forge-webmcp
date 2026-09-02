import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import '../src/styles.css'
import '../src/mobile-preview.css'

const description = 'A parametric wall-art studio for deterministic design, print-bed packing, and fabrication exports.'

export const metadata: Metadata = {
  title: 'Relief Forge',
  description: 'Design deterministic modular wall art and prepare local 3D-printing fabrication files.',
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%2310100f'/%3E%3Cpath d='M12 43 25 17l11 30 16-28' fill='none' stroke='%23d26746' stroke-width='7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E",
  },
  openGraph: { type: 'website', title: 'Relief Forge', description },
  twitter: {
    card: 'summary',
    title: 'Relief Forge',
    description,
  },
}

export const viewport: Viewport = {
  themeColor: '#10100f',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
