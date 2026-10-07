import { Icon, Flag } from "./Icons";
import { AtlasOverview } from "./AtlasOverview";
import { calendar, TICKS_PER_DAY } from "../engine/calendar";
import { useEffect, useRef, useState } from "react";
import { MapView } from "./MapView";
import {
  aiOrders,
  applyCommand,
  checksum,
  createGame,
  requirements,
  stats,
  step,
  technologies,
  reachableZone,
} from "../engine/engine";
import {
  equipmentTypes,
  type Battalion,
  type Command,
  type Order,
  type State,
  type World,
} from "../engine/types";
import { GameSave, initStorage } from "../persistence/save";
type Screen = "home" | "select" | "lobbies" | "lobby" | "game";
type Tab =
  | "overview"
  | "industry"
  | "army"
  | "navy"
  | "air"
  | "research"
  | "politics"
  | "chronicle";
interface Lobby {
  id: string;
  name: string;
  host: string;
  started: boolean;
  members: { id: string; nation: number | null }[];
  tick: number;
}
function download(bytes: Uint8Array, name: string) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: "application/vnd.sqlite3" }),
    );
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function App() {
  const [world, setWorld] = useState<World | null>(null),
    [screen, setScreen] = useState<Screen>("home"),
    [game, setGame] = useState<State | null>(null),
    [nation, setNation] = useState<number | null>(null),
    [selected, setSelected] = useState<number | null>(null),
    [units, setUnits] = useState<number[]>([]),
    [tab, setTab] = useState<Tab>("overview"),
    [panelOpen, setPanelOpen] = useState(true),
    [paused, setPaused] = useState(true),
    [speed, setSpeed] = useState(1),
    [air, setAir] = useState(false),
    [sea, setSea] = useState(false),
    [message, setMessage] = useState(""),
    [lobbies, setLobbies] = useState<Lobby[]>([]),
    [lobby, setLobby] = useState<Lobby | null>(null),
    [player, setPlayer] = useState(""),
    [connected, setConnected] = useState(false),
    [multi, setMulti] = useState(false),
    [templateName, setTemplateName] = useState("New division"),
    [editId, setEditId] = useState<number | undefined>(),
    [bs, setBs] = useState<Battalion[]>(["infantry"]),
    [recruitTemplate, setRecruitTemplate] = useState(1),
    [ships, setShips] = useState(2),
    [zone, setZone] = useState(0),
    [sqlQuery, setSqlQuery] = useState(
      "SELECT tick, type, nation, amount, message FROM events ORDER BY id DESC LIMIT 20",
    ),
    [queryResult, setQueryResult] = useState(""),
    [timeline, setTimeline] = useState<number | null>(null);
  const playerRef = useRef("");
  const gameRef = useRef<State | null>(null),
    save = useRef<GameSave | null>(null),
    pending = useRef<Order[]>([]),
    ws = useRef<WebSocket | null>(null),
    nationRef = useRef<number | null>(null),
    multiRef = useRef(false),
    lastEvent = useRef(0);
  nationRef.current = nation;
  multiRef.current = multi;
  const publish = (s: State) => {
    gameRef.current = s;
    setGame(structuredClone(s));
  };
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/world.json").then((r) => {
        if (!r.ok) throw Error("Compile the source maps first");
        return r.json();
      }),
      initStorage(),
    ])
      .then(([w]) => {
        if (alive) setWorld(w);
      })
      .catch((e) => setMessage(String(e)));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(""), 6500);
    return () => clearTimeout(id);
  }, [message]);
  useEffect(() => {
    if (screen !== "game" || multi || paused) return;
    const id = setInterval(() => {
      const s = gameRef.current;
      if (!s || s.winner !== null) return;
      try {
        const orders = [...pending.current, ...aiOrders(s)];
        pending.current = [];
        step(s, orders);
        save.current!.record(s, orders);
        publish(s);
      } catch (e) {
        setPaused(true);
        setMessage(String(e));
      }
    }, 500 / speed);
    return () => clearInterval(id);
  }, [screen, multi, paused, speed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        screen === "game" &&
        !multi &&
        !["INPUT", "SELECT", "TEXTAREA"].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, multi]);
  useEffect(
    () => () => {
      ws.current?.close();
      save.current?.close();
    },
    [],
  );
  function command(c: Command) {
    if (nation === null || !gameRef.current) return;
    if (multi) {
      if (ws.current?.readyState !== WebSocket.OPEN) {
        setMessage("Multiplayer disconnected");
        return;
      }
      ws.current.send(JSON.stringify({ type: "command", command: c }));
      return;
    }
    const test = structuredClone(gameRef.current);
    for (const o of pending.current) applyCommand(test, o.nation, o.command);
    const err = applyCommand(test, nation, c);
    if (err) {
      setMessage(err);
      return;
    }
    pending.current.push({ nation, command: c });
    setMessage(
      paused
        ? "Order queued. Resume to execute it on the next tick."
        : "Order queued for the next tick.",
    );
  }
  function connect() {
    setMulti(true);
    setScreen("lobbies");
    if (ws.current?.readyState === WebSocket.OPEN) return;
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    ws.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onclose = () => {
      setConnected(false);
      setMessage(
        "Disconnected from multiplayer server. Reopen multiplayer to reconnect.",
      );
    };
    socket.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "hello") {
        playerRef.current = m.id;
        setPlayer(m.id);
        setLobbies(m.lobbies);
      }
      if (m.type === "lobbies") setLobbies(m.lobbies);
      if (m.type === "lobby") {
        setLobby(m.lobby);
        setScreen((s) => (s === "game" ? s : "lobby"));
        const member = m.lobby.members.find(
          (x: { id: string }) => x.id === playerRef.current,
        );
        if (member) setNation(member.nation);
      }
      if (m.type === "state") {
        const s = m.state as State;
        if (!save.current || s.tick === 0) {
          save.current?.close();
          save.current = new GameSave();
          lastEvent.current = 0;
        }
        save.current.record(s, m.orders || []);
        if (s.events.length > lastEvent.current) {
          const rejection = s.events
            .slice(lastEvent.current)
            .find(
              (e) => e.type === "rejected" && e.nation === nationRef.current,
            );
          if (rejection) setMessage(rejection.message);
          lastEvent.current = s.events.length;
        }
        publish(s);
        setScreen("game");
        setPaused(false);
        setTimeline(null);
      }
      if (m.type === "error") setMessage(m.message);
      if (m.type === "save")
        download(
          Uint8Array.from(atob(m.bytes), (c) => c.charCodeAt(0)),
          `campaign-${gameRef.current?.tick || 0}.sqlite`,
        );
    };
  }
  function start() {
    if (!world || nation === null) return;
    pending.current = [];
    save.current?.close();
    save.current = new GameSave();
    const s = createGame(world, nation);
    save.current.record(s);
    publish(s);
    setMulti(false);
    setPaused(true);
    setScreen("game");
    setTab("overview");
    setPanelOpen(true);
    setUnits([]);
    setTimeline(null);
  }
  async function load(file: File) {
    try {
      if (file.size > 32 * 1024 * 1024) throw Error("Save exceeds 32 MB");
      const db = new GameSave(new Uint8Array(await file.arrayBuffer()));
      const s = db.load();
      save.current?.close();
      save.current = db;
      pending.current = [];
      setWorld(s.world);
      const human =
        s.nations.find((n) => !n.ai && !n.surrendered)?.id ??
        s.nations.find((n) => !n.surrendered)?.id ??
        0;
      s.nations.forEach((n) => (n.ai = n.id !== human));
      setNation(human);
      publish(s);
      setMulti(false);
      setPaused(true);
      setScreen("game");
      setTimeline(null);
      setUnits([]);
      setMessage("SQLite campaign loaded. Press Space to resume.");
    } catch (e) {
      setMessage(String(e));
    }
  }
  function exit() {
    if (multi) ws.current?.send(JSON.stringify({ type: "leave" }));
    pending.current = [];
    setScreen("home");
    setPaused(true);
    setMulti(false);
    setLobby(null);
    setGame(null);
    gameRef.current = null;
    save.current?.close();
    save.current = null;
  }
  function selectProvince(id: number) {
    setSelected(id);
    if (screen === "select" && world?.provinces[id].owner !== null)
      setNation(world!.provinces[id].owner);
  }
  const live = game,
    shown =
      timeline !== null && save.current ? save.current.history(timeline) : live,
    n = nation !== null ? shown?.nations[nation] : null,
    province = selected !== null ? world?.provinces[selected] : null,
    owned =
      province && shown
        ? shown.owners[province.id] === nation
        : province?.owner === nation,
    selectedUnits = shown?.units.filter((u) => units.includes(u.id)) || [];
  const send = (m: unknown) => {
    if (ws.current?.readyState === WebSocket.OPEN)
      ws.current.send(JSON.stringify(m));
    else setMessage("Server is disconnected");
  };
  if (!world)
    return (
      <main className="loading">
        <div className="wordmark">
          WORLD <span>AT</span> WAR
        </div>
        <p>{message || "Preparing strategic atlas…"}</p>
      </main>
    );
  return (
    <div
      className={`app screen-${screen} section-${tab} ${panelOpen ? "panel-open" : "panel-closed"}`}
    >
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
      {screen === "home" ? (
        <main className="welcome">
          <div className="welcome-map">
            <MapView
              world={world}
              state={null}
              nation={null}
              selected={null}
              units={[]}
              air={false}
              onProvince={() => {}}
              onUnits={() => {}}
              onMove={() => {}}
            />
          </div>
          <div className="welcome-content">
            <div className="campaign-emblem">✦</div>
            <div className="eyebrow">THE WORLD STANDS AT A CROSSROADS</div>
            <h1>
              WORLD
              <br />
              <span>AT WAR</span>
            </h1>
            <p>
              January 1936. Eight nations.
              <br />
              Command the industry. Shape the frontiers.
            </p>
            <div className="welcome-actions">
              <button
                className="primary"
                onClick={() => {
                  setScreen("select");
                  setNation(null);
                  setGame(null);
                  setMulti(false);
                }}
              >
                <Icon name="army" size={22} /> Singleplayer <span>→</span>
              </button>
              <button onClick={connect}>
                <Icon name="politics" size={22} /> Multiplayer <span>→</span>
              </button>
            </div>
            <label className="load-link">
              ↥ Load SQLite campaign
              <input
                type="file"
                accept=".sqlite,.db"
                onChange={(e) => {
                  if (e.target.files?.[0]) void load(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <div className="welcome-footer">
              1936 · AN ORIGINAL ALTERNATE EUROPE
              <br />
              <small>
                Deterministic simulation · Browser & terminal · SQLite history
              </small>
            </div>
          </div>
        </main>
      ) : (
        <>
          <header className="topbar">
            {screen === "game" && nation !== null ? (
              <button
                className="country-seal"
                onClick={() => {
                  setTab("overview");
                  setPanelOpen((p) => !p);
                }}
              >
                <Flag nation={world.nations[nation]} />
                <span>
                  <small>NATIONAL COMMAND</small>
                  <b>{world.nations[nation].name}</b>
                </span>
                <Icon name="chevron" size={14} />
              </button>
            ) : (
              <button className="brand" onClick={exit}>
                WORLD <span>AT</span> WAR
              </button>
            )}
            {screen === "game" && n && (
              <div className="national-resources">
                <div title="Civilian / military factories">
                  <Icon name="industry" />
                  <b>
                    {n.civs}
                    <em>/</em>
                    {n.mils}
                  </b>
                  <small>FACTORIES</small>
                </div>
                <div title="Fielded divisions">
                  <Icon name="army" />
                  <b>
                    {
                      shown?.units.filter(
                        (u) => u.owner === nation && u.kind === "division",
                      ).length
                    }
                  </b>
                  <small>DIVISIONS</small>
                </div>
                <div title="Fleets">
                  <Icon name="navy" />
                  <b>
                    {
                      shown?.units.filter(
                        (u) => u.owner === nation && u.kind === "fleet",
                      ).length
                    }
                  </b>
                  <small>FLEETS</small>
                </div>
                <div title="Deployed fighters">
                  <Icon name="air" />
                  <b>
                    {shown?.wings
                      .filter((w) => w.owner === nation)
                      .reduce((a, w) => a + w.planes, 0)}
                  </b>
                  <small>AIRCRAFT</small>
                </div>
                <div
                  className={
                    shown?.wars.some((w) => w.includes(nation!))
                      ? "at-war"
                      : "at-peace"
                  }
                >
                  <span className="status-dot" />
                  <b>
                    {shown?.wars.some((w) => w.includes(nation!))
                      ? "AT WAR"
                      : "AT PEACE"}
                  </b>
                  <small>DIPLOMATIC STATUS</small>
                </div>
              </div>
            )}
            <span className="mode">
              {screen === "game"
                ? multi
                  ? "MULTIPLAYER · LIVE"
                  : "SINGLEPLAYER"
                : screen === "select"
                  ? "CHOOSE YOUR NATION"
                  : "MULTIPLAYER COMMAND"}
            </span>
            <div className="top-actions">
              {screen === "game" && (
                <>
                  <span className="tick">
                    {calendar(shown?.tick ?? 0).label}{" "}
                    <small>
                      {calendar(shown?.tick ?? 0).phase} ·{" "}
                      {timeline !== null
                        ? "HISTORY"
                        : paused
                          ? "PAUSED"
                          : "RUNNING"}
                    </small>
                  </span>
                  {!multi && (
                    <>
                      <button onClick={() => setPaused((p) => !p)}>
                        <Icon name={paused ? "play" : "pause"} size={13} />
                        {paused ? "Resume" : "Pause"}
                      </button>
                      <select
                        aria-label="Simulation speed"
                        value={speed}
                        onChange={(e) => setSpeed(Number(e.target.value))}
                      >
                        <option value={1}>1×</option>
                        <option value={2}>2×</option>
                        <option value={4}>4×</option>
                      </select>
                    </>
                  )}
                  <button
                    onClick={() => {
                      if (multi) send({ type: "save" });
                      else if (save.current)
                        download(
                          save.current.bytes(),
                          `campaign-${live?.tick}.sqlite`,
                        );
                    }}
                  >
                    <Icon name="save" size={13} />
                    Save
                  </button>
                </>
              )}
              <button onClick={exit}>Exit</button>
            </div>
          </header>
          {screen === "lobbies" ? (
            <main className="lobbies">
              <div className="eyebrow">CONNECTED WAR ROOMS</div>
              <h2>Multiplayer lobbies</h2>
              <p>
                {connected
                  ? "Select a room or establish your own command."
                  : "Connecting to server…"}{" "}
                Simulations run on the server. No player can pause.
              </p>
              <button
                className="primary"
                disabled={!connected}
                onClick={() =>
                  send({
                    type: "create",
                    name: `Campaign ${lobbies.length + 1}`,
                  })
                }
              >
                + Create lobby
              </button>
              <div className="lobby-list">
                {!lobbies.length && (
                  <p className="empty">
                    No campaigns yet. Create the first one.
                  </p>
                )}
                {lobbies.map((l) => (
                  <article key={l.id}>
                    <h3>{l.name}</h3>
                    <span>
                      {l.members.length}/{world.nations.length} commanders ·{" "}
                      {l.started ? calendar(l.tick).date : "Waiting"}
                    </span>
                    <button
                      disabled={
                        l.started || l.members.length >= world.nations.length
                      }
                      onClick={() => send({ type: "join", id: l.id })}
                    >
                      Join →
                    </button>
                  </article>
                ))}
              </div>
            </main>
          ) : screen === "lobby" ? (
            <main className="lobbies">
              <div className="eyebrow">{lobby?.name}</div>
              <h2>Choose your command</h2>
              <div className="nation-grid">
                {world.nations.map((country) => {
                  const member = lobby?.members.find(
                    (m) => m.nation === country.id,
                  );
                  return (
                    <button
                      key={country.id}
                      disabled={!!member && member.id !== player}
                      className={
                        nation === country.id ? "country active" : "country"
                      }
                      onClick={() => {
                        setNation(country.id);
                        send({ type: "nation", nation: country.id });
                      }}
                    >
                      <Flag nation={country} />
                      <h3>{country.name}</h3>
                      <p>{country.description}</p>
                      <small>
                        {member
                          ? member.id === player
                            ? "YOUR COMMAND"
                            : "TAKEN"
                          : "AVAILABLE"}
                      </small>
                    </button>
                  );
                })}
              </div>
              <p>
                {lobby?.members.length} connected commander(s). Unclaimed
                nations use AI.
              </p>
              <button
                className="primary"
                disabled={
                  lobby?.host !== player ||
                  lobby?.members.some((m) => m.nation === null)
                }
                onClick={() => send({ type: "start" })}
              >
                {lobby?.host === player ? "Start campaign" : "Waiting for host"}
              </button>
              <button
                onClick={() => {
                  send({ type: "leave" });
                  setLobby(null);
                  setScreen("lobbies");
                }}
              >
                Leave lobby
              </button>
            </main>
          ) : (
            <div
              className={`workspace ${screen === "select" ? "country-selection" : ""}`}
            >
              {screen === "game" && (
                <nav className="command-nav" aria-label="National departments">
                  {(
                    [
                      "overview",
                      "industry",
                      "army",
                      "navy",
                      "air",
                      "research",
                      "politics",
                      "chronicle",
                    ] as Tab[]
                  ).map((t) => (
                    <button
                      key={t}
                      aria-label={t}
                      title={`${{ overview: "National overview", industry: "Construction & production", army: "Recruitment & division designer", navy: "Fleets & naval invasions", air: "Air command", research: "Research & technology", politics: "Diplomacy", chronicle: "Campaign history" }[t]}`}
                      className={tab === t && panelOpen ? "active" : ""}
                      onClick={() => {
                        setTab(t);
                        setPanelOpen(tab !== t || !panelOpen);
                      }}
                    >
                      <Icon name={t} size={25} />
                      <span>
                        {
                          {
                            overview: "Overview",
                            industry: "Industry",
                            army: "Army",
                            navy: "Navy",
                            air: "Air force",
                            research: "Research",
                            politics: "Diplomacy",
                            chronicle: "History",
                          }[t]
                        }
                      </span>
                    </button>
                  ))}
                </nav>
              )}
              <div className="map-shell">
                <div className="map-tools">
                  <button
                    className={!air && !sea ? "active" : ""}
                    onClick={() => {
                      setAir(false);
                      setSea(false);
                    }}
                  >
                    <Icon name="map" size={14} />
                    Political
                  </button>
                  <span>
                    STRATEGIC ATLAS <small>EUROPA / 1936</small>
                  </span>
                  <button
                    className={air ? "active" : ""}
                    onClick={() => {
                      setAir((a) => !a);
                      setSea(false);
                    }}
                  >
                    <Icon name="air" size={14} />
                    Air zones
                  </button>
                  <button
                    className={sea ? "active" : ""}
                    onClick={() => {
                      setSea((s) => !s);
                      setAir(false);
                    }}
                  >
                    Sea zones
                  </button>
                </div>
                <MapView
                  world={world}
                  state={shown}
                  nation={nation}
                  selected={selected}
                  units={units}
                  air={air}
                  sea={sea}
                  insetLeft={
                    screen === "game" && panelOpen
                      ? tab === "research"
                        ? 630
                        : tab === "army"
                          ? 450
                          : 390
                      : 0
                  }
                  onProvince={selectProvince}
                  onUnits={setUnits}
                  onMove={(id) => {
                    if (timeline !== null) {
                      setMessage("Return to live view to issue orders");
                      return;
                    }
                    command({ type: "move", units, province: id });
                  }}
                />
                <div className="map-legend">
                  <span>
                    <i className="land" />
                    Land
                  </span>
                  <span>
                    <i className="sea" />
                    Sea
                  </span>
                  <span>
                    <i className="blocked" />
                    Impassable
                  </span>
                  <span>▰ Division</span>
                  <span>▲ Fleet</span>
                </div>
              </div>
              <aside
                className={`sidebar ${screen === "game" && !panelOpen ? "hidden" : ""}`}
              >
                <div className="panel-rail">
                  <span>
                    {screen === "select"
                      ? "SELECT YOUR NATION"
                      : {
                          overview: "NATIONAL OVERVIEW",
                          industry: "INDUSTRIAL COMMAND",
                          army: "ARMY COMMAND",
                          navy: "NAVAL COMMAND",
                          air: "AIR COMMAND",
                          research: "RESEARCH BUREAU",
                          politics: "FOREIGN AFFAIRS",
                          chronicle: "CAMPAIGN HISTORY",
                        }[tab]}
                  </span>
                  {screen === "game" && (
                    <button
                      aria-label="Close command panel"
                      onClick={() => setPanelOpen(false)}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  )}
                </div>
                {screen === "select" ? (
                  <>
                    <div className="eyebrow">YOUR PLACE IN HISTORY</div>
                    <h2>Select a nation</h2>
                    <p className="muted">
                      Choose a country on the map or in the list below.
                    </p>
                    <div className="nation-list">
                      {world.nations.map((country) => (
                        <button
                          className={nation === country.id ? "active" : ""}
                          key={country.id}
                          onClick={() => {
                            setNation(country.id);
                            setSelected(country.capital);
                          }}
                        >
                          <Flag nation={country} />
                          {country.name}
                          <span>→</span>
                        </button>
                      ))}
                    </div>
                    {nation !== null && (
                      <div className="country-detail">
                        <h3>{world.nations[nation].name}</h3>
                        <p>{world.nations[nation].description}</p>
                        <div className="metrics">
                          <div>
                            <b>
                              {
                                world.provinces.filter(
                                  (p) => p.owner === nation,
                                ).length
                              }
                            </b>
                            <small>PROVINCES</small>
                          </div>
                          <div>
                            <b>6 / 8</b>
                            <small>CIV / MIL</small>
                          </div>
                          <div>
                            <b>3</b>
                            <small>DIVISIONS</small>
                          </div>
                        </div>
                        <button className="primary full" onClick={start}>
                          Begin campaign →
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="nation-heading">
                      {nation !== null && (
                        <Flag nation={world.nations[nation]} />
                      )}
                      <div>
                        <small>NATIONAL COMMAND</small>
                        <h2>
                          {nation !== null
                            ? world.nations[nation].name
                            : "Observer"}
                        </h2>
                      </div>
                    </div>
                    {n?.surrendered && (
                      <p className="warning">Your nation has surrendered.</p>
                    )}
                    {shown?.winner !== null && shown?.winner !== undefined && (
                      <p className="warning">
                        Campaign won by {world.nations[shown.winner].name}.
                      </p>
                    )}
                    <div
                      className="panel"
                      inert={
                        timeline !== null && tab !== "chronicle"
                          ? true
                          : undefined
                      }
                    >
                      {tab === "overview" && n && (
                        <>
                          <div className="eyebrow">SITUATION REPORT</div>
                          <h3>Your nation. Your strategy.</h3>
                          <p className="muted">
                            Build your industry, train divisions, and secure
                            your borders. AI nations follow the same rules.
                          </p>
                          <div className="metrics">
                            <div>
                              <b>
                                {
                                  shown?.units.filter(
                                    (u) =>
                                      u.owner === nation &&
                                      u.kind === "division",
                                  ).length
                                }
                              </b>
                              <small>DIVISIONS</small>
                            </div>
                            <div>
                              <b>{n.civs - n.consumer}</b>
                              <small>AVAILABLE CIVS</small>
                            </div>
                            <div>
                              <b>{n.mils}</b>
                              <small>MIL FACTORIES</small>
                            </div>
                          </div>
                          <h4>
                            Field formations{" "}
                            <span className="section-count">
                              {
                                shown?.units.filter(
                                  (u) =>
                                    u.owner === nation && u.kind === "division",
                                ).length
                              }
                            </span>
                          </h4>
                          <div className="formation-roster">
                            {shown?.units
                              .filter(
                                (u) =>
                                  u.owner === nation && u.kind === "division",
                              )
                              .map((u) => (
                                <button
                                  className={
                                    units.includes(u.id) ? "active" : ""
                                  }
                                  key={u.id}
                                  onClick={() => {
                                    setUnits([u.id]);
                                    setSelected(u.province);
                                  }}
                                >
                                  <Icon name="army" size={19} />
                                  <span>
                                    <b>{u.name}</b>
                                    <small>
                                      Province {u.province} ·{" "}
                                      {u.transition
                                        ? u.transition.kind
                                        : u.target !== null
                                          ? "Moving"
                                          : "Standing by"}
                                    </small>
                                  </span>
                                  <i>
                                    <em
                                      style={{
                                        width: `${(u.org / u.maxOrg) * 100}%`,
                                      }}
                                    />
                                  </i>
                                  <strong>{Math.round(u.strength)}%</strong>
                                </button>
                              ))}
                          </div>
                          <h4>Equipment stockpile</h4>
                          <div className="stock-list">
                            {equipmentTypes.map((e) => (
                              <div key={e}>
                                <span>{e}</span>
                                <b>{Math.floor(n.stock[e]).toLocaleString()}</b>
                              </div>
                            ))}
                          </div>
                          <div className="help">
                            <b>Field manual</b>
                            <p>
                              Space pauses singleplayer. Drag a box around your
                              units, then right click a destination. Declare war
                              before crossing foreign borders. Units fight, lose
                              equipment, and retreat; encircled units are
                              destroyed.
                            </p>
                            <p>
                              Three ticks per Gregorian day: two daylight
                              periods and one night. Normal speed = two ticks
                              per second. Training takes 12 days.
                            </p>
                          </div>
                        </>
                      )}
                      {tab === "industry" && n && (
                        <>
                          <h3>Industrial command</h3>
                          <p className="muted">
                            {n.civs} civilian factories · {n.consumer} reserved
                            for consumer goods. {n.mils} military factories,{" "}
                            {n.mils -
                              Object.values(n.production).reduce(
                                (a, b) => a + b,
                                0,
                              )}{" "}
                            unassigned.
                          </p>
                          <h4>Construction</h4>
                          <div className="button-row">
                            <button
                              onClick={() =>
                                command({ type: "build", kind: "civ" })
                              }
                            >
                              + Civilian
                            </button>
                            <button
                              onClick={() =>
                                command({ type: "build", kind: "mil" })
                              }
                            >
                              + Military
                            </button>
                          </div>
                          <button
                            className="full"
                            disabled={
                              !province ||
                              !owned ||
                              province.kind !== "land" ||
                              !province.neighbors.some(
                                (id) => world.provinces[id].kind === "sea",
                              ) ||
                              !!shown?.ports[province.id]
                            }
                            onClick={() =>
                              command({
                                type: "build",
                                kind: "port",
                                province: province!.id,
                              })
                            }
                          >
                            + Port in selected coastal province
                          </button>
                          {n.construction.map((q, i) => (
                            <div className="queue" key={i}>
                              <span>
                                {q.kind === "port"
                                  ? `Port · P${q.province}`
                                  : q.kind === "civ"
                                    ? "Civilian factory"
                                    : "Military factory"}
                              </span>
                              <small>
                                {i === 0
                                  ? `${q.progress}/${q.kind === "port" ? 180 : 120} work`
                                  : "Queued"}
                              </small>
                              <progress
                                value={q.progress}
                                max={q.kind === "port" ? 180 : 120}
                              />
                            </div>
                          ))}
                          <h4>Military production</h4>
                          {equipmentTypes.map((e) => (
                            <div className="production-row" key={e}>
                              <div>
                                <b>
                                  <Icon
                                    name={
                                      e === "gun"
                                        ? "gun"
                                        : e === "tank"
                                          ? "tank"
                                          : e === "fighter"
                                            ? "air"
                                            : e === "destroyer"
                                              ? "navy"
                                              : "gun"
                                    }
                                    size={20}
                                  />
                                  {e}
                                </b>
                                <small>Stock: {Math.floor(n.stock[e])}</small>
                              </div>
                              <button
                                onClick={() =>
                                  command({
                                    type: "production",
                                    equipment: e,
                                    factories: n.production[e] - 1,
                                  })
                                }
                                disabled={n.production[e] === 0}
                              >
                                −
                              </button>
                              <b>{n.production[e]}</b>
                              <button
                                onClick={() =>
                                  command({
                                    type: "production",
                                    equipment: e,
                                    factories: n.production[e] + 1,
                                  })
                                }
                              >
                                +
                              </button>
                            </div>
                          ))}
                        </>
                      )}
                      {tab === "army" && n && (
                        <>
                          <h3>Division designer</h3>
                          <div className="button-row">
                            {n.templates.map((t) => (
                              <button
                                key={t.id}
                                onClick={() => {
                                  setEditId(t.id);
                                  setTemplateName(t.name);
                                  setBs([...t.battalions]);
                                }}
                              >
                                {t.name}
                              </button>
                            ))}
                            <button
                              onClick={() => {
                                setEditId(undefined);
                                setTemplateName("New division");
                                setBs(["infantry"]);
                              }}
                            >
                              New
                            </button>
                          </div>
                          <label>
                            Name
                            <input
                              value={templateName}
                              onChange={(e) => setTemplateName(e.target.value)}
                              maxLength={60}
                            />
                          </label>
                          <div className="battalion-grid">
                            {bs.map((b, i) => (
                              <button
                                key={i}
                                title="Remove battalion"
                                onClick={() =>
                                  setBs(bs.filter((_, j) => j !== i))
                                }
                              >
                                {b === "infantry" ? (
                                  <Icon name="army" size={24} />
                                ) : b === "armored" ? (
                                  <Icon name="tank" size={24} />
                                ) : (
                                  <Icon name="gun" size={24} />
                                )}
                                <small>{b}</small>
                                <span>×</span>
                              </button>
                            ))}
                            {Array.from(
                              { length: Math.max(0, 10 - bs.length) },
                              (_, i) => (
                                <button
                                  key={`empty-${i}`}
                                  className="empty-battalion"
                                  title="Add infantry battalion"
                                  onClick={() => setBs([...bs, "infantry"])}
                                >
                                  <Icon name="plus" size={19} />
                                  <small>ADD</small>
                                </button>
                              ),
                            )}
                          </div>
                          <div className="button-row">
                            {(
                              [
                                "infantry",
                                "armored",
                                "artillery",
                              ] as Battalion[]
                            ).map((b) => (
                              <button
                                key={b}
                                disabled={bs.length >= 12}
                                onClick={() => setBs([...bs, b])}
                              >
                                + {b}
                              </button>
                            ))}
                          </div>
                          <div className="metrics">
                            <div>
                              <b>{stats(bs).attack}</b>
                              <small>ATTACK</small>
                            </div>
                            <div>
                              <b>{stats(bs).defense}</b>
                              <small>DEFENSE</small>
                            </div>
                            <div>
                              <b>{stats(bs).maxOrg}</b>
                              <small>ORG</small>
                            </div>
                          </div>
                          <p className="muted">
                            Equipment:{" "}
                            {Object.entries(
                              requirements({ id: 0, name: "", battalions: bs }),
                            )
                              .map(([e, v]) => `${v} ${e}`)
                              .join(" · ")}
                          </p>
                          <button
                            className="primary full"
                            onClick={() =>
                              command({
                                type: "template",
                                id: editId,
                                name: templateName,
                                battalions: bs,
                              })
                            }
                          >
                            Save template
                          </button>
                          <h4>Recruitment</h4>
                          <select
                            value={recruitTemplate}
                            onChange={(e) =>
                              setRecruitTemplate(Number(e.target.value))
                            }
                          >
                            {n.templates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                          <button
                            className="full"
                            disabled={
                              !province || !owned || province.kind !== "land"
                            }
                            onClick={() =>
                              command({
                                type: "recruit",
                                template: recruitTemplate,
                                province: province!.id,
                              })
                            }
                          >
                            Queue in selected province
                          </button>
                          <p className="muted">
                            Equipment is reserved immediately; division deploys
                            after 12 days (36 ticks).
                          </p>
                          {n.recruits.map((r, i) => (
                            <div className="queue" key={i}>
                              {r.template.name}
                              <small>Ready {calendar(r.ready).date}</small>
                              <progress
                                value={36 - (r.ready - (shown?.tick || 0))}
                                max={36}
                              />
                            </div>
                          ))}
                        </>
                      )}
                      {tab === "navy" && n && (
                        <>
                          <h3>Ships & fleets</h3>
                          <div className="help">
                            <b>Naval transport & invasions</b>
                            <p>
                              Move divisions to an owned port, then right click
                              sea or a coastal land destination. Inland
                              divisions automatically route through a port. Sea
                              movement: 1 tick per province; land: 3. Embarking
                              and disembarking each add 6 ticks. Landings have
                              −75% attack and double incoming losses. Enemy
                              fleets do not block transports.
                            </p>
                          </div>
                          <h4>Owned ports</h4>
                          <div className="button-row">
                            {Object.keys(shown?.ports || {})
                              .filter(
                                (id) =>
                                  shown?.ports[Number(id)] &&
                                  shown.owners[Number(id)] === nation,
                              )
                              .map((id) => (
                                <button
                                  key={id}
                                  onClick={() => setSelected(Number(id))}
                                >
                                  ⚓ Port P{id}
                                </button>
                              ))}
                          </div>
                          <p className="muted">
                            Select a sea province adjacent to your coast to
                            commission a fleet. Destroyers share the land combat
                            rules, including retreat and encirclement.
                          </p>
                          <label>
                            Destroyers per fleet
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={ships}
                              onChange={(e) => setShips(Number(e.target.value))}
                            />
                          </label>
                          <p>
                            Available destroyers:{" "}
                            {Math.floor(n.stock.destroyer)}
                          </p>
                          <button
                            className="primary full"
                            disabled={province?.kind !== "sea"}
                            onClick={() =>
                              command({
                                type: "fleet",
                                province: province!.id,
                                ships,
                              })
                            }
                          >
                            Commission fleet
                          </button>
                          {shown?.units
                            .filter(
                              (u) => u.owner === nation && u.kind === "fleet",
                            )
                            .map((u) => (
                              <button
                                className="unit-row"
                                key={u.id}
                                onClick={() => {
                                  setUnits([u.id]);
                                  setSelected(u.province);
                                }}
                              >
                                <b>▲ {u.name}</b>
                                <small>
                                  P{u.province} · {Math.round(u.org)} org ·{" "}
                                  {Math.round(u.strength)}% strength
                                </small>
                              </button>
                            ))}
                        </>
                      )}
                      {tab === "air" && n && (
                        <>
                          <h3>Air command</h3>
                          <p className="muted">
                            Each land province hosts 500 planes. Wings deploy in
                            groups of 100; range is measured from airbase
                            centroid to air-zone centroid.
                          </p>
                          <button
                            className="primary full"
                            disabled={!owned || province?.kind !== "land"}
                            onClick={() =>
                              command({ type: "wing", province: province!.id })
                            }
                          >
                            Deploy 100 fighters
                          </button>
                          <p>
                            Stockpile: {Math.floor(n.stock.fighter)} fighters
                          </p>
                          <label>
                            Mission region
                            <select
                              value={zone}
                              onChange={(e) => setZone(Number(e.target.value))}
                            >
                              {world.airZones.map((z) => (
                                <option value={z.id} key={z.id}>
                                  {z.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          {shown?.wings
                            .filter((w) => w.owner === nation)
                            .map((w) => (
                              <div className="wing" key={w.id}>
                                <b>
                                  Wing {w.id} · {w.planes} fighters
                                </b>
                                <small>
                                  Base P{w.base} · Range {w.range} ·{" "}
                                  {w.zone === null
                                    ? "Idle"
                                    : `${world.airZones[w.zone].name} / ${w.mission}`}
                                </small>
                                <div className="button-row">
                                  <button
                                    disabled={
                                      !reachableZone(
                                        shown,
                                        w.base,
                                        zone,
                                        w.range,
                                      )
                                    }
                                    onClick={() =>
                                      command({
                                        type: "mission",
                                        wing: w.id,
                                        zone,
                                        mission: "superiority",
                                      })
                                    }
                                  >
                                    Superiority
                                  </button>
                                  <button
                                    disabled={
                                      !reachableZone(
                                        shown,
                                        w.base,
                                        zone,
                                        w.range,
                                      )
                                    }
                                    onClick={() =>
                                      command({
                                        type: "mission",
                                        wing: w.id,
                                        zone,
                                        mission: "support",
                                      })
                                    }
                                  >
                                    Ground support
                                  </button>
                                </div>
                              </div>
                            ))}
                        </>
                      )}
                      {tab === "research" && n && (
                        <>
                          <h3>Technology tree</h3>
                          <p className="muted">
                            One active research project per nation. All
                            equipment types are available from the start.
                          </p>
                          <div className="technology-graph">
                            {technologies.map((t) => (
                              <div
                                className={`tech ${n.techs.includes(t.id) ? "complete" : ""}`}
                                key={t.id}
                              >
                                <small>
                                  {t.requires
                                    ? `↳ Requires ${technologies.find((x) => x.id === t.requires)?.name}`
                                    : "FOUNDATION"}
                                </small>
                                <Icon
                                  name={
                                    t.id === "industry"
                                      ? "industry"
                                      : t.id === "weapons"
                                        ? "gun"
                                        : t.id === "armor"
                                          ? "tank"
                                          : t.id === "aviation"
                                            ? "air"
                                            : "navy"
                                  }
                                  size={27}
                                />
                                <h4>{t.name}</h4>
                                <p>{t.description}</p>
                                {n.research === t.id ? (
                                  <>
                                    <progress
                                      value={n.researchProgress}
                                      max={t.cost}
                                    />
                                    <small>
                                      {n.researchProgress}/{t.cost} days
                                    </small>
                                  </>
                                ) : (
                                  <button
                                    disabled={
                                      n.techs.includes(t.id) ||
                                      !!(
                                        t.requires &&
                                        !n.techs.includes(t.requires)
                                      )
                                    }
                                    onClick={() =>
                                      command({ type: "research", tech: t.id })
                                    }
                                  >
                                    {n.techs.includes(t.id)
                                      ? "Researched"
                                      : `Research · ${t.cost} days`}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                      {tab === "politics" && n && (
                        <>
                          <h3>Foreign affairs</h3>
                          <p className="muted">
                            There are no alliances in this MVP. Declare war to
                            contest land and engage enemy fleets. Overseas
                            divisions must depart from a port.
                          </p>
                          {world.nations
                            .filter((x) => x.id !== nation)
                            .map((other) => {
                              const war = shown?.wars.some(
                                (w) =>
                                  w.includes(nation!) && w.includes(other.id),
                              );
                              return (
                                <div className="diplomacy" key={other.id}>
                                  <Flag nation={other} />
                                  <div>
                                    <b>{other.name}</b>
                                    <small>
                                      {shown?.nations[other.id].surrendered
                                        ? "Surrendered"
                                        : war
                                          ? "At war"
                                          : "At peace"}
                                    </small>
                                  </div>
                                  <button
                                    disabled={
                                      war ||
                                      shown?.nations[other.id].surrendered
                                    }
                                    onClick={() =>
                                      command({ type: "war", target: other.id })
                                    }
                                  >
                                    Declare war
                                  </button>
                                </div>
                              );
                            })}
                          <h4>Capitulation</h4>
                          <p className="muted">
                            Surrender transfers your remaining territory to a
                            war opponent and removes your forces. Losing every
                            land province triggers surrender automatically.
                          </p>
                          <button
                            className="danger full"
                            disabled={
                              !shown?.wars.some((w) => w.includes(nation!))
                            }
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Surrender your nation and end its campaign?",
                                )
                              )
                                command({ type: "surrender" });
                            }}
                          >
                            Surrender
                          </button>
                        </>
                      )}
                      {tab === "chronicle" && (
                        <>
                          <h3>Campaign chronicle</h3>
                          <p className="muted">
                            Ownership changes are transactions; national stats
                            and kills are sampled daily. Only the current
                            resumable state is written on download. Download
                            your save for analysis or resume it later.
                          </p>
                          <div className="metrics">
                            <div>
                              <b>{live?.events.length}</b>
                              <small>EVENTS</small>
                            </div>
                            <div>
                              <b>
                                {
                                  shown?.events.filter(
                                    (e) => e.type === "destroyed",
                                  ).length
                                }
                              </b>
                              <small>UNITS LOST</small>
                            </div>
                            <div>
                              <b>
                                {timeline !== null
                                  ? "—"
                                  : shown
                                    ? checksum(shown)
                                    : "—"}
                              </b>
                              <small>STATE HASH</small>
                            </div>
                          </div>
                          <h4>Map time machine</h4>
                          <p className="muted">
                            Exact historical ownership; daily national-stat
                            samples. Historical unit positions are omitted.
                          </p>
                          <input
                            aria-label="Historical tick"
                            type="range"
                            min={0}
                            max={live?.tick || 0}
                            value={timeline ?? live?.tick ?? 0}
                            onChange={(e) => {
                              if (!multi) setPaused(true);
                              setTimeline(Number(e.target.value));
                              setUnits([]);
                            }}
                          />
                          <button onClick={() => setTimeline(null)}>
                            Return to live · {calendar(live?.tick ?? 0).date}
                          </button>
                          <button
                            onClick={() =>
                              setSqlQuery(
                                "SELECT tick, nation, civs, mils, ports, provinces, kills FROM national_stats ORDER BY tick DESC, nation LIMIT 32",
                              )
                            }
                          >
                            National stats
                          </button>
                          <h4>SQL workbench</h4>
                          <textarea
                            value={sqlQuery}
                            onChange={(e) => setSqlQuery(e.target.value)}
                            rows={3}
                          />
                          <div className="button-row">
                            <button
                              onClick={() => {
                                try {
                                  if (
                                    !/^\s*SELECT\b/i.test(sqlQuery) ||
                                    sqlQuery.includes(";")
                                  )
                                    throw Error("Use a single SELECT query");
                                  const db = new GameSave(
                                    save.current!.bytes(),
                                  );
                                  try {
                                    db.db.run("PRAGMA query_only=ON");
                                    setQueryResult(
                                      JSON.stringify(
                                        db.query(sqlQuery),
                                        null,
                                        2,
                                      ),
                                    );
                                  } finally {
                                    db.close();
                                  }
                                } catch (e) {
                                  setQueryResult(String(e));
                                }
                              }}
                            >
                              Run query
                            </button>
                            <button
                              onClick={() =>
                                setSqlQuery(
                                  "SELECT tick, nation, equipment_lost, units_lost, kills FROM national_stats ORDER BY tick,nation",
                                )
                              }
                            >
                              Losses / day
                            </button>
                            <button
                              onClick={() =>
                                setSqlQuery(
                                  "SELECT tick, nation, COUNT(*) AS captures FROM events WHERE type='capture' GROUP BY tick,nation",
                                )
                              }
                            >
                              Captures / day
                            </button>
                          </div>
                          {queryResult && <pre>{queryResult}</pre>}
                          <h4>Event ledger</h4>
                          <div className="events">
                            {shown?.events
                              .slice(-35)
                              .reverse()
                              .map((e, i) => (
                                <div key={i}>
                                  <small>
                                    {calendar(e.tick).date} ·{" "}
                                    {calendar(e.tick).phase} · {e.type}
                                  </small>
                                  <span>{e.message}</span>
                                </div>
                              ))}
                          </div>
                        </>
                      )}
                    </div>
                    {province && (
                      <div className="province-info">
                        <small>
                          PROVINCE {province.id} · {province.kind.toUpperCase()}
                        </small>
                        <b>
                          {shown && shown.owners[province.id] !== null
                            ? world.nations[shown.owners[province.id]!].name
                            : province.owner !== null
                              ? world.nations[province.owner].name
                              : "Open waters"}
                        </b>
                        <span>
                          {world.airZones[province.airZone].name} ·{" "}
                          {province.neighbors.length} neighbors
                        </span>
                        <small>
                          Linked regions:{" "}
                          {world.airZones[province.airZone].linkedAirZones
                            .map((id) => world.airZones[id].name)
                            .join(", ") || "none"}
                          {world.airZones[province.airZone].seaZone !== null
                            ? ` / ${world.seaZones[world.airZones[province.airZone].seaZone!].name}`
                            : ""}
                        </small>
                        {province.seaZone !== null && (
                          <small>
                            {world.seaZones[province.seaZone].name} · linked air
                            regions{" "}
                            {world.seaZones[province.seaZone].airZones
                              .map((id) => id + 1)
                              .join(", ")}
                          </small>
                        )}
                        {shown?.ports[province.id] && <b>⚓ Port</b>}
                        {province.kind === "land" && (
                          <small>
                            Airbase:{" "}
                            {shown?.wings
                              .filter((w) => w.base === province.id)
                              .reduce((a, w) => a + w.planes, 0) || 0}
                            /500 aircraft
                          </small>
                        )}
                      </div>
                    )}
                    {selectedUnits.length > 0 && (
                      <div className="selected-units">
                        <small>
                          {selectedUnits.length} UNIT(S) SELECTED · RIGHT CLICK
                          TO MOVE
                        </small>
                        {selectedUnits.slice(0, 6).map((u) => (
                          <div key={u.id}>
                            <b>{u.name}</b>
                            <span>
                              A{u.attack} / D{u.defense} · Org{" "}
                              {Math.round(u.org)}/{u.maxOrg} ·{" "}
                              {Math.round(u.strength)}% ·{" "}
                              {u.transition
                                ? `${u.transition.kind} until ${calendar(u.transition.ready).date}`
                                : world.provinces[u.province].kind === "sea" &&
                                    u.kind === "division"
                                  ? "Transporting"
                                  : "On land"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </aside>
              {screen === "game" && (
                <>
                  <AtlasOverview
                    world={world}
                    state={shown}
                    onProvince={selectProvince}
                  />
                  <div className="theater-banner">
                    <span className="status-dot" />
                    <b>EUROPEAN THEATER</b>
                    <small>
                      {shown?.wars.length
                        ? `${shown.wars.length} active conflict${shown.wars.length === 1 ? "" : "s"}`
                        : "No active conflicts"}
                    </small>
                  </div>
                  {province && (
                    <div className="province-card">
                      <span className="eyebrow">
                        PROVINCE {province.id} ·{" "}
                        {province.kind
                          .replace("impassable-", "IMPASSABLE ")
                          .toUpperCase()}
                      </span>
                      <b>
                        {shown && shown.owners[province.id] !== null
                          ? world.nations[shown.owners[province.id]!].name
                          : province.kind.includes("sea")
                            ? "Open sea"
                            : "Unclaimed land"}
                      </b>
                      <small>
                        {world.airZones[province.airZone].name}
                        {shown?.ports[province.id] ? " · ⚓ Port" : ""}
                      </small>
                      <button
                        onClick={() => setSelected(null)}
                        aria-label="Dismiss province"
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </div>
                  )}
                  {selectedUnits.length > 0 && (
                    <div className="army-order-bar">
                      <Icon
                        name={
                          selectedUnits[0].kind === "fleet" ? "navy" : "army"
                        }
                        size={29}
                      />
                      <div>
                        <b>
                          {selectedUnits.length}{" "}
                          {selectedUnits[0].kind === "fleet"
                            ? "fleet"
                            : "division"}
                          {selectedUnits.length > 1 ? "s" : ""} selected
                        </b>
                        <small>
                          Right click a destination to issue a movement order
                        </small>
                      </div>
                      <button
                        onClick={() =>
                          selectedUnits.forEach((u) =>
                            command({
                              type: "move",
                              units: [u.id],
                              province: u.province,
                            }),
                          )
                        }
                      >
                        Halt
                      </button>
                      <button
                        aria-label="Clear unit selection"
                        onClick={() => setUnits([])}
                      >
                        <Icon name="close" size={17} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <footer className="statusbar">
            <span>
              ●{" "}
              {multi
                ? connected
                  ? "SERVER CONNECTED"
                  : "DISCONNECTED"
                : "DETERMINISTIC LOCAL ENGINE"}
            </span>
            <span>
              {screen === "game"
                ? `${shown?.units.length} units · ${shown?.wings.length} air wings · ${shown?.wars.length} wars`
                : `${world.provinces.length} provinces · ${world.nations.length} nations · ${world.airZones.length} air zones · ${world.seaZones.length} sea zones`}
            </span>
            <span>
              {screen === "game" && !multi
                ? "SPACE TO PLAY / PAUSE"
                : "WORLD AT WAR · MVP 0.1"}
            </span>
          </footer>
        </>
      )}
    </div>
  );
}
