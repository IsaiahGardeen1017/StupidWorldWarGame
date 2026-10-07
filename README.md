# World at War

A playable browser grand strategy MVP set in an original, fictional 1930s Europe. React handles the command interface; Three.js renders selectable province polygons and units. A standalone TypeScript engine drives browser play, authoritative multiplayer, and terminal simulations. No accounts, credentials, or external services are required.

## Run

Requires Node 24 and npm. From the repository root:

```sh
npm ci --cache /workspace/.npm-cache
npm run map:build  # compile source PNGs; separate from starting the server
npm run dev        # http server and WebSocket multiplayer on port 3000
```

For a production build: `npm run build`, then `npm start`. `PORT` optionally overrides 3000. `npm test` runs deterministic engine, combat, compiler, and SQLite tests. With the server running, `node tests/multiplayer.mjs` checks two clients against the real server. `npm run sim -- 200 /tmp/campaign.sqlite` runs a seeded all-AI campaign without React, Three.js, a browser, or a server.

## Play

Choose **Singleplayer**, pick a nation on the atlas or list, then begin. Singleplayer starts paused. **Space** or the top toolbar resumes/pauses; three ticks represent one Gregorian day (early daylight, late daylight, night), starting January 1, 1936. Normal 1× speed runs two ticks per real second. Live games have no calendar end date. Controls remain accessible while paused and orders execute on the next tick. The top command strip opens collapsible Industry, Army, Navy, Air, Research, Diplomacy, and History panels. The national bar shows factories and forces; the minimap and province card keep the main atlas visible. Formation counters display stack size, organization (green), and strength (gold). Select formations from the roster or atlas to see their movement routes.

Drag-select your divisions/fleets or click a unit; **right click** a compatible destination to move. Shift adds to selection. Scroll zooms; middle-button dragging pans the cylindrical map horizontally. The eastern and western edges share neighbors. There is no polar/vertical wrap. War is required to cross foreign land. Impassable tiles cannot be traversed. Fleets stay at sea. Divisions can route overseas through an owned port. Land combat cannot happen on sea provinces; transports and enemy fleets ignore each other in this MVP.

Create or join a multiplayer lobby, select distinct nations, and let the host start after everyone selects. Unclaimed nations run the general AI. The server ticks continuously; players cannot pause or choose game speed. Commands are validated against the submitting player's nation and applied in server arrival order. Joining an already running game and reconnecting to reclaim a nation are not supported yet. When a player disconnects, AI takes over; the game is discarded when the last player leaves. Download saves before leaving. Multiplayer is an in-memory demonstration server, not a hardened public service.

## Mechanics

- **Factories:** civilian factories reserve 25% (rounded up) for consumer goods; the rest apply 2 work/day each to a serial construction queue each day. Civilian and military factories cost 120 work; ports cost 180 work and require an owned land province adjacent to passable sea. Ports remain attached to provinces when captured; queued port construction pauses if the site is lost. Each demo nation starts with one coastal port when geography permits. Military factory allocations produce guns (10), tanks (2), fighters (3), destroyers (0.1), or artillery (3) per day; fractional production accumulates.
- **Templates:** 1–12 infantry, armored, and artillery battalions determine attack, defense, organization, and equipment requirements. Existing formations keep their recruited design when a template changes. Infantry needs 100 guns; armor needs 40 tanks and 30 guns; artillery needs 30 artillery and 20 guns. Recruitment reserves the equipment immediately and deploys after 12 days (36 ticks) at the selected owned land province (or another owned province if the training base was lost).
- **Combat:** land movement/combat happens every three ticks. Sea movement takes one tick per province. Embarking from an owned port and disembarking onto any passable coast each add six ticks (two days). Enemy coastal land requires a declared war. Naval landings suffer −75% attack and double incoming organization/strength losses; sea units cannot engage in land combat. Attack, defense, strength, technology, and ground-support aircraft affect organization damage. Both sides lose strength and equipment. Defeated units retreat to a compatible safe neighbor; units with no retreat are destroyed. Idle units recover organization and reinforce using stockpiled equipment (division transports cannot reinforce while at sea). There is no manpower, supply, frontage, or naval interception, or dockyard system in this MVP.
- **Fleets:** commissioned from stockpiled destroyers at sea adjacent to owned land; fight other fleets and ignore division transports. Fleet movement takes one tick per sea province.
- **Air:** land provinces each have 500 aircraft capacity. Deploy 100-fighter wings, then assign superiority or ground support in an in-range zone. Baseline range is 90 source pixels, upgraded to 150 by research; centroid distances use horizontal wrapping. Opposing wings suffer attrition; ground-support wings buff attack. Air superiority wings participate in interception/attrition. Airbase capture destroys its resident hostile wings.
- **Technology:** five research projects with explicit prerequisite edges. One project at a time; changing a project resets its progress. Industry increases output, weapons and mobile warfare improve attack/defense, aviation improves range, and naval doctrine improves fleet attack.
- **Politics:** declare war and surrender. Surrender transfers remaining land to the lowest-ID active war opponent and removes formations. Losing all owned land triggers surrender. One remaining nation wins.
- **AI:** every nation uses the same capability/ownership-driven policy through the public command API. It builds factories, assigns production, creates a combined-arms template, recruits, researches, commissions ships/wings, assigns missions, declares war against bordering opponents, and attacks, including routing divisions through ports for naval invasions. Recruitment is bounded by territory (12 + 2 per owned province, capped at 60) to prevent unbounded idle armies. It is intentionally basic; surrender is primarily forced by defeat.

