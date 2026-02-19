# Figwork

**AI-powered contractor marketplace that matches businesses with vetted student workers through adaptive voice interviews, progressive trust tiers, and automated quality assurance.**

![Figwork Logo](./figwork.webp)

---

## What It Does

Figwork connects businesses with student contractors via a managed marketplace. Instead of resume-based hiring, the platform uses AI-mediated voice interviews to screen candidates, assigns trust tiers based on track record, and handles the full lifecycle from task posting → screening → assignment → execution → proof-of-work verification → payout.

### Key Capabilities

| Area | Description |
|------|-------------|
| **AI Voice Interviews** | Adaptive, multi-turn conversations powered by GPT-4o with real-time speech-to-text via OpenAI Realtime and text-to-speech via ElevenLabs. Follow-up questions generated dynamically until sufficient signal is gathered. |
| **Contractor Marketplace** | Public task board with search, filtering, and eligibility checks. Students browse and accept tasks matching their skills and tier. |
| **Progressive Trust System** | Three-tier system (Novice → Pro → Elite) with EXP-based progression. Higher tiers unlock more complex tasks, higher payouts, and lower platform fees. |
| **Screening & Assignment** | Tasks can require AI screening interviews. Two assignment modes: auto-match (first qualified student) or manual review (company picks from applicants). |
| **Proof of Work (POW)** | Periodic photo/file verification during task execution with AI analysis to confirm active work. |
| **Escrow & Payouts** | Company funds are held in escrow. Released to contractors upon approval via Stripe Connect. |
| **Quality Assurance** | Automated QA checks, defect analysis, and AI-generated improvement suggestions for tasks. |
| **Real-Time Notifications** | WebSocket-powered live updates with toast notifications for task status changes, new assignments, and payouts. |
| **Admin Panel** | Platform-wide analytics, student management, dispute resolution, and legal onboarding configuration. |
| **Business Dashboard** | Template management, task creation with AI clarity scoring, candidate review queues, interview transcript viewer, and execution tracking. |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Monorepo** | Turborepo + pnpm workspaces |
| **Frontend** | Next.js 14, React 18, Tailwind CSS, shadcn/ui |
| **Backend** | Fastify, Node.js, Socket.io |
| **Database** | PostgreSQL with pgvector |
| **Cache & Queues** | Redis, BullMQ |
| **AI/LLM** | OpenAI GPT-4o, OpenAI Realtime STT, ElevenLabs TTS |
| **Auth** | Clerk |
| **Payments** | Stripe (Payments, Connect, Identity, Tax) |
| **Storage** | Cloudinary |
| **E-Signatures** | DocuSign API |
| **SMS/Phone** | Twilio (Verify, SMS) |
| **Email** | Resend / SendGrid |
| **Hosting** | Vercel (frontend), Railway (backend) |

---

## Project Structure

```
figwork/
├── apps/
│   ├── web/                    # Next.js frontend
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (admin)/    # Admin panel (analytics, students, disputes, settings)
│   │   │   │   ├── (auth)/     # Clerk sign-in/sign-up
│   │   │   │   ├── (dashboard)/ # Business dashboard (templates, work units, billing)
│   │   │   │   ├── (student)/  # Student portal (tasks, executions, POW, earnings)
│   │   │   │   ├── marketplace/ # Public task marketplace
│   │   │   │   ├── interview/  # Voice interview interface
│   │   │   │   ├── for-business/ # Landing page for businesses
│   │   │   │   ├── become-contractor/ # Landing page for students
│   │   │   │   ├── terms/      # Terms of Service
│   │   │   │   └── privacy/    # Privacy Policy
│   │   │   ├── components/     # Reusable UI components
│   │   │   ├── lib/            # API clients, utilities, hooks
│   │   │   └── stores/         # Zustand state management
│   │   └── public/
│   │
│   └── api/                    # Fastify backend
│       └── src/
│           ├── routes/         # API endpoints
│           │   ├── auth.ts         # Authentication
│           │   ├── students.ts     # Student registration, profiles, tasks
│           │   ├── companies.ts    # Company profiles
│           │   ├── workunits.ts    # Task CRUD, AI clarity scoring
│           │   ├── executions.ts   # Accept, clock-in, submit, review pipeline
│           │   ├── payments.ts     # Stripe payments, escrow, payouts
│           │   ├── templates.ts    # Interview template management
│           │   ├── interview.ts    # Interview session management
│           │   ├── pow.ts          # Proof of Work submissions
│           │   ├── admin.ts        # Admin operations
│           │   ├── onboarding-config.ts # Legal onboarding configuration
│           │   └── webhooks.ts     # Stripe, Clerk, DocuSign, Twilio webhooks
│           ├── workers/        # Background job processors (BullMQ)
│           │   ├── knowledge.worker.ts      # RAG knowledge ingestion
│           │   ├── post-process.worker.ts   # Interview summary generation
│           │   ├── pow.worker.ts            # POW photo AI analysis
│           │   ├── qa.worker.ts             # Quality assurance checks
│           │   ├── payout.worker.ts         # Stripe payout processing
│           │   ├── notification.worker.ts   # Email/SMS dispatch
│           │   ├── invoice.worker.ts        # Invoice PDF generation
│           │   ├── defect-analysis.worker.ts # Task defect pattern analysis
│           │   ├── pdf.worker.ts            # PDF generation
│           │   ├── cleanup.worker.ts        # Expired session cleanup
│           │   └── candidate-file.worker.ts # File processing
│           ├── orchestrator/   # Interview session orchestration
│           ├── websocket/      # Socket.io real-time events
│           └── lib/            # Service integrations (Stripe, DocuSign, Twilio, etc.)
│
├── packages/
│   ├── db/                 # Prisma schema + client
│   ├── ai/                 # OpenAI client, embeddings, prompt library
│   └── shared/             # Types, constants, tier config, pricing, utils
│
├── docker/
│   └── api.Dockerfile      # Production Docker build
├── turbo.json
├── railway.toml            # Railway deployment config
├── vercel.json             # Vercel deployment config
└── pnpm-workspace.yaml
```

