import { validateDogecoinAddress } from '../../utils/validators';
import BaseUTXOSyncer from './base';
import { Cradle } from '../../container';
import { Job } from 'bullmq';
import { sha256 } from 'bitcoinjs-lib/src/crypto';
import * as Sentry from '@sentry/node';
import { UTXOSyncerError } from './types';
import { IUTXOSyncRequest } from './interface';

const DOGE_UTXO_SYNCER_QUEUE_NAME = 'doge-utxo-syncer-queue';
const DOGE_CACHE_PREFIX = 'doge-utxo-syncer-data';

class DogecoinUTXOSyncer extends BaseUTXOSyncer {
  constructor(cradle: Cradle) {
    super(cradle, DOGE_UTXO_SYNCER_QUEUE_NAME, DOGE_CACHE_PREFIX);
  }

  protected validateAddress(address: string): boolean {
    return validateDogecoinAddress(address);
  }

  public async getUtxosByAddress(address: string, noCache?: boolean) {
    if (this.cradle.env.UTXO_SYNC_DATA_CACHE_ENABLE && !noCache) {
      const cached = await this.dataCache.get(address);
      if (cached) {
        return cached.utxos;
      }
    }
    const utxos = await this.cradle.doge.getAddressTxsUtxo({ address: address });
    return utxos;
  }

  public async enqueueSyncJob(dogeAddress: string) {
    this.cradle.logger.info(`[UTXOSyncer] Enqueue sync job for doge address ${dogeAddress}, ${Date.now()}`);
    if (!validateDogecoinAddress(dogeAddress)) {
      throw new UTXOSyncerError(`Invalid doge address: ${dogeAddress}`);
    }
    return this.enqueueSyncJobThrottle(dogeAddress);
  }

  private captureJobExceptionToSentryScope(job: Job<IUTXOSyncRequest>, err: Error) {
    const { address: dogeAddress } = job.data;
    Sentry.withScope((scope) => {
      scope.setTag('dogeAddress', dogeAddress);
      this.cradle.logger.error(err, `doge address ${dogeAddress} process error`);
      scope.captureException(err);
    });
  }

  public async process(job: Job<IUTXOSyncRequest>) {
    try {
      const { address: dogeAddress } = job.data;
      if (!validateDogecoinAddress(dogeAddress)) {
        if (job.repeatJobKey) {
          await this.queue.removeRepeatableByKey(job.repeatJobKey);
        }
        throw new Error(`Invalid doge address: ${dogeAddress}`);
      }

      const txs = await this.cradle.doge.getAddressTxs({ address: dogeAddress });
      const txsHash = sha256(Buffer.from(txs.map((tx) => tx.txid + JSON.stringify(tx.status)).join(','))).toString();

      // check if the data is updated
      const cached = await this.dataCache.get(dogeAddress);
      if (cached && txsHash === cached.txsHash) {
        this.cradle.logger.info(`[UTXOSyncer] doge address ${dogeAddress} is up to date, skip sync job`);
        return cached;
      }

      const utxos = await this.cradle.doge.getAddressTxsUtxo({ address: dogeAddress });
      const data = { dogeAddress, utxos, txsHash };
      await this.dataCache.set(dogeAddress, data);
    } catch (e) {
      const { message, stack } = e as Error;
      const error = new UTXOSyncerError(message);
      error.stack = stack;
      this.captureJobExceptionToSentryScope(job, error);
      throw e;
    }
  }
}

export default DogecoinUTXOSyncer;
