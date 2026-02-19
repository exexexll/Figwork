import { createClerkClient, verifyToken } from '@clerk/backend';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '@figwork/db';

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

export { clerkClient };

// Middleware to verify JWT and attach user to request
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing authorization header' });
    }

    const token = authHeader.slice(7);

    // Verify the JWT with Clerk
    const verifiedToken = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });

    if (!verifiedToken || !verifiedToken.sub) {
      return reply.status(401).send({ error: 'Invalid token' });
    }

    // Find or create user in our database
    let user = await db.user.findUnique({
      where: { clerkId: verifiedToken.sub },
    });

    if (!user) {
      // Fetch user details from Clerk
      const clerkUser = await clerkClient.users.getUser(verifiedToken.sub);
      
      user = await db.user.create({
        data: {
          clerkId: verifiedToken.sub,
          email: clerkUser.emailAddresses[0]?.emailAddress || '',
          name: `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || null,
        },
      });
    }

    // Attach user to request
    (request as any).user = user;
  } catch (error) {
    request.log.error(error, 'Auth verification failed');
    return reply.status(401).send({ error: 'Authentication failed' });
  }
}

// Type augmentation for request.user
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      clerkId: string;
      email: string;
      name: string | null;
    };
  }
}

// Helper to verify auth and return userId (returns null if unauthorized)
export async function verifyClerkAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<{ userId: string; user: any } | null> {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'Missing authorization header' });
      return null;
    }

    const token = authHeader.slice(7);

    const verifiedToken = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });

    if (!verifiedToken || !verifiedToken.sub) {
      reply.status(401).send({ error: 'Invalid token' });
      return null;
    }

    // Find or create user in our database
    let user = await db.user.findUnique({
      where: { clerkId: verifiedToken.sub },
    });

    if (!user) {
      const clerkUser = await clerkClient.users.getUser(verifiedToken.sub);
      
      user = await db.user.create({
        data: {
          clerkId: verifiedToken.sub,
          email: clerkUser.emailAddresses[0]?.emailAddress || '',
          name: `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || null,
        },
      });
    }

    (request as any).user = user;
    return { userId: verifiedToken.sub, user };
  } catch (error) {
    request.log.error(error, 'Auth verification failed');
    reply.status(401).send({ error: 'Authentication failed' });
    return null;
  }
}
