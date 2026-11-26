// The first load took over 15 seconds with two other suites running. Eight times that leaves room for the registry to grow.
const AREA_PRELOAD_TIMEOUT_MS = 120_000;

export async function preloadArea<T>(load: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`The AWS area load did not finish within ${String(AREA_PRELOAD_TIMEOUT_MS)} ms.`));
    }, AREA_PRELOAD_TIMEOUT_MS);
  });

  try {
    return await Promise.race([deadline, load()]);
  } finally {
    clearTimeout(timer);
  }
}
