import { describe, beforeEach, it } from 'vitest';
import { DogeMemoryWalletProvider, createP2PKHTransaction } from 'doge-sdk';

import { DogeRestApiClient } from './restapi';

describe('DogeRestApiClient', () => {
  let testnetClient: DogeRestApiClient;
  // dev Crypto APIs

  beforeEach(() => {
    testnetClient = new DogeRestApiClient('testnet', process.env.DOGE_CRYPTO_APIS_API_KEY!);
  });

  const testnetBlockHash: string = '577f016bbf165a905fc7778f89d3ccc5be04b5cfd1490004fa21746cf9decf4c';
  const testnetTxId: string = 'de5df2efbf03237f71aa420cbd189d16fc1beb8b902fa8643d5930479e9ca0c3';
  const testnetAddress: string = 'nsSfZttkEy2ZkujJUmQvKdjsTVRXSAwSvm';
  // nWujuS2wgYTbyL7B3dk7RoLb7KqfEY7tVS
  const testnetWif: string = 'QWzHvo6EBqEpYADitbmV7Ybq9ufGN3q16fvVc2dXH9egQSpCr64A';

  describe('postTx', () => {
    it('should return the tx', async () => {
      const walletProvider = new DogeMemoryWalletProvider();
      const wallet = walletProvider.addWalletFromWIF(testnetWif, 'dogeTestnet');

      const utxos = await testnetClient.getAddressTxsUtxo({ address: wallet.address });
      if (utxos.length === 0) {
        throw new Error('No utxos found');
      }
      const formattedUtxo = {
        txid: utxos[0].txid,
        vout: utxos[0].vout,
        value: utxos[0].value * 10 ** 8,
      };
      console.log(utxos.length, formattedUtxo);

      const fee = 2_333_000;
      const txBuilder = createP2PKHTransaction(wallet, {
        inputs: [formattedUtxo],
        outputs: [
          { address: testnetAddress, value: 280_000 },
          { address: wallet.address, value: formattedUtxo.value - fee },
        ],
        address: wallet.address,
      });
      const finalizedTx = await txBuilder.finalizeAndSign();
      const txHex = finalizedTx.toHex();
      console.log(await testnetClient.postTx({ txHex }));
    });
  });

  describe('getBlocksTipHash', () => {
    it('should return the latest block hash', async () => {
      console.log(await testnetClient.getBlocksTipHash());
    });
  });

  describe('getBlockHeader', () => {
    it('should return the header of the block', async () => {
      console.log(await testnetClient.getBlockHeader({ hash: testnetBlockHash }));
    });
  });

  describe('getBlockHeight', () => {
    it('should return the height of the block', async () => {
      console.log(await testnetClient.getBlockHeight({ height: 0 }));
    });
  });

  describe('getBlockTxids', () => {
    it('should return the txids of the block', async () => {
      console.log(await testnetClient.getBlockTxids({ hash: testnetBlockHash }));
    });
  });

  describe('getBlock', () => {
    it('should return the block', async () => {
      console.log(await testnetClient.getBlock({ hash: testnetBlockHash }));
    });
  });

  describe('getTxHex', () => {
    it('should return the hex of the transaction', async () => {
      console.log(await testnetClient.getTxHex({ txId: testnetTxId }));
    });
  });

  describe('getTx', () => {
    it('should return the transaction', async () => {
      console.log(await testnetClient.getTx({ txId: testnetTxId }));
    });
  });

  describe('getAddressTxs', () => {
    it('should return the transactions', async () => {
      const txs = await testnetClient.getAddressTxs({ address: testnetAddress });
      console.log(txs);
      txs.forEach((tx) => {
        console.log(tx.vout);
      });
    });
  });

  describe('getAddressTxsUtxo', () => {
    it('should return the utxos', async () => {
      console.log(await testnetClient.getAddressTxsUtxo({ address: testnetAddress }));
    });
  });
});

/* 
pnpm vitest run src/services/doge/restapi.test.ts -t "getAddressTxsUtxo"
pnpm vitest run src/services/doge/restapi.test.ts -t "getAddressTxs should return the transactions"
*/
