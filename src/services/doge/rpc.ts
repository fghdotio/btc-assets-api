import axios, { AxiosInstance } from 'axios';

// https://github.com/dogecoin/dogecoin/blob/master/doc/rpc-maturity.md
// https://developer.bitcoin.org/reference/rpc/index.html
// https://mempool.space/docs/api/rest
// https://github.com/blockstream/esplora/blob/master/API.md
export class DogeRpcClient {
  private request: AxiosInstance;

  constructor(
    private baseUrl: string,
    username: string,
    password: string,
  ) {
    this.request = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      auth: {
        username,
        password,
      },
    });
  }

  private rpcId(): string {
    return 'doge-assets-api-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  private rpcReq(
    method: string,
    params?: unknown[],
  ): {
    jsonrpc: string;
    id: string;
    method: string;
    params?: unknown[];
  } {
    return {
      jsonrpc: '1.0',
      id: this.rpcId(),
      method,
      params: params ?? [],
    };
  }

  // https://developer.bitcoin.org/reference/rpc/sendrawtransaction.html
  public async postTx({ txHex }: { txHex: string }) {
    interface PostTxResponse {
      result: string;
    }

    const response = await this.request.post<PostTxResponse>('/', this.rpcReq('sendrawtransaction', [txHex]));
    return response.data.result;
  }

  /** Estimate fee rate needed to get into the next nBlocks */
  public async getFeesRecommended() {
    interface GetFeesRecommendedResponse {
      result: number;
    }
    const BLOCKS_TO_PRIORITY: Record<number, 'fast' | 'medium' | 'slow'> = {
      2: 'fast',
      5: 'medium',
      15: 'slow',
    };

    const nBlocks = Object.keys(BLOCKS_TO_PRIORITY).map(Number);
    const responses = await Promise.all(
      nBlocks.map((n) => this.request.post<GetFeesRecommendedResponse>('/', this.rpcReq('estimatefee', [n]))),
    );

    return Object.fromEntries(
      responses.map((response, index) => [BLOCKS_TO_PRIORITY[nBlocks[index]], response.data.result]),
    );
  }

  // public async getAddressTxsUtxo({ _address }: { _address: string }) {
  //   throw new Error('Not supported');
  // }

  // public async getAddressTxs({ _address }: { _address: string }) {
  //   throw new Error('Not supported');
  // }

  // https://developer.bitcoin.org/reference/rpc/getrawtransaction.html
  // Returns details about a transaction.
  public async getTx({ txId }: { txId: string }) {
    interface GetTxResponse {
      result: Record<string, unknown>;
    }
    const response = await this.request.post<GetTxResponse>('/', this.rpcReq('getrawtransaction', [txId, true]));
    return response.data.result;
  }

  // https://developer.bitcoin.org/reference/rpc/getrawtransaction.html
  // Returns a string that is serialized, hex-encoded data for ‘txid’.
  public async getTxHex({ txId }: { txId: string }) {
    interface GetTxHexResponse {
      result: string;
    }
    const response = await this.request.post<GetTxHexResponse>('/', this.rpcReq('getrawtransaction', [txId, false]));
    return response.data.result;
  }

  // https://developer.bitcoin.org/reference/rpc/getblock.html
  // Returns details about a block.
  public async getBlock({ hash }: { hash: string }) {
    interface GetBlockResponse {
      result: Record<string, unknown>;
    }
    const response = await this.request.post<GetBlockResponse>('/', this.rpcReq('getblock', [hash, 2]));
    return response.data.result;
  }

  // https://developer.bitcoin.org/reference/rpc/getblockhash.html
  // Returns the hash of the block currently at :height.
  public async getBlockHeight({ height }: { height: number }) {
    interface GetBlockHeightResponse {
      result: string;
    }
    const response = await this.request.post<GetBlockHeightResponse>('/', this.rpcReq('getblockhash', [height]));
    return response.data.result;
  }

  // https://developer.bitcoin.org/reference/rpc/getblockheader.html
  // Returns serialized, hex-encoded data for blockheader ‘hash’.
  public async getBlockHeader({ hash }: { hash: string }) {
    interface GetBlockHeaderResponse {
      result: string;
    }
    const response = await this.request.post<GetBlockHeaderResponse>('/', this.rpcReq('getblockheader', [hash, false]));
    return response.data.result;
  }

  // https://developer.bitcoin.org/reference/rpc/getblock.html
  // Returns a list of all txids in the block.
  public async getBlockTxids({ hash }: { hash: string }) {
    interface GetBlockTxidsResponse {
      result: {
        tx: string[];
      };
    }
    const response = await this.request.post<GetBlockTxidsResponse>('/', this.rpcReq('getblock', [hash, 1]));
    return response.data.result.tx;
  }

  // https://developer.bitcoin.org/reference/rpc/getchaintips.html
  public async getBlocksTipHash() {
    interface GetBlocksTipHashResponse {
      result: string;
    }
    const res = await this.request.post<GetBlocksTipHashResponse>('/', this.rpcReq('getbestblockhash'));

    return res.data.result;
  }
}
