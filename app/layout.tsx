import type {Metadata} from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css'; 

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'KaisifOS',
  description: 'Automated Job Hunting Engine',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
       <body className="bg-[#0F172A] text-[#F8FAFC] font-sans antialiased h-screen overflow-hidden" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
