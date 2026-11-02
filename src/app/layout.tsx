import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Value Finder — Intrinsic Value Research', description: 'SEC financial statements, a transparent ten-year FCFF model, and reproducible valuation assumptions.', icons: { icon: '/favicon.svg' } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
