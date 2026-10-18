import { Database } from "bun:sqlite";

import type { SignedBlock } from "../../web/src/lib/device-chain/format";
import { chainPath } from "./paths";

/**
 * The device's own chain, in a local SQLite file: one row per block (the signed JSON) plus which
 * height the server has countersigned. Blocks above that height are not accepted yet: if the server
 * refuses them they are dropped, so the chain always continues from a countersigned head.
 */
let db: Database | null = null;

function open() {
  if (db) return db;
  db = new Database(chainPath(), { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("CREATE TABLE IF NOT EXISTS blocks (height INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, json TEXT NOT NULL, created INTEGER NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  return db;
}

export function allBlocks(): SignedBlock[] {
  return open()
    .query<{ json: string }, []>("SELECT json FROM blocks ORDER BY height")
    .all()
    .map((r) => JSON.parse(r.json));
}

export function blocksFrom(height: number, limit = 1000): SignedBlock[] {
  return open()
    .query<{ json: string }, [number, number]>("SELECT json FROM blocks WHERE height >= ? ORDER BY height LIMIT ?")
    .all(height, limit)
    .map((r) => JSON.parse(r.json));
}

export function lastBlocks(limit: number): SignedBlock[] {
  return open()
    .query<{ json: string }, [number]>("SELECT json FROM blocks ORDER BY height DESC LIMIT ?")
    .all(limit)
    .map((r) => JSON.parse(r.json));
}

export function head(): SignedBlock | null {
  const r = open().query<{ json: string }, []>("SELECT json FROM blocks ORDER BY height DESC LIMIT 1").get();
  return r ? JSON.parse(r.json) : null;
}

export function blockAt(height: number): SignedBlock | null {
  const r = open().query<{ json: string }, [number]>("SELECT json FROM blocks WHERE height = ?").get(height);
  return r ? JSON.parse(r.json) : null;
}

export function count(): number {
  return open().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM blocks").get()?.n ?? 0;
}

export function append(blocks: SignedBlock[]) {
  const d = open();
  const ins = d.prepare("INSERT INTO blocks (height, hash, kind, json, created) VALUES (?, ?, ?, ?, ?)");
  d.transaction(() => {
    for (const b of blocks) ins.run(b.height, b.hash, b.kind, JSON.stringify(b), Date.now());
  })();
}

/** Drops blocks above `height` (ones the server never countersigned). */
export function truncateAbove(height: number) {
  open().run("DELETE FROM blocks WHERE height > ?", [height]);
}

export function replaceAll(blocks: SignedBlock[]) {
  const d = open();
  d.transaction(() => {
    d.run("DELETE FROM blocks");
  })();
  append(blocks);
}

export function getMeta(k: string): string | null {
  return open().query<{ v: string }, [string]>("SELECT v FROM meta WHERE k = ?").get(k)?.v ?? null;
}

export function setMeta(k: string, v: string) {
  open().run("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", [k, v]);
}

/** Every event id the chain carries (to ask the server which are linked to the other party's chain). */
export function eventIds(): string[] {
  return open()
    .query<{ id: string }, []>("SELECT json_extract(json, '$.body.event.id') AS id FROM blocks WHERE kind = 'event'")
    .all()
    .map((r) => r.id);
}
