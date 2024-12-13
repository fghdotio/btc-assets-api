import { describe, beforeEach, it, expect } from 'vitest';
import { DogeMemoryWalletProvider, createP2PKHTransaction } from 'doge-sdk';

import { DogeRestApiClient } from './restapi';
import { DogeRpcClient } from './rpc';

const testnetAddress: string = 'nsSfZttkEy2ZkujJUmQvKdjsTVRXSAwSvm';
// nWujuS2wgYTbyL7B3dk7RoLb7KqfEY7tVS
const testnetWif: string = 'QWzHvo6EBqEpYADitbmV7Ybq9ufGN3q16fvVc2dXH9egQSpCr64A';

// const mainnetRpcUrl = 'https://rgbpp.doge.awesomeckb.xyz';

describe('DogeRpcClient', () => {
  let testnetRpcClient: DogeRpcClient;
  const testnetBlockHash = '2cf27df561ea1d78eae6945b544378aad78cde2302dc9e65b82892545b4d92d3';
  const testnetGenesisBlockHash = 'bb0a78264637406b6360aad926284d544d7049f45189db5664f3c4d07350559e';
  const testnetTxId = 'de5df2efbf03237f71aa420cbd189d16fc1beb8b902fa8643d5930479e9ca0c3';

  // let mainnetRpcClient: DogeRpcClient;

  beforeEach(() => {
    testnetRpcClient = new DogeRpcClient(
      process.env.DOGE_TESTNET_RPC_URL!,
      process.env.DOGE_TESTNET_RPC_USERNAME!,
      process.env.DOGE_TESTNET_RPC_PASSWORD!,
    );
    // mainnetRpcClient = new DogeRpcClient(mainnetRpcUrl);
  });

  describe('postTx', () => {
    it('should return the tx', async () => {
      const testnetClient = new DogeRestApiClient('testnet', process.env.DOGE_CRYPTO_APIS_API_KEY!);

      const walletProvider = new DogeMemoryWalletProvider();
      const wallet = walletProvider.addWalletFromWIF(testnetWif, 'dogeTestnet');

      const utxos = await testnetClient.getAddressTxsUtxo({ address: wallet.address });
      if (utxos.length === 0) {
        throw new Error('No UTXOs found');
      }
      const formattedUtxo = {
        txid: utxos[1].transactionId,
        vout: utxos[1].index,
        value: parseFloat(utxos[1].amount) * 10 ** 8,
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
      console.log(await testnetRpcClient.postTx({ txHex }));
    });
  });

  describe('getTxHex', () => {
    it('should return the tx hex', async () => {
      console.log(await testnetRpcClient.getTxHex({ txId: testnetTxId }));
    });
  });

  describe('getBlock', () => {
    it('should return the block', async () => {
      console.log(await testnetRpcClient.getBlock({ hash: testnetBlockHash }));
    });
  });

  describe('getBlockHeight', () => {
    it('should return the block height', async () => {
      expect(await testnetRpcClient.getBlockHeight({ height: 0 })).toBe(testnetGenesisBlockHash);
    });
  });

  describe('getBlockHeader', () => {
    it('should return the block header', async () => {
      console.log(await testnetRpcClient.getBlockHeader({ hash: testnetBlockHash }));
    });
  });

  describe('getBlockTxids', () => {
    it('should return the block txids', async () => {
      console.log(await testnetRpcClient.getBlockTxids({ hash: testnetBlockHash }));
    });
  });

  describe('getBlocksTipHash', () => {
    it('should return the blocks tip hash', async () => {
      console.log(await testnetRpcClient.getBlocksTipHash());
    });
  });
});

/* 
pnpm vitest run src/services/doge/rpc.test.ts
pnpm vitest run src/services/doge/rpc.test.ts -t "postTx"
*/
