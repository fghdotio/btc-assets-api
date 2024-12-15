import { Job } from 'bullmq';

import { UTXO } from '../bitcoin/schema';

export interface IUTXOSyncRequest {
  address: string;
}

export interface IUTXOSyncJobReturn {
  address: string;
  utxos: UTXO[];
  // use sha256(latest_txs_id) as the key, so we can check if the data is updated
  txsHash: string;
}

export interface IUTXOSyncer {
  getUtxosByAddress(address: string, noCache?: boolean): Promise<UTXO[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enqueueSyncJob(address: string): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process(job: Job<IUTXOSyncRequest>): Promise<any>;
}
