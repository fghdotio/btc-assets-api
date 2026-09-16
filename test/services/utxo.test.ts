import container, { Cradle } from '../../src/container';
import { describe, test, beforeAll, beforeEach, afterEach, afterAll, vi, expect } from 'vitest';
import { Job, UnrecoverableError } from 'bullmq';
import UTXOSyncer, { IUTXOSyncRequest, UTXO_SYNCER_QUEUE_NAME } from '../../src/services/utxo';
import { BitcoinClientAPIError } from '../../src/services/bitcoin';

const ADDRESS_A = 'tb1quqtqsh5jrlr9p5wnpu3rs883lqh4avpwc766x3';
const ADDRESS_B = 'tb1q2fd0fpgu2jhcddkwu296c386w4tnm9qzp9dazj';

const fakeJob = (data: IUTXOSyncRequest) => ({ data }) as Job<IUTXOSyncRequest>;

describe('UTXOSyncer', () => {
  let cradle: Cradle;
  let utxoSyncer: UTXOSyncer;
  let envBackup: Partial<Cradle['env']>;

  const queue = () => utxoSyncer['queue'];
  const chainState = (address: string) => utxoSyncer.getChainState(address);
  const chainJobId = (address: string, chainId: string, iteration: number) =>
    UTXOSyncer.jobId(address, chainId, iteration);

  beforeAll(() => {
    cradle = container.cradle;
    utxoSyncer = new UTXOSyncer(cradle);
  });

  // other test files share this Redis, only touch our keys
  const cleanup = async () => {
    for (const pattern of ['utxo-syncer:*', `bull:${UTXO_SYNCER_QUEUE_NAME}:*`]) {
      let cursor = '0';
      do {
        const [next, keys] = await cradle.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
        cursor = next;
        if (keys.length > 0) {
          await cradle.redis.del(...keys);
        }
      } while (cursor !== '0');
    }
  };

  beforeEach(async () => {
    await cleanup();
    envBackup = {
      UTXO_SYNC_REPEAT_BASE_DURATION: cradle.env.UTXO_SYNC_REPEAT_BASE_DURATION,
      UTXO_SYNC_REPEAT_MAX_DURATION: cradle.env.UTXO_SYNC_REPEAT_MAX_DURATION,
      UTXO_SYNC_REPEAT_EXPRIED_DURATION: cradle.env.UTXO_SYNC_REPEAT_EXPRIED_DURATION,
    };
    vi.spyOn(cradle.bitcoin, 'getAddressTxs').mockResolvedValue([]);
    vi.spyOn(cradle.bitcoin, 'getAddressTxsUtxo').mockResolvedValue([]);
  });

  afterEach(() => {
    Object.assign(cradle.env, envBackup);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanup();
    await utxoSyncer.closeProcess();
  });

  describe('getIterationDelay', () => {
    test('iteration 0 runs immediately', () => {
      expect(UTXOSyncer.getIterationDelay(cradle, 0)).toBe(0);
    });

    test('grows exponentially from 2x base duration', () => {
      const base = cradle.env.UTXO_SYNC_REPEAT_BASE_DURATION;
      expect(UTXOSyncer.getIterationDelay(cradle, 1)).toBeGreaterThanOrEqual(base * 2);
      expect(UTXOSyncer.getIterationDelay(cradle, 1)).toBeLessThan(base * 2 + 1000);
      expect(UTXOSyncer.getIterationDelay(cradle, 3)).toBeGreaterThanOrEqual(base * 8);
    });

    test('is capped at max duration', () => {
      cradle.env.UTXO_SYNC_REPEAT_MAX_DURATION = 60 * 1000;
      expect(UTXOSyncer.getIterationDelay(cradle, 100)).toBeLessThan(60 * 1000 + 1000);
    });
  });

  describe('enqueueSyncJob', () => {
    test('starts a chain and adds iteration 0 with a deterministic job id', async () => {
      const job = await utxoSyncer.enqueueSyncJob(ADDRESS_A);
      const state = await chainState(ADDRESS_A);

      expect(state).toEqual({ chainId: expect.any(String), iteration: 0 });
      expect(job?.id).toBe(chainJobId(ADDRESS_A, state!.chainId, 0));
      expect(job?.data).toEqual({ btcAddress: ADDRESS_A, chainId: state!.chainId, iteration: 0 });
      expect(await queue().getWaitingCount()).toBe(1);
    });

    test('does not read the repeatable job list', async () => {
      const spy = vi.spyOn(queue(), 'getRepeatableJobs');
      await utxoSyncer.enqueueSyncJob(ADDRESS_A);
      expect(spy).not.toHaveBeenCalled();
    });

    test('a request shortly after another one only extends the chain window', async () => {
      const first = await utxoSyncer.enqueueSyncJob(ADDRESS_A);
      const stateAfterFirst = await chainState(ADDRESS_A);
      await cradle.redis.pexpire(UTXOSyncer.chainKey(ADDRESS_A), 1000);

      const second = await utxoSyncer.enqueueSyncJob(ADDRESS_A);

      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(await chainState(ADDRESS_A)).toEqual(stateAfterFirst);
      expect(await cradle.redis.pttl(UTXOSyncer.chainKey(ADDRESS_A))).toBeGreaterThan(1000);
      expect(await queue().getWaitingCount()).toBe(1);
    });

    test('concurrent requests for one address create exactly one chain and one job', async () => {
      const results = await Promise.all(Array.from({ length: 20 }, () => utxoSyncer.enqueueSyncJob(ADDRESS_A)));

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await queue().getWaitingCount()).toBe(1);
      expect(await cradle.redis.keys(`${UTXOSyncer.chainKey('')}*`)).toHaveLength(1);
    });

    test('requests for different addresses are not throttled by each other', async () => {
      const [a, b] = await Promise.all([utxoSyncer.enqueueSyncJob(ADDRESS_A), utxoSyncer.enqueueSyncJob(ADDRESS_B)]);

      expect(a?.data.btcAddress).toBe(ADDRESS_A);
      expect(b?.data.btcAddress).toBe(ADDRESS_B);
      expect(await queue().getWaitingCount()).toBe(2);
    });

    test('restarts the chain once the restart cooldown has passed and drops the superseded job', async () => {
      const first = await utxoSyncer.enqueueSyncJob(ADDRESS_A);
      const firstChain = (await chainState(ADDRESS_A))!.chainId;
      // the restart cooldown has passed
      await cradle.redis.del(UTXOSyncer.touchKey(ADDRESS_A));

      const second = await utxoSyncer.enqueueSyncJob(ADDRESS_A);
      const secondChain = (await chainState(ADDRESS_A))!.chainId;

      expect(second).not.toBeNull();
      expect(secondChain).not.toBe(firstChain);
      expect(await queue().getJob(first!.id!)).toBeUndefined();
      expect(await queue().getJob(second!.id!)).toBeDefined();
      expect(await queue().getWaitingCount()).toBe(1);
    });

    test('the restart cooldown is UTXO_SYNC_RESTART_COOLDOWN, not the backoff base duration', async () => {
      await utxoSyncer.enqueueSyncJob(ADDRESS_A);
      const ttl = await cradle.redis.pttl(UTXOSyncer.touchKey(ADDRESS_A));
      expect(ttl).toBeGreaterThan(cradle.env.UTXO_SYNC_REPEAT_BASE_DURATION);
      expect(ttl).toBeLessThanOrEqual(cradle.env.UTXO_SYNC_RESTART_COOLDOWN);
    });

    test('repairs a chain whose pending job is gone, ignoring the restart cooldown', async () => {
      const first = await utxoSyncer.enqueueSyncJob(ADDRESS_A);
      const firstChain = (await chainState(ADDRESS_A))!.chainId;
      // job gone and the chain older than the repair grace period
      await first!.remove();
      await cradle.redis.hset(UTXOSyncer.chainKey(ADDRESS_A), 'updatedAt', Date.now() - 60_000);

      const repaired = await utxoSyncer.enqueueSyncJob(ADDRESS_A);
      const repairedChain = (await chainState(ADDRESS_A))!.chainId;

      expect(repaired).not.toBeNull();
      expect(repairedChain).not.toBe(firstChain);
      expect(await queue().getWaitingCount()).toBe(1);
      // and once healthy, the next request within the cooldown only extends
      expect(await utxoSyncer.enqueueSyncJob(ADDRESS_A)).toBeNull();
    });

    test('concurrent repairs of a job-less chain replace it exactly once', async () => {
      const first = await utxoSyncer.enqueueSyncJob(ADDRESS_A);
      const brokenChain = (await chainState(ADDRESS_A))!.chainId;
      await first!.remove();
      await cradle.redis.hset(UTXOSyncer.chainKey(ADDRESS_A), 'updatedAt', Date.now() - 60_000);

      const results = await Promise.all(Array.from({ length: 20 }, () => utxoSyncer.enqueueSyncJob(ADDRESS_A)));

      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await chainState(ADDRESS_A))!.chainId).not.toBe(brokenChain);
      expect(await queue().getWaitingCount()).toBe(1);
      expect(await cradle.redis.keys(`${UTXOSyncer.chainKey('')}*`)).toHaveLength(1);
    });

    test('rolls the chain back when the first job can not be added', async () => {
      vi.spyOn(queue(), 'add').mockRejectedValueOnce(new Error('redis down'));

      await expect(utxoSyncer.enqueueSyncJob(ADDRESS_A)).rejects.toThrow('redis down');

      expect(await chainState(ADDRESS_A)).toBeNull();
      // the next request starts a fresh chain immediately, no repair grace period involved
      const job = await utxoSyncer.enqueueSyncJob(ADDRESS_A);
      expect(job).not.toBeNull();
      expect(await queue().getWaitingCount()).toBe(1);
    });

    test('a freshly started chain is not repaired before its job is added', async () => {
      const chainId = 'fresh';
      await utxoSyncer['touchChain']({ btcAddress: ADDRESS_A, chainId });
      // no job yet, but the state was written a moment ago

      expect(await utxoSyncer.enqueueSyncJob(ADDRESS_A)).toBeNull();
      expect((await chainState(ADDRESS_A))!.chainId).toBe(chainId);
    });

    test('a chain in the add-then-advance window is considered healthy', async () => {
      await utxoSyncer.enqueueSyncJob(ADDRESS_A);
      const { chainId } = (await chainState(ADDRESS_A))!;
      // iteration 0 ran and was removed, iteration 1 was added but the marker was not advanced yet
      await (await queue().getJob(chainJobId(ADDRESS_A, chainId, 0)))!.remove();
      await utxoSyncer['addChainJob'](ADDRESS_A, chainId, 1);
      await cradle.redis.hset(UTXOSyncer.chainKey(ADDRESS_A), 'updatedAt', Date.now() - 60_000);

      expect(await utxoSyncer.enqueueSyncJob(ADDRESS_A)).toBeNull();
      expect((await chainState(ADDRESS_A))!.chainId).toBe(chainId);
    });

    test('skips addresses under permanent error cooldown', async () => {
      await cradle.redis.set(UTXOSyncer.tombstoneKey(ADDRESS_A), 'too many utxos', 'PX', 60_000);

      expect(await utxoSyncer.enqueueSyncJob(ADDRESS_A)).toBeNull();
      expect(await chainState(ADDRESS_A)).toBeNull();
      expect(await queue().getWaitingCount()).toBe(0);
    });

    test('rejects invalid addresses', async () => {
      await expect(utxoSyncer.enqueueSyncJob('not-an-address')).rejects.toThrow('Invalid btc address');
    });
  });

  describe('process', () => {
    let job0: Job<IUTXOSyncRequest>;
    let chainId: string;

    beforeEach(async () => {
      const job = await utxoSyncer.enqueueSyncJob(ADDRESS_A);
      chainId = job!.data.chainId;
      job0 = fakeJob(job!.data);
    });

    test('schedules exactly one successor and advances the iteration marker', async () => {
      await utxoSyncer.process(job0);

      expect(await chainState(ADDRESS_A)).toEqual({ chainId, iteration: 1 });
      const successor = await queue().getJob(chainJobId(ADDRESS_A, chainId, 1));
      expect(successor?.data).toEqual({ btcAddress: ADDRESS_A, chainId, iteration: 1 });
      expect(successor?.opts.delay).toBeGreaterThanOrEqual(cradle.env.UTXO_SYNC_REPEAT_BASE_DURATION * 2);
      expect(successor?.opts.attempts).toBe(3);
      expect(await queue().getDelayedCount()).toBe(1);
    });

    test('running the same iteration twice (retry / stalled) does not create a second successor', async () => {
      await utxoSyncer.process(job0);
      await utxoSyncer.process(job0);

      expect(await chainState(ADDRESS_A)).toEqual({ chainId, iteration: 1 });
      expect(await queue().getDelayedCount()).toBe(1);
    });

    test('a job recovered after its successor already ran can not re-create that iteration', async () => {
      await utxoSyncer.process(job0);
      // iteration 1 runs and is removed on completion
      const job1 = await queue().getJob(chainJobId(ADDRESS_A, chainId, 1));
      await job1!.remove();
      await utxoSyncer.process(fakeJob(job1!.data));
      expect(await chainState(ADDRESS_A)).toEqual({ chainId, iteration: 2 });

      // iteration 0 comes back late
      await utxoSyncer.process(job0);

      expect(await chainState(ADDRESS_A)).toEqual({ chainId, iteration: 2 });
      expect(await queue().getJob(chainJobId(ADDRESS_A, chainId, 1))).toBeUndefined();
      expect(await queue().getDelayedCount()).toBe(1);
    });

    test('recovers when the process died after adding the successor but before advancing the marker', async () => {
      // successor exists, marker still at 0
      await utxoSyncer['addChainJob'](ADDRESS_A, chainId, 1);
      const job1 = await queue().getJob(chainJobId(ADDRESS_A, chainId, 1));

      await utxoSyncer.process(fakeJob(job1!.data));

      expect(await chainState(ADDRESS_A)).toEqual({ chainId, iteration: 2 });
      expect(await queue().getJob(chainJobId(ADDRESS_A, chainId, 2))).toBeDefined();
      // and the late iteration 0 is now stale
      await utxoSyncer.process(job0);
      expect(await chainState(ADDRESS_A)).toEqual({ chainId, iteration: 2 });
    });

    test('a stale iteration of the current chain does not call the provider', async () => {
      await utxoSyncer.process(job0);
      const job1 = await queue().getJob(chainJobId(ADDRESS_A, chainId, 1));
      await job1!.remove();
      await utxoSyncer.process(fakeJob(job1!.data));
      vi.mocked(cradle.bitcoin.getAddressTxs).mockClear();

      // iteration 0 comes back late
      await utxoSyncer.process(job0);

      expect(cradle.bitcoin.getAddressTxs).not.toHaveBeenCalled();
      expect(await chainState(ADDRESS_A)).toEqual({ chainId, iteration: 2 });
    });

    test('retries scheduling the successor before giving up', async () => {
      const add = vi.spyOn(queue(), 'add');
      add.mockRejectedValueOnce(new Error('redis hiccup'));

      await utxoSyncer.process(job0);

      expect(add).toHaveBeenCalledTimes(2);
      expect(await chainState(ADDRESS_A)).toEqual({ chainId, iteration: 1 });
      expect(await queue().getJob(chainJobId(ADDRESS_A, chainId, 1))).toBeDefined();
    });

    test('fails the job when the successor can not be scheduled, and a retry of the job schedules it', async () => {
      const add = vi.spyOn(queue(), 'add').mockRejectedValue(new Error('redis down'));

      await expect(utxoSyncer.process(job0)).rejects.toThrow('redis down');
      expect(await chainState(ADDRESS_A)).toEqual({ chainId, iteration: 0 });

      // BullMQ retries the job (attempts > 1): the marker was not advanced, so it does the work again
      add.mockRestore();
      await utxoSyncer.process(job0);

      expect(await chainState(ADDRESS_A)).toEqual({ chainId, iteration: 1 });
      expect(await queue().getJob(chainJobId(ADDRESS_A, chainId, 1))).toBeDefined();
      expect(await queue().getDelayedCount()).toBe(1);
    });

    test('a retry after a transient provider error is skipped without calling the provider', async () => {
      vi.mocked(cradle.bitcoin.getAddressTxs).mockRejectedValueOnce(new Error('timeout'));
      await expect(utxoSyncer.process(job0)).rejects.toThrow('timeout');
      expect(await chainState(ADDRESS_A)).toEqual({ chainId, iteration: 1 });
      vi.mocked(cradle.bitcoin.getAddressTxs).mockClear();

      // BullMQ retries the job: the successor is already scheduled, so this activation is stale
      await utxoSyncer.process(job0);

      expect(cradle.bitcoin.getAddressTxs).not.toHaveBeenCalled();
      expect(await queue().getDelayedCount()).toBe(1);
    });

    test('a job that exhausted its attempts leaves the chain repairable by the next request', async () => {
      vi.spyOn(queue(), 'add').mockRejectedValue(new Error('redis down'));
      await expect(utxoSyncer.process(job0)).rejects.toThrow('redis down');
      vi.restoreAllMocks();
      vi.spyOn(cradle.bitcoin, 'getAddressTxs').mockResolvedValue([]);
      vi.spyOn(cradle.bitcoin, 'getAddressTxsUtxo').mockResolvedValue([]);

      // job 0 was removed after its last attempt and no successor exists
      await (await queue().getJob(chainJobId(ADDRESS_A, chainId, 0)))?.remove();
      await cradle.redis.hset(UTXOSyncer.chainKey(ADDRESS_A), 'updatedAt', Date.now() - 60_000);
      const repaired = await utxoSyncer.enqueueSyncJob(ADDRESS_A);

      expect(repaired).not.toBeNull();
      expect((await chainState(ADDRESS_A))!.chainId).not.toBe(chainId);
    });

    test('stops without calling the provider once the chain window has expired', async () => {
      await cradle.redis.del(UTXOSyncer.chainKey(ADDRESS_A));

      await utxoSyncer.process(job0);

      expect(cradle.bitcoin.getAddressTxs).not.toHaveBeenCalled();
      expect(await queue().getDelayedCount()).toBe(0);
    });

    test('a job of a superseded chain stops without scheduling', async () => {
      // the restart rate limit has passed
      await cradle.redis.del(UTXOSyncer.touchKey(ADDRESS_A));
      await utxoSyncer.enqueueSyncJob(ADDRESS_A);
      const newChain = (await chainState(ADDRESS_A))!.chainId;
      expect(newChain).not.toBe(chainId);

      await utxoSyncer.process(job0);

      expect(cradle.bitcoin.getAddressTxs).not.toHaveBeenCalled();
      expect(await chainState(ADDRESS_A)).toEqual({ chainId: newChain, iteration: 0 });
      expect(await queue().getJob(chainJobId(ADDRESS_A, chainId, 1))).toBeUndefined();
    });

    test('a transient error keeps the chain alive with a single successor', async () => {
      vi.mocked(cradle.bitcoin.getAddressTxs).mockRejectedValue(new Error('timeout'));

      await expect(utxoSyncer.process(job0)).rejects.toThrow('timeout');

      expect(await chainState(ADDRESS_A)).toEqual({ chainId, iteration: 1 });
      expect(await queue().getDelayedCount()).toBe(1);
    });

    test('a permanent provider error tombstones the address and ends the chain', async () => {
      vi.mocked(cradle.bitcoin.getAddressTxs).mockRejectedValue(
        new BitcoinClientAPIError('Too many unspent transaction outputs (>2000). Contact support to raise limits.'),
      );

      await expect(utxoSyncer.process(job0)).rejects.toBeInstanceOf(UnrecoverableError);

      expect(await utxoSyncer.isTombstoned(ADDRESS_A)).toBe(true);
      expect(await chainState(ADDRESS_A)).toBeNull();
      expect(await queue().getDelayedCount()).toBe(0);
      // later requests do not start a new chain while the cooldown lasts
      expect(await utxoSyncer.enqueueSyncJob(ADDRESS_A)).toBeNull();
      // and a job of the old chain that is still around exits before touching the provider
      vi.mocked(cradle.bitcoin.getAddressTxs).mockClear();
      await utxoSyncer.process(job0);
      expect(cradle.bitcoin.getAddressTxs).not.toHaveBeenCalled();
    });

    test('a skipped job completes without a return value, a synced job with one (real worker)', async () => {
      // own instance so its worker can be closed at the end
      const syncer = new UTXOSyncer(cradle);
      const completed: Array<{ id: string; returnvalue: unknown }> = [];
      const waitForCompleted = (count: number) =>
        new Promise<void>((resolve) => {
          const check = () => (completed.length >= count ? resolve() : setTimeout(check, 20));
          check();
        });
      try {
        // resolves when the worker closes, don't await
        void syncer.startProcess({
          onCompleted: (job) => {
            completed.push({ id: job.id!, returnvalue: job.returnvalue });
          },
        });
        // job0 is stale: its chain has moved on to iteration 1 already
        await syncer['advanceChain']({ btcAddress: ADDRESS_A, chainId, iteration: 0, next: 1 });
        const stale = await queue().getJob(chainJobId(ADDRESS_A, chainId, 0));
        expect(stale).toBeDefined();
        await stale!.promote().catch(() => undefined);
        await waitForCompleted(1);
        // now a job that really syncs: iteration 1 of the same chain
        await syncer['addChainJob'](ADDRESS_A, chainId, 1);
        await (await queue().getJob(chainJobId(ADDRESS_A, chainId, 1)))!.promote();
        await waitForCompleted(2);
      } finally {
        await syncer.closeProcess();
      }

      expect(completed[0]).toEqual({ id: chainJobId(ADDRESS_A, chainId, 0), returnvalue: undefined });
      expect(completed[1].id).toBe(chainJobId(ADDRESS_A, chainId, 1));
      expect(completed[1].returnvalue).toEqual({ btcAddress: ADDRESS_A, utxos: [], txsHash: expect.any(String) });
    });

    test('rejects invalid addresses without retry', async () => {
      await expect(
        utxoSyncer.process(fakeJob({ btcAddress: 'not-an-address', chainId, iteration: 0 })),
      ).rejects.toBeInstanceOf(UnrecoverableError);
    });
  });
});