---

## Getting Started

### Prerequisites

- **Node.js** 20+
- **pnpm** 9+
- **PostgreSQL** with the `pgvector` extension
- **Redis**

### Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/figwork.git
cd figwork

# Install all dependencies
pnpm install
```

### Environment Setup

```bash
# Copy the root env example
cp env.example .env

# Copy app-specific env files
cp apps/api/env.example.txt apps/api/.env
cp apps/web/env.example.txt apps/web/.env.local
```

Fill in the values in each file. At minimum you need:

| Variable | Where | Required |
|----------|-------|----------|
| `DATABASE_URL` | Root / API | ✅ PostgreSQL connection string |
| `REDIS_URL` | Root / API | ✅ Redis connection string |
| `CLERK_SECRET_KEY` | API + Web | ✅ Clerk authentication |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Web | ✅ Clerk frontend key |
| `OPENAI_API_KEY` | API | ✅ GPT-4o for interviews & AI features |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | API | ✅ File storage |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | Web | ✅ Client-side uploads |
| `NEXT_PUBLIC_API_URL` | Web | ✅ Backend URL (default `http://localhost:3001`) |
| `FRONTEND_URL` | API | ✅ Frontend URL (default `http://localhost:3000`) |

Optional integrations (gracefully degrade to mock mode when missing):

| Variable | Service |
|----------|---------|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe payments |
| `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, etc. | DocuSign e-signatures |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Twilio SMS/verification |
| `RESEND_API_KEY` or `SENDGRID_API_KEY` | Transactional email |
| `ELEVENLABS_API_KEY` | Text-to-speech |

### Database Setup

```bash
# Generate the Prisma client
pnpm db:generate

# Push schema to your database (creates all tables)
pnpm db:push
```

### Run Development Servers

```bash
# Start both frontend and backend concurrently via Turborepo
pnpm dev
```

This starts:
- **Frontend** → `http://localhost:3000`
- **API server** → `http://localhost:3001`

Or run them individually:

```bash
# API only
cd apps/api && pnpm dev

# Web only
cd apps/web && pnpm dev
```

---

## Core Concepts

### Trust Tier System

Students progress through three tiers based on experience points (EXP):

| Tier | EXP Range | Max Complexity | Daily Task Limit | Platform Fee |
|------|-----------|---------------|-------------------|-------------|
| **Novice** | 0 – 499 | 2/5 | 3 | 20% |
| **Pro** | 500 – 1,999 | 4/5 | 7 | 15% |
| **Elite** | 2,000+ | 5/5 | 15 | 10% |

Promotion requires meeting quality score and on-time delivery thresholds.

### Task Lifecycle

```
Company creates Work Unit (draft)
  → Fund Escrow (Stripe)
  → Activate
  → Student Accepts / Applies
  → [Screening Interview] (if configured)
  → [Manual Review] (if manual assignment mode)
  → Assigned
  → Clock In
  → Working (POW checks during execution)
  → Submit Deliverable
  → Company Review
  → Approved → Payout triggered
  → (or) Revision Needed → Student revises
```

