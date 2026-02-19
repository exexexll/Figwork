import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/student(.*)',
  '/admin(.*)',
]);

// These routes are always public (no auth required)
const isPublicRoute = createRouteMatcher([
  '/interview(.*)',
  '/marketplace(.*)',
  '/for-business(.*)',
  '/become-contractor(.*)',
  '/terms(.*)',
  '/privacy(.*)',
]);

export default clerkMiddleware((auth, req) => {
  // Protect dashboard, student, and admin routes
  if (isProtectedRoute(req)) {
    auth().protect();
  }
});

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
