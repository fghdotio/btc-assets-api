import { describe, beforeEach, it } from 'vitest';
import { DogeMemoryWalletProvider, createP2PKHTransaction } from 'doge-sdk';

import { DogeRestApiClient } from './restapi';

import * as bitcoin from 'bitcoinjs-lib';

describe('DogeRestApiClient', () => {
  let testnetClient: DogeRestApiClient;
  // dev Crypto APIs

  beforeEach(() => {
    testnetClient = new DogeRestApiClient('testnet', process.env.DOGE_CRYPTO_APIS_API_KEY!);
  });

  const testnetBlockHash: string = '577f016bbf165a905fc7778f89d3ccc5be04b5cfd1490004fa21746cf9decf4c';
  const testnetCoinbaseTxId: string = 'de5df2efbf03237f71aa420cbd189d16fc1beb8b902fa8643d5930479e9ca0c3';
  const testnetTxId: string = '02605b84a2a829dc08aa032b3b3bb100ae36f6ad813a9a6906d6bdf283a2257c';
  const testnetAddress: string = 'nsSfZttkEy2ZkujJUmQvKdjsTVRXSAwSvm';
  const testnetMinerAddress: string = 'nmZ36RoFkyd9tKqfTk2iBt5UfgLfbcxC98';
  // nWujuS2wgYTbyL7B3dk7RoLb7KqfEY7tVS
  const testnetWif: string = '';

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

      const commitment = '10c4a63bbffad8a5a374eb2d56f5790f4bb4b93796f04d9d8de9ee9177038104';
      // const commitment = 'b4b51b307ab82b41c1eb422284475c8abd28a69702c11e059693cb0b6e8c019b';
      // https://sochain.com/tx/DOGETEST/9eaaec1a4478f0901df98c33d36173a45618f9d077bc9301e8087a723707a5fb
      // https://blockexplorer.one/dogecoin/testnet/tx/9eaaec1a4478f0901df98c33d36173a45618f9d077bc9301e8087a723707a5fb

      // const opCode = 'OP_RETURN';
      // const commitmentOutputString = `${opCode} ${commitment}`;
      // console.log(getOpCodeFromString(opCode));

      const opReturnScript = bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(commitment, 'hex')]);
      const opReturnScriptUint8 = new Uint8Array(opReturnScript);
      console.log(opReturnScriptUint8, opReturnScript.toString('hex'));
      const commitmentOutput = {
        value: 0,
        script: opReturnScriptUint8,
      };

      const changeOutput = {
        address: wallet.address,
        value: formattedUtxo.value - 10 ** 8,
      };

      // const fee = 2_333_000;
      const txBuilder = createP2PKHTransaction(wallet, {
        inputs: [formattedUtxo],
        outputs: [commitmentOutput, changeOutput],
        address: wallet.address,
      });
      const finalizedTx = await txBuilder.finalizeAndSign();
      const txHex = finalizedTx.toHex();
      console.log(txHex);
      console.log(
        await testnetClient.postTx({
          txHex:
            '0200000001fba50737727a08e80193bc77d0f91856a47361d3338cf91d90f078441aecaa9e010000006a473044022015eb9e548bf5fb42d72cf59d5eded7ac50b804b45f1a34348591d0f9074e946902201a16512e45e8597ed1a72d59a0166e02ea3105627cd55bf60cba1a97858d0b7601210201ed4ceaf7982e3a8de9aac1316244302fdea30831b9dd8f8563fe87e02a5f6effffffff030000000000000000226a2010c4a63bbffad8a5a374eb2d56f5790f4bb4b93796f04d9d8de9ee917703810422020000000000001976a914b74bd483e3da461a03d1717d0a600b09a49dd53588ac00fea237c12fbd0d1976a914b74bd483e3da461a03d1717d0a600b09a49dd53588ac00000000',
        }),
      );
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
      console.log(await testnetClient.getTxHex({ txid: testnetTxId }));
    });
  });

  describe('getTx', () => {
    it('should return the transaction', async () => {
      console.log(await testnetClient.getTx({ txid: testnetTxId }));
      console.log(await testnetClient.getTx({ txid: testnetCoinbaseTxId }));
    });
  });

  describe('getAddressTxs', () => {
    it('should return the transactions', async () => {
      const txs = await testnetClient.getAddressTxs({ address: testnetAddress });
      console.log(txs);

      const txsMiner = await testnetClient.getAddressTxs({ address: testnetMinerAddress });
      console.log(txsMiner);
    });
  });

  describe('getAddressTxsUtxo', () => {
    it('should return the utxos', async () => {
      console.log(await testnetClient.getAddressTxsUtxo({ address: testnetAddress }));
    });
  });
});

/* 
pnpm vitest run src/services/doge/restapi.test.ts -t "postTx"
pnpm vitest run src/services/doge/restapi.test.ts -t "getTx should return the transaction"
*/
