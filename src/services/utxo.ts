import { sha256 } from 'bitcoinjs-lib/src/crypto';
import { randomUUID } from 'node:crypto';
import { Cradle } from '../container';
import { Redis } from 'ioredis';
import BaseQueueWorker from './base/queue-worker';
import { UTXO } from './bitcoin/schema';
import { z } from 'zod';
import { Job, UnrecoverableError } from 'bullmq';
import * as Sentry from '@sentry/node';
import DataCache from './base/data-cache';
import validateBitcoinAddress from '../utils/validators';
import { BitcoinClientAPIError, BitcoinClientErrorCode } from './bitcoin';

export interface IUTXOSyncRequest {
  btcAddress: string;
  // sync chain the job belongs to, a job of a superseded chain stops itself
  chainId: string;
  // position in the chain, drives the backoff interval and the job id
  iteration: number;
}

interface IUTXOSyncJobReturn {
  btcAddress: string;
  utxos: UTXO[];
  // use sha256(latest_txs_id) as the key, so we can check if the data is updated
  txsHash: string;
}

// v2: jobs of the legacy repeatable-job queue are incompatible with this worker
export const UTXO_SYNCER_QUEUE_NAME = 'utxo-syncer-queue-v2';

const CHAIN_KEY_PREFIX = 'utxo-syncer:chain:';
const TOUCH_KEY_PREFIX = 'utxo-syncer:touch:';
const TOMBSTONE_KEY_PREFIX = 'utxo-syncer:tombstone:';

const PERMANENT_ERROR_CODES = new Set([BitcoinClientErrorCode.TooManyUtxos, BitcoinClientErrorCode.TooManyTxs]);

const SCHEDULE_ATTEMPTS = 3;
const SCHEDULE_RETRY_DELAY_MS = 100;
// a chain younger than this may not have its job added yet, don't treat it as broken
const REPAIR_GRACE_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start, restart or extend the sync chain of an address.
 *
 * KEYS[1] chain hash, KEYS[2] restart cooldown key
 * ARGV[1] new chainId, ARGV[2] active window ms, ARGV[3] restart cooldown ms,
 * ARGV[4] repair: chainId observed without a job ('' for a normal request), replaces the chain
 *         ignoring the cooldown but only if it is still that chainId, ARGV[5] now ms
 *
 * Returns {'start'} | {'restart', previousChainId, previousIteration} | {'extend', chainId, iteration, updatedAt}
 */
const TOUCH_CHAIN_SCRIPT = `
local exists = redis.call('EXISTS', KEYS[1]) == 1
if exists then
  local keep
  if ARGV[4] ~= '' then
    keep = redis.call('HGET', KEYS[1], 'chainId') ~= ARGV[4]
  else
    keep = redis.call('SET', KEYS[2], '1', 'PX', ARGV[3], 'NX') == false
  end
  if keep then
    redis.call('PEXPIRE', KEYS[1], ARGV[2])
    return {'extend', redis.call('HGET', KEYS[1], 'chainId'), redis.call('HGET', KEYS[1], 'iteration'), redis.call('HGET', KEYS[1], 'updatedAt') or '0'}
  end
  local previousChainId = redis.call('HGET', KEYS[1], 'chainId')
  local previousIteration = redis.call('HGET', KEYS[1], 'iteration')
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('HSET', KEYS[1], 'chainId', ARGV[1], 'iteration', '0', 'updatedAt', ARGV[5])
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return {'restart', previousChainId, previousIteration}
end
redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
redis.call('HSET', KEYS[1], 'chainId', ARGV[1], 'iteration', '0', 'updatedAt', ARGV[5])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return {'start'}
`;

/**
 * Delete the chain state if it still belongs to the given chainId.
 *
 * KEYS[1] chain hash, ARGV[1] chainId
 */
const RELEASE_CHAIN_SCRIPT = `
if redis.call('HGET', KEYS[1], 'chainId') == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * Advance the scheduled iteration of a chain.
 *
 * KEYS[1] chain hash
 * ARGV[1] chainId, ARGV[2] iteration of the job, ARGV[3] iteration being scheduled, ARGV[4] now ms
 *
 * Returns 1 when advanced, 0 when the chain is gone, is another chain, or is already past ARGV[2]
 */
const ADVANCE_CHAIN_SCRIPT = `
if redis.call('HGET', KEYS[1], 'chainId') ~= ARGV[1] then
  return 0
