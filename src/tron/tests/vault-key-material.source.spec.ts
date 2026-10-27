import { VaultKeyMaterialSource } from '../services/vault-key-material.source';

const CIPHERTEXTS: Record<string, string> = {
  TRON_DEPOSIT_SEED_CIPHERTEXT: 'vault:v1:seed',
  TRON_HOT_KEY_CIPHERTEXT: 'vault:v1:hot',
  TRON_ENERGY_KEY_CIPHERTEXT: 'vault:v1:energy',
};

const build = () => {
  const vault = {
    decrypt: jest.fn(async (ciphertext: string) =>
      Buffer.from(`plain of ${ciphertext}`),
    ),
  };
  const config = { getOrThrow: jest.fn((key: string) => CIPHERTEXTS[key]) };

  return {
    source: new VaultKeyMaterialSource(config as never, vault as never),
    vault,
  };
};

describe('VaultKeyMaterialSource', () => {
  it.each([
    ['deposit', 'vault:v1:seed'],
    ['hot', 'vault:v1:hot'],
    ['energy', 'vault:v1:energy'],
  ] as const)(
    'decrypts the %s key from its ciphertext',
    async (kind, ciphertext) => {
      const { source, vault } = build();

      const material = await source.read(kind);

      expect(vault.decrypt).toHaveBeenCalledWith(ciphertext);
      expect(material.toString()).toBe(`plain of ${ciphertext}`);
    },
  );

  it('passes a Vault failure through', async () => {
    const { source, vault } = build();
    vault.decrypt.mockRejectedValueOnce(new Error('vault down'));

    await expect(source.read('hot')).rejects.toThrow('vault down');
  });
});
