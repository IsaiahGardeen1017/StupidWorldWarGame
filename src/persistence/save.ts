import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { checksum } from "../engine/engine";
import { TICKS_PER_DAY } from "../engine/calendar";
import type { Order, State } from "../engine/types";
let sql: SqlJsStatic;
export async function initStorage(wasm = "/sql-wasm.wasm") {
  sql = await initSqlJs({ locateFile: () => wasm });
}
/** Ownership/event transactions + daily statistics. Exact state is written only on export. */
export class GameSave {
  db: Database;
  private eventCount = 0;
  private current: State | null = null;
  private lastTick = -1;
  constructor(bytes?: Uint8Array) {
    if (!sql) throw Error("SQLite is not initialized");
    this.db = bytes ? new sql.Database(bytes) : new sql.Database();
    if (!bytes)
      this.db
        .run(`CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);INSERT INTO metadata VALUES ('schema','3');
   CREATE TABLE current_state(id INTEGER PRIMARY KEY CHECK(id=1),tick INTEGER,state TEXT,checksum TEXT);
   CREATE TABLE events(id INTEGER PRIMARY KEY,tick INTEGER,type TEXT,nation INTEGER,unit INTEGER,province INTEGER,amount REAL,message TEXT,payload TEXT);
   CREATE INDEX event_tick ON events(tick);CREATE INDEX event_type ON events(type);
   CREATE TABLE national_stats(tick INTEGER,nation INTEGER,civs INTEGER,mils INTEGER,ports INTEGER,provinces INTEGER,divisions INTEGER,fleets INTEGER,kills INTEGER,units_lost INTEGER,equipment_lost INTEGER,aircraft_lost INTEGER,data TEXT,PRIMARY KEY(tick,nation));`);
    else {
      const version = this.db.exec(
        "SELECT value FROM metadata WHERE key='schema'",
      )[0]?.values[0]?.[0];
      if (version !== "3")
        throw Error(
          "Unsupported save schema: this build uses calendar/transport save version 3",
        );
      this.eventCount = Number(
        this.db.exec("SELECT COUNT(*) FROM events")[0]?.values[0]?.[0] || 0,
      );
      this.lastTick = Number(
        this.db.exec("SELECT tick FROM current_state WHERE id=1")[0]
          ?.values[0]?.[0] ?? -1,
      );
    }
  }
  record(s: State, _orders: Order[] = []) {
    if (s.tick <= this.lastTick) throw Error("Tick already recorded");
    const initial = this.lastTick < 0,
      daily = initial || s.tick % TICKS_PER_DAY === 0;
    if (initial || daily || s.events.length > this.eventCount) {
      this.db.run("BEGIN");
      try {
        if (initial) {
          this.db.run("INSERT INTO metadata VALUES ('world',?)", [
            JSON.stringify(s.world),
          ]);
          this.db.run("INSERT INTO metadata VALUES ('initial_ports',?)", [
            JSON.stringify(s.ports),
          ]);
        }
        for (let i = this.eventCount; i < s.events.length; i++) {
          const e = s.events[i];
          this.db.run("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)", [
            i,
            e.tick,
            e.type,
            e.nation ?? null,
            e.unit ?? null,
            e.province ?? null,
            e.amount ?? null,
            e.message,
            JSON.stringify(e),
          ]);
        }
        if (daily)
          for (const n of s.nations) {
            const ports = Object.keys(s.ports).filter(
                (id) => s.ports[Number(id)] && s.owners[Number(id)] === n.id,
              ).length,
              provinces = s.world.provinces.filter(
                (p) => p.kind === "land" && s.owners[p.id] === n.id,
              ).length,
              divisions = s.units.filter(
                (u) => u.owner === n.id && u.kind === "division",
              ).length,
              fleets = s.units.filter(
                (u) => u.owner === n.id && u.kind === "fleet",
              ).length;
            this.db.run(
              "INSERT INTO national_stats VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
              [
                s.tick,
                n.id,
                n.civs,
                n.mils,
                ports,
                provinces,
                divisions,
                fleets,
                n.metrics.kills,
                n.metrics.unitsLost,
                n.metrics.equipmentLost,
                n.metrics.aircraftLost,
                JSON.stringify({
                  stock: n.stock,
                  consumer: n.consumer,
                  metrics: n.metrics,
                  surrendered: n.surrendered,
                }),
              ],
            );
          }
        this.db.run("COMMIT");
        this.eventCount = s.events.length;
      } catch (e) {
        this.db.run("ROLLBACK");
        throw e;
      }
    }
    this.current = s;
    this.lastTick = s.tick;
  }
  load(): State {
    if (this.current) return structuredClone(this.current);
    const row = this.db.exec(
      "SELECT state,checksum FROM current_state WHERE id=1",
    )[0]?.values[0];
    if (!row) throw Error("Save contains no resumable state");
    const s = JSON.parse(String(row[0])) as State;
    s.world = JSON.parse(
      String(
        this.db.exec("SELECT value FROM metadata WHERE key='world'")[0]
          ?.values[0][0],
      ),
    );
    s.events = (
      this.db.exec("SELECT payload FROM events ORDER BY id")[0]?.values || []
    ).map((r) => JSON.parse(String(r[0])));
    if (s.version !== 2 || !s.world?.seaZones || checksum(s) !== row[1])
      throw Error("Save is incompatible or corrupted");
    return s;
  }
  /** Historical display: exact ownership, sampled national stats, no historical unit positions. */
  history(tick: number): State {
    if (!Number.isInteger(tick) || tick < 0 || tick > this.lastTick)
      throw Error("Tick outside save history");
    const latest = this.current ?? this.load();
    const s = {
      ...latest,
      tick,
      units: [],
      wings: [],
      winner: null,
      owners: Object.fromEntries(
        latest.world.provinces.map((p) => [p.id, p.owner]),
      ),
      ports: JSON.parse(
        String(
          this.db.exec(
            "SELECT value FROM metadata WHERE key='initial_ports'",
          )[0]?.values[0][0] || "{}",
        ),
      ),
      nations: structuredClone(latest.nations),
      events: (
        this.db.exec(
          `SELECT payload FROM events WHERE tick<=${tick} ORDER BY id`,
        )[0]?.values || []
      ).map((r) => JSON.parse(String(r[0]))),
    } as State;
    for (const e of s.events) {
      if (
        (e.type === "capture" || e.type === "ownership") &&
        e.province !== undefined
      )
        s.owners[e.province] = e.nation!;
      if (e.type === "factory" && e.province !== undefined)
        s.ports[e.province] = true;
    }
    for (const n of s.nations) {
      const row = this.db.exec(
        `SELECT civs,mils,data FROM national_stats WHERE nation=${n.id} AND tick<=${tick} ORDER BY tick DESC LIMIT 1`,
      )[0]?.values[0];
      if (row) {
        n.civs = Number(row[0]);
        n.mils = Number(row[1]);
        Object.assign(n, JSON.parse(String(row[2])));
      }
      n.recruits = [];
      n.construction = [];
      n.research = null;
    }
    return s;
  }
  bytes() {
    if (this.current) {
      const s = this.current;
      this.db.run("INSERT OR REPLACE INTO current_state VALUES (1,?,?,?)", [
        s.tick,
        JSON.stringify({ ...s, world: null, events: null }),
        checksum(s),
      ]);
    }
    return this.db.export();
  }
  query(sql: string) {
    return this.db.exec(sql);
  }
  close() {
    this.db.close();
  }
}
