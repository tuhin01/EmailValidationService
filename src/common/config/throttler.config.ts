import { Injectable } from '@nestjs/common';
import {
  days,
  hours,
  minutes,
  seconds,
  ThrottlerModuleOptions,
  ThrottlerOptionsFactory,
} from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { ExecutionContext } from '@nestjs/common';

@Injectable()
export class ThrottlerConfigService implements ThrottlerOptionsFactory {
  createThrottlerOptions(): ThrottlerModuleOptions {
    return {
      throttlers: [
        {
          limit: 50000,
          ttl: hours(1),
          blockDuration: minutes(5),
        },
      ],
      errorMessage: 'Rate limit exceeded. Please try again later.',
      storage: new ThrottlerStorageRedisService(
        new Redis({
          host: 'localhost',
          port: 6379,
        }),
      ),
      getTracker: (req: Record<string, any>, context: ExecutionContext) => {
        return req.headers['api_key'];
      },
      generateKey: (
        context: ExecutionContext,
        trackerString: string,
        throttlerName: string,
      ) => {
        return `${trackerString}-${throttlerName}`;
      },
    };
  }
}