## Map workshop

Run `npm run map` from the repository root to start the separate local editor on **port 3001**. It lives in this repository and shares the PNG palette definitions with the compiler. It can run alongside `npm run dev`; it does not start a game or rebuild the map.

Select any current PNG in `assets/source/` from the left panel. **Save asset** or **Ctrl+S** (Cmd+S on Mac) overwrites that file. Saves preserve dimensions, use an atomic file replacement, and reject an outdated revision if another editor or program changed the source. Unsaved edits stay in the editor after a failed save. Run `npm run map:build` separately after editing, then start a fresh campaign to use the compiled map.

| Control                        | Action                         |
| ------------------------------ | ------------------------------ |
| Right click / drag             | Paint with the brush           |
| Left click                     | Flood-fill the contiguous area |
| Middle click                   | Pick the hovered pixel's color |
| Scroll                         | Zoom around the pointer        |
| Shift + scroll                 | Change brush diameter          |
| Space + left drag              | Pan                            |
| Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z | Undo / redo                    |

The left panel includes a brush-size slider, circle/square shapes, color swatches, and optional horizontal seam wrapping for both painting and fill. `kind.png` permits only the four land/sea classification colors; `owner.png` permits only nation colors and black for unowned territory. Unique-color layers (`provinces.png`, `air.png`, and unrestricted additional PNGs) provide **New unused color**, which picks an RGB value absent from the image, plus a color picker. Additional restricted layers can define a palette in `assets/source/palettes.json`, for example:

```json
{
  "terrain.png": [
    { "color": "#228833", "label": "Plains" },
    { "color": "#885522", "label": "Mountains" }
  ]
}
```

The authoring server binds to loopback and is separate from the multiplayer server. `MAP_PORT` changes its port; `MAP_ASSET_DIR` selects a different source directory for testing. PNG assets must be fully opaque when saved. The workshop edits pixels only; country definitions remain in `nations.json`.

## PNG compilation

`assets/source/` contains the editable source PNGs and `nations.json`. `npm run map:generate` regenerates the demonstration inputs; it overwrites those inputs, so use it only when intentionally discarding map edits. It is not part of normal startup or build.

All source PNGs must have identical dimensions. RGB colors are categorical identifiers (alpha is currently ignored); avoid antialiasing and ensure every pixel is classified.

| Input           | Meaning                                                                                                                                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provinces.png` | Each unique RGB color identifies one province, including disconnected components. Province IDs are assigned by first occurrence in row-major scan order.                                                                                                              |
| `kind.png`      | `#32a852` land, `#2474b5` sea, `#185b2b` impassable land, `#102c61` impassable sea.                                                                                                                                                                                   |
| `air.png`       | Shared air/sea zone source. Each color becomes one land air region and one sea air region when both media are present, plus one sea zone covering the sea portion. Empty regions are omitted; all derived regions retain their source color and explicit cross-links. |
| `owner.png`     | Optional initial ownership. Colors match `nations.json`; unmatched colors are unowned.                                                                                                                                                                                |
| Other PNGs      | Automatically compiled categorical layers, such as `terrain.png` or `weather.png`. Stored in each province's `layers` metadata.                                                                                                                                       |

Province membership comes only from `provinces.png`. Every other layer uses a per-province pixel-overlap vote; ties choose the lexically smallest color. Kind palette values must be valid. Air- and sea-zone centroids and province centroids use circular horizontal means so seam-straddling regions do not appear to be centered halfway around the world. Adjacency uses shared pixel edges (four-way connectivity), including the horizontal seam. Geometry contains simplified boundary loops, holes, and disconnected pieces; the renderer constructs Three.js Shapes from those loops. Zone splitting uses the province’s majority-voted kind so a province cannot be assigned to a region of the wrong medium; impassable variants retain the corresponding land/sea medium. Air regions have `medium`, `sourceColor`, `linkedAirZones`, and `seaZone` fields; sea regions have `airZones` links. Provinces carry `airZone` and nullable `seaZone`. A disconnected province is one logical tile, so its components share ownership and unit location at its centroid.

