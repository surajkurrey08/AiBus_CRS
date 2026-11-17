import { useEffect, useState } from "react";

export function useStored<T>(key: string, value: T) {
  const [data, setData] = useState<T>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") ?? value;
    } catch {
      return value;
    }
  });
  useEffect(() => localStorage.setItem(key, JSON.stringify(data)), [key, data]);
  return [data, setData] as const;
}
