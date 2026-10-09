// Cifrado de tokens de Meta con AES-GCM (WebCrypto). Formato guardado: base64(iv) + ":" + base64(ciphertext).

const b64encode = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)));

const b64decode = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64decode(keyB64);
  if (raw.length !== 32) throw new Error("TOKEN_ENC_KEY debe ser de 32 bytes en base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `${b64encode(iv)}:${b64encode(ciphertext)}`;
}

export async function decryptSecret(stored: string, keyB64: string): Promise<string> {
  const [ivB64, dataB64] = stored.split(":");
  if (!ivB64 || !dataB64) throw new Error("Formato de secreto cifrado inválido");
  const key = await importKey(keyB64);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64decode(ivB64) }, key, b64decode(dataB64));
  return new TextDecoder().decode(plaintext);
}

/** Enmascara un token para logs: nunca se imprime completo. */
export const maskToken = (token: string) => (token.length <= 8 ? "****" : `${token.slice(0, 4)}…${token.slice(-4)}`);

/** Clave aleatoria no adivinable para objetos de R2. */
export function randomKey(bytes = 16): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}
