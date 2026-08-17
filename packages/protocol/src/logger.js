// Tiny leveled logger shared by the tunnel server and client.
// Level can be controlled via LOG_LEVEL env (debug|info|warn|error) or by
// constructing a logger with an explicit level.

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function readLevel() {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

function timestamp() {
  return new Date().toISOString();
}

export function createLogger(component = 'app', level = readLevel()) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function emit(levelName, levelValue, args) {
    if (levelValue < threshold) {
      return;
    }
    const line = [`[${timestamp()}]`, `[${levelName.toUpperCase()}]`, `[${component}]`, ...args]
      .map(String)
      .join(' ');
    if (levelValue >= LEVELS.error) {
      console.error(line);
    } else if (levelValue >= LEVELS.warn) {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (...args) => emit('debug', LEVELS.debug, args),
    info: (...args) => emit('info', LEVELS.info, args),
    warn: (...args) => emit('warn', LEVELS.warn, args),
    error: (...args) => emit('error', LEVELS.error, args),
  };
}

export default createLogger;