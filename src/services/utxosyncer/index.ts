import { Cradle } from '../../container';
import BitcoinUTXOSyncer from './btc';
import DogecoinUTXOSyncer from './doge';
import { validateBitcoinAddress, validateDogecoinAddress } from '../../utils/validators';
import { IUTXOSyncer } from './interface';

enum CoinType {
  BITCOIN = 'bitcoin',
  DOGECOIN = 'dogecoin',
}

class UTXOSyncerFactory {
  private syncers: Map<CoinType, IUTXOSyncer>;

  constructor(cradle: Cradle) {
    this.syncers = new Map();
    this.syncers.set(CoinType.BITCOIN, new BitcoinUTXOSyncer(cradle));
    this.syncers.set(CoinType.DOGECOIN, new DogecoinUTXOSyncer(cradle));
  }

  getSyncer(coinType: CoinType): IUTXOSyncer {
    const syncer = this.syncers.get(coinType);
    if (!syncer) {
      throw new Error(`No UTXO syncer found for ${coinType}`);
    }
    return syncer;
  }

  getSyncerByAddress(address: string): IUTXOSyncer {
    if (validateBitcoinAddress(address)) {
      return this.getSyncer(CoinType.BITCOIN);
    }
    if (validateDogecoinAddress(address)) {
      return this.getSyncer(CoinType.DOGECOIN);
    }
    throw new Error(`Unable to determine coin type for address: ${address}`);
  }

  async syncAddress(address: string) {
    const syncer = this.getSyncerByAddress(address);
    return syncer.enqueueSyncJob(address);
  }
}

export default UTXOSyncerFactory;
