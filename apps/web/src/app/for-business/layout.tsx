import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'For Businesses — Figwork',
  description:
    'Buy deliverables, not headcount. Post tasks to vetted student contractors and pay only for approved work. Escrow-protected, QA-checked, delivered fast.',
  openGraph: {
    title: 'For Businesses — Figwork',
    description:
      'Post tasks to vetted student contractors and pay only for approved work.',
    type: 'website',
    url: 'https://figwork.com/for-business',
  },
};

export default function ForBusinessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
