import { POLICY } from "./policy";

// Map maths for deliveries, worked out on the server so every screen shows the same numbers.

export interface Point {
  lat: number;
  lng: number;
}

// A {lat, lng} sent by a phone, or null if it isn't a real position on Earth.
export function parsePoint(value: any): Point | null {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  if (typeof value?.lat !== "number" || typeof value?.lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // 6 decimals is about 10 cm: more would only be noise from the phone.
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

// Straight-line ("as the crow flies") distance with the haversine formula, in km.
export function distanceKm(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Is this pin somewhere we deliver (a circle around Kuruman)? Stops a pin dropped by mistake in another town.
export function inServiceArea(p: Point): boolean {
  return distanceKm(p, POLICY.serviceCentre) <= POLICY.serviceRadiusKm;
}

// A rough arrival time: roads aren't straight (x 1.3), at a typical speed in town for the courier's vehicle.
// It's an estimate, and the screens say "about".
const SPEED_KMH: Record<string, number> = { on_foot: 5, bicycle: 14, motorbike: 30, car: 30, bakkie: 30 };
export function etaMinutes(km: number, vehicleType: string): number {
  return Math.max(1, Math.round(((km * 1.3) / (SPEED_KMH[vehicleType] ?? 20)) * 60));
}

// A Google Maps link that opens turn-by-turn directions on the phone (the Maps app if it's installed).
// It needs no API key: it's an ordinary link. To a pin when there is one, otherwise to the written address.
const TRAVEL_MODE: Record<string, string> = { on_foot: "walking", bicycle: "bicycling" };
export function directionsUrl(to: Point | string, vehicleType?: string): string {
  const destination = typeof to === "string" ? to : `${to.lat},${to.lng}`;
  const mode = TRAVEL_MODE[vehicleType ?? ""] ?? "driving";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=${mode}`;
}

// A written pickup or delivery address with the town added, so Google Maps searches in the right place.
export function addressInKuruman(address: string, area?: string | null): string {
  return [address, area, "Kuruman, Northern Cape"].filter(Boolean).join(", ");
}
