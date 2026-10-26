import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveDataHome } from './paths.mjs';

const MARKER_NAME = 'desktop-data-v1.done.json';

/**
 * @param {string} dataHome
 */
export function migrationMarkerPath(dataHome) {
  return path.join(dataHome, '.migrations', MARKER_NAME);
}

/**
 * @param {string} src
 * @param {string} dest
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {{ copied: number; skipped: number }}
 */
export function copyTreeMerge(src, dest, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  let copied = 0;
  let skipped = 0;

  if (!fs.existsSync(src)) {
    return { copied, skipped };
  }

  const walk = (relDir) => {
    const abs = path.join(src, relDir);
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    for (const ent of entries) {
      const rel = path.join(relDir, ent.name);
      const from = path.join(src, rel);
      const to = path.join(dest, rel);
      if (ent.isDirectory()) {
        if (!dryRun && !fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
        walk(rel);
        continue;
      }
      if (fs.existsSync(to)) {
        skipped += 1;
        continue;
      }
      if (!dryRun) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
      }
      copied += 1;
    }
  };

  if (!dryRun && !fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  walk('');
  return { copied, skipped };
}

/**
 * @param {{ dataHome?: string; dryRun?: boolean; force?: boolean }} [opts]
 */
export function planDesktopDataMigration(opts = {}) {
  const home = os.homedir();
  const dataHome = opts.dataHome ?? resolveDataHome({ profile: 'desktop' });
  const legacyYueli = path.join(home, '.yueli');
  const legacyTmp = '/tmp/yueli-kgm-data';

  /** @type {Array<{ id: string; from: string; to: string; mode: 'merge' | 'file' }>} */
  const steps = [];

  const skillsSrc = path.join(legacyYueli, 'skills');
  const skillsDest = path.join(dataHome, 'skills');
  if (fs.existsSync(skillsSrc)) {
    steps.push({ id: 'skills', from: skillsSrc, to: skillsDest, mode: 'merge' });
  }

  const tmpDb = path.join(legacyTmp, 'kgm.db');
  const destDb = path.join(dataHome, 'kgm.db');
  if (fs.existsSync(tmpDb) && !fs.existsSync(destDb)) {
    steps.push({ id: 'kgm-db', from: tmpDb, to: destDb, mode: 'file' });
  }

  const tmpModels = path.join(legacyTmp, 'models');
  const destModels = path.join(dataHome, 'models');
  if (fs.existsSync(tmpModels)) {
    steps.push({ id: 'kgm-models', from: tmpModels, to: destModels, mode: 'merge' });
  }

  const tmpCfg = path.join(legacyTmp, 'kgm.config.json');
  const destCfg = path.join(dataHome, 'kgm.config.json');
  if (fs.existsSync(tmpCfg) && !fs.existsSync(destCfg)) {
    steps.push({ id: 'kgm-config', from: tmpCfg, to: destCfg, mode: 'file' });
  }

  const marker = migrationMarkerPath(dataHome);
  const alreadyDone = !opts.force && fs.existsSync(marker);

  return { dataHome, steps, marker, alreadyDone, legacyYueli, legacyTmp };
}

/**
 * @param {{ dataHome?: string; dryRun?: boolean; force?: boolean }} [opts]
 */
export function runDesktopDataMigration(opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const plan = planDesktopDataMigration(opts);

  if (plan.alreadyDone) {
    return { status: 'skipped', reason: 'already_migrated', plan, stats: {} };
  }

  if (plan.steps.length === 0) {
    return { status: 'noop', reason: 'no_legacy_data', plan, stats: {} };
  }

  const stats = {};
  for (const step of plan.steps) {
    if (step.mode === 'merge') {
      stats[step.id] = copyTreeMerge(step.from, step.to, { dryRun });
    } else {
      const exists = fs.existsSync(step.to);
      if (exists) {
        stats[step.id] = { copied: 0, skipped: 1 };
      } else if (dryRun) {
        stats[step.id] = { copied: 1, skipped: 0 };
      } else {
        fs.mkdirSync(path.dirname(step.to), { recursive: true });
        fs.copyFileSync(step.from, step.to);
        stats[step.id] = { copied: 1, skipped: 0 };
      }
    }
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(plan.marker), { recursive: true });
    fs.writeFileSync(
      plan.marker,
      JSON.stringify(
        {
          version: 1,
          migratedAt: new Date().toISOString(),
          stats,
          sources: {
            legacyYueli: plan.legacyYueli,
            legacyTmp: plan.legacyTmp,
          },
        },
        null,
        2
      )
    );
  }

  return { status: dryRun ? 'dry_run' : 'completed', plan, stats };
}
