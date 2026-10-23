import { useEffect, useState } from 'react';

// useState that survives page reloads. Storage can be unavailable (private mode,
// blocked site data), so every access is guarded and the hook still works in memory.
export function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initialValue : JSON.parse(stored);
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Not persisting is acceptable; the value still lives in React state.
    }
  }, [key, value]);

  return [value, setValue];
}
