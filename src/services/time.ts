export function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export function nowUtc(): Date {
  return new Date();
}

