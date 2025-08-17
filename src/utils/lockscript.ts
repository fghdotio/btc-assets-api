import { getBtcTimeLockScript, getRgbppLockScript } from '@rgbpp-sdk/ckb';
import { IS_MAINNET, TESTNET_TYPE } from '../constants';

export function getRgbppLock(): CKBComponents.Script {
  return getRgbppLockScript(IS_MAINNET, TESTNET_TYPE);
}

export function getBtcTimeLock(): CKBComponents.Script {
  return getBtcTimeLockScript(IS_MAINNET, TESTNET_TYPE);
}

export function isRgbppLock(script: CKBComponents.Script): boolean {
  const rgbppLock = {
    codeHash: '0x52616e6badbb708be4ded222dc9fe5791b6bd0a5d518f7b5ab6cdee2f1868f95',
    hashType: 'type',
    args: '',
  };
  return script.codeHash === rgbppLock.codeHash && script.hashType === rgbppLock.hashType;
}

export function isBtcTimeLock(script: CKBComponents.Script): boolean {
  const btcTimeLock = {
    codeHash: '0x9b0280f33a20220def43b1beef5e60c8d0be604c6425fbf79cc04839db2572a0',
    hashType: 'type',
    args: '',
  };
  return script.codeHash === btcTimeLock.codeHash && script.hashType === btcTimeLock.hashType;
}
