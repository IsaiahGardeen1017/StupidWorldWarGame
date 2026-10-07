import type { State, World } from "../engine/types";
export function AtlasOverview({
  world,
  state,
  onProvince,
}: {
  world: World;
  state: State | null;
  onProvince: (id: number) => void;
}) {
  return (
    <div className="atlas-overview">
      <div className="minimap-caption">
        THEATER OVERVIEW <span>EUROPA</span>
      </div>
      <svg
        viewBox={`0 0 ${world.width} ${world.height}`}
        role="img"
        aria-label="World overview map"
      >
        {world.provinces.map((p) => {
          const owner = state ? state.owners[p.id] : p.owner;
          return (
            <path
              key={p.id}
              onClick={() => onProvince(p.id)}
              style={{ cursor: "pointer" }}
              d={p.polygons
                .map(
                  (loop) =>
                    "M" + loop.map((point) => point.join(",")).join("L") + "Z",
                )
                .join(" ")}
              fillRule="evenodd"
              fill={
                p.kind === "land"
                  ? owner === null
                    ? "#777d65"
                    : world.nations[owner].color
                  : p.kind === "sea"
                    ? "#354a50"
                    : "#263335"
              }
              stroke="#172321"
              strokeWidth=".5"
            />
          );
        })}
      </svg>
      <div className="minimap-coordinates">
        W <span>CYLINDRICAL WORLD</span> E
      </div>
    </div>
  );
}
