消息队列:
- 每个队列的 worker 处理各自的 job；
1. `export const UTXO_SYNCER_QUEUE_NAME = 'utxo-syncer-queue';`
  - "Get the balance of a bitcoin address" && `UTXO_SYNC_DATA_CACHE_ENABLE` 触发更新；
2. `export const RGBPP_COLLECTOR_QUEUE_NAME = 'rgbpp-collector-queue';`
  - "Get the balance of a bitcoin address" && `RGBPP_COLLECT_DATA_CACHE_ENABLE` 触发更新；
debug 时记住 `ResponseCacheable` 的路由，会走缓存。
3. [ ] `export const TRANSACTION_QUEUE_NAME = 'rgbpp-ckb-transaction-queue';`

cron job:
- Cron plugin 负责启动 3 个消息队列的 worker；
- 注册两个 cron job `jobs: [retryMissingTransactionsJob, unlockBTCTimeLockCellsJob],`
  - `*/5 * * * *` 


- [ ] `retryMissingTransactionsJob`

- [ ] `internalRoutes`

由各个 handler 自行设置 `ResponseCacheable` 的值，配合 `ResponseCacheMaxAge` 设置缓存时间，默认值是 `const MAX_AGE_FOREVER = 60 * 60 * 24 * 365 * 5;`。


By default, register creates a new scope, this means that if you make some changes to the Fastify instance (via decorate), this change will not be reflected by the current context ancestors, but only by its descendants.  
> https://fastify.dev/docs/latest/Reference/Plugins/#plugins

- [x] unlocker
   - 把 time lock 锁的 cell 变成 owner lock script 锁的 cell；

```ts
const outputs: CKBComponents.CellOutput[] = [
  {
    lock: genBtcTimeLockScript(toLock, isMainnet, btcTestnetType, btcConfirmationBlocks),
    type: xudtType,
    capacity: append0x(receiverOutputCapacity.toString(16)),
  },
];
/**
 * btcTimeLockArgs: 
 * table BTCTimeLock {
    lock_script: Script,
    after: Uint32,
    btc_txid: Byte32,
  }
 */
export const genBtcTimeLockScript = (
  toLock: CKBComponents.Script,
  isMainnet: boolean,
  btcTestnetType?: BTCTestnetType,
  btcConfirmationBlocks?: number,
) => {
  const args = genBtcTimeLockArgs(
    toLock,
    RGBPP_TX_ID_PLACEHOLDER,
    btcConfirmationBlocks ?? BTC_JUMP_CONFIRMATION_BLOCKS,
  );
  return {
    ...getBtcTimeLockScript(isMainnet, btcTestnetType),
    args,
  } as CKBComponents.Script;
};

// buildBtcTimeCellsSpentTx
const { btcTxId, after } = btcTxIdAndAfterFromBtcTimeLockArgs(btcTimeCell.output.lock.args);
const result = await btcAssetsApi.getRgbppSpvProof(btcTxId, after);
const { spvClient, proof } = transformSpvProof(result);

if (!cellDepsSet.has(serializeOutPoint(spvClient))) {
  cellDeps.push(buildSpvClientCellDep(spvClient));
  // * btc time lock script 要访问 spv cell 校验数据，所以要加进 cellDeps
  cellDepsSet.add(serializeOutPoint(spvClient));
}

const btcTimeWitness = append0x(
  serializeWitnessArgs({ lock: buildBtcTimeUnlockWitness(proof), inputType: '', outputType: '' }),
);
```

!!! `!isTypeAssetSupported`

- [x] debug：监听文件改动，自动重启

```bash
curl -X 'GET' \
  'http://92.118.56.39:3000/rgbpp/v1/transaction/de355428762b7ed3b613eb0344bbbbcfd3e51470150e052c39820729786e65e7' \
  -H 'accept: application/json' \
  -H "Origin: https://rgbpp.testnet.fgh.rs" \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmZ2hwcCIsImF1ZCI6InJnYnBwLnRlc3RuZXQuZmdoLnJzIiwianRpIjoiY2IwNmVkYmItZGE5Yy00ODc3LTg4N2MtY2FjOWFlNGJhOGZiIiwiaWF0IjoxNzMzMjUzNTU1fQ.h4MKFDKkfgwCvCptBzoge21AGbSNJ-5mEOanHm9VB8Q' \
  -w "\n%{http_code}\n"

curl -X 'GET' \
  'http://92.118.56.39:3000/bitcoin/v1/info' \
  -H 'accept: application/json' \
  -H "Origin: https://rgbpp.testnet.fgh.rs" \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmZ2hwcCIsImF1ZCI6InJnYnBwLnRlc3RuZXQuZmdoLnJzIiwianRpIjoiY2IwNmVkYmItZGE5Yy00ODc3LTg4N2MtY2FjOWFlNGJhOGZiIiwiaWF0IjoxNzMzMjUzNTU1fQ.h4MKFDKkfgwCvCptBzoge21AGbSNJ-5mEOanHm9VB8Q' \
  -w "\n%{http_code}\n"
```