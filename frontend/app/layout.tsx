import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dhaka Tesla Pool',
  description:
    'Ride-pooling MVP for Dhaka — passengers share one Tesla, each keeping their own seat, status and fare.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <span className="font-semibold">Dhaka Tesla Pool</span>
            <span className="text-xs text-slate-500">Phase 1 scaffold</span>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