`npm run map:build` reads those inputs and writes `public/world.json` plus the SQLite WASM runtime. An optional source directory can be supplied with `npm run map:build -- path/to/sources`. The output carries a source SHA-256. The demo nations are contiguous IDs starting at zero; initial capitals are reassigned to an owned land province when necessary. Country configuration is original and not tied to copyrighted game assets.

## Engine and simulation contract

`src/engine/engine.ts` imports only local types. `createGame(world, humanNationOrNull, seed)` creates state; `applyCommand(state, nation, command)` validates and applies an order; `step(state, orders)` advances exactly one tick. `aiOrders(state)` generates commands using seeded xorshift RNG and advances the RNG stored in state. `checksum(state)` is a fast deterministic diagnostic hash, not a security hash.

Call `aiOrders` exactly once per tick and combine human and AI orders in a stable order before `step`. Browser/server integrations queue human commands first, followed by AI orders. The engine uses stable ID ordering, seeded randomness, integer ticks, and rounded fractional values; it never reads wall-clock time or browser APIs. `step` mutates state deliberately. Identical initial state plus identical ordered commands produces identical results. Inject test policies through the same `Order[]` API to run balancing experiments without UI code.

## Calendar and simulations

The calendar uses deterministic Gregorian UTC date arithmetic. Tick 0 is January 1, 1936, early daylight; phases repeat early day, late day, night. Leap days in 1936, 1940, and 1944 are included. January 1, 1946 is exactly **10,959 ticks** after the start (3,653 days × 3). Live browser/server games have no fixed end date. `npm run sim` defaults to that ten-year cutoff, stopping earlier if one nation wins. Override duration/output/seed with `npm run sim -- 10959 /tmp/campaign.sqlite 42`. The explicit tick count is a test-run limit, never a global game rule.

Economic production, construction, research, and reinforcement update daily. Recruitment durations use three ticks per day. Unit movement and embark/disembark delays operate on individual ticks.

## SQLite saves and analytics

The lightweight **version 3** SQLite schema stores ownership-change transactions and important events, plus one national statistics sample per Gregorian day. It omits recurring combat exchanges, repetitive move orders, individual equipment-loss records, command replay logs, per-tick hashes, and historical unit snapshots. Losses and kills are cumulative counters sampled daily; `metrics` can later hold manpower, stability, and similar national values.

The engine retains live state in memory. On download/export, the database writes **one current-state record**, replacing its previous record, so a file can resume exactly with RNG state, units, transport paths/delays, ports, research, queues, equipment, and map ownership. This record is not written after every click or tick. The immutable map is stored once. `Load SQLite campaign` restores the current state paused; a checksum detects corruption. Pending future orders are omitted. Schema-2 saves from the earlier prototype are incompatible with these changed calendar and transport rules.

Chronicle's time slider reconstructs **exact historical map ownership** from initial ownership plus capture/surrender-transfer transactions. National stats use the latest daily sample at/before that tick. Historical unit positions and exact historical combat state are intentionally unavailable; unit markers are hidden in history view. Historical views cannot be resumed as games.

Tables:

- `metadata(key, value)`: schema, immutable compiled world, and initial ports.
- `current_state(id, tick, state, checksum)`: a single exact resumable state written on export.
- `events(id, tick, type, nation, unit, province, amount, message, payload)`: significant events and ownership changes.
- `national_stats(tick, nation, civs, mils, ports, provinces, divisions, fleets, kills, units_lost, equipment_lost, aircraft_lost, data)`: daily points. `data` holds stockpile, consumer-factory count, surrender status, and extensible metrics.

```sql
SELECT tick, nation, kills, units_lost, civs, mils, ports FROM national_stats ORDER BY tick, nation;
SELECT tick, nation, equipment_lost, aircraft_lost FROM national_stats ORDER BY tick, nation;
SELECT tick, nation, province FROM events WHERE type IN ('capture', 'ownership') ORDER BY id;
```

Fewer SQL writes and no full-state hashing/serialization during each tick keep simulations inexpensive. Browser import limits files to 32 MB. Multiplayer authentication, persistent lobby discovery, and network recovery remain outside this MVP.

## Repository layout

`src/engine/`: portable state, rules, commands, AI, and Gregorian calendar. `src/map/`: raster compiler. `scripts/`: source generation, build, simulation. `src/persistence/`: transactional SQLite saves. `src/ui/`: React and Three.js interaction. `src/editor/` and `editor/`: the map workshop UI and entry point. `server/`: static/dev hosting, WebSocket authority, and the local asset editor. `tests/`: mechanics, reproducibility, map compilation, saves, and multiplayer integration.
