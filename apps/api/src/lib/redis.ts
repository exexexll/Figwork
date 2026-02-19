import Redis from 'ioredis';

let redisClient: Redis | null = null;
let bullmqRedisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    redisClient.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    redisClient.on('connect', () => {
      console.log('Redis connected');
    });
  }

  return redisClient;
}

// Separate Redis connection for BullMQ workers
// BullMQ requires maxRetriesPerRequest: null
export function getBullMQRedis(): Redis {
  if (!bullmqRedisClient) {
    bullmqRedisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    bullmqRedisClient.on('error', (err) => {
      console.error('BullMQ Redis connection error:', err);
    });

    bullmqRedisClient.on('connect', () => {
      console.log('BullMQ Redis connected');
    });
  }

  return bullmqRedisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
  if (bullmqRedisClient) {
    await bullmqRedisClient.quit();
    bullmqRedisClient = null;
  }
}
