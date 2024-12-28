import axios, { AxiosInstance } from 'axios';
import * as Sentry from '@sentry/node';
import { addLoggerInterceptor } from '../utils/interceptors';
import { Cradle } from '../container';
import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import { remove0x } from '@rgbpp-sdk/btc';

export const TxProof = z.object({
  spv_client: z.object({
    tx_hash: z.string(),
    index: z.string(),
  }),
  proof: z.string(),
});
export type TxProof = z.infer<typeof TxProof>;

// https://github.com/ckb-cell/ckb-bitcoin-spv-service/blob/master/src/components/api_service/error.rs
export enum BitcoinSPVErrorCode {
  StorageTxTooNew = 23101,
  StorageTxUnconfirmed,
  StorageHeaderMissing = 23301,
  StorageHeaderUnmatched,
  OnchainTxUnconfirmed = 25101,
  OnchainReorgRequired = 25901,
}

export class BitcoinSPVError extends Error {
  public code: BitcoinSPVErrorCode;

  public static schema = z.object({
    code: z.number(),
    message: z.string(),
  });

  constructor(code: BitcoinSPVErrorCode, message: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

/**
 * Bitcoin SPV service client
 */
export default class SPVClient {
  private request: AxiosInstance;
  private cradle: Cradle;

  constructor(cradle: Cradle) {
    const { env, logger } = cradle;
    this.cradle = cradle;
    this.request = axios.create({
      baseURL: env.BITCOIN_SPV_SERVICE_URL,
    });
    addLoggerInterceptor(this.request, logger);
  }

  private async callMethod<T>(method: string, params: unknown): Promise<T> {
    return Sentry.startSpan({ op: this.constructor.name, name: method }, async () => {
      const id = randomUUID();
      const response = await this.request.post('', {
        jsonrpc: '2.0',
        id,
        method,
        params,
      });
      if (response.data?.error) {
        const { code, message } = BitcoinSPVError.schema.parse(response.data.error);
        throw new BitcoinSPVError(code, message);
      }
      return response.data?.result;
    });
  }

  // https://github.com/ckb-cell/ckb-bitcoin-spv-service?tab=readme-ov-file#json-rpc-api-reference
  private async _getTxProof(txid: string, index: number, confirmations: number) {
    return this.callMethod<TxProof>('getTxProof', [remove0x(txid), index, confirmations]);
  }

  public async getTxProof(btcTxid: string, confirmations: number = 0) {
    const txid = remove0x(btcTxid);
    const btcTx = await this.cradle.doge.getTx({ txid });
    const btcTxids = await this.cradle.doge.getBlockTxids({ hash: btcTx.status.block_hash! });
    const btcIdxInBlock = btcTxids.findIndex((id) => id === txid);
    return this._getTxProof(txid, btcIdxInBlock, confirmations);
  }
}
