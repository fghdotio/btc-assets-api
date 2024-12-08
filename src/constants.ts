import { env, isAdminMode } from './env';
import { BTCTestnetType } from '@rgbpp-sdk/ckb';

export enum NetworkType {
  mainnet = 'mainnet',
  testnet = 'testnet',
  signet = 'signet',
}

export const TestnetTypeMap: Record<NetworkType, BTCTestnetType | undefined> = {
  [NetworkType.mainnet]: undefined,
  [NetworkType.testnet]: 'Testnet3',
  [NetworkType.signet]: 'Signet',
};

// * 内部使用的 HTTP Headers，独立于 HTTP 标准 Headers
export const CUSTOM_HEADERS = {
  ApiCache: 'x-api-cache',
  ResponseCacheable: 'x-response-cacheable',
  ResponseCacheMaxAge: 'x-response-cache-max-age',
};

export enum ApiCacheStatus {
  Hit = 'HIT',
  Miss = 'MISS',
}

export const JWT_IGNORE_URLS = ['/token', '/docs', '/cron', '/internal', '/healthcheck'];
export const SWAGGER_PROD_IGNORE_URLS = isAdminMode ? ['/token', '/cron'] : ['/cron'];

export const VERCEL_MAX_DURATION = 300;

// estimate time: 2024-04-03 09:45:17
// ref: https://mempool.space/testnet/block/000000000000000493ba5eebf0602f3e0e5381dd35f763a62ca7ea135343a0d6
export const BTC_TESTNET_SPV_START_BLOCK_HEIGHT = 2584900;

// estimate time: 2024-06-13 18:31:56
// ref: https://mempool.space/signet/block/000000b2af39a66ec81d414b102804d975c5c4527adfd9bd3cabf2b7b4634737
// Signet BTC SPV deployment time: https://pudge.explorer.nervos.org/transaction/0x61efdeddbaa0bb4132c0eb174b3e8002ff5ec430f61ba46f30768d683c516eec
export const BTC_SIGNET_SPV_START_BLOCK_HEIGHT = 199800;

// estimate time: 2024-04-02 06:20:03
// ref: https://mempool.space/block/0000000000000000000077d98a103858c7d7cbc5ba67a4135f348a436bec1748
export const BTC_MAINNET_SPV_START_BLOCK_HEIGHT = 837300;

export const IS_MAINNET = env.NETWORK === NetworkType.mainnet.toString();
export const TESTNET_TYPE = TestnetTypeMap[env.NETWORK];
