import { keccak256, toBytes, type Hex } from "viem";

/** Serializes JSON with object keys sorted recursively and no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  const json = JSON.stringify(value, (_key, currentValue: unknown) => {
    if (
      currentValue !== null &&
      typeof currentValue === "object" &&
      !Array.isArray(currentValue)
    ) {
      const object = currentValue as Record<string, unknown>;

      return Object.keys(object)
        .sort()
        .reduce<Record<string, unknown>>((sorted, key) => {
          sorted[key] = object[key];
          return sorted;
        }, {});
    }

    return currentValue;
  });

  if (json === undefined) {
    throw new TypeError("Value is not JSON-serializable");
  }

  return json;
}

/** Returns the keccak256 hash of the canonical UTF-8 JSON representation. */
export function cardHash(card: unknown): Hex {
  return keccak256(toBytes(canonicalJson(card)));
}