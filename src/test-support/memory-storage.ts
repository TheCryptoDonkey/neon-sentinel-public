/**
 * Minimal in-memory Storage shim for tests that exercise localStorage-backed
 * modules under Vitest's plain "node" environment (no jsdom).
 */
export class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

export function createMemoryStorage(): MemoryStorage {
  return new MemoryStorage();
}

/**
 * A Storage that throws on every read/write, to exercise the try/catch
 * fallback paths that guard against blocked or unavailable localStorage.
 */
export function createThrowingStorage(): Storage {
  const explode = (): never => {
    throw new DOMException('storage disabled', 'SecurityError');
  };
  return {
    get length() { return 0; },
    clear: explode,
    getItem: explode,
    key: explode,
    removeItem: explode,
    setItem: explode,
  };
}

/**
 * Minimal `window` stub for modules that call `window.dispatchEvent(...)`
 * as a side-effecting notification. Not jsdom — just enough surface for
 * those calls not to throw under Node's plain environment.
 */
export function installMinimalWindow(): void {
  if (typeof (globalThis as Record<string, unknown>).window === 'undefined') {
    (globalThis as unknown as { window: { dispatchEvent: (event: unknown) => boolean } }).window = {
      dispatchEvent: () => true,
    };
  }
}
