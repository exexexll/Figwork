import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — Figwork',
  description: 'Figwork Terms of Service governing the use of our talent marketplace platform.',
};

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-[#faf8fc]">
      {/* Ambient */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at top left, rgba(196,181,253,0.12) 0%, transparent 50%)',
        }}
      />

      {/* Nav */}
      <nav className="relative z-10 border-b border-[#e8e4f0] bg-white/70 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/iconfigwork.png" alt="Figwork" className="h-7 w-7" />
            <span className="font-semibold text-[#1f1f2e]">figwork</span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/privacy" className="text-[#6b6b80] hover:text-[#1f1f2e] transition-colors">
              Privacy Policy
            </Link>
            <Link
              href="/sign-in"
              className="text-[#6b6b80] hover:text-[#1f1f2e] transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="relative z-10 max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-[#1f1f2e] mb-2">Terms of Service</h1>
        <p className="text-[#6b6b80] mb-12">Last updated: February 16, 2026</p>

        <div className="prose prose-slate max-w-none space-y-10 text-[#4a4a5c] leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing or using the Figwork platform (&quot;Platform&quot;), operated by Figwork, Inc.
              (&quot;Figwork,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), you agree to be bound by these Terms of
              Service (&quot;Terms&quot;). If you do not agree, do not use the Platform. We may update these
              Terms from time to time, and your continued use constitutes acceptance of the revised
              Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">2. Description of Service</h2>
            <p>
              Figwork is a managed marketplace that connects businesses (&quot;Clients&quot;) with independent
              contractors (&quot;Contractors&quot;) to complete discrete work units (&quot;Tasks&quot;). The Platform
              facilitates task posting, contractor matching, execution management, quality assurance,
              payment processing, and dispute resolution.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">3. Account Registration</h2>
            <p>
              You must create an account to use certain features. You agree to provide accurate,
              complete information and keep it updated. You are responsible for all activity under
              your account and must maintain the confidentiality of your credentials. Notify us
              immediately of any unauthorized access.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">4. Contractor Relationship</h2>
            <p>
              Contractors on the Platform are independent contractors, not employees of Figwork or
              any Client. Contractors are responsible for their own taxes, insurance, and compliance
              with applicable laws. Figwork does not control the manner or means by which Contractors
              complete Tasks, but does enforce quality standards through its review process.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">5. Payments &amp; Escrow</h2>
            <p>
              Clients fund Tasks via escrow before work begins. Funds are held by our payment
              processor (Stripe) and are released to the Contractor upon Client approval or
              automatic approval after the review period. Figwork charges a platform fee as disclosed
              at the time of Task creation. All payments are in US dollars unless otherwise stated.
            </p>
            <p className="mt-3">
              Contractors receive payouts to their connected bank accounts via Stripe Connect. Payout
              timing depends on the Contractor&apos;s tier and Stripe&apos;s processing schedule.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">
              6. Identity Verification &amp; Onboarding
            </h2>
            <p>
              Contractors must complete identity verification (KYC), tax information collection, and
              any required legal agreements before accepting Tasks. We reserve the right to suspend
              or terminate accounts that fail verification or provide false information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">
              7. Proof of Work &amp; Quality Assurance
            </h2>
            <p>
              Contractors may be required to respond to proof-of-work (&quot;POW&quot;) check-ins while working
              on Tasks. These check-ins help verify active engagement and may include photo
              verification. Failure to respond to required check-ins may result in Task reassignment,
              reduced quality scores, or account restrictions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">8. Intellectual Property</h2>
            <p>
              Work product created during the performance of Tasks is &quot;work made for hire&quot; and
              becomes the property of the Client upon payment. Contractors retain no rights to the
              deliverables except as expressly agreed in writing. Contractors must not include
              third-party copyrighted material without proper authorization.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">9. Confidentiality</h2>
            <p>
              Users must maintain the confidentiality of all non-public information received through
              the Platform. This includes task specifications, business data, proprietary
              methodologies, and personal information of other users. Confidentiality obligations
              survive termination of these Terms for a period of two (2) years.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">10. Dispute Resolution</h2>
            <p>
              Disputes between Clients and Contractors are first handled through Figwork&apos;s built-in
              dispute resolution process. If the dispute cannot be resolved through the Platform,
              it shall be resolved through binding arbitration administered in accordance with the
              rules of JAMS, with the venue in San Francisco, California. Class action waivers apply.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">11. Prohibited Conduct</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Circumvent the Platform to transact directly with other users</li>
              <li>Create multiple accounts or impersonate others</li>
              <li>Submit plagiarized or AI-generated content without disclosure</li>
              <li>Manipulate quality scores, reviews, or tier rankings</li>
              <li>Harass, threaten, or discriminate against other users</li>
              <li>Use the Platform for any unlawful purpose</li>
              <li>Attempt to reverse engineer, scrape, or compromise the Platform</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">
              12. Suspension &amp; Termination
            </h2>
            <p>
              We may suspend or terminate your account at any time for violations of these Terms,
              fraudulent activity, or any other reason at our sole discretion. Upon termination,
              outstanding obligations for accepted Tasks survive. Any funds in escrow for approved
              work will still be disbursed.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">
              13. Limitation of Liability
            </h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, FIGWORK SHALL NOT BE LIABLE FOR ANY INDIRECT,
              INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE
              PLATFORM. OUR TOTAL LIABILITY SHALL NOT EXCEED THE GREATER OF (A) THE FEES PAID BY YOU
              IN THE 12 MONTHS PRECEDING THE CLAIM OR (B) $100.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">14. Indemnification</h2>
            <p>
              You agree to indemnify and hold harmless Figwork, its officers, directors, employees,
              and agents from any claims, damages, or expenses arising from your use of the Platform,
              your violation of these Terms, or your violation of any third-party rights.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">15. Governing Law</h2>
            <p>
              These Terms are governed by the laws of the State of California, without regard to
              conflict of law principles. Any judicial proceeding shall take place in the state or
              federal courts located in San Francisco, California.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">16. Contact</h2>
            <p>
              For questions about these Terms, contact us at{' '}
              <a href="mailto:legal@figwork.com" className="text-[#a78bfa] hover:underline">
                legal@figwork.com
              </a>.
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[#e8e4f0] px-6 py-8">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/iconfigwork.png" alt="Figwork" className="h-6 w-6 opacity-50" />
            <span className="text-sm text-[#a0a0b0]">figwork</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-[#a0a0b0]">
            <Link href="/privacy" className="hover:text-[#1f1f2e] transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-[#1f1f2e] transition-colors font-medium text-[#6b6b80]">
              Terms of Service
            </Link>
          </div>
          <p className="text-xs text-[#a0a0b0]">© {new Date().getFullYear()} Figwork, Inc.</p>
        </div>
      </footer>
    </div>
  );
}
