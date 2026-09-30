/**
 * Assinatura dos envios nó → hub com Ed25519 (node:crypto, sem dependências).
 * Mensagem assinada: `${timestamp}\n${sha256(corpo) em hex}` — o timestamp limita reenvios
 * (FEDERATION_MAX_SKEW_MS) e o hash amarra a assinatura ao corpo exato.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";

export function generateNodeKeyPair(): { privateKeyPem: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

/** Valida e normaliza uma chave pública recebida (SPKI/DER em base64). */
export function parsePublicKey(base64: string): KeyObject {
  const key = createPublicKey({ key: Buffer.from(base64.trim(), "base64"), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("A chave pública precisa ser Ed25519");
  return key;
}

export function loadPrivateKey(path: string): KeyObject {
  const key = createPrivateKey(readFileSync(path));
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${path} não é uma chave privada Ed25519`);
  return key;
}

const message = (timestamp: string, body: string) =>
  Buffer.from(`${timestamp}\n${createHash("sha256").update(body).digest("hex")}`);

export function signPush(privateKey: KeyObject, timestamp: string, body: string): string {
  return sign(null, message(timestamp, body), privateKey).toString("base64");
}

export function verifyPush(publicKey: KeyObject, timestamp: string, body: string, signature: string): boolean {
  try {
    return verify(null, message(timestamp, body), publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
