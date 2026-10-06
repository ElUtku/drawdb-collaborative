import assert from "node:assert/strict";
import test from "node:test";
import NodeSQLParser from "node-sql-parser";
import OracleSQLParser from "oracle-sql-parser";
import { DB } from "../../data/constants.js";
import { diagrams } from "../../../scripts/sql-engines/fixtures.js";
import { shop } from "../../../scripts/sql-engines/migration-fixtures.js";
import { generateSQL } from "../exportSQL/index.js";
import { prepareSQL } from "./prepare.js";
import { importScript as importWith } from "./script.js";

/** What the import dialog does with a script. */
const importScript = (sql, database) =>
  importWith(sql, {
    database,
    Parser: NodeSQLParser.Parser,
    OracleParser: OracleSQLParser.Parser,
  });

const DIALECTS = [
  DB.MYSQL,
  DB.MARIADB,
  DB.POSTGRES,
  DB.SQLITE,
  DB.MSSQL,
  DB.ORACLESQL,
];
const SETTINGS = [
  {},
  { existing: "create" },
  { existing: "drop_create" },
  { existing: "create", foreignKeys: "alter" },
  { foreignKeys: "inline" },
  { identifierQuoting: "when_needed" },
  { includeComments: false, includeIndexes: false },
];
// INT and INTEGER are the same type, and a column without a default
// defaults to NULL.
const comparable = (sql, database) =>
  ([DB.MYSQL, DB.MARIADB].includes(database)
    ? sql.replace(/\bINT\b/g, "INTEGER")
    : sql
  ).replace(/(?: CONSTRAINT (?:\[[^\]]*\]|"[^"]*"|\S+))? DEFAULT NULL\b/g, "");

test("our own SQL imports back into the same schema, for every engine and setting", () => {
  const cases = [["shop", shop], ...Object.entries(diagrams)];
  let checked = 0;
  for (const database of DIALECTS) {
    for (const [name, build] of cases) {
      for (const settings of SETTINGS) {
        const options = { includeHeader: false, ...settings };
        const first = generateSQL(build(database), { options }).sql;
        const imported = importScript(first, database);
        const second = generateSQL(
          {
            ...imported,
            references: imported.relationships,
            database,
          },
          { options },
        ).sql;
        assert.equal(
          comparable(second, database),
          comparable(first, database),
          `${database} ${name} ${JSON.stringify(settings)}`,
        );
        checked++;
      }
    }
  }
  assert.equal(checked, DIALECTS.length * cases.length * SETTINGS.length);
});

test("pg_dump output imports: settings, sequences and ALTER TABLE ONLY are handled", () => {
  const dump = `--
-- PostgreSQL database dump
--
SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SELECT pg_catalog.set_config('search_path', '', false);
SET default_tablespace = '';

CREATE TABLE public.customers (
    id integer NOT NULL,
    email character varying(120) NOT NULL,
    note text DEFAULT 'it''s ok'::text
);

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;

CREATE TABLE public.orders (
    id integer NOT NULL,
    customer_id integer NOT NULL
);

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);

COPY public.customers (id, email) FROM stdin;
1\tann@example.com
\\.

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_email_key UNIQUE (email);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;
`;
  const diagram = importScript(dump, DB.POSTGRES);
  assert.deepEqual(
    diagram.tables.map((t) => t.name),
    ["customers", "orders"],
  );
  const customers = diagram.tables[0];
  const id = customers.fields.find((f) => f.name === "id");
  assert.equal(id.primary, true);
  assert.equal(id.increment, true);
  assert.deepEqual(customers.uniqueConstraints, [
    { id: 0, name: "customers_email_key", fields: ["email"] },
  ]);
  assert.equal(
    customers.fields.find((f) => f.name === "note").default,
    "it's ok",
  );
  assert.equal(diagram.relationships.length, 1);
  assert.equal(diagram.relationships[0].name, "orders_customer_id_fkey");
  assert.equal(diagram.relationships[0].deleteConstraint, "Cascade");
});

test("pg_dump 16 output keeps types, arrays, enums and identities", () => {
  // Real pg_dump --schema-only output (owners and settings trimmed).
  const dump = `\\restrict fgXCjfoVM7d3dUxlL8ba3e5bQizxmOUlY5lJd4F8a318H5F1QoDIHWVUg5IGPSP
SET client_encoding = 'UTF8';
COMMENT ON SCHEMA public IS '';
CREATE TYPE public.order_status AS ENUM (
    'new',
    'paid',
    'it''s done'
);
ALTER TYPE public.order_status OWNER TO postgres;
CREATE TABLE public.accounts (
    id uuid NOT NULL,
    login character varying(40) NOT NULL,
    tags text[],
    scores integer[],
    settings jsonb DEFAULT '{}'::jsonb,
    created timestamp with time zone DEFAULT now() NOT NULL,
    local_t time(3) without time zone,
    code character(3),
    ratio double precision,
    small smallint,
    flag boolean DEFAULT true
);
ALTER TABLE public.accounts OWNER TO postgres;
CREATE TABLE public.orders (
    id bigint NOT NULL,
    account_id uuid NOT NULL,
    status public.order_status DEFAULT 'new'::public.order_status NOT NULL,
    amount numeric(12,2),
    serial_no integer NOT NULL,
    CONSTRAINT orders_amount_check CHECK ((amount >= (0)::numeric))
);
COMMENT ON TABLE public.orders IS 'Orders';
COMMENT ON COLUMN public.orders.status IS 'Life cycle';
ALTER TABLE public.orders ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE SEQUENCE public.orders_serial_no_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.orders_serial_no_seq OWNED BY public.orders.serial_no;
ALTER TABLE ONLY public.orders ALTER COLUMN serial_no SET DEFAULT nextval('public.orders_serial_no_seq'::regclass);
ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_login_key UNIQUE (login);
ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_account_id_serial_no_key UNIQUE (account_id, serial_no);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX ux_orders_lower ON public.orders USING btree (account_id, status);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
REVOKE USAGE ON SCHEMA public FROM PUBLIC;
\\unrestrict fgXCjfoVM7d3dUxlL8ba3e5bQizxmOUlY5lJd4F8a318H5F1QoDIHWVUg5IGPSP
`;
  const diagram = importScript(dump, DB.POSTGRES);
  assert.deepEqual(diagram.enums, [
    { name: "order_status", values: ["new", "paid", "it's done"] },
  ]);
  const [accounts, orders] = diagram.tables;
  const field = (table, name) => table.fields.find((f) => f.name === name);
  const shape = (f) => [f.type, f.size ?? "", Boolean(f.isArray)];
  assert.deepEqual(shape(field(accounts, "login")), ["VARCHAR", 40, false]);
  assert.deepEqual(shape(field(accounts, "tags")), ["TEXT", "", true]);
  assert.deepEqual(shape(field(accounts, "scores")), ["INTEGER", "", true]);
  assert.deepEqual(shape(field(accounts, "created")), [
    "TIMESTAMPTZ",
    "",
    false,
  ]);
  assert.deepEqual(shape(field(accounts, "code")), ["CHAR", 3, false]);
  assert.deepEqual(shape(field(accounts, "ratio")), [
    "DOUBLE PRECISION",
    "",
    false,
  ]);
  assert.equal(field(accounts, "settings").default, "{}");
  assert.equal(field(accounts, "id").primary, true);
  assert.equal(field(orders, "id").increment, true);
  assert.equal(field(orders, "serial_no").increment, true);
  assert.equal(field(orders, "status").type, "order_status");
  assert.equal(field(orders, "status").default, "new");
  assert.equal(field(orders, "status").comment, "Life cycle");
  assert.equal(field(orders, "amount").check, "amount >= (0)::NUMERIC");
  assert.equal(orders.comment, "Orders");
  assert.deepEqual(
    orders.uniqueConstraints.map((u) => u.fields),
    [["account_id", "serial_no"]],
  );
  assert.deepEqual(
    orders.indices.map((i) => [i.name, i.unique]),
    [["ux_orders_lower", true]],
  );
  assert.equal(diagram.relationships[0].deleteConstraint, "Set null");
});

test("mysqldump output imports: versioned comments, locks and rows are skipped", () => {
  const dump = `-- MySQL dump 10.13
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
DROP TABLE IF EXISTS \`orders\`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
CREATE TABLE \`orders\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`customer_id\` int NOT NULL,
  \`status\` varchar(20) DEFAULT 'new' COMMENT 'it\\'s the state',
  PRIMARY KEY (\`id\`),
  KEY \`fk_orders_customer\` (\`customer_id\`),
  CONSTRAINT \`fk_orders_customer\` FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
LOCK TABLES \`orders\` WRITE;
INSERT INTO \`orders\` VALUES (1,1,'new');
UNLOCK TABLES;
DROP TABLE IF EXISTS \`customers\`;
CREATE TABLE \`customers\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`email\` varchar(120) NOT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`email\` (\`email\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;
  const diagram = importScript(dump, DB.MYSQL);
  assert.deepEqual(diagram.tables.map((t) => t.name).sort(), [
    "customers",
    "orders",
  ]);
  const orders = diagram.tables.find((t) => t.name === "orders");
  const status = orders.fields.find((f) => f.name === "status");
  assert.equal(status.comment, "it's the state");
  assert.equal(status.default, "new");
  // KEY fk_orders_customer is the index MySQL made for the foreign key.
  assert.deepEqual(orders.indices, []);
  // The foreign key points at a table defined later in the dump.
  assert.equal(diagram.relationships.length, 1);
  assert.equal(diagram.relationships[0].deleteConstraint, "Cascade");
  const customers = diagram.tables.find((t) => t.name === "customers");
  assert.equal(customers.indices[0].unique, true);
});

test("SQL Server Management Studio scripts import: GO, options, filegroups, ALTER defaults and checks", () => {
  const script = `USE [shop]
GO
/****** Object:  Table [dbo].[customers] ******/
SET ANSI_NULLS ON
GO
CREATE TABLE [dbo].[customers](
\t[id] [int] IDENTITY(1,1) NOT NULL,
\t[email] [nvarchar](120) NOT NULL,
\t[created_at] [datetime2](7) NOT NULL,
 CONSTRAINT [PK_customers] PRIMARY KEY CLUSTERED 
(
\t[id] ASC
)WITH (PAD_INDEX = OFF, IGNORE_DUP_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_customers_email] UNIQUE NONCLUSTERED 
(
\t[email] ASC
)WITH (PAD_INDEX = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
CREATE TABLE [dbo].[orders](
\t[id] [bigint] IDENTITY(1,1) NOT NULL,
\t[customer_id] [int] NOT NULL,
\t[status] [varchar](20) NOT NULL,
\t[qty] [int] NOT NULL,
 CONSTRAINT [PK_orders] PRIMARY KEY CLUSTERED ([id] ASC)
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
ALTER TABLE [dbo].[customers] ADD  CONSTRAINT [DF_customers_created_at]  DEFAULT (sysdatetime()) FOR [created_at]
GO
ALTER TABLE [dbo].[orders] ADD  DEFAULT (N'new') FOR [status]
GO
ALTER TABLE [dbo].[orders] ADD  DEFAULT ((1)) FOR [qty]
GO
ALTER TABLE [dbo].[orders]  WITH CHECK ADD  CONSTRAINT [FK_orders_customers] FOREIGN KEY([customer_id])
REFERENCES [dbo].[customers] ([id])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[orders] CHECK CONSTRAINT [FK_orders_customers]
GO
ALTER TABLE [dbo].[orders]  WITH CHECK ADD  CONSTRAINT [CK_orders_status] CHECK  (([status]='done' OR [status]='new'))
GO
ALTER TABLE [dbo].[orders] CHECK CONSTRAINT [CK_orders_status]
GO
CREATE NONCLUSTERED INDEX [IX_orders_customer] ON [dbo].[orders]
(
\t[customer_id] ASC
)WITH (PAD_INDEX = OFF) ON [PRIMARY]
GO
EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'Who buys' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'customers'
GO
`;
  const diagram = importScript(script, DB.MSSQL);
  const [customers, orders] = diagram.tables;
  assert.equal(customers.comment, "Who buys");
  assert.deepEqual(
    customers.uniqueConstraints.map((u) => u.name),
    ["UQ_customers_email"],
  );
  const field = (table, name) => table.fields.find((f) => f.name === name);
  assert.equal(field(customers, "id").increment, true);
  assert.equal(field(customers, "created_at").default, "sysdatetime()");
  assert.equal(field(orders, "status").default, "new");
  assert.equal(field(orders, "qty").default, "1");
  assert.equal(field(orders, "status").check, "status='done' OR status='new'");
  assert.deepEqual(
    orders.indices.map((i) => [i.name, i.fields]),
    [["IX_orders_customer", ["customer_id"]]],
  );
  assert.equal(diagram.relationships.length, 1);
  assert.equal(diagram.relationships[0].name, "FK_orders_customers");
  assert.equal(diagram.relationships[0].deleteConstraint, "Cascade");
});

test("sqlite3 .dump output imports: transactions, rows and sqlite_sequence are skipped", () => {
  const dump = `PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, note TEXT DEFAULT 'it''s');
INSERT INTO customers VALUES(1,'a@b.c',NULL);
CREATE TABLE IF NOT EXISTS "orders" (
  "id" INTEGER NOT NULL,
  "customer_id" INTEGER NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "qty" INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  PRIMARY KEY("id")
);
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence VALUES('customers',1);
CREATE INDEX idx_orders_customer ON orders(customer_id);
COMMIT;
`;
  const diagram = importScript(dump, DB.SQLITE);
  const [customers, orders] = diagram.tables;
  const field = (table, name) => table.fields.find((f) => f.name === name);
  assert.equal(field(customers, "id").increment, true);
  assert.equal(field(customers, "email").unique, true);
  assert.equal(field(customers, "note").default, "it's");
  assert.equal(field(orders, "id").primary, true);
  assert.equal(field(orders, "qty").check, "qty > 0");
  assert.deepEqual(
    orders.indices.map((i) => i.name),
    ["idx_orders_customer"],
  );
  assert.equal(diagram.relationships[0].deleteConstraint, "Cascade");
});

test("Oracle DBMS_METADATA.GET_DDL output imports: storage, states and identity options", () => {
  // Real output of GET_DDL for two tables, their comments included.
  const ddl = `
  CREATE TABLE "APP"."customers"
   (\t"id" NUMBER(*,0) GENERATED BY DEFAULT AS IDENTITY MINVALUE 1 MAXVALUE 9999999999999999999999999999 INCREMENT BY 1 START WITH 1 CACHE 20 NOORDER  NOCYCLE  NOKEEP  NOSCALE  NOT NULL ENABLE,
\t"email" VARCHAR2(120) NOT NULL ENABLE,
\t CONSTRAINT "pk_customers" PRIMARY KEY ("id")
  USING INDEX PCTFREE 10 INITRANS 2 MAXTRANS 255
  TABLESPACE "USERS"  ENABLE,
\t CONSTRAINT "uq_customers_email" UNIQUE ("email")
  USING INDEX PCTFREE 10 INITRANS 2 MAXTRANS 255
  TABLESPACE "USERS"  ENABLE
   ) SEGMENT CREATION DEFERRED
  PCTFREE 10 PCTUSED 40 INITRANS 1 MAXTRANS 255
 NOCOMPRESS LOGGING
  TABLESPACE "USERS" ;

  CREATE TABLE "APP"."orders"
   (\t"id" NUMBER(*,0) GENERATED BY DEFAULT AS IDENTITY MINVALUE 1 MAXVALUE 9999999999999999999999999999 INCREMENT BY 1 START WITH 1 CACHE 20 NOORDER  NOCYCLE  NOKEEP  NOSCALE  NOT NULL ENABLE,
\t"customer_id" NUMBER(*,0) NOT NULL ENABLE,
\t"status" VARCHAR2(255) DEFAULT 'new',
\t"created_at" TIMESTAMP (6) DEFAULT CURRENT_TIMESTAMP NOT NULL ENABLE,
\t"total" NUMBER(10,2) DEFAULT 0,
\t CONSTRAINT "ck_orders_total" CHECK ("total" >= 0) ENABLE,
\t CONSTRAINT "pk_orders" PRIMARY KEY ("id")
  USING INDEX PCTFREE 10 INITRANS 2 MAXTRANS 255
  TABLESPACE "USERS"  ENABLE,
\t CONSTRAINT "fk_orders_customer" FOREIGN KEY ("customer_id")
\t  REFERENCES "APP"."customers" ("id") ON DELETE CASCADE ENABLE
   ) SEGMENT CREATION DEFERRED
  PCTFREE 10 PCTUSED 40 INITRANS 1 MAXTRANS 255
 NOCOMPRESS LOGGING
  TABLESPACE "USERS" ;

  CREATE INDEX "APP"."idx_orders_status" ON "APP"."orders" ("status")
  PCTFREE 10 INITRANS 2 MAXTRANS 255
  TABLESPACE "USERS" ;

   COMMENT ON COLUMN "APP"."customers"."email" IS 'Contact ''email''';
   COMMENT ON TABLE "APP"."customers"  IS 'People who buy';
`;
  const diagram = importScript(ddl, DB.ORACLESQL);
  // Exported again, it is the script the tables were created with.
  const { sql } = generateSQL(
    { ...diagram, references: diagram.relationships, database: DB.ORACLESQL },
    { options: { includeHeader: false } },
  );
  assert.equal(
    sql,
    `CREATE TABLE "customers" (
  "id" INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "email" VARCHAR2(120) NOT NULL,
  CONSTRAINT "pk_customers" PRIMARY KEY ("id"),
  CONSTRAINT "uq_customers_email" UNIQUE ("email")
);

COMMENT ON TABLE "customers" IS 'People who buy';

COMMENT ON COLUMN "customers"."email" IS 'Contact ''email''';

CREATE TABLE "orders" (
  "id" INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "customer_id" INTEGER NOT NULL,
  "status" VARCHAR2(255) DEFAULT 'new',
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "total" NUMBER(10,2) DEFAULT 0,
  CONSTRAINT "ck_orders_total" CHECK ("total" >= 0),
  CONSTRAINT "pk_orders" PRIMARY KEY ("id")
);

CREATE INDEX "idx_orders_status" ON "orders" ("status");

ALTER TABLE "orders" ADD CONSTRAINT "fk_orders_customer" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE CASCADE;
`,
  );
});

test("statements split without breaking strings, quoted names or comments", () => {
  const prepared = prepareSQL(
    `CREATE TABLE "a;b" (x TEXT DEFAULT 'semi;colon -- not a comment');
-- a comment; with a semicolon
/* block ; comment */
CREATE TABLE c (y INT);`,
    DB.POSTGRES,
  );
  assert.equal(prepared.sql.match(/CREATE TABLE/g).length, 2);
  assert.match(prepared.sql, /'semi;colon -- not a comment'/);
  assert.doesNotMatch(prepared.sql, /a comment;|block ;/);
});
