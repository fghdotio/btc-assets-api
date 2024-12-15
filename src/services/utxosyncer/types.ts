class UTXOSyncerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UTXOSyncerError';
  }
}

export { UTXOSyncerError };
