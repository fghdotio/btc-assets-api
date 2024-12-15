import * as AddressValidator from 'multicoin-address-validator';
import { env } from '../env';
import { NetworkType, DogecoinNetworkType } from '../constants';

export function validateBitcoinAddress(address: string): boolean {
  return AddressValidator.validate(address, 'BTC', env.NETWORK === NetworkType.mainnet.toString() ? 'prod' : 'testnet');
}

export function validateDogecoinAddress(address: string): boolean {
  return AddressValidator.validate(
    address,
    'DOGE',
    env.DOGE_NETWORK === DogecoinNetworkType.mainnet.toString() ? 'prod' : 'testnet',
  );
}
