export function timeoutAfter<T>(ms: number, defaultValue: T): Promise<T> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(defaultValue);
    }, ms);
  });
}