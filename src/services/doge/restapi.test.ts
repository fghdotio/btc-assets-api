import { describe, beforeEach, it } from 'vitest';

import { RestApiDogeClient } from './restapi';

describe('RestApiDogeClient', () => {
  let client: RestApiDogeClient;
  // dev Crypto APIs
  const testnetBaseUrl = 'https://rest.cryptoapis.io/blockchain-data/dogecoin/testnet';

  beforeEach(() => {
    client = new RestApiDogeClient(testnetBaseUrl, process.env.CRYPTO_APIS_API_KEY!);
  });

  const testnetBlockHash: string = '577f016bbf165a905fc7778f89d3ccc5be04b5cfd1490004fa21746cf9decf4c';
  const testnetTxId: string = 'de5df2efbf03237f71aa420cbd189d16fc1beb8b902fa8643d5930479e9ca0c3';
  const testnetAddress: string = 'nsSfZttkEy2ZkujJUmQvKdjsTVRXSAwSvm';

  describe('getBlocksTipHash', () => {
    it('should return the latest block hash', async () => {
      console.log(await client.getBlocksTipHash());
    });
  });

  describe('getBlockHeader', () => {
    it('should return the header of the block', async () => {
      console.log(await client.getBlockHeader({ hash: testnetBlockHash }));
    });
  });

  describe('getBlockHeight', () => {
    it('should return the height of the block', async () => {
      console.log(await client.getBlockHeight({ height: 0 }));
    });
  });

  describe('getBlockTxids', () => {
    it('should return the txids of the block', async () => {
      console.log(await client.getBlockTxids({ hash: testnetBlockHash }));
    });
  });

  describe('getBlock', () => {
    it('should return the block', async () => {
      console.log(await client.getBlock({ hash: testnetBlockHash }));
    });
  });

  describe('getTxHex', () => {
    it('should return the hex of the transaction', async () => {
      console.log(await client.getTxHex({ txId: testnetTxId }));
    });
  });

  describe('getTx', () => {
    it('should return the transaction', async () => {
      console.log(await client.getTx({ txId: testnetTxId }));
    });
  });

  describe('getAddressTxs', () => {
    it('should return the transactions', async () => {
      console.log(await client.getAddressTxs({ address: testnetAddress }));
    });
  });

  describe('getAddressTxsUtxo', () => {
    it('should return the utxos', async () => {
      console.log(await client.getAddressTxsUtxo({ address: testnetAddress }));
    });
  });
});

/* 
pnpm vitest run src/services/doge/restapi.test.ts -t "getBlocksTipHash"
*/
