# Figwork — Production Roadmap

> Last updated: Feb 16, 2026
> Goal: Ship a production-ready marketplace with real money flows, verified contractors, and reliable notifications.

---

## Phase 1: Auth & Route Security (Day 1)

### 1.1 Protect Student & Admin Routes in Middleware

The Clerk middleware currently only guards `/dashboard(.*)`. Student and admin routes rely on client-side `useAuth()` which can be bypassed.

**File:** `apps/web/src/middleware.ts`

- [ ] Add `/student(.*)` and `/admin(.*)` to `isProtectedRoute`
- [ ] Verify that `/interview(.*)` and `/marketplace` remain public

### 1.2 Admin Role Enforcement

`ADMIN_USER_IDS` is an env-var comma-separated list. This works but is fragile.

- [ ] Move admin user list to a database table or Clerk metadata (`publicMetadata.role = "admin"`)
- [ ] Add a Clerk webhook handler to sync role changes

---

## Phase 2: Stripe Integration — Real Money (Days 2–5)

All payment code exists but runs against a mock client. This is the highest-priority gap.

### 2.1 Stripe Core Setup

- [ ] Install `stripe` package in `apps/api`
- [ ] Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to env
- [ ] Remove mock client fallback in `apps/api/src/lib/stripe-service.ts` (or gate it behind `NODE_ENV === 'development'`)
- [ ] Set up Stripe webhook endpoint (`/api/webhooks/stripe`) to handle:
  - `payment_intent.succeeded` → mark escrow as funded
  - `transfer.created` / `transfer.paid` → update payout status
  - `invoice.paid` → mark invoice as paid
  - `account.updated` → update Connect account status

### 2.2 Escrow Funding (Company → Platform)

- [ ] Wire `fundEscrow()` in `stripe-service.ts` to create real `PaymentIntent`
- [ ] Add a Stripe Elements / Checkout UI on the work unit detail page for companies to fund escrow
- [ ] Confirm idempotency (prevent double-funding)

### 2.3 Stripe Connect (Platform → Student Payouts)

- [ ] Wire `createConnectAccount()` to create real Express Connect accounts
- [ ] Build the Connect onboarding redirect flow in student onboarding step 6
- [ ] Wire `createTransfer()` to send real payouts from platform to connected accounts
- [ ] Handle edge cases: account not yet verified, insufficient platform balance

### 2.4 Company Billing

- [ ] Wire `createStripeCustomer()` on company registration
- [ ] Wire invoice generation to create real Stripe invoices
- [ ] Add payment method collection (Stripe Elements) on company onboarding step 2

### 2.5 Test End-to-End in Stripe Test Mode

- [ ] Company funds escrow → student completes task → QA passes → payout lands in connected account
- [ ] Verify webhook handling for every event type
- [ ] Test failure cases: declined card, insufficient funds, Connect account deactivated

---

## Phase 3: Identity & Compliance (Days 5–8)

### 3.1 KYC via Stripe Identity

- [ ] Install/configure Stripe Identity
- [ ] Replace the "Coming soon" placeholder in student onboarding step 4 with a real Stripe Identity verification session
- [ ] Handle webhook `identity.verification_session.verified` / `requires_input` to update `kycStatus`
- [ ] Block task acceptance if `kycStatus !== 'verified'` (currently only "recommended")

### 3.2 Tax Form Collection

- [ ] Decide on approach: Stripe Tax, manual W-9 PDF upload, or a service like Trolley/Tax1099
- [ ] Build real form collection in student onboarding step 5
- [ ] Store tax form reference and update `taxStatus`
- [ ] Gate payouts on `taxStatus === 'verified'`

### 3.3 Contract / E-Signature

Two options — pick one:

**Option A: DocuSign (full e-sig)**
- [ ] Set up DocuSign developer account + API keys
- [ ] Generate envelope from template on onboarding
- [ ] Handle webhook for signed status → update `contractStatus`

**Option B: Clickwrap (simpler, still legally binding)**
- [ ] Use a clickwrap service (e.g., Ironclad Click, or custom)
- [ ] Store acceptance timestamp + IP + user agent
- [ ] Display signed agreement in profile

---

## Phase 4: Notifications — Email & SMS (Days 8–10)

### 4.1 Email Service

- [ ] Pick provider: **Resend** (recommended — simple, good DX) or SendGrid
- [ ] Install SDK in `apps/api`
- [ ] Replace stubs in `apps/api/src/lib/email-service.ts` with real sends
- [ ] Create email templates for:
  - Welcome / onboarding complete
  - Task assigned
  - Submission received (to company)
  - Revision requested
  - Task approved + payout initiated
  - POW reminder
  - Dispute filed / resolved
  - Weekly earnings summary

### 4.2 Twilio SMS

