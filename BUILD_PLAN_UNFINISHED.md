# Unfinished / Mocked Features — Complete Build Plan

## Status Legend
- ✅ = Built + Working
- ⚠️ = Built but MOCKED (needs real integration)
- ❌ = Not built / placeholder UI only

---

## 1. STRIPE INTEGRATION (Payment System)

### Backend (`apps/api/src/lib/stripe-service.ts`)
| Feature | Status | Notes |
|---|---|---|
| Stripe client init | ⚠️ | Falls back to mock if no `STRIPE_SECRET_KEY` |
| Customer creation | ⚠️ | Mock returns fake IDs |
| Checkout Sessions (company add-funds) | ⚠️ | Mock returns fake URLs |
| Payment Intents (escrow) | ⚠️ | Mock returns fake client secrets |
| Connect Express (contractor payouts) | ⚠️ | Mock returns fake account links |
| Transfers (payouts) | ⚠️ | Mock returns fake transfer IDs |
| Identity Verification (KYC) | ⚠️ | Mock returns fake verification sessions |
| Tax Reporting | ⚠️ | Mock — just updates account |
| Invoicing | ⚠️ | Mock returns fake invoice URLs |
| Webhooks | ⚠️ | Mock skips signature verification |

**TO DO:** Set `STRIPE_SECRET_KEY` in `.env` → all mocks auto-switch to real Stripe. The code is ready.

### Frontend
| Feature | Status | Notes |
|---|---|---|
| Company billing page | ⚠️ | `dashboard/billing/page.tsx` — shows data but add-funds button hits mock |
| Student earnings page | ⚠️ | `student/earnings/page.tsx` — shows balance but withdraw hits mock |
| Student onboard payout step | ⚠️ | `student/onboard/page.tsx` — Stripe Connect link goes to mock URL |

**TO DO:** Add `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` to `.env`, install `stripe` package, set up webhook endpoint in Stripe dashboard.

---

## 2. CONTRACTOR ONBOARDING (Student Side)

### Backend (`apps/api/src/routes/students.ts`, `onboarding-config.ts`)
| Step | Status | Notes |
|---|---|---|
| Profile (name + skills) | ✅ | Working |
| Phone verification | ⚠️ | Uses Twilio mock — `startPhoneVerification` logs but doesn't send SMS |
| Portfolio upload | ✅ | Cloudinary upload works |
| KYC (Identity) | ⚠️ | Stripe Identity mock — returns fake session |
| Tax info (W-9/W-8BEN) | ❌ | No UI or backend for tax form collection |
| Payout setup (Connect) | ⚠️ | Stripe Connect mock — returns fake onboarding URL |
| Agreement signing | ⚠️ | DocuSign mock — returns fake signing URL |

### Frontend (`apps/web/src/app/(student)/student/onboard/page.tsx`)
| Step | Status | Notes |
|---|---|---|
| Profile step UI | ✅ | Working |
| Phone step UI | ⚠️ | Shows input but verification is mocked |
| File upload step UI | ✅ | Working |
| KYC step UI | ⚠️ | Button opens mock URL |
| Tax step UI | ❌ | No UI — step exists in config but no frontend |
| Payout step UI | ⚠️ | Button opens mock Connect URL |
| Agreement step UI | ⚠️ | Scrollable agreement text, name signing — saves to DB |

**TO DO:**
1. Set `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_PHONE_NUMBER` for real SMS
2. Set `STRIPE_SECRET_KEY` for real KYC + Connect
3. Build tax form collection UI (W-9 form fields or redirect to Stripe Tax)
4. Set `DOCUSIGN_*` env vars for real e-signatures

---

## 3. COMPANY ONBOARDING

### Backend (`apps/api/src/routes/companies.ts`)
| Feature | Status | Notes |
|---|---|---|
| Company registration | ✅ | Working |
| Profile update | ✅ | Working |
| Billing setup | ⚠️ | `POST /billing/setup` returns MOCK customer ID + client secret |
| Stripe customer creation | ⚠️ | Mock mode |
| DocuSign contract signing | ⚠️ | Mock mode |

### Frontend (`apps/web/src/app/(dashboard)/dashboard/onboard/page.tsx`)
| Step | Status | Notes |
|---|---|---|
| Company info | ✅ | Working |
| Billing setup UI | ⚠️ | Shows setup but mock response |
| Contract signing | ⚠️ | Mock DocuSign URL |

**TO DO:** Same as above — set Stripe + DocuSign env vars.

---

## 4. LEGAL / CONTRACTS

### Backend (`apps/api/src/lib/docusign-service.ts`)
| Feature | Status | Notes |
|---|---|---|
| DocuSign client init | ⚠️ | Falls back to mock if no `DOCUSIGN_*` env vars |
| Envelope creation | ⚠️ | Mock returns fake envelope IDs |
| Embedded signing | ⚠️ | Mock returns fake signing URLs |
| Envelope status | ⚠️ | Mock returns "completed" |
| Template-based envelopes | ⚠️ | Mock returns fake IDs |

### Database
| Table | Status | Notes |
|---|---|---|
| `LegalAgreement` | ✅ | Schema exists, CRUD works |
| `AgreementSignature` | ✅ | Schema exists |
| `OnboardingStep` (agreement type) | ✅ | Config system works |

