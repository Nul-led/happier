import {
  normalizeStrictJsonValue,
  type JsonValue,
} from '../json/strictJsonValue.js';

function canonicalizeJsonValue(value: JsonValue): JsonValue {
  let output: JsonValue = null;
  const pending: { value: JsonValue; assign: (value: JsonValue) => void }[] = [
    { value, assign: (canonical) => { output = canonical; } },
  ];
  while (pending.length > 0) {
    const task = pending.pop()!;
    if (Array.isArray(task.value)) {
      const array: JsonValue[] = new Array(task.value.length);
      task.assign(array);
      for (let index = task.value.length - 1; index >= 0; index -= 1) {
        const position = index;
        pending.push({ value: task.value[index]!, assign: (canonical) => { array[position] = canonical; } });
      }
    } else if (task.value !== null && typeof task.value === 'object') {
      const record = task.value as Readonly<Record<string, JsonValue>>;
      const keys = Object.keys(record).sort();
      // Define data properties (including __proto__) just like Object.fromEntries.
      const object: Record<string, JsonValue> = Object.fromEntries(keys.map((key) => [key, null]));
      task.assign(object);
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index]!;
        pending.push({ value: record[key]!, assign: (canonical) => { object[key] = canonical; } });
      }
    } else {
      task.assign(task.value);
    }
  }
  return output;
}

export function createCanonicalJsonSigningInput(value: unknown): string {
  const serialized = JSON.stringify(canonicalizeJsonValue(normalizeStrictJsonValue(value)));
  if (typeof serialized !== 'string') {
    throw new TypeError('Canonical JSON serialization did not produce a string');
  }
  return serialized;
}
