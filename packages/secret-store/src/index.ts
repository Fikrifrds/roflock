export interface SecretStore { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void>; }

export class InMemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();
  async get(key: string) { return this.values.get(key); }
  async set(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
}

/** Adapter boundary for keytar/OS keychain; injected so this package has no native dependency. */
export class OsKeychainSecretStore implements SecretStore {
  constructor(private readonly service: string, private readonly keychain: { getPassword(service: string, account: string): Promise<string | null>; setPassword(service: string, account: string, value: string): Promise<void>; deletePassword(service: string, account: string): Promise<boolean> }) {}
  async get(key: string) { return (await this.keychain.getPassword(this.service, key)) ?? undefined; }
  async set(key: string, value: string) { await this.keychain.setPassword(this.service, key, value); }
  async delete(key: string) { await this.keychain.deletePassword(this.service, key); }
}
