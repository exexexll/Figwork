# 2-Week Production Sprint Plan
## Figwork Platform - Go-Live Ready (10K Users)
**Team:** 4 Berkeley Student Engineers  
**Duration:** 2 weeks (10 working days)  
**Goal:** Production-ready platform with external application pipeline, minimal contractor UI, optimized backend/AI, and analytics

---

## 🎯 CRITICAL PRIORITIES (Must-Have for Launch)

### 1. **External Application Pipeline** (HIGHEST PRIORITY)
**Problem:** Clients can't post jobs on their own sites. Contractors must come to platform first.
**Solution:** Embeddable application widget that clients can add to their websites.

### 2. **Minimal Contractor UI** (HIGH PRIORITY)
**Problem:** Student dashboard is too complex with excessive text, carousels, multiple sections.
**Solution:** Drastically simplify - reduce to essential actions only.

### 3. **Backend Performance** (HIGH PRIORITY)
**Problem:** No caching, expensive queries, no optimization for 10K users.
**Solution:** Add Redis caching, optimize queries, add database indexes.

### 4. **AI Cost Optimization** (MEDIUM PRIORITY)
**Problem:** Using expensive gpt-5.2 with 16384 tokens for every request.
**Solution:** Optimize model usage, add caching, reduce token usage.

### 5. **Analytics Dashboard** (MEDIUM PRIORITY)
**Problem:** Companies have no visibility into performance metrics.
**Solution:** Build analytics dashboard with key metrics.

### 6. **UI Cleanup** (MEDIUM PRIORITY)
**Problem:** Inconsistent UI patterns, unnecessary complexity.
**Solution:** Standardize components, remove clutter.

---

## 👥 Team Assignments

### **Engineer 1: Backend Specialist**
- External application pipeline (API + embed)
- Backend optimization (caching, indexes, queries)
- Database performance

### **Engineer 2: Frontend Specialist**
- Minimal contractor UI redesign
- Analytics dashboard
- UI cleanup & standardization

### **Engineer 3: Full-Stack**
- External application widget (embeddable)
- Application pipeline integration
- Frontend performance optimization

### **Engineer 4: Full-Stack + AI**
- AI optimization (cost reduction, caching)
- Agent tool improvements
- Testing & documentation

---

## 📅 WEEK 1: Core Infrastructure

### **Day 1-2: External Application Pipeline (Backend)** ⚡ CRITICAL
**Engineer 1**

**What's Missing:**
- No public API for external job postings
- No embeddable application form
- No way to link external applications to platform

**Tasks:**
```typescript
// 1. Create Public Application API
POST /api/public/applications
  - Accept: workUnitId, applicantEmail, applicantName, resumeUrl
  - No auth required (public endpoint)
  - Rate limit: 10 per IP per hour
  - Creates ApplicationSubmission record

// 2. Create Application Submission Model
model ApplicationSubmission {
  id            String   @id @default(uuid())
  workUnitId    String   @map("work_unit_id")
  applicantEmail String  @map("applicant_email")
  applicantName  String  @map("applicant_name")
  resumeUrl     String   @map("resume_url") // Cloudinary URL
  source        String   @default("external") // "external" | "platform"
  sourceUrl     String?  @map("source_url") // Where they applied from
  status        String   @default("pending") // pending | reviewed | accepted | rejected
  createdAt     DateTime @default(now())
  
  workUnit      WorkUnit @relation(...)
  @@index([workUnitId, status])
  @@index([applicantEmail])
}

// 3. Create Public Work Unit Endpoint
GET /api/public/workunits/:id
  - Returns: title, spec, category, price, deadline (public info only)
  - No auth required
  - Cached for 5 minutes

// 4. Resume Upload Endpoint (Public)
POST /api/public/applications/upload-resume
  - Accept: file (PDF, DOC, DOCX)
  - Returns: resumeUrl (Cloudinary)
  - Rate limit: 5 uploads per IP per hour
```

**Files to Create:**
- `apps/api/src/routes/public-applications.ts`
- `apps/api/src/routes/public-workunits.ts`
- Migration: Add `ApplicationSubmission` model

**Estimated Time:** 16 hours

---

### **Day 1-2: Embeddable Application Widget** ⚡ CRITICAL
**Engineer 3**

