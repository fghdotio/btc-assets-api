btc-assets-api & rgbpp-sdk Doge 开发计划

## btc-assets-api

12.11-12.13：
1. `DogeClient`：对接第三方 API 服务，实现以下接口：
   - `GET /dogecoin/vl/info`
   - `GET /dogecoin/vl/block/{hash}`
   - `GET /dogecoin/vl/block/{hash}/txids`
   - `GET /dogecoin/vl/block/{hash}/header`
   - `GET /dogecoin/vl/block/height/{height}`
   - `POST /dogecoin/vl/transaction`
   - `GET /dogecoin/vl/transaction/{txid}`
   - `GET /dogecoin/vl/transaction/{txid}/hex`
   - `GET /dogecoin/v1/address/{address}/balance`
   - `GET /dogecoin/vl/address/{address}/unspent`
   - `GET /dogecoin/v1l/address/{address}/txs`
   - `GET /dogecoin/v1/fees/recommended`
     - 备选 api：
       - https://chain.so/api/
       - https://cryptoapis.io/
2. `DogeUTXOSyncer`：Doge 地址的 UTXO 缓存模块
3. `RgbppCollector`：utxo-cells pair 缓存模块

12.16-12.18：
1. `TransactionProcessor`：构造最终的 RGB++ CKB 交易

## rgbpp-sdk

12.16-12.18：
1. 部署 mock RGB++ Lock Script（关闭 `check_btc_tx_exists`）校验；
2. Doge 交易签名；

12.18-12.25：
1. 联调 Doge SPV service；
2. 制定 rgbpp-sdk 重构方案；