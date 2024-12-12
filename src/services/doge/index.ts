import { z } from 'zod';

import { Cradle } from '../../container';
import { RestApiDogeClient } from './restapi';
import { IS_MAINNET, NetworkType } from '../../constants';
import { Block } from './interfaces';

export default class DogeClient {
  private cradle: Cradle;
  private source;
  private fallback?;

  constructor(cradle: Cradle) {
    this.cradle = cradle;
    const { env } = cradle;
    this.source = new RestApiDogeClient(env.DOGE_NETWORK, env.DOGE_CRYPTO_APIS_API_KEY);

    // TODO: add a fallback data source
    this.fallback = new RestApiDogeClient(env.DOGE_NETWORK, env.DOGE_CRYPTO_APIS_API_KEY);
  }

  private async call<T, Args extends Record<string, unknown> = Record<string, unknown>>(
    method: keyof RestApiDogeClient,
    args?: Args,
  ): Promise<T> {
    try {
      this.cradle.logger.debug(`Calling ${method} with args: ${JSON.stringify(args)}`);

      const sourceMethod = this.source[method] as (args?: Args) => Promise<T>;
      const result = await sourceMethod.call(this.source, args);
      return result;
    } catch (err) {
      if (this.fallback) {
        const fallbackMethod = this.fallback[method] as (args?: Args) => Promise<T>;
        const result = await fallbackMethod.call(this.fallback, args);
        return result;
      }
      throw err;
    }
  }

  public async getBaseURL(): Promise<string> {
    return this.source.getBaseURL();
  }

  public async checkNetwork(network: NetworkType) {
    const hash = await this.getBlockHeight({ height: 0 });
    switch (network) {
      case NetworkType.mainnet:
        // Dogecoin mainnet genesis block hash
        if (hash !== '1a91e3dace36e2be3bf030a65679fe821aa1d6ef92e7c9902eb318182c355691') {
          throw new Error('Dogecoin client is not running on mainnet');
        }
        break;
      case NetworkType.testnet:
        // Dogecoin testnet genesis block hash
        if (hash !== 'bb0a78264637406b6360aad926284d544d7049f45189db5664f3c4d07350559e') {
          throw new Error('Dogecoin client is not running on testnet');
        }
        break;
      default:
    }
  }

  public async getBlockchainInfo() {
    const hash = await this.getBlocksTipHash();
    const tip = await this.call<z.infer<typeof Block>>('getBlock', { hash });

    return {
      chain: IS_MAINNET ? 'main' : 'test',
      blocks: tip.height,
      bestblockhash: hash,
      difficulty: tip.difficulty,
      mediantime: tip.timestamp,
    };
  }

  public async getFeesRecommended() {
    return this.call('getFeesRecommended');
  }

  public async postTx({ txhex }: { txhex: string }) {
    const txid = await this.call('postTx', { txhex });
    return txid;
  }

  public async getAddressTxsUtxo({ address }: { address: string }) {
    return this.call('getAddressTxsUtxo', { address });
  }

  public async getAddressTxs({ address, after_txid }: { address: string; after_txid?: string }) {
    return this.call('getAddressTxs', { address, after_txid });
  }

  public async getTx({ txid }: { txid: string }) {
    return this.call('getTx', { txid });
  }

  public async getTxHex({ txid }: { txid: string }) {
    return this.call('getTxHex', { txid });
  }

  public async getBlock({ hash }: { hash: string }) {
    return this.call('getBlock', { hash });
  }

  public async getBlockHeight({ height }: { height: number }): Promise<string> {
    return this.call<string>('getBlockHeight', { height });
  }

  public async getBlockHeader({ hash }: { hash: string }) {
    return this.call('getBlockHeader', { hash });
  }

  public async getBlockTxids({ hash }: { hash: string }) {
    return this.call('getBlockTxids', { hash });
  }

  public async getBlocksTipHash(): Promise<string> {
    return this.call('getBlocksTipHash');
  }
}
