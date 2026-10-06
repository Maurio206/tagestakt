/* global jest */
// AsyncStorage: offizielles In-Memory-Mock.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// SecureStore: In-Memory-Ersatz für Tests.
jest.mock("expo-secure-store", () => {
  const store = new Map();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
    __store: store,
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => {
      if (!/^[A-Za-z0-9._-]+$/.test(key))
        throw new Error(`Ungültiger SecureStore-Schlüssel: ${key}`);
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
  };
});
