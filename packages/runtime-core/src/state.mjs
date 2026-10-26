import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} stateFile
 * @param {object} state
 */
export function writeRuntimeState(stateFile, state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
}
