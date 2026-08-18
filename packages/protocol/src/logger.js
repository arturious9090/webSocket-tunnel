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

  // The logger itself is callable (log(...) === log.info(...)) so it can be
  // passed to functions that expect a plain `log` function, while still
  // exposing leveled methods for structured logging.
  const log = (...args) => emit('info', LEVELS.info, args);
  log.debug = (...args) => emit('debug', LEVELS.debug, args);
  log.info = (...args) => emit('info', LEVELS.info, args);
  log.warn = (...args) => emit('warn', LEVELS.warn, args);
  log.error = (...args) => emit('error', LEVELS.error, args);
  return log;
}

export default createLogger;