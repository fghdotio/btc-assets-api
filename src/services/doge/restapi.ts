import axios, { AxiosInstance } from 'axios';

import { Block } from './interfaces';

export const baseUrl = 'https://rest.cryptoapis.io/blockchain-data/dogecoin';

// using cryptoapis.io endpoint
export class RestApiDogeClient {
  private request: AxiosInstance;
  private baseUrl: string;

  constructor(
    network: 'testnet' | 'mainnet',
    private apiKey: string,
  ) {
    this.baseUrl = `${baseUrl}/${network}`;
    this.request = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
    });
  }

  public getBaseURL(): string {
    return this.baseUrl;
  }

  public async getFeesRecommended() {
    throw new Error('Recommended fees not available');
  }

  public async postTx({ txHex }: { txHex: string }) {
    const txData = {
      data: {
        item: {
          signedTransactionHex: txHex,
        },
      },
    };
    const response = await this.request.post('/transactions/broadcast', txData, {
      baseURL: this.baseUrl.replace('blockchain-data', 'blockchain-tools'),
    });
    return response.data;
  }

  // https://developers.cryptoapis.io/v-1.2023-04-25-105/RESTapis/unified-endpoints/list-unspent-transaction-outputs-by-address/get
  // default limit is 10
  public async getAddressTxsUtxo({ address }: { address: string }) {
    type AddressTxsUtxoResponse = {
      data: {
        limit: number;
        offset: number;
        total: number;
        items: {
          address: string;
          amount: string;
          index: number;
          isAvailable: boolean;
          isConfirmed: boolean;
          timestamp: number;
          transactionId: string;
        }[];
      };
    };
    const response = await this.request.get<AddressTxsUtxoResponse>(`/addresses/${address}/unspent-outputs`);
    // console.log(response.data.data);
    return response.data.data.items;
  }

  // https://developers.cryptoapis.io/v-1.2023-04-25-105/RESTapis/unified-endpoints/list-unconfirmed-transactions-by-address/get
  // https://developers.cryptoapis.io/v-1.2023-04-25-105/RESTapis/unified-endpoints/list-confirmed-transactions-by-address/get
  // Dogecoin Testnet Faucet: https://shibe.technology/
  // bitcoin: Get transaction history for the specified address/scripthash, sorted with newest first. Returns up to 50 mempool transactions plus the first 25 confirmed transactions.
  // TODO: You can request more confirmed transactions using an after_txid query parameter.
  public async getAddressTxs({ address }: { address: string; after_txid?: string }) {
    type AddressTxsResponse = {
      data: {
        limit: number;
        offset: number;
        total: number;
        items: [
          {
            timestamp: number;
          },
        ];
      };
    };
    const unconfirmedRes = await this.request.get<AddressTxsResponse>(
      `address-transactions-unconfirmed/${address}?limit=50`,
    );
    // console.log(unconfirmedRes.data.data);
    const confirmedRes = await this.request.get<AddressTxsResponse>(`addresses/${address}/transactions?limit=25`);
    // console.log(confirmedRes.data.data);

    // merge the two responses, sort by timestamp
    const merged = [...unconfirmedRes.data.data.items, ...confirmedRes.data.data.items];
    merged.sort((a, b) => b.timestamp - a.timestamp);
    return merged;
  }

  // https://developers.cryptoapis.io/v-1.2023-04-25-105/RESTapis/unified-endpoints/get-transaction-details-by-transaction-id/get
  public async getTx({ txId }: { txId: string }) {
    interface TxResponse {
      data: {
        // TODO
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        item: any;
      };
    }
    const response = await this.request.get<TxResponse>(`/transactions/${txId}`);
    return response.data.data.item;
  }

  // https://developers.cryptoapis.io/v-1.2023-04-25-105/RESTapis/unified-endpoints/get-raw-transaction-data/get
  public async getTxHex({ txId }: { txId: string }) {
    interface TxHexResponse {
      data: {
        item: {
          transactionHex: string;
        };
      };
    }
    const response = await this.request.get<TxHexResponse>(`/transactions/${txId}/raw-data`);
    return response.data.data.item.transactionHex;
  }

  // https://developers.cryptoapis.io/v-1.2023-04-25-105/RESTapis/unified-endpoints/get-block-details-by-block-hash/get
  public async getBlock({ hash }: { hash: string }) {
    interface BlockResponse {
      data: {
        item: {
          hash: string;
          height: string;
          nextBlockHash: string;
          previousBlockHash: string;
          timestamp: number;
          transactionsCount: number;
          blockchainSpecific: {
            bits: string;
            chainwork: string;
            difficulty: string;
            merkleRoot: string;
            nonce: string;
            size: number;
            strippedSize: number;
            version: number;
            versionHex: string;
            weight: number;
          };
        };
      };
    }
    const response = await this.request.get<BlockResponse>(`/blocks/hash/${hash}`);
    const {
      item: { blockchainSpecific: data, ...rest },
    } = response.data.data;
    const blockData = {
      id: rest.hash,
      height: parseInt(rest.height, 10),
      version: data.version,
      timestamp: rest.timestamp,
      tx_count: rest.transactionsCount,
      size: data.size,
      weight: data.weight,
      merkle_root: data.merkleRoot,
      previousblockhash: rest.previousBlockHash,
      mediantime: rest.timestamp,
      nonce: parseInt(data.nonce, 10),
      bits: parseInt(data.bits, 10),
      difficulty: parseFloat(data.difficulty),
    };
    const block = Block.parse(blockData);
    return block;
  }

  // https://developers.cryptoapis.io/v-1.2023-04-25-105/RESTapis/unified-endpoints/get-block-details-by-block-height/get
  public async getBlockHeight({ height }: { height: number }) {
    interface BlockHeightResponse {
      data: {
        item: {
          hash: string;
        };
      };
    }
    const response = await this.request.get<BlockHeightResponse>(`/blocks/height/${height}`);
    return response.data.data.item.hash;
  }

  // TODO: Returns the hex-encoded block header to keep consistency with Bitcoin
  // https://developers.cryptoapis.io/v-1.2023-04-25-105/RESTapis/unified-endpoints/get-block-details-by-block-hash/get
  public async getBlockHeader({ hash }: { hash: string }) {
    interface BlockHeaderResponse {
      data: {
        // TODO
        // eslint-disable-next-line @typescript-eslint/ban-types
        item: {};
      };
    }
    const response = await this.request.get<BlockHeaderResponse>(`/blocks/hash/${hash}`);
    return response.data.data.item;
  }

  // https://developers.cryptoapis.io/v-1.2023-04-25-105/RESTapis/unified-endpoints/list-transactions-by-block-hash/get
  public async getBlockTxids({ hash }: { hash: string }) {
    interface BlockTxResponse {
      data: {
        items: {
          transactionId: string;
        }[];
      };
    }
    const response = await this.request.get<BlockTxResponse>(`/blocks/hash/${hash}/transactions`);
    return response.data.data.items.map((item) => item.transactionId);
  }

  // https://developers.cryptoapis.io/v-1.2023-04-25-105/RESTapis/unified-endpoints/get-last-mined-block/get
  public async getBlocksTipHash() {
    interface BlockTipResponse {
      data: {
        item: {
          hash: string;
        };
      };
    }
    const response = await this.request.get<BlockTipResponse>('/blocks/last');
    return response.data.data.item.hash;
  }
}
