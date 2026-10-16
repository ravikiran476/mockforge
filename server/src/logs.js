/** In-memory ring buffer of recent mock requests, newest first. */
export function createLogBuffer(limit = 300) {
  let items = [];
  return {
    add(entry) {
      items.unshift(entry);
      if (items.length > limit) items.length = limit;
    },
    list: () => items,
    clear() {
      items = [];
    },
  };
}
