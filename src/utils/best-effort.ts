export interface BestEffortTask {
  name: string;
  run: () => Promise<unknown>;
}

export interface BestEffortTaskResult {
  name: string;
  durationMs: number;
  error?: unknown;
  timedOut: boolean;
}

class BestEffortTimeoutError extends Error {
  constructor(taskName: string, timeoutMs: number) {
    super(`${taskName} timed out after ${timeoutMs}ms`);
    this.name = 'BestEffortTimeoutError';
  }
}

async function runOneTask(task: BestEffortTask, timeoutMs: number): Promise<BestEffortTaskResult> {
  const startedAt = Date.now();
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      Promise.resolve().then(task.run),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new BestEffortTimeoutError(task.name, timeoutMs)),
          timeoutMs
        );
      }),
    ]);
    return { name: task.name, durationMs: Date.now() - startedAt, timedOut: false };
  } catch (error) {
    return {
      name: task.name,
      durationMs: Date.now() - startedAt,
      error,
      timedOut: error instanceof BestEffortTimeoutError,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Run independent non-critical tasks concurrently with a per-task time limit. */
export async function runBestEffortTasks(
  tasks: readonly BestEffortTask[],
  timeoutMs: number
): Promise<BestEffortTaskResult[]> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive finite number');
  }
  return Promise.all(tasks.map((task) => runOneTask(task, timeoutMs)));
}
