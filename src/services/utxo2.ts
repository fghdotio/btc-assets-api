import { sha256 } from 'bitcoinjs-lib/src/crypto';
import { Cradle } from '../container';
import BaseQueueWorker from './base/queue-worker';
import { z } from 'zod';
import { Job, RepeatOptions } from 'bullmq';
import * as Sentry from '@sentry/node';
import DataCache from './base/data-cache';
import { throttle } from 'lodash';
import { validateBitcoinAddress, validateDogecoinAddress } from '../utils/validators';
import { CoinType } from '../constants';

const BaseUTXOSchema = z.object({
  txid: z.string(),
  vout: z.number(),
  value: z.number(),
  status: z.object({
    confirmed: z.boolean(),
    block_height: z.number().optional(),
    block_hash: z.string().optional(),
    block_time: z.number().optional(),
  }),
});

type BaseUTXO = z.infer<typeof BaseUTXOSchema>;

interface IUTXOSyncRequest {
  address: string;
  coinType: CoinType;
}

interface IUTXOSyncJobReturn {
  address: string;
  coinType: CoinType;
  utxos: BaseUTXO[];
  txsHash: string;
}

export const UTXO_SYNCER_QUEUE_NAME = 'utxo-syncer-queue';

class UTXOSyncerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UTXOSyncerError';
  }
}

export default class UTXOSyncer2 extends BaseQueueWorker<IUTXOSyncRequest, IUTXOSyncJobReturn> {
  private cradle: Cradle;
  private dataCache: DataCache<IUTXOSyncJobReturn>;

  constructor(cradle: Cradle) {
    const defaultJobOptions = UTXOSyncer2.getDefaultJobOptions(cradle);
    const repeatStrategy = UTXOSyncer2.getRepeatStrategy(cradle);
    super({
      name: UTXO_SYNCER_QUEUE_NAME,
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
      prefix: 'utxo-syncer-data',
      schema: z.object({
        address: z.string(),
        coinType: z.enum([CoinType.BTC, CoinType.DOGE]),
        utxos: z.array(BaseUTXOSchema),
        txsHash: z.string(),
      }),
      expire: cradle.env.UTXO_SYNC_DATA_CACHE_EXPIRE,
    });
  }

  static cacheKey(address: string, coinType: CoinType) {
    return `${coinType}_${address}`;
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
      cradle.logger.info(`[UTXOSyncer2] Repeat job ${opts.jobId} in ${duration}ms`);
      return millis + duration;
    };
  }

  private getCoinService(coinType: CoinType) {
    switch (coinType) {
      case CoinType.BTC:
        return this.cradle.bitcoin;
      case CoinType.DOGE:
        return this.cradle.doge;
      default:
        throw new UTXOSyncerError(`Unsupported coin type: ${coinType}`);
    }
  }

  private captureJobExceptionToSentryScope(job: Job<IUTXOSyncRequest>, err: Error) {
    const { address, coinType } = job.data;
    Sentry.withScope((scope) => {
      // Ignore the error for the specified addresses to avoid too many errors
      if (this.cradle.env.SENTRY_IGNORE_UTXO_SYNC_ERROR_ADDRESSES.includes(address)) {
        return;
      }
      scope.setTag('coinType', coinType);
      scope.setTag('address', address);
      this.cradle.logger.error(err);
      scope.captureException(err);
    });
  }

  public async getUtxosByAddress(address: string, coinType: CoinType, noCache?: boolean) {
    if (this.cradle.env.UTXO_SYNC_DATA_CACHE_ENABLE && !noCache) {
      const cached = await this.dataCache.get(UTXOSyncer2.cacheKey(address, coinType));
      if (cached) {
        return cached.utxos;
      }
    }

    const coinService = this.getCoinService(coinType);
    return coinService.getAddressTxsUtxo({ address });
  }

  public enqueueSyncJob(address: string, coinType: CoinType) {
    this.cradle.logger.info(
      `[UTXOSyncer2] Enqueue sync job for ${UTXOSyncer2.cacheKey(address, coinType)}, ${Date.now()}`,
    );
    return this.enqueueSyncJobThrottle(address, coinType);
  }

  private async _enqueueSyncJob(address: string, coinType: CoinType) {
    if (coinType === CoinType.BTC) {
      if (!validateBitcoinAddress(address)) {
        throw new UTXOSyncerError(`Invalid btc address: ${address}`);
      }
    } else if (coinType === CoinType.DOGE) {
      if (!validateDogecoinAddress(address)) {
        throw new UTXOSyncerError(`Invalid doge address: ${address}`);
      }
    }

    const jobs = await this.queue.getRepeatableJobs();
    const repeatableJob = jobs.find((job) => job.name === address);

    if (repeatableJob) {
      // Remove the existing repeatable job to update the start date, let the job be processed immediately
      this.cradle.logger.info(`[UTXOSyncer2] Remove existing repeatable job for ${coinType} ${address}`);
      await this.queue.removeRepeatableByKey(repeatableJob.key);
    }

    return this.addJob(
      UTXOSyncer2.cacheKey(address, coinType),
      { address, coinType },
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

  private enqueueSyncJobThrottle = throttle(
    (address: string, coinType: CoinType) => this._enqueueSyncJob(address, coinType),
    1000,
    {
      leading: true,
    },
  );

  public async process(job: Job<IUTXOSyncRequest>) {
    try {
      const { address, coinType } = job.data;
      const valid = validateBitcoinAddress(address) || validateDogecoinAddress(address);
      if (!valid) {
        if (job.repeatJobKey) {
          await this.queue.removeRepeatableByKey(job.repeatJobKey);
        }
        throw new Error(`Invalid ${coinType} address: ${address}`);
      }

      const coinService = this.getCoinService(coinType);
      const txs = await coinService.getAddressTxs({ address });
      const txsHash = sha256(Buffer.from(txs.map((tx) => tx.txid + JSON.stringify(tx.status)).join(','))).toString();

      const cacheKey = UTXOSyncer2.cacheKey(address, coinType);
      const cached = await this.dataCache.get(cacheKey);
      if (cached && txsHash === cached.txsHash) {
        this.cradle.logger.info(`[UTXOSyncer2] ${cacheKey} is up to date, skip sync job`);
        return cached;
      }

      const utxos = await coinService.getAddressTxsUtxo({ address });
      const data = { address, coinType, utxos, txsHash };
      await this.dataCache.set(cacheKey, data);
      return data;
    } catch (e) {
      const { message, stack } = e as Error;
      const error = new UTXOSyncerError(message);
      error.stack = stack;
      this.captureJobExceptionToSentryScope(job, error);
      throw e;
    }
  }
}
