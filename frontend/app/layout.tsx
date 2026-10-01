import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { AuthProvider } from '@/components/auth-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dhaka Tesla Pool',
  description:
    'Ride-pooling MVP for Dhaka — passengers share one Tesla, each keeping their own seat, status and fare.',
};
/**
 * The shell every screen renders inside (ui-ux §8): `header` + `nav` landmarks,
 * then `main`. `AuthProvider` is mounted here — once, above the router — because
 * the session outlives any single page; the header is its first consumer.
 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AuthProvider>
          <AppHeader />
          <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-ink-400 sm:px-6">
            Dhaka Tesla Pool — MVP build. One Tesla, shared seats, one fare per passenger.
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