**What's Missing:**
- No embeddable widget for client websites
- No way to customize application form per work unit

**Tasks:**
```typescript
// 1. Create Embed Widget Component
apps/web/src/components/public/ApplicationWidget.tsx
  - Accepts: workUnitId (from URL param or prop)
  - Minimal design: Name, Email, Resume Upload, Submit
  - No platform branding (white-label)
  - Responsive, works in iframe

// 2. Create Public Application Page
apps/web/src/app/apply/[workUnitId]/page.tsx
  - Standalone page for external links
  - Minimal header, just form
  - Success/error states

// 3. Create Embed Script Generator (for clients)
GET /api/workunits/:id/embed-code
  - Returns: HTML snippet with iframe or script tag
  - Customizable: width, height, theme
```

**Widget Features:**
- **Ultra-minimal:** Name, Email, Resume Upload, Submit button
- **No text clutter:** Remove all explanatory text
- **Fast:** < 2s load time
- **Mobile-first:** Works on all devices
- **White-label:** No Figwork branding

**Files to Create:**
- `apps/web/src/components/public/ApplicationWidget.tsx`
- `apps/web/src/app/apply/[workUnitId]/page.tsx`
- `apps/api/src/routes/public-applications.ts` (upload endpoint)

**Estimated Time:** 16 hours

---

### **Day 1-2: Minimal Contractor Dashboard** ⚡ CRITICAL
**Engineer 2**

**Current Problem:**
- Student dashboard has 800+ lines
- Multiple carousels, complex state
- Too much text, too many sections
- Background image picker (unnecessary)

**Tasks:**
```typescript
// Redesign: apps/web/src/app/(student)/student/page.tsx
// Remove:
- Background image picker
- Carousel complexity
- Placeholder tasks
- Excessive text descriptions
- Multiple view modes

// Keep ONLY:
- Active tasks (simple list, max 5)
- Earnings summary (3 numbers)
- Quick actions (Apply, View Tasks)
- Pending POW alerts (if any)

// New Design:
- Single column layout
- Large, clear numbers
- Minimal text
- 3-4 sections max
- No animations/carousels
```

**New Structure:**
```
┌─────────────────────────┐
│ Earnings: $X.XX         │ ← Big number
│ Pending: $Y.YY         │
│ This Month: $Z.ZZ      │
├─────────────────────────┤
│ Active Tasks (3-5)      │ ← Simple list, no carousel
│ [Task 1] [View]         │
│ [Task 2] [View]         │
├─────────────────────────┤
│ [Browse Tasks]          │ ← Single CTA
│ [View Messages]         │
└─────────────────────────┘
```

**Files to Modify:**
- `apps/web/src/app/(student)/student/page.tsx` (complete rewrite, < 300 lines)

**Estimated Time:** 16 hours

---

### **Day 1-2: Backend Caching Layer** ⚡ CRITICAL
**Engineer 1**

**What's Missing:**
- Redis exists but not used for API response caching
- No query result caching
- Every request hits database

**Tasks:**
```typescript
// 1. Create Cache Utility
apps/api/src/lib/cache.ts
  - cacheGet(key, ttl)
  - cacheSet(key, value, ttl)
  - cacheInvalidate(pattern)

// 2. Add Caching to High-Traffic Endpoints
GET /api/workunits (cache 30s)
GET /api/marketplace/search (cache 60s)
GET /api/students/me/executions (cache 15s)
GET /api/companies/:id/analytics (cache 5min)

// 3. Cache Invalidation
- Invalidate on work unit create/update/delete
- Invalidate on execution status change
- Invalidate on message send

// 4. Add Cache Headers
- Set Cache-Control headers
- Use ETags for conditional requests
```

**Files to Create:**
- `apps/api/src/lib/cache.ts`
- Modify: `apps/api/src/routes/workunits.ts`
- Modify: `apps/api/src/routes/students.ts`
- Modify: `apps/api/src/index.ts` (marketplace search)

**Estimated Time:** 16 hours

---

### **Day 3-4: Database Optimization** ⚡ CRITICAL
**Engineer 1**