- [ ] Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_VERIFY_SERVICE_SID` to env
- [ ] Install `twilio` package in `apps/api`
- [ ] Wire real SMS sends in `apps/api/src/lib/twilio-service.ts`
- [ ] Wire real phone verification (Twilio Verify) in student onboarding step 2
- [ ] Rate-limit SMS sends to prevent abuse

### 4.3 Real-Time Frontend Notifications

The WebSocket events and `NotificationBell.tsx` exist but aren't connected.

- [ ] In the student layout (`apps/web/src/app/(student)/layout.tsx`), connect to the marketplace WebSocket namespace on mount
- [ ] In the company layout (`apps/web/src/app/(dashboard)/layout.tsx`), connect similarly
- [ ] Wire `NotificationBell` to display unread count + dropdown from the `notifications` table
- [ ] Add toast notifications for real-time events (task assigned, POW request, payout complete)

---

## Phase 5: POW Photo Capture (Days 10–11)

The POW page currently asks for **photo URLs**. Real POW needs camera capture.

- [ ] Replace URL inputs on `apps/web/src/app/(student)/student/pow/page.tsx` with:
  - Camera capture (via `navigator.mediaDevices.getUserMedia`)
  - Or file picker with image preview
- [ ] Upload captured photos to Cloudinary (use the existing `upload-with-retry.ts` lib)
- [ ] Pass Cloudinary URLs to the POW submit API
- [ ] Verify the POW worker's OpenAI Vision analysis works with real photos

---

## Phase 6: Screening Interview ↔ Task Eligibility Bridge (Day 11–12)

The schema and UI support screening interviews per work unit, but the connection isn't wired.

- [ ] When a student accepts a task that has `infoCollectionTemplateId`:
  1. Auto-generate a one-time interview link
  2. Redirect student to complete the interview
  3. On interview completion, update `execution.infoSessionId`
  4. Allow clock-in only after interview is completed
- [ ] Add UI in the execution detail page to show interview status/link

---

## Phase 7: Testing (Days 12–15)

### 7.1 API Tests

- [ ] Set up Vitest (already in the Turborepo ecosystem)
- [ ] Write integration tests for critical flows:
  - Student registration → task acceptance → clock in → submit → QA → payout
  - Company registration → work unit creation → escrow funding → review → approval
  - Dispute filing → admin resolution
- [ ] Mock external services (Stripe, Twilio, OpenAI) in test env

### 7.2 Frontend Tests

- [ ] Set up Playwright for E2E tests
- [ ] Test critical user journeys:
  - Student onboarding flow
  - Company posting a task
  - Student accepting and completing a task
  - Interview flow (text mode)

### 7.3 Load Testing

- [ ] Load test the marketplace search endpoint
- [ ] Load test WebSocket connections (target: 500 concurrent)
- [ ] Load test the interview orchestrator

---

## Phase 8: Production Hardening (Days 15–18)

### 8.1 Error Monitoring

- [ ] Set up Sentry for both `apps/web` and `apps/api`
- [ ] Add error boundaries to all page layouts
- [ ] Configure Sentry alerts for error spikes

### 8.2 Logging & Observability

- [ ] Ship Fastify logs to a log aggregator (e.g., Axiom, Datadog, or Railway's built-in)
- [ ] Add structured logging to all workers (job ID, duration, outcome)
- [ ] Set up uptime monitoring (e.g., BetterUptime) for `/health`

### 8.3 Database

- [ ] Run `prisma migrate` instead of `prisma db push` for production schema management
- [ ] Set up daily database backups on Railway
- [ ] Add database connection pooling (PgBouncer or Prisma Accelerate)
- [ ] Review and add missing indexes for common query patterns

### 8.4 Rate Limiting & Abuse Prevention

- [ ] Tighten rate limits on sensitive routes (registration, payment, POW submit)
- [ ] Add CAPTCHA on public-facing forms (sign-up, become contractor)
- [ ] Add file upload size/type validation on the server (not just client)

### 8.5 Environment & Secrets

- [ ] Audit all env vars — ensure nothing sensitive is in `NEXT_PUBLIC_*`
- [ ] Set up separate staging and production environments
- [ ] Use Railway's environment variable groups for shared secrets

---

## Phase 9: Polish & Ship (Days 18–20)

### 9.1 UI Polish

- [ ] Audit all pages on mobile (especially admin panel, execution detail)
- [ ] Add proper loading skeletons to pages that still use generic spinners
- [ ] Add empty states with helpful CTAs on all list pages
- [ ] Add confirmation modals for destructive actions (delete work unit, fail execution)

### 9.2 SEO & Meta

- [ ] Add `<title>` and `<meta>` tags to all public pages (landing, marketplace, for-business, become-contractor)
- [ ] Add Open Graph images for social sharing
- [ ] Submit sitemap to Google Search Console

### 9.3 Legal Pages

- [ ] Create Terms of Service page
- [ ] Create Privacy Policy page
- [ ] Create Cookie Policy (if applicable)
- [ ] Link from footer on all public pages

### 9.4 Analytics

- [ ] Add PostHog or Mixpanel for product analytics
- [ ] Track key events: sign-up, task posted, task accepted, task completed, payout
- [ ] Set up conversion funnels

---

## Priority Summary

| Priority | Phase | Effort | Impact |
|----------|-------|--------|--------|
| 🔴 P0 | Phase 1 — Route security | 1 day | Blocks launch |
| 🔴 P0 | Phase 2 — Stripe (real payments) | 4 days | Blocks launch |
| 🔴 P0 | Phase 3 — KYC/Tax/Contracts | 3 days | Blocks launch (legal) |
| 🟡 P1 | Phase 4 — Email & SMS | 2 days | Critical for UX |
| 🟡 P1 | Phase 5 — POW photo capture | 1 day | Core feature gap |
| 🟡 P1 | Phase 8 — Prod hardening | 3 days | Required for reliability |
| 🟢 P2 | Phase 6 — Screening bridge | 1 day | Nice-to-have for v1 |
| 🟢 P2 | Phase 7 — Testing | 3 days | Ship faster with confidence |
| 🟢 P2 | Phase 9 — Polish & ship | 2 days | First impressions |

**Estimated total: ~20 working days to production-ready.**
