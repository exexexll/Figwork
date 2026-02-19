import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — Figwork',
  description: 'Figwork Privacy Policy describing how we collect, use, and protect your data.',
};

export default function PrivacyPolicyPage() {
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
            <Link href="/terms" className="text-[#6b6b80] hover:text-[#1f1f2e] transition-colors">
              Terms of Service
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
        <h1 className="text-4xl font-bold text-[#1f1f2e] mb-2">Privacy Policy</h1>
        <p className="text-[#6b6b80] mb-12">Last updated: February 16, 2026</p>

        <div className="prose prose-slate max-w-none space-y-10 text-[#4a4a5c] leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">1. Introduction</h2>
            <p>
              Figwork, Inc. (&quot;Figwork,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is committed to protecting your
              privacy. This Privacy Policy describes how we collect, use, store, and share your
              personal information when you use the Figwork platform (&quot;Platform&quot;), including our
              website and related services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">
              2. Information We Collect
            </h2>

            <h3 className="text-base font-semibold text-[#1f1f2e] mt-4 mb-2">
              2.1 Information You Provide
            </h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Account Information:</strong> Name, email address, phone number, and
                authentication credentials (via Clerk).
              </li>
              <li>
                <strong>Profile Information:</strong> Skills, portfolio files, resume, and
                professional experience.
              </li>
              <li>
                <strong>Identity Verification:</strong> Government-issued ID, selfie, and biometric
                data processed by Stripe Identity for KYC verification.
              </li>
              <li>
                <strong>Tax Information:</strong> W-9 or W-8BEN form data processed by our tax
                compliance partner for 1099 reporting.
              </li>
              <li>
                <strong>Payment Information:</strong> Bank account details for payouts (processed by
                Stripe Connect) and payment card details for clients (processed by Stripe).
              </li>
              <li>
                <strong>Legal Agreement Signatures:</strong> Your typed name, IP address, user agent,
                and timestamp when signing agreements on the Platform.
              </li>
              <li>
                <strong>Communications:</strong> Messages, dispute filings, and support requests.
              </li>
            </ul>

            <h3 className="text-base font-semibold text-[#1f1f2e] mt-4 mb-2">
              2.2 Information Collected Automatically
            </h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Usage Data:</strong> Pages visited, features used, session duration, and
                interactions with the Platform.
              </li>
              <li>
                <strong>Device Information:</strong> Browser type, operating system, IP address, and
                device identifiers.
              </li>
              <li>
                <strong>Proof of Work Data:</strong> Photos submitted during POW check-ins, including
                location metadata if provided.
              </li>
              <li>
                <strong>AI Interview Data:</strong> Voice recordings and transcriptions from AI
                screening interviews (with your consent).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">
              3. How We Use Your Information
            </h2>
            <p>We use your information to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Operate and improve the Platform</li>
              <li>Match Contractors with suitable Tasks</li>
              <li>Process payments and payouts</li>
              <li>Verify your identity and prevent fraud</li>
              <li>Comply with tax reporting requirements</li>
              <li>Conduct quality assurance on deliverables</li>
              <li>Resolve disputes between users</li>
              <li>Send notifications about tasks, payments, and account activity</li>
              <li>Provide AI-powered coaching and skill assessment</li>
              <li>Generate anonymous, aggregated analytics</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">
              4. How We Share Your Information
            </h2>
            <p>We share your information only in the following circumstances:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>
                <strong>With Clients/Contractors:</strong> Limited profile information is shared to
                facilitate Tasks (e.g., Contractor name and skills visible to Clients).
              </li>
              <li>
                <strong>Service Providers:</strong> We use trusted third parties including Stripe
                (payments), Clerk (authentication), Cloudinary (file storage), OpenAI (AI features),
                and Twilio (SMS) who process data on our behalf.
              </li>
              <li>
                <strong>Legal Compliance:</strong> When required by law, regulation, legal process,
                or governmental request.
              </li>
              <li>
                <strong>Business Transfers:</strong> In connection with a merger, acquisition, or
                sale of assets, with notice to you.
              </li>
            </ul>
            <p className="mt-3">
              We do <strong>not</strong> sell your personal information to advertisers or data
              brokers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">5. Data Security</h2>
            <p>
              We implement industry-standard security measures to protect your data, including:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>TLS encryption for all data in transit</li>
              <li>Encryption at rest for sensitive data (payment info, KYC data)</li>
              <li>CORS, CSRF protection, and rate limiting on all API endpoints</li>
              <li>Regular security audits and vulnerability assessments</li>
              <li>
                Role-based access controls — only authorized personnel access personal data
              </li>
            </ul>
            <p className="mt-3">
              No method of transmission or storage is 100% secure. If you discover a security
              vulnerability, please report it to{' '}
              <a href="mailto:security@figwork.com" className="text-[#a78bfa] hover:underline">
                security@figwork.com
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">6. Data Retention</h2>
            <p>
              We retain your data for as long as your account is active or as needed to provide
              services. After account deletion:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Personal profile data is deleted within 30 days</li>
              <li>
                Financial records are retained for 7 years as required by tax regulations
              </li>
              <li>
                Anonymized analytics data may be retained indefinitely
              </li>
              <li>
                Legal agreement signatures are retained for the duration required by applicable law
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">7. Your Rights</h2>
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>
                <strong>Access:</strong> Request a copy of your personal data
              </li>
              <li>
                <strong>Correction:</strong> Update inaccurate or incomplete data
              </li>
              <li>
                <strong>Deletion:</strong> Request deletion of your data (subject to legal
                retention requirements)
              </li>
              <li>
                <strong>Portability:</strong> Receive your data in a machine-readable format
              </li>
              <li>
                <strong>Opt-out:</strong> Opt out of marketing communications at any time
              </li>
              <li>
                <strong>Restrict Processing:</strong> Request limitation of certain data processing
              </li>
            </ul>
            <p className="mt-3">
              To exercise these rights, email{' '}
              <a href="mailto:privacy@figwork.com" className="text-[#a78bfa] hover:underline">
                privacy@figwork.com
              </a>
              . We will respond within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">
              8. California Privacy Rights (CCPA)
            </h2>
            <p>
              California residents have additional rights under the CCPA, including the right to
              know what personal information is collected, the right to request deletion, and the
              right to opt out of the sale of personal information. As noted above, we do not sell
              personal information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">9. Children&apos;s Privacy</h2>
            <p>
              The Platform is not directed to individuals under the age of 18. We do not knowingly
              collect personal information from children. If you believe a child has provided us
              with personal data, contact us and we will delete it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">
              10. International Data Transfers
            </h2>
            <p>
              Your data may be transferred to and processed in the United States. By using the
              Platform, you consent to the transfer of your data to the US where our servers and
              service providers are located. We take appropriate safeguards for international
              transfers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">
              11. Changes to This Policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of material
              changes via email or a prominent notice on the Platform. Your continued use after
              notification constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">12. Contact Us</h2>
            <p>
              For privacy-related inquiries, contact us at{' '}
              <a href="mailto:privacy@figwork.com" className="text-[#a78bfa] hover:underline">
                privacy@figwork.com
              </a>
              .
            </p>
            <p className="mt-2">
              Figwork, Inc.
              <br />
              San Francisco, CA
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
            <Link href="/privacy" className="hover:text-[#1f1f2e] transition-colors font-medium text-[#6b6b80]">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-[#1f1f2e] transition-colors">
              Terms of Service
            </Link>
          </div>
          <p className="text-xs text-[#a0a0b0]">© {new Date().getFullYear()} Figwork, Inc.</p>
        </div>
      </footer>
    </div>
  );
}
