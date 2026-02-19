import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Nunito_Sans, Fira_Code } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

const nunitoSans = Nunito_Sans({
  subsets: ['latin'],
  variable: '--font-nunito-sans',
  display: 'swap',
});

const firaCode = Fira_Code({
  subsets: ['latin'],
  variable: '--font-fira-code',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Figwork — The Future of Human Talent Marketplace',
    template: '%s | Figwork',
  },
  description:
    'Figwork runs your contract work end-to-end — matching vetted talent, managing execution, and paying only for approved results.',
  icons: {
    icon: '/iconfigwork.png',
    apple: '/iconfigwork.png',
  },
  metadataBase: new URL('https://figwork.com'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://figwork.com',
    siteName: 'Figwork',
    title: 'Figwork — The Future of Human Talent Marketplace',
    description:
      'Post tasks to vetted student contractors. AI-mediated screening, escrow-protected payments, QA-checked deliverables.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Figwork — The Future of Human Talent Marketplace',
    description:
      'Post tasks to vetted student contractors. AI-mediated screening, escrow-protected payments, QA-checked deliverables.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${nunitoSans.variable} ${firaCode.variable}`}>
        <body className="font-sans">
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: 'white',
                border: '1px solid var(--color-border)',
                borderRadius: '12px',
                boxShadow: 'var(--shadow-md)',
              },
            }}
          />
        </body>
      </html>
    </ClerkProvider>
  );
}