end
local scheduled = tonumber(redis.call('HGET', KEYS[1], 'iteration'))
if scheduled == nil or scheduled > tonumber(ARGV[2]) then
  return 0
end
redis.call('HSET', KEYS[1], 'iteration', ARGV[3], 'updatedAt', ARGV[4])
return 1
`;

// registered on the shared ioredis client, hence the prefix
const TOUCH_CHAIN_COMMAND = 'utxoSyncerTouchChain';
const ADVANCE_CHAIN_COMMAND = 'utxoSyncerAdvanceChain';
const RELEASE_CHAIN_COMMAND = 'utxoSyncerReleaseChain';

type ScriptClient = Redis & {
  [TOUCH_CHAIN_COMMAND](
    chainKey: string,
    touchKey: string,
    chainId: string,
    activeWindowMs: string,
    restartCooldownMs: string,
    repairChainId: string,
    nowMs: string,
  ): Promise<unknown>;
  [ADVANCE_CHAIN_COMMAND](
    chainKey: string,
    chainId: string,
    iteration: string,
    next: string,
    nowMs: string,
  ): Promise<unknown>;
  [RELEASE_CHAIN_COMMAND](chainKey: string, chainId: string): Promise<unknown>;
};

const touchReplySchema = z.union([
  z.tuple([z.literal('start')]),
  z.tuple([z.literal('restart'), z.string(), z.coerce.number()]),
  z.tuple([z.literal('extend'), z.string(), z.coerce.number(), z.coerce.number()]),
]);

type TouchResult =
  | { action: 'start' }
  | { action: 'restart'; previousChainId: string; previousIteration: number }
  | { action: 'extend'; chainId: string; iteration: number; updatedAt: number };

class UTXOSyncerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UTXOSyncerError';
  }
}

/**
 * UTXOSyncer is used to sync the utxos for the btc address.
 * The utxos are stored in the cache with the btc address as the key,
 * will be resync when the btc address txs are updated.
 *
 * Each address has at most one sync chain: delayed jobs with ids derived from
 * (address, chainId, iteration). A job schedules one successor after it ran; the iteration
 * marker in Redis makes sure a job that runs twice (retry, stalled) can't schedule a second one.
 * The chain stops once the address hasn't been requested for the active window.
 */
export default class UTXOSyncer extends BaseQueueWorker<IUTXOSyncRequest, IUTXOSyncJobReturn> {
  private cradle: Cradle;
  private dataCache: DataCache<IUTXOSyncJobReturn>;

  constructor(cradle: Cradle) {
    super({
      name: UTXO_SYNCER_QUEUE_NAME,
      connection: cradle.redis,
      queue: {
        defaultJobOptions: {
          // retries can't fan out: the successor id is deterministic and the marker is CAS-advanced
          attempts: 3,
          backoff: { type: 'exponential', delay: cradle.env.UTXO_SYNC_REPEAT_BASE_DURATION },
          removeOnComplete: true,
          removeOnFail: true,
        },
      },
      worker: {
        lockDuration: 60_000,
      },
    });
    this.cradle = cradle;
    cradle.redis.defineCommand(TOUCH_CHAIN_COMMAND, { numberOfKeys: 2, lua: TOUCH_CHAIN_SCRIPT });
    cradle.redis.defineCommand(ADVANCE_CHAIN_COMMAND, { numberOfKeys: 1, lua: ADVANCE_CHAIN_SCRIPT });
    cradle.redis.defineCommand(RELEASE_CHAIN_COMMAND, { numberOfKeys: 1, lua: RELEASE_CHAIN_SCRIPT });
    this.dataCache = new DataCache(cradle.redis, {
      prefix: 'utxo-syncer-data',
      schema: z.object({
        btcAddress: z.string(),
        utxos: z.array(UTXO),
        txsHash: z.string(),
      }),
      expire: cradle.env.UTXO_SYNC_DATA_CACHE_EXPIRE,
    });
  }

  private get redis() {
    return this.cradle.redis;
  }

  private get scripts() {
    return this.cradle.redis as ScriptClient;
  }

  public static chainKey(btcAddress: string) {
    return `${CHAIN_KEY_PREFIX}${btcAddress}`;
  }

  public static touchKey(btcAddress: string) {
    return `${TOUCH_KEY_PREFIX}${btcAddress}`;
  }

  public static tombstoneKey(btcAddress: string) {
    return `${TOMBSTONE_KEY_PREFIX}${btcAddress}`;
  }

  /**
   * Deterministic job id, never parsed back. '-' instead of ':' because newer BullMQ rejects ':' in custom ids.
   */
  public static jobId(btcAddress: string, chainId: string, iteration: number) {
    return `${btcAddress}-${chainId}-${iteration}`;
  }

  /**
   * Delay before the given iteration runs.
   * For default values (base=10s, max=3600s): 0, 20s, 40s, 80s, ..., 3600s, 3600s, ... plus jitter
   */
  public static getIterationDelay(cradle: Cradle, iteration: number) {
    if (iteration === 0) {
      return 0;
    }
    const { UTXO_SYNC_REPEAT_BASE_DURATION: base, UTXO_SYNC_REPEAT_MAX_DURATION: max } = cradle.env;
    return Math.min(Math.pow(2, iteration) * base, max) + Math.floor(Math.random() * 1000);
  }

  public static isPermanentError(err: unknown) {
    return err instanceof BitcoinClientAPIError && PERMANENT_ERROR_CODES.has(err.errorCode);
  }

  /**
   * Capture the job exception to Sentry with the btcAddress tag
   * @param job - the job that failed
   * @param err - the error that caused the job to fail
   */
  private captureJobExceptionToSentryScope(job: Job<IUTXOSyncRequest>, err: Error) {
    const { btcAddress } = job.data;
    Sentry.withScope((scope) => {
      // Ignore the error for the specified addresses to avoid too many errors
      if (this.cradle.env.SENTRY_IGNORE_UTXO_SYNC_ERROR_ADDRESSES.includes(btcAddress)) {
        return;
      }
      scope.setTag('btcAddress', btcAddress);
      this.cradle.logger.error(err);
      scope.captureException(err);
    });
  }

  /**
   * Get the utxos by btc address
   */
  public async getUtxosByAddress(btcAddress: string, noCache?: boolean) {
    if (this.cradle.env.UTXO_SYNC_DATA_CACHE_ENABLE && !noCache) {
      const cached = await this.dataCache.get(btcAddress);
      if (cached) {
        return cached.utxos;
      }
    }
    const utxos = await this.cradle.bitcoin.getAddressTxsUtxo({ address: btcAddress });
    return utxos;
  }

  /**
   * Whether the address is in permanent error cooldown (e.g. too many UTXOs for the provider)
   */
  public async isTombstoned(btcAddress: string) {
    return (await this.redis.exists(UTXOSyncer.tombstoneKey(btcAddress))) === 1;
  }

  /**
   * Current chain state of the address, null when no chain is active
   */
  public async getChainState(btcAddress: string) {
    const [chainId, iteration] = await this.redis.hmget(UTXOSyncer.chainKey(btcAddress), 'chainId', 'iteration');
    if (!chainId || iteration === null) {
      return null;
    }
    return { chainId, iteration: Number(iteration) };
  }

  private async addChainJob(btcAddress: string, chainId: string, iteration: number) {
    return this.queue.add(
      btcAddress,
      { btcAddress, chainId, iteration },
      {
        jobId: UTXOSyncer.jobId(btcAddress, chainId, iteration),
        delay: UTXOSyncer.getIterationDelay(this.cradle, iteration),
      },
    );
  }

  /**
   * See TOUCH_CHAIN_SCRIPT
   * @param repair - chainId observed without a job, replace it ignoring the cooldown if still current
   */
  private async touchChain(params: { btcAddress: string; chainId: string; repair?: string }): Promise<TouchResult> {
    const { btcAddress, chainId, repair = '' } = params;
    const { env } = this.cradle;
    const reply = touchReplySchema.parse(
      await this.scripts[TOUCH_CHAIN_COMMAND](
        UTXOSyncer.chainKey(btcAddress),
        UTXOSyncer.touchKey(btcAddress),
        chainId,
        String(env.UTXO_SYNC_REPEAT_EXPRIED_DURATION),
        String(env.UTXO_SYNC_RESTART_COOLDOWN),
        repair,
        String(Date.now()),
      ),
    );
    switch (reply[0]) {
      case 'start':
        return { action: 'start' };
      case 'restart':
        return { action: 'restart', previousChainId: reply[1], previousIteration: reply[2] };
      case 'extend':
        return { action: 'extend', chainId: reply[1], iteration: reply[2], updatedAt: reply[3] };
    }
  }

  /**
   * See ADVANCE_CHAIN_SCRIPT
   * @returns whether the marker was advanced
   */
  private async advanceChain(params: { btcAddress: string; chainId: string; iteration: number; next: number }) {
    const { btcAddress, chainId, iteration, next } = params;
    const reply = await this.scripts[ADVANCE_CHAIN_COMMAND](
      UTXOSyncer.chainKey(btcAddress),
      chainId,
      String(iteration),
      String(next),
      String(Date.now()),
    );
    return reply === 1;
  }

  /**
   * The chain is alive while the job of its iteration, or of the next one (added before the marker
   * is advanced), exists
   */
  private async hasPendingJob(btcAddress: string, chainId: string, iteration: number) {
    const keys = [iteration, iteration + 1].map((i) => this.queue.toKey(UTXOSyncer.jobId(btcAddress, chainId, i)));
    return (await this.redis.exists(...keys)) > 0;
  }

  /**
   * Enqueue a sync job for the btc address.
   * Starts a chain if there is none, otherwise extends its window, or restarts it (immediate sync,
   * backoff reset) once per UTXO_SYNC_RESTART_COOLDOWN. A chain that lost its job is restarted right away.
   */
  public async enqueueSyncJob(btcAddress: string) {
    this.cradle.logger.info(`[UTXOSyncer] Enqueue sync job for ${btcAddress}, ${Date.now()}`);
    if (!validateBitcoinAddress(btcAddress)) {
      throw new UTXOSyncerError(`Invalid btc address: ${btcAddress}`);
    }
    if (await this.isTombstoned(btcAddress)) {
      this.cradle.logger.info(`[UTXOSyncer] ${btcAddress} is in permanent error cooldown, skip enqueue`);
      return null;
    }

    const chainId = randomUUID();
    let touched = await this.touchChain({ btcAddress, chainId });

    if (touched.action === 'extend') {
      const recentlyUpdated = Date.now() - touched.updatedAt < REPAIR_GRACE_MS;
      if (recentlyUpdated || (await this.hasPendingJob(btcAddress, touched.chainId, touched.iteration))) {
        return null;
      }
      this.cradle.logger.warn(`[UTXOSyncer] chain ${touched.chainId} of ${btcAddress} has no pending job, repair`);
      touched = await this.touchChain({ btcAddress, chainId, repair: touched.chainId });
      if (touched.action === 'extend') {
        // another request repaired it first
        return null;
      }
    }

    if (touched.action === 'restart') {
      // best effort, the old chain stops itself anyway when its job runs
      const previousJobId = UTXOSyncer.jobId(btcAddress, touched.previousChainId, touched.previousIteration);
      await this.queue.remove(previousJobId).catch(() => undefined);
    }
    this.cradle.logger.info(`[UTXOSyncer] ${touched.action} chain ${chainId} for ${btcAddress}`);
    try {
      return await this.addChainJob(btcAddress, chainId, 0);
    } catch (err) {
      // don't leave a chain without a job behind. A request that saw the chain during the grace
      // period has already returned, that address gets its chain on the request after it.
      await this.scripts[RELEASE_CHAIN_COMMAND](UTXOSyncer.chainKey(btcAddress), chainId).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Schedule the successor of a job, at most once per iteration.
   * Add first, advance the marker second: a crash in between is repaired by re-running the job,
   * the re-added successor is a no-op if it still exists and can't advance the marker if it already ran.
   */
  private async scheduleNext(data: IUTXOSyncRequest) {
    const { btcAddress, chainId, iteration } = data;
    const next = iteration + 1;

    const state = await this.getChainState(btcAddress);
    if (!state) {
      this.cradle.logger.info(`[UTXOSyncer] ${btcAddress} not requested recently, stop chain ${chainId}`);
      return;
    }
    if (state.chainId !== chainId || state.iteration > iteration) {
      this.cradle.logger.info(`[UTXOSyncer] ${btcAddress} iteration ${iteration} of chain ${chainId} is stale, skip`);
      return;
    }

    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.addChainJob(btcAddress, chainId, next);
        const advanced = await this.advanceChain({ btcAddress, chainId, iteration, next });
        if (!advanced) {
          this.cradle.logger.info(
            `[UTXOSyncer] ${btcAddress} chain ${chainId} moved on while scheduling iteration ${next}`,
          );
        }
        return;
      } catch (err) {
        if (attempt >= SCHEDULE_ATTEMPTS) {
          // the next request for the address repairs the chain
          this.cradle.logger.error(
            `[UTXOSyncer] failed to schedule iteration ${next} of chain ${chainId} for ${btcAddress}: ${(err as Error).message}`,
          );
          throw err;
        }
        await sleep(SCHEDULE_RETRY_DELAY_MS * attempt);
      }
    }
  }

  private async tombstone(btcAddress: string, reason: string) {
    this.cradle.logger.warn(`[UTXOSyncer] ${btcAddress} hit a permanent error, stop syncing: ${reason}`);
    await this.redis
      .multi()
      .set(UTXOSyncer.tombstoneKey(btcAddress), reason, 'PX', this.cradle.env.UTXO_SYNC_PERMANENT_ERROR_COOLDOWN)
      .del(UTXOSyncer.chainKey(btcAddress))
      .exec();
  }

  public async process(job: Job<IUTXOSyncRequest>) {
    const { btcAddress, chainId, iteration } = job.data;
    if (!validateBitcoinAddress(btcAddress)) {
      throw new UnrecoverableError(`Invalid btc address: ${btcAddress}`);
    }

    const state = await this.getChainState(btcAddress);
    if (!state || state.chainId !== chainId || state.iteration > iteration) {
      this.cradle.logger.info(
        `[UTXOSyncer] iteration ${iteration} of chain ${chainId} for ${btcAddress} is stale, skip`,
      );
      return;
    }
    if (await this.isTombstoned(btcAddress)) {
      this.cradle.logger.info(`[UTXOSyncer] ${btcAddress} is in permanent error cooldown, skip`);
      return;
    }

    let result: IUTXOSyncJobReturn | undefined;
    try {
      const txs = await this.cradle.bitcoin.getAddressTxs({ address: btcAddress });
      const txsHash = sha256(Buffer.from(txs.map((tx) => tx.txid + JSON.stringify(tx.status)).join(','))).toString();

      // check if the data is updated
      const cached = await this.dataCache.get(btcAddress);
      if (cached && txsHash === cached.txsHash) {
        this.cradle.logger.info(`[UTXOSyncer] ${btcAddress} is up to date, skip sync job`);
        result = cached;
      } else {
        const utxos = await this.cradle.bitcoin.getAddressTxsUtxo({ address: btcAddress });
        result = { btcAddress, utxos, txsHash };
        await this.dataCache.set(btcAddress, result);
      }
    } catch (e) {
      const { message, stack } = e as Error;
      const error = new UTXOSyncerError(message);
      error.stack = stack;
      this.captureJobExceptionToSentryScope(job, error);

      if (UTXOSyncer.isPermanentError(e)) {
        await this.tombstone(btcAddress, message);
        throw new UnrecoverableError(message);
      }
      // transient, keep the chain going
      await this.scheduleNext(job.data);
      throw e;
    }

    await this.scheduleNext({ btcAddress, chainId, iteration });
    return result;
  }
}
