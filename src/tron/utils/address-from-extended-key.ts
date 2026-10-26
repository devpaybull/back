import { TronWeb, utils } from 'tronweb';

export const addressFromExtendedKey = (
  extendedKey: string,
  derivationIndex: number,
): string => {
  const node = utils.ethersUtils.ethersHDNodeWallet
    .fromExtendedKey(extendedKey)
    .deriveChild(0)
    .deriveChild(derivationIndex);
  const publicKey = utils.ethersUtils.SigningKey.computePublicKey(
    node.publicKey,
    false,
  );
  const addressBytes = utils.crypto.computeAddress(
    utils.code.hexStr2byteArray(publicKey.slice(2)),
  );

  return TronWeb.address.fromHex(utils.bytes.byteArray2hexStr(addressBytes));
};
