import fs from 'node:fs';
import path from 'node:path';

const empty = () => ({ version: 1, endpoints: [], fixtures: [] });

/**
 * JSON-file backed store. Pass `file = null` for a purely in-memory store (tests).
 * The file is meant to be committed so a team shares the same mocks and fixtures.
 */
export function createStore(file, { seed } = {}) {
  let data;

  if (file && fs.existsSync(file)) {
    try {
      data = { ...empty(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (err) {
      throw new Error(`Could not parse MockForge data file ${file}: ${err.message}`);
    }
  } else {
    data = seed ? { ...empty(), ...structuredClone(seed) } : empty();
    save();
  }

  function save() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmp, file);
  }

  return {
    file,
    snapshot: () => structuredClone(data),
    list: (kind) => data[kind],
    get: (kind, id) => data[kind].find((item) => item.id === id),
    insert(kind, item) {
      data[kind].push(item);
      save();
      return item;
    },
    replace(kind, id, item) {
      const index = data[kind].findIndex((x) => x.id === id);
      if (index === -1) return null;
      data[kind][index] = item;
      save();
      return item;
    },
    remove(kind, id) {
      const before = data[kind].length;
      data[kind] = data[kind].filter((x) => x.id !== id);
      if (data[kind].length === before) return false;
      save();
      return true;
    },
    /** Replace whole collections at once (used by bulk import). */
    setAll(next) {
      data = { ...data, ...next };
      save();
    },
  };
}
