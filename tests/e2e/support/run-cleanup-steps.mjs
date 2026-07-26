export function runCleanupSteps(steps) {
  const failures = [];
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, 'EasyMDE E2E cleanup failed.');
  }
}
