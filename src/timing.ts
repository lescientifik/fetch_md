export function now(): number {
  return performance.now();
}

export function elapsed(since: number): number {
  return performance.now() - since;
}
