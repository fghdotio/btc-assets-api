import axios, { AxiosInstance } from 'axios';

export class ElectrsDogeClient {
  private request: AxiosInstance;

  constructor(private baseURL: string) {
    this.request = axios.create({
      baseURL,
    });
  }

  public getBaseURL(): string {
    return this.baseURL;
  }
}
