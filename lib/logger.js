export function createLogger(verbose) {
  if (!verbose) {
    return () => {};
  }

  return (message, ...args) => {
    const prefix = `[figma-brief]`;

    if (args.length > 0) {
      console.error(prefix, message, ...args);
    } else {
      console.error(prefix, message);
    }
  };
}
