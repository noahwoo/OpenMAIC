function createPoller(load, receive, fail, interval = 4000, timers = { setTimeout, clearTimeout }) {
  let timer;
  let version = 0;
  async function tick(token) {
    try {
      const value = await load();
      if (version !== token) return;
      if (receive(value) === false) return;
    } catch (error) {
      if (version !== token) return;
      if (fail(error) === false) return;
    }
    if (version === token) timer = timers.setTimeout(() => tick(token), interval);
  }
  return {
    start() {
      version += 1;
      timers.clearTimeout(timer);
      tick(version);
    },
    stop() {
      version += 1;
      timers.clearTimeout(timer);
    },
  };
}
module.exports = { createPoller };
