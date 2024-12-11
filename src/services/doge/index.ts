import { Cradle } from '../../container';
import { RestApiDogeClient } from './restapi';

// dev Crypto APIs
const apiKey = '5535a247f8973fb4fc2b6e7ef190a2a5bd045c37';
const testnetBaseUrl = 'https://rest.cryptoapis.io/blockchain-data/bitcoin';

export default class DogeClient {
  private cradle: Cradle;
  private source;

  constructor(cradle: Cradle) {
    this.cradle = cradle;
    this.source = new RestApiDogeClient(testnetBaseUrl, apiKey);
  }
}
