import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Browse Tasks — Figwork Marketplace',
  description:
    'Browse available tasks on the Figwork marketplace. Find work that matches your skills and start earning today.',
  openGraph: {
    title: 'Browse Tasks — Figwork Marketplace',
    description:
      'Browse available tasks and start earning on Figwork.',
    type: 'website',
    url: 'https://figwork.com/marketplace',
  },
};

export default function MarketplaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
