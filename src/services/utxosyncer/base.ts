import { z } from 'zod';
import { Job, RepeatOptions } from 'bullmq';
import { throttle } from 'lodash';
import { Cradle } from '../../container';
import { UTXO } from '../bitcoin/schema';
import { IUTXOSyncRequest, IUTXOSyncJobReturn, IUTXOSyncer } from './interface';
import DataCache from '../base/data-cache';
import BaseQueueWorker from '../base/queue-worker';

abstract class BaseUTXOSyncer extends BaseQueueWorker<IUTXOSyncRequest, IUTXOSyncJobReturn> implements IUTXOSyncer {
  protected cradle: Cradle;
  protected dataCache: DataCache<IUTXOSyncJobReturn>;

  constructor(cradle: Cradle, queueName: string, cachePrefix: string) {
    const defaultJobOptions = BaseUTXOSyncer.getDefaultJobOptions(cradle);
    const repeatStrategy = BaseUTXOSyncer.getRepeatStrategy(cradle);
    super({
      name: queueName,
      connection: cradle.redis,
      queue: {
        defaultJobOptions,
        settings: {
          repeatStrategy,
        },
      },
      worker: {
        lockDuration: 60_000,
        removeOnComplete: { count: 0 },
        removeOnFail: { count: 0 },
        settings: {
          repeatStrategy,
        },
      },
    });
    this.cradle = cradle;
    this.dataCache = new DataCache(cradle.redis, {
      prefix: cachePrefix,
      schema: z.object({
        address: z.string(),
        utxos: z.array(UTXO),
        txsHash: z.string(),
      }),
      expire: cradle.env.UTXO_SYNC_DATA_CACHE_EXPIRE,
    });
  }

  public static getDefaultJobOptions(cradle: Cradle) {
    return {
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: cradle.env.UTXO_SYNC_REPEAT_BASE_DURATION,
      },
    };
  }

  public static getRepeatStrategy(cradle: Cradle) {
    return (millis: number, opts: RepeatOptions) => {
      const { count = 0 } = opts;
      if (count === 0) {
        // immediately process the job when first added
        return millis;
      }
      // Exponential increase the repeat interval, with a maximum of maxDuration
      // For default values (base=10s, max=3600s), the interval will be 10s, 20s, 40s, 80s, 160s, ..., 3600s, 3600s, ...
      const baseDuration = cradle.env.UTXO_SYNC_REPEAT_BASE_DURATION;
      const maxDuration = cradle.env.UTXO_SYNC_REPEAT_MAX_DURATION;
      // Add some random delay to avoid all jobs being processed at the same time
      const duration = Math.min(Math.pow(2, count) * baseDuration, maxDuration) + Math.random() * 1000;
      cradle.logger.info(`[UTXOSyncer] Repeat job ${opts.jobId} in ${duration}ms`);
      return millis + duration;
    };
  }

  protected abstract validateAddress(address: string): boolean;

  public abstract getUtxosByAddress(address: string, noCache?: boolean): Promise<UTXO[]>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public abstract enqueueSyncJob(address: string): Promise<any>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public abstract process(job: Job<IUTXOSyncRequest>): Promise<any>;

  protected enqueueSyncJobThrottle = throttle((address) => this._enqueueSyncJob(address), 1000, {
    leading: true,
  });

  protected async _enqueueSyncJob(address: string) {
    const jobs = await this.queue.getRepeatableJobs();
    const repeatableJob = jobs.find((job) => job.name === address);

    if (repeatableJob) {
      // Remove the existing repeatable job to update the start date, let the job be processed immediately
      this.cradle.logger.info(`[UTXOSyncer] Remove existing repeatable job for ${address}`);
      await this.queue.removeRepeatableByKey(repeatableJob.key);
    }

    return this.addJob(
      address,
      { address },
      {
        repeat: {
          pattern: 'exponential',
          // bullmq will end the repeat job when the end date is reached
          // https://github.com/taskforcesh/bullmq/blob/cce0774cffcee591407eee4d4530daa37aab3eca/src/classes/repeat.ts#L51
          endDate: Date.now() + this.cradle.env.UTXO_SYNC_REPEAT_EXPRIED_DURATION,
        },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}

export default BaseUTXOSyncer;