### Assignment Modes

- **Auto-Match**: First qualified student who accepts is automatically assigned.
- **Manual Review**: Students apply; the company reviews applicants (with interview transcripts if screening is enabled) and chooses who to assign.

### Interview System

1. Company creates an interview template with questions and rubrics
2. Template is linked to a work unit as a screening requirement (or used standalone)
3. Candidate opens the interview and has a real-time voice conversation with the AI
4. The AI adapts follow-up questions based on response sufficiency
5. A post-interview summary is generated with strengths, gaps, and quotes
6. Companies can review full transcripts and summaries before making assignment decisions

---

## Deployment

### Railway (Backend)

The API is containerized with Docker and configured for Railway:

```bash
# The railway.toml and Dockerfile are already configured
railway up
```

Key settings in `railway.toml`:
- Health check at `/health`
- Auto-restart on failure (max 10 retries)
- Docker build from `docker/api.Dockerfile`

### Vercel (Frontend)

```bash
# vercel.json is pre-configured
vercel
```

Set these environment variables in Vercel:
- `NEXT_PUBLIC_API_URL` → your Railway API URL
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`
- `CLERK_SECRET_KEY`

---

## API Overview

All API routes are prefixed with `/api` and require Clerk JWT authentication (except webhooks and health check).

| Route | Description |
|-------|-------------|
| `POST /api/students/register` | Student registration |
| `GET /api/students/me` | Current student profile |
| `GET /api/students/me/tasks` | Available tasks for student |
| `POST /api/executions/accept` | Accept or apply for a task |
| `POST /api/executions/:id/clock-in` | Start working |
| `POST /api/executions/:id/submit` | Submit deliverable |
| `POST /api/executions/:id/review` | Company reviews submission |
| `POST /api/executions/:id/assign` | Company assigns applicant (manual mode) |
| `GET /api/workunits` | List work units |
| `POST /api/workunits` | Create work unit |
| `PUT /api/workunits/:id` | Update work unit settings |
| `POST /api/workunits/:id/fund-escrow` | Fund escrow via Stripe |
| `GET /api/templates` | List interview templates |
| `POST /api/templates` | Create interview template |
| `POST /api/pow/:logId/respond` | Submit proof of work |
| `GET /api/payments/payouts` | Student payout history |
| `POST /api/webhooks/stripe` | Stripe webhook handler |
| `POST /api/webhooks/clerk` | Clerk webhook handler |

---

## Background Workers

All workers run via BullMQ with Redis and start automatically with the API server:

| Worker | Purpose |
|--------|---------|
| `knowledge` | Ingests uploaded files into RAG vector store |
| `post-process` | Generates AI interview summaries |
| `pow` | Analyzes proof-of-work photos via AI |
| `qa` | Runs automated quality checks on submissions |
| `payout` | Processes Stripe Connect payouts |
| `notification` | Dispatches email/SMS notifications |
| `invoice` | Generates PDF invoices |
| `defect-analysis` | Detects recurring defect patterns |
| `pdf` | General PDF generation |
| `cleanup` | Expires stale sessions, cleans up orphans |
| `candidate-file` | Processes uploaded candidate files |

---

## Scripts

```bash
pnpm dev           # Start all dev servers (Turborepo)
pnpm build         # Production build
pnpm lint          # Run linters
pnpm test          # Run tests

pnpm db:generate   # Regenerate Prisma client
pnpm db:push       # Push schema to database
pnpm db:migrate    # Run database migrations
pnpm db:studio     # Open Prisma Studio (DB GUI)
```

---

## Service Configuration

On startup, the API server prints a configuration status table showing which integrations are active vs. running in mock mode:

```
┌─────────────────────────────────────────────────────────┐
│               SERVICE CONFIGURATION STATUS              │
├─────────────────────────────────────────────────────────┤
│ ✅ CONFIGURED:                                          │
│    PostgreSQL, Redis, Clerk Auth, Stripe, Cloudinary,   │
│    OpenAI, ElevenLabs                                   │
│                                                         │
│ 🔶 MOCK MODE (configure to enable):                    │
│    DocuSign, Twilio SMS, Email (Resend/SendGrid)        │
└─────────────────────────────────────────────────────────┘
```

Missing integrations won't crash the server — they gracefully fall back to mock responses logged to the console.

---

## License

Proprietary — All rights reserved.
