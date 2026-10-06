// Real database engines, reached through their command-line clients (see
// run.js for the variables). SQLite always runs, in memory.

/* global process */
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { DB } from "../../src/data/constants.js";

const env = process.env;

export const shell = (command, input) => {
  const result = spawnSync(command, {
    shell: true,
    input,
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  return {
    ok: result.status === 0,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
};

export const engines = {
  [DB.SQLITE]: {
    reset() {
      this.db = new Database(":memory:");
    },
    run(sql) {
      try {
        this.db.exec(sql);
        return { ok: true, out: "" };
      } catch (error) {
        return { ok: false, out: error.message };
      }
    },
  },
  [DB.POSTGRES]: env.SQL_PSQL && {
    reset() {
      shell(
        `${env.SQL_PSQL} -q -X -v ON_ERROR_STOP=1`,
        "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public;",
      );
    },
    run(sql) {
      const r = shell(`${env.SQL_PSQL} -q -X -v ON_ERROR_STOP=1 -f -`, sql);
      return { ok: r.ok && !/ERROR/.test(r.out), out: r.out };
    },
  },
  [DB.MYSQL]: env.SQL_MYSQL && mysqlLike(env.SQL_MYSQL),
  [DB.MARIADB]: env.SQL_MARIADB && mysqlLike(env.SQL_MARIADB),
  [DB.MSSQL]: env.SQL_SQLCMD && {
    reset() {
      shell(
        `${env.SQL_SQLCMD} -b -Q "IF DB_ID('drawdb_test') IS NOT NULL BEGIN ALTER DATABASE drawdb_test SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE drawdb_test; END; CREATE DATABASE drawdb_test;"`,
      );
    },
    run(sql) {
      const r = shell(`${env.SQL_SQLCMD} -b -I -d drawdb_test`, sql);
      return { ok: r.ok && !/Msg \d+/.test(r.out), out: r.out };
    },
  },
  [DB.ORACLESQL]: env.SQL_SQLPLUS && {
    reset() {
      shell(
        env.SQL_SQLPLUS,
        `WHENEVER SQLERROR EXIT FAILURE
BEGIN
  FOR t IN (SELECT table_name FROM user_tables) LOOP
    EXECUTE IMMEDIATE 'DROP TABLE "' || t.table_name || '" CASCADE CONSTRAINTS PURGE';
  END LOOP;
END;
/
EXIT
`,
      );
    },
    run(sql) {
      const r = shell(
        env.SQL_SQLPLUS,
        `WHENEVER SQLERROR EXIT FAILURE\nSET DEFINE OFF\n${sql}\nEXIT\n`,
      );
      return { ok: r.ok && !/(ORA|SP2|PLS)-\d+/.test(r.out), out: r.out };
    },
  },
};

export function mysqlLike(command) {
  return {
    reset() {
      shell(
        `${command} -e "DROP DATABASE IF EXISTS drawdb_test; DROP DATABASE IF EXISTS app; CREATE DATABASE drawdb_test;"`,
      );
    },
    run(sql) {
      return shell(`${command} drawdb_test`, sql);
    },
  };
}