**Current State:**
- 453 indexes exist (need to verify they're optimal)
- No connection pooling visible
- Queries may not be optimized

**Tasks:**
```sql
-- 1. Add Missing Indexes for Common Queries
CREATE INDEX idx_workunits_company_status ON work_units(company_id, status) WHERE archived_at IS NULL;
CREATE INDEX idx_executions_student_status ON executions(student_id, status);
CREATE INDEX idx_executions_deadline_status ON executions(deadline_at, status) WHERE status IN ('assigned', 'clocked_in');
CREATE INDEX idx_messages_execution_created ON execution_messages(execution_id, created_at DESC);
CREATE INDEX idx_workunits_published ON work_units(published_at DESC) WHERE status = 'active' AND archived_at IS NULL;

-- 2. Analyze Slow Queries
-- Run EXPLAIN ANALYZE on common queries
-- Optimize N+1 queries (use include/select properly)

-- 3. Add Query Result Caching
-- Cache expensive aggregations (analytics, counts)
```

**Files to Modify:**
- `packages/db/prisma/schema.prisma` (add indexes)
- Run migration: `pnpm prisma db push`
- Add query analysis script

**Estimated Time:** 16 hours

---

### **Day 3-4: AI Cost Optimization** ⚡ HIGH PRIORITY
**Engineer 4**

**Current Problems:**
- Using `gpt-5.2` (expensive) for every request
- `max_completion_tokens: 16384` (very high, rarely needed)
- No caching of tool results
- No request deduplication

**Tasks:**
```typescript
// 1. Optimize Model Usage
apps/api/src/routes/agent.ts
  - Reduce max_completion_tokens to 8192 (default)
  - Use gpt-4o for simple queries (cheaper)
  - Only use gpt-5.2 for complex multi-step operations
  - Add model selection logic based on query complexity

// 2. Add Tool Result Caching
  - Cache tool results for 5 minutes
  - Key: toolName + JSON.stringify(args)
  - Invalidate on data changes

// 3. Add Request Deduplication
  - If same query within 10 seconds, return cached response
  - Key: userId + message hash

// 4. Optimize Context Compression
  - Use gpt-4o-mini for compression (already doing this ✓)
  - Increase compression ratio
  - Cache compressed context
```

**Expected Savings:**
- 40-60% reduction in AI costs
- 30% faster responses (from caching)

**Files to Modify:**
- `apps/api/src/routes/agent.ts`
- `apps/api/src/lib/agent-tools.ts` (add result caching)

**Estimated Time:** 16 hours

---

### **Day 3-4: Minimal Contractor UI - Execution Page** ⚡ CRITICAL
**Engineer 2**

**Current Problem:**
- Execution detail page is 1100+ lines
- Too many sections, too much text
- Complex state management

**Tasks:**
```typescript
// Simplify: apps/web/src/app/(student)/student/executions/[id]/page.tsx

// Remove:
- Complex milestone UI
- Excessive POW logs
- Multiple tabs
- Long descriptions

// Keep ONLY:
- Task title
- Deadline countdown
- Submit deliverables (simple upload)
- Chat (already minimal ✓)
- Status indicator

// New Layout:
┌─────────────────────────┐
│ Task: [Title]           │
│ Due: [Countdown]        │
│ Status: [Badge]         │
├─────────────────────────┤
│ [Upload Deliverables]   │ ← Single button
├─────────────────────────┤
│ Chat                    │ ← Already minimal
└─────────────────────────┘
```

**Target:** Reduce from 1100 lines to < 400 lines

**Files to Modify:**
- `apps/web/src/app/(student)/student/executions/[id]/page.tsx` (major simplification)

**Estimated Time:** 16 hours

---

### **Day 3-4: Application Pipeline Integration** ⚡ CRITICAL
**Engineer 3**

**Tasks:**
```typescript
// 1. Create Application Review UI (Company Side)
apps/web/src/app/(dashboard)/dashboard/applications/page.tsx
  - List all ApplicationSubmissions
  - Filter by work unit, status
  - Review resume, accept/reject
  - Accept → creates Execution, notifies contractor

// 2. Create Application Status Page (Public)
apps/web/src/app/apply/status/[applicationId]/page.tsx
  - Contractor can check application status
  - Shows: Pending, Under Review, Accepted, Rejected
  - If accepted: Link to create account/login

// 3. Auto-Create Contractor Account on Acceptance
  - Send email with signup link
  - Pre-fill email/name from application
  - Auto-assign to work unit
```

**Files to Create:**
- `apps/web/src/app/(dashboard)/dashboard/applications/page.tsx`
- `apps/web/src/app/apply/status/[applicationId]/page.tsx`
- Modify: `apps/api/src/routes/public-applications.ts` (accept endpoint)

**Estimated Time:** 16 hours

---

### **Day 5: Integration & Testing** (All Engineers)
**Tasks:**
- Integration testing
- Fix bugs
- Performance testing
- Load testing (simulate 100 concurrent users)

**Estimated Time:** 8 hours each

---

## 📅 WEEK 2: Analytics, Polish, Production Prep

### **Day 6-7: Analytics Dashboard** 
**Engineer 2**

**What's Missing:**
- Company has no analytics dashboard
- Admin analytics exist but not company-facing

**Tasks:**
```typescript
// 1. Create Analytics API
GET /api/companies/:id/analytics
  - Metrics: total spend, active tasks, completion rate
  - Trends: spending over time, task completion trends
  - Contractor performance: top performers, avg quality
  - Cached for 5 minutes

// 2. Create Analytics Dashboard
apps/web/src/app/(dashboard)/dashboard/analytics/page.tsx
  - Overview cards (4 key metrics)
  - Spending trend chart (last 30 days)
  - Task completion chart
  - Contractor performance table
  - Export to CSV

// 3. Add to Navigation
  - Add "Analytics" to dashboard sidebar
```

**Files to Create:**
- `apps/api/src/routes/analytics.ts`
- `apps/web/src/app/(dashboard)/dashboard/analytics/page.tsx`

**Estimated Time:** 16 hours

---

### **Day 6-7: UI Cleanup & Standardization**
**Engineer 2**

**Tasks:**
```typescript
// 1. Create Design System
apps/web/src/components/ui/
  - Button (standardized)
  - Card (standardized)
  - Input (standardized)
  - Badge (standardized)
  - Remove duplicate components

// 2. Standardize Colors
  - Use CSS variables
  - Remove hardcoded colors
  - Consistent spacing (4px grid)

// 3. Remove Unused Code
  - Delete unused components
  - Remove dead code
  - Clean up imports
```

**Estimated Time:** 16 hours

---

### **Day 6-7: Frontend Performance**
**Engineer 3**

**Tasks:**
```typescript
// 1. Code Splitting
  - Lazy load routes
  - Split vendor chunks
  - Dynamic imports for heavy components

// 2. Image Optimization
  - Use Next.js Image component
  - Lazy load images
  - WebP format

// 3. Bundle Optimization
  - Analyze bundle size
  - Remove unused dependencies
  - Tree-shake unused code

// 4. Add Service Worker (PWA)
  - Cache static assets
  - Offline support
```

**Estimated Time:** 16 hours

---

### **Day 6-7: AI Agent Improvements**
**Engineer 4**

**Tasks:**
```typescript
// 1. Improve Tool Selection
  - Better intent classification
  - Reduce tool hallucination
  - Add tool usage analytics

// 2. Add Request Batching
  - Batch similar requests
  - Reduce API calls

// 3. Improve Error Handling
  - Better error messages
  - Retry logic
  - Fallback responses
```

**Estimated Time:** 16 hours

---

### **Day 8-9: Production Readiness**
**All Engineers**

**Tasks:**
- [ ] Environment variable documentation
- [ ] Deployment scripts
- [ ] Health check endpoints
- [ ] Error monitoring setup
- [ ] Logging configuration
- [ ] Security audit
- [ ] Performance benchmarks
- [ ] Load testing (1000 concurrent users)

**Estimated Time:** 16 hours each

---

### **Day 10: Final Polish & Launch Prep**
**All Engineers**

**Tasks:**
- Final bug fixes
- Documentation
- Demo preparation
- Launch checklist
- Rollback plan

**Estimated Time:** 8 hours each

---

## 📊 Success Metrics

### Performance
- [ ] API response time < 200ms (p95)
- [ ] Page load time < 2s
- [ ] Database queries < 100ms (p95)
- [ ] AI response time < 5s (p95)

### Scalability
- [ ] Support 10,000 concurrent users
- [ ] Handle 1000 requests/minute
- [ ] Database connection pool optimized
- [ ] Redis caching reduces DB load by 60%+

### Cost
- [ ] AI costs reduced by 40%+
- [ ] Server costs optimized
- [ ] CDN for static assets

### User Experience
- [ ] Contractor dashboard < 5 sections
- [ ] Application widget < 2s load
- [ ] Mobile-responsive (all pages)
- [ ] Zero critical bugs

---

## 🗂️ File Structure

### New Files to Create
```
apps/api/src/
  - routes/public-applications.ts
  - routes/public-workunits.ts
  - routes/analytics.ts
  - lib/cache.ts

apps/web/src/
  - app/apply/[workUnitId]/page.tsx
  - app/apply/status/[applicationId]/page.tsx
  - app/(dashboard)/dashboard/applications/page.tsx
  - app/(dashboard)/dashboard/analytics/page.tsx
  - components/public/ApplicationWidget.tsx
```

### Files to Majorly Refactor
```
apps/web/src/app/(student)/student/page.tsx (800 → 300 lines)
apps/web/src/app/(student)/student/executions/[id]/page.tsx (1100 → 400 lines)
apps/api/src/routes/agent.ts (optimize AI usage)
```

---

## 🔧 Technical Details

### External Application Flow
```
1. Client embeds widget on their site
   <iframe src="https://figwork.com/apply/WORK_UNIT_ID" />

2. Contractor fills: Name, Email, Uploads Resume
   → POST /api/public/applications

3. Application stored with status="pending"
   → ApplicationSubmission record created

4. Client reviews in dashboard
   → GET /api/applications (company endpoint)

5. Client accepts application
   → POST /api/applications/:id/accept
   → Creates Execution
   → Sends email to contractor with signup link

6. Contractor signs up
   → Pre-filled with application data
   → Auto-assigned to work unit
   → Redirected to execution page
```

### Caching Strategy
```typescript
// Cache Layers
1. Redis (API responses) - 30s to 5min TTL
2. Browser (static assets) - Long-term
3. CDN (images, fonts) - Long-term
4. Database query cache - 15s to 1min

// Cache Keys
workunits:company:{id} = 30s
analytics:company:{id} = 5min
marketplace:search:{query} = 60s
executions:student:{id} = 15s
```

### Database Indexes Needed
```sql
-- High-traffic queries
CREATE INDEX idx_workunits_company_status_archived 
  ON work_units(company_id, status) 
  WHERE archived_at IS NULL;

CREATE INDEX idx_executions_student_status_active 
  ON executions(student_id, status) 
  WHERE status IN ('assigned', 'clocked_in', 'submitted');

CREATE INDEX idx_applications_workunit_status 
  ON application_submissions(work_unit_id, status);

-- Full-text search
CREATE INDEX idx_workunits_search 
  ON work_units USING gin(to_tsvector('english', title || ' ' || spec));
```

---

## 🚨 Critical Path

**Must Complete for Launch:**
1. ✅ External application pipeline (Day 1-2)
2. ✅ Minimal contractor UI (Day 1-4)
3. ✅ Backend caching (Day 1-2)
4. ✅ Database optimization (Day 3-4)
5. ✅ Application integration (Day 3-4)

**Nice to Have:**
- Analytics dashboard (can launch without)
- AI optimization (can optimize post-launch)
- UI cleanup (can iterate)

---

## 📝 Daily Standup Format

**Time:** 9:00 AM (15 min)
**Questions:**
1. What did you complete yesterday?
2. What are you working on today?
3. Any blockers?
4. Will you hit today's milestone?

**Weekly Review:** Friday 4:00 PM
- Demo completed features
- Review metrics
- Adjust plan if needed

---

## ✅ Definition of Done

**Feature is "Done" when:**
- [ ] Code written and reviewed
- [ ] Tests passing
- [ ] Performance targets met
- [ ] Mobile-responsive
- [ ] No critical bugs
- [ ] Documentation updated
- [ ] Deployed to staging
- [ ] Load tested (100+ concurrent users)

---

**Let's ship it! 🚀**
