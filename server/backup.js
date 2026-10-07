import fs from "node:fs";
import path from "node:path";

const NAME = /^drawdb-\d{8}-\d{6}\.sqlite$/;

const timestamp = (date) =>
  date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

/**
 * Periodic copies of the database (SQLite's online backup, so the server keeps
 * working while it runs), keeping the newest `keep` files in `directory`.
 */
export function createBackupService({
  db,
  directory,
  intervalHours = 24,
  keep = 14,
  log = console.log,
}) {
  let timer = null;
  let running = null;

  const list = () => {
    if (!directory || !fs.existsSync(directory)) return [];
    return fs
      .readdirSync(directory)
      .filter((name) => NAME.test(name))
      .map((name) => {
        const stat = fs.statSync(path.join(directory, name));
        return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  };

  const prune = () => {
    for (const old of list().slice(keep)) {
      fs.rmSync(path.join(directory, old.name), { force: true });
    }
  };

  const backupNow = async () => {
    if (!directory) throw new Error("Backups are not configured");
    // One backup at a time; a second request waits for the running one.
    if (running) return running;
    running = (async () => {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      let name = `drawdb-${timestamp(new Date())}.sqlite`;
      let counter = 1;
      while (fs.existsSync(path.join(directory, name))) {
        // Two backups within the same second.
        name = `drawdb-${timestamp(new Date(Date.now() + counter++ * 1000))}.sqlite`;
      }
      const target = path.join(directory, name);
      await db.backup(target);
      fs.chmodSync(target, 0o600);
      prune();
      return list().find((entry) => entry.name === name);
    })();
    try {
      return await running;
    } finally {
      running = null;
    }
  };

  return {
    enabled: Boolean(directory),
    list,
    backupNow,
    /** The path of a backup by name, or null when there is no such file. */
    file(name) {
      if (!directory || !NAME.test(String(name))) return null;
      const target = path.join(directory, name);
      return fs.existsSync(target) ? target : null;
    },
    start() {
      if (!directory || !(intervalHours > 0)) return;
      const intervalMs = intervalHours * 3_600_000;
      const run = () =>
        backupNow().catch((error) =>
          log(`Database backup failed: ${error.message}`),
        );
      const newest = list()[0];
      const age = newest ? Date.now() - Date.parse(newest.createdAt) : Infinity;
      if (age >= intervalMs) run();
      timer = setInterval(run, intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
