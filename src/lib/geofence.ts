export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = Math.PI / 180;
  const x = Math.sin((b.latitude - a.latitude) * radians / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin((b.longitude - a.longitude) * radians / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}


export function isFreshLocation(timestamp: number, now: number) {
  return Number.isFinite(timestamp) && now - timestamp <= 30000 && timestamp - now <= 5000;
}

export function withinPickupRadius(location: { latitude: number; longitude: number; accuracy: number }, stop: { latitude: number; longitude: number }) {
  return Number.isFinite(location.accuracy) && location.accuracy >= 0 && distanceMeters(location, stop) + location.accuracy <= 50;
}
