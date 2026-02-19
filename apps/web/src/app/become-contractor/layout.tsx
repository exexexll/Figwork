import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Become a Contractor — Figwork',
  description:
    'Get paid for real work. Complete paid tasks from real businesses, build your track record, and level up from Novice to Elite.',
  openGraph: {
    title: 'Become a Contractor — Figwork',
    description:
      'Complete paid tasks from real businesses and get paid directly to your bank account.',
    type: 'website',
    url: 'https://figwork.com/become-contractor',
  },
};

export default function BecomeContractorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
