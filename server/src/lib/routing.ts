import { distanceKm, etaMinutes, type Point } from "./geo";

// Road directions inside the app, so a courier doesn't need the Google Maps app to find a customer.
//
// The route comes from the OpenStreetMap routing service run by FOSSGIS (routing.openstreetmap.de, the
// one openstreetmap.org uses itself): free and without a key. Its fair-use rules ask for light use and a
// clear User-Agent, which is why the phone asks OUR server (which also checks the job is theirs) and not the
// service directly. Only two map points are sent: no name, phone number or address.
//
// If the service can't be reached, the courier still gets a straight line with the distance, never an error.

export interface RouteStep {
  text: string; // e.g. "Turn right onto Tsenin Street (R31)"
  type: string; // OSRM's manoeuvre: depart, turn, roundabout, arrive...
  modifier: string | null; // left, slight right, straight, uturn...
  distanceM: number; // how far to drive after this step, before the next one
  at: Point; // where the step happens
}

export interface Route {
  source: "roads" | "straight"; // "straight" = the routing service couldn't be reached
  distanceM: number;
  durationS: number;
  line: [number, number][]; // [lat, lng] points to draw on the map
  steps: RouteStep[];
}

const USER_AGENT = "KurumanMarketPlace/1.0 (+https://kurumanmarketplace.co.za)";
const PROFILE: Record<string, string> = { on_foot: "foot", bicycle: "bike" }; // motorbike, car, bakkie: car

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// One OSRM step in plain words. OSRM gives only codes (type "turn", modifier "right", the road's name),
// so the sentence is put together here.
export function stepText(type: string, modifier: string | null | undefined, road: string, exit?: number): string {
  const onto = road ? ` onto ${road}` : "";
  const direction =
    modifier === "uturn"
      ? "make a U-turn"
      : modifier === "straight"
        ? "go straight on"
        : modifier
          ? `turn ${modifier.replace("slight ", "slightly ")}`
          : "continue";
  switch (type) {
    case "depart":
      return road ? `Start on ${road}` : "Start";
    case "arrive":
      return "You’ve arrived at the customer’s pin";
    case "roundabout":
    case "rotary":
      return exit ? `At the roundabout, take exit ${exit}${onto}` : `Go round the roundabout${onto}`;
    case "exit roundabout":
    case "exit rotary":
      return `Leave the roundabout${onto}`;
    case "fork":
      return `Keep ${(modifier ?? "straight").replace("slight ", "")} at the fork${onto}`;
    case "end of road":
      return `At the end of the road, ${direction}${onto}`;
    case "new name":
    case "notification":
      return `Continue${onto}`;
    case "continue":
      return modifier && modifier !== "straight" ? `${capital(direction)}${onto}` : `Continue${onto}`;
    default: // turn, merge, on ramp, off ramp
      return `${capital(direction)}${onto}`;
  }
}

// "Tsenin Street (R31)", "Tsenin Street", "R31" or "" (many village roads have no name on the map).
function roadName(step: { name?: string; ref?: string }): string {
  const name = step.name?.trim() ?? "";
  const ref = step.ref?.trim() ?? "";
  return name && ref && !name.includes(ref) ? `${name} (${ref})` : name || ref;
}

function straightLine(from: Point, to: Point, vehicleType: string): Route {
  const km = distanceKm(from, to);
  return {
    source: "straight",
    distanceM: Math.round(km * 1000),
    durationS: etaMinutes(km, vehicleType) * 60,
    line: [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ],
    steps: [],
  };
}

export async function roadRoute(from: Point, to: Point, vehicleType: string): Promise<Route> {
  const base = process.env.ROUTING_URL ?? "https://routing.openstreetmap.de";
  const profile = PROFILE[vehicleType] ?? "car";
  const url = `${base}/routed-${profile}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8000) });
    const data: any = await res.json();
    const route = data?.routes?.[0];
    if (!res.ok || data.code !== "Ok" || !route) throw new Error(`answered ${res.status} ${data?.code ?? ""}`);
    return {
      source: "roads",
      distanceM: Math.round(route.distance),
      durationS: Math.round(route.duration),
      line: route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]),
      steps: route.legs[0].steps.map((s: any) => ({
        text: stepText(s.maneuver.type, s.maneuver.modifier, roadName(s), s.maneuver.exit),
        type: s.maneuver.type,
        modifier: s.maneuver.modifier ?? null,
        distanceM: Math.round(s.distance),
        at: { lat: s.maneuver.location[1], lng: s.maneuver.location[0] },
      })),
    };
  } catch (err) {
    console.warn(`[routing] no road route (${(err as Error).message}); showing a straight line`);
    return straightLine(from, to, vehicleType);
  }
}
