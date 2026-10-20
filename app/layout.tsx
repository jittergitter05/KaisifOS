import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Public_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
});

const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'KaisifOS — Autonomous Job Intelligence & Outreach Engine',
  description:
    'Autonomous AI-driven job intelligence, multi-source scouting, deterministic fit scoring, outreach synthesis, and Gmail reply tracking engine.',
  openGraph: {
    title: 'KaisifOS — Autonomous Job Intelligence & Outreach Engine',
    description:
      'Autonomous AI-driven job intelligence, multi-source scouting, deterministic fit scoring, outreach synthesis, and Gmail reply tracking engine.',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-kaisif-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      { url: '/favicon-kaisif-512.png', sizes: '512x512', type: 'image/png' },
    ],
    other: [
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '512x512',
        url: '/favicon-kaisif-dark-512.png',
        media: '(prefers-color-scheme: dark)',
      },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${publicSans.variable} ${jetbrainsMono.variable} dark`}
    >
      <body
        className="bg-[#0B0F17] text-[#F8FAFC] font-sans antialiased min-h-screen flex flex-col selection:bg-emerald-500/25 selection:text-emerald-200"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
