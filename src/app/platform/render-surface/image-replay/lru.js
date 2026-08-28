export function oldestLruKey(entries) {
    return entries.keys().next().value;
}

export function touchLruEntry(entries, key, value) {
    entries.delete(key);
    entries.set(key, value);
}
