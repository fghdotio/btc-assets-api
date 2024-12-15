import { validateBitcoinAddress } from '../../utils/validators';
import BaseUTXOSyncer from './base';
import { Cradle } from '../../container';
import { Job } from 'bullmq';
import { sha256 } from 'bitcoinjs-lib/src/crypto';
import * as Sentry from '@sentry/node';
import { UTXOSyncerError } from './types';
import { IUTXOSyncRequest } from './interface';

const BTC_UTXO_SYNCER_QUEUE_NAME = 'btc-utxo-syncer';
const BTC_CACHE_PREFIX = 'btc-utxo-syncer-data';

class BitcoinUTXOSyncer extends BaseUTXOSyncer {
  constructor(cradle: Cradle) {
    super(cradle, BTC_UTXO_SYNCER_QUEUE_NAME, BTC_CACHE_PREFIX);
  }

  protected validateAddress(address: string): boolean {
    return validateBitcoinAddress(address);
  }

  public async getUtxosByAddress(address: string, noCache?: boolean) {
    if (this.cradle.env.UTXO_SYNC_DATA_CACHE_ENABLE && !noCache) {
      const cached = await this.dataCache.get(address);
      if (cached) {
        return cached.utxos;
      }
    }
    const utxos = await this.cradle.bitcoin.getAddressTxsUtxo({ address: address });
    return utxos;
  }

  public async enqueueSyncJob(btcAddress: string) {
    this.cradle.logger.info(`[UTXOSyncer] Enqueue sync job for btc address ${btcAddress}, ${Date.now()}`);
    if (!validateBitcoinAddress(btcAddress)) {
      throw new UTXOSyncerError(`Invalid btc address: ${btcAddress}`);
    }
    return this.enqueueSyncJobThrottle(btcAddress);
  }

  private captureJobExceptionToSentryScope(job: Job<IUTXOSyncRequest>, err: Error) {
    const { address: btcAddress } = job.data;
    Sentry.withScope((scope) => {
      // Ignore the error for the specified addresses to avoid too many errors
      if (this.cradle.env.SENTRY_IGNORE_UTXO_SYNC_ERROR_ADDRESSES.includes(btcAddress)) {
        return;
      }
      scope.setTag('btcAddress', btcAddress);
      this.cradle.logger.error(err, `btc address ${btcAddress} process error`);
      scope.captureException(err);
    });
  }

  public async process(job: Job<IUTXOSyncRequest>) {
    try {
      const { address: btcAddress } = job.data;
      if (!validateBitcoinAddress(btcAddress)) {
        if (job.repeatJobKey) {
          await this.queue.removeRepeatableByKey(job.repeatJobKey);
        }
        throw new Error(`Invalid btc address: ${btcAddress}`);
      }

      const txs = await this.cradle.bitcoin.getAddressTxs({ address: btcAddress });
      const txsHash = sha256(Buffer.from(txs.map((tx) => tx.txid + JSON.stringify(tx.status)).join(','))).toString();

      // check if the data is updated
      const cached = await this.dataCache.get(btcAddress);
      if (cached && txsHash === cached.txsHash) {
        this.cradle.logger.info(`[UTXOSyncer] btc address ${btcAddress} is up to date, skip sync job`);
        return cached;
      }

      const utxos = await this.cradle.bitcoin.getAddressTxsUtxo({ address: btcAddress });
      const data = { btcAddress, utxos, txsHash };
      await this.dataCache.set(btcAddress, data);
    } catch (e) {
      const { message, stack } = e as Error;
      const error = new UTXOSyncerError(message);
      error.stack = stack;
      this.captureJobExceptionToSentryScope(job, error);
      throw e;
    }
  }
}

export default BitcoinUTXOSyncer;
