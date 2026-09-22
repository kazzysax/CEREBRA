import type { Metadata } from 'next';
import { Geist, Geist_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const brandFont = Space_Grotesk({
  variable: '--font-brand',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://cerebra-decision-court.web3kingley.chatgpt.site'),
  title: 'Cerebra — The decision court for stock intelligence',
  description: 'Stress-test tokenized U.S. stock theses with Bitget market intelligence, an Analyst, a Challenger, and three independent judges.',
  openGraph: {
    title: 'Cerebra — Put every trade idea on trial',
    description: 'An AI Trading Desk for evidence-bound research, adversarial judgment, outcome monitoring, dissent-aware calibration, and alternative recommendations.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Cerebra stock decision court' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Cerebra — Put every trade idea on trial',
    description: 'Stock intelligence enters. Arguments collide. Three judges rule. You make the final call.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} ${brandFont.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
