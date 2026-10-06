import * as SecureStore from "expo-secure-store";

/**
 * Speicher-Adapter für die Supabase-Session auf Basis von Expo SecureStore
 * (Android Keystore / iOS Keychain).
 *
 * SecureStore ist für kleine Werte gedacht; eine Supabase-Session kann größer als
 * 2 KB sein. Der Wert wird deshalb in Abschnitte aufgeteilt, die alle in
 * SecureStore liegen. Es wird bewusst KEINE eigene Verschlüsselung implementiert
 * und nichts davon landet in AsyncStorage.
 */

export const SECURE_CHUNK_SIZE = 1800;
const MAX_CHUNKS = 32;

const options: SecureStore.SecureStoreOptions = {
  // iOS: nur auf diesem Gerät, nach dem ersten Entsperren. Android ignoriert die Option.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** SecureStore erlaubt nur alphanumerische Zeichen sowie „.“, „-“ und „_“ in Schlüsseln. */
export function toSecureKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

const countKey = (key: string) => `${toSecureKey(key)}.n`;
const chunkKey = (key: string, index: number) => `${toSecureKey(key)}.${index}`;

async function readCount(key: string): Promise<number | null> {
  const raw = await SecureStore.getItemAsync(countKey(key), options);
  if (raw === null) return null;
  const count = Number(raw);
  return Number.isInteger(count) && count >= 0 && count <= MAX_CHUNKS ? count : null;
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = await readCount(key);
    if (count === null) return null;
    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(chunkKey(key, i), options)),
    );
    if (parts.some((part) => part === null)) return null;
    return parts.join("");
  },

  async setItem(key: string, value: string): Promise<void> {
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += SECURE_CHUNK_SIZE) {
      chunks.push(value.slice(i, i + SECURE_CHUNK_SIZE));
    }
    if (chunks.length > MAX_CHUNKS) {
      throw new Error("Sitzungsdaten sind unerwartet groß und werden nicht gespeichert.");
    }
    await secureSessionStorage.removeItem(key);
    for (const [index, chunk] of chunks.entries()) {
      await SecureStore.setItemAsync(chunkKey(key, index), chunk, options);
    }
    // Zähler zuletzt schreiben: unvollständige Schreibvorgänge werden so nie gelesen.
    await SecureStore.setItemAsync(countKey(key), String(chunks.length), options);
  },

  async removeItem(key: string): Promise<void> {
    const count = (await readCount(key)) ?? MAX_CHUNKS;
    await SecureStore.deleteItemAsync(countKey(key), options);
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        SecureStore.deleteItemAsync(chunkKey(key, i), options),
      ),
    );
  },
};