**TO DO:** Set `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_BASE_URL`, `DOCUSIGN_RSA_PRIVATE_KEY` for real e-signatures.

---

## 5. EMAIL / SMS

### Backend
| Service | Status | Notes |
|---|---|---|
| Email (`apps/api/src/lib/email-service.ts`) | ⚠️ | Falls back to console.log if no `RESEND_API_KEY` |
| SMS/Twilio (`apps/api/src/lib/twilio-service.ts`) | ⚠️ | Falls back to console.log if no `TWILIO_*` vars |

**TO DO:** Set `RESEND_API_KEY` for real email, `TWILIO_*` for real SMS.

---

## 6. STUDENT PAGES (Mocked/Placeholder)

| Page | Status | What's needed |
|---|---|---|
| `student/page.tsx` (dashboard) | ✅ | Working but has placeholder tasks |
| `student/tasks/page.tsx` (marketplace) | ✅ | Working |
| `student/executions/page.tsx` | ✅ | Working |
| `student/executions/[id]/page.tsx` | ✅ | Working (chat, milestones, POW) |
| `student/earnings/page.tsx` | ⚠️ | Shows data but withdraw is mocked |
| `student/profile/page.tsx` | ⚠️ | Basic — needs skill editing, avatar upload |
| `student/library/page.tsx` | ⚠️ | Placeholder — no real content library |
| `student/disputes/page.tsx` | ⚠️ | Basic list — needs detail view + evidence upload |
| `student/pow/page.tsx` | ✅ | Working |
| `student/quiz/page.tsx` | ✅ | Working |
| `student/daily-tasks/page.tsx` | ✅ | Working |
| `student/messages/page.tsx` | ✅ | Working |
| `student/onboard/page.tsx` | ⚠️ | See section 2 above |

---

## 7. COMPANY PAGES (Mocked/Placeholder)

| Page | Status | What's needed |
|---|---|---|
| `dashboard/page.tsx` (main chat) | ✅ | Working |
| `dashboard/workunits/*` | ✅ | Working (CRUD, workflow, detail) |
| `dashboard/billing/page.tsx` | ⚠️ | UI exists but payments are mocked |
| `dashboard/settings/page.tsx` | ⚠️ | Notification prefs UI exists, needs backend wiring |
| `dashboard/messages/page.tsx` | ✅ | Working |
| `dashboard/review-queue/page.tsx` | ✅ | Working |
| `dashboard/disputes/page.tsx` | ⚠️ | Basic — needs resolution workflow |
| `dashboard/sessions/page.tsx` | ✅ | Working |
| `dashboard/onboard/page.tsx` | ⚠️ | See section 3 above |

---

## 8. ADMIN PAGES

| Page | Status | What's needed |
|---|---|---|
| `admin/page.tsx` | ✅ | Dashboard metrics |
| `admin/students/page.tsx` | ✅ | List + search |
| `admin/payouts/page.tsx` | ⚠️ | UI exists but payouts are mocked |
| `admin/disputes/page.tsx` | ⚠️ | Basic list |
| `admin/analytics/page.tsx` | ⚠️ | Basic charts |
| `admin/settings/page.tsx` | ⚠️ | Basic |
| `admin/legal-onboarding/page.tsx` | ⚠️ | Config editor exists |

---

## 9. PRIORITY BUILD ORDER (What to do first)

### Phase 1: Stripe (enables all payments)
1. `pnpm add stripe` in `apps/api`
2. Create `.env` entries: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
3. Test: company add-funds flow, escrow funding, contractor Connect onboarding
4. Set up Stripe webhook endpoint: `POST /api/payments/webhooks/stripe`

### Phase 2: Contractor onboarding completion
1. Tax form UI (W-9 fields or Stripe Tax link)
2. Real phone verification (Twilio)
3. Real KYC (Stripe Identity — already coded, just needs real key)
4. Real payout setup (Stripe Connect — already coded)

### Phase 3: Company billing
1. Real checkout sessions
2. Invoice generation
3. Balance tracking

### Phase 4: Legal
1. DocuSign integration (or skip — in-app agreement signing already works)
2. Contract template system

### Phase 5: Email/SMS
1. Resend for transactional email
2. Twilio for SMS verification + POW notifications

---

## 10. ENV VARS NEEDED

```bash
# Stripe (REQUIRED for payments)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Twilio (REQUIRED for phone verification)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...

# Email (REQUIRED for notifications)
RESEND_API_KEY=re_...

# DocuSign (OPTIONAL — in-app signing works without it)
DOCUSIGN_INTEGRATION_KEY=...
DOCUSIGN_USER_ID=...
DOCUSIGN_ACCOUNT_ID=...
DOCUSIGN_BASE_URL=https://demo.docusign.net/restapi
DOCUSIGN_RSA_PRIVATE_KEY=...

# Cloudinary (already configured)
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

---

## KEY INSIGHT

**Most features are already built with mock fallbacks.** The primary work is:
1. Setting env vars for Stripe/Twilio/Resend
2. Installing the `stripe` npm package
3. Building the tax form collection UI
4. Testing the end-to-end flows with real keys

The codebase is designed so that setting `STRIPE_SECRET_KEY` auto-switches from mock → real Stripe. Same for Twilio and Resend.
