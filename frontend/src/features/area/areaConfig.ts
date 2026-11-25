export type AreaField = {
  key: string;
  label: string;
  type?: string;
  options?: string[];
  optional?: boolean;
};
const status: AreaField = {
  key: "status",
  label: "Status",
  options: ["Active", "Inactive"],
};
const coordinates: AreaField[] = [
  { key: "latitude", label: "Latitude", type: "number", optional: true },
  { key: "longitude", label: "Longitude", type: "number", optional: true },
];
export const areaTabs = [
  { id: "routes", label: "Routes (City pairs)" },
  { id: "route-stops", label: "Route stop assignment" },
  { id: "cities", label: "Cities" },
  { id: "locations", label: "Pickup & drop points" },
  { id: "pois", label: "POI / landmarks" },
];
export const areaFields: Record<string, AreaField[]> = {
  cities: [
    { key: "name", label: "City name" },
    { key: "state", label: "State / region" },
    { key: "country", label: "Country" },
    status,
  ],
  locations: [
    { key: "cityId", label: "City" },
    { key: "name", label: "Location name" },
    { key: "usage", label: "Point type", options: ["Pickup", "Drop", "Both"] },
    { key: "address", label: "Address", optional: true },
    { key: "landmarkId", label: "Nearby landmark", optional: true },
    { key: "phone", label: "Contact phone", type: "tel", optional: true },
    ...coordinates,
    status,
  ],
  pois: [
    { key: "cityId", label: "City" },
    { key: "name", label: "POI / landmark name" },
    {
      key: "category",
      label: "Category",
      options: ["Bus stand", "Railway station", "Landmark", "Other"],
    },
    { key: "address", label: "Address", optional: true },
    ...coordinates,
    status,
  ],
};
export const areaColumns: Record<string, [string, string][]> = {
  routes: [
    ["source", "From / Origin"],
    ["destination", "To / Destination"],
    ["departure", "Departure"],
    ["arrival", "Arrival"],
    ["durationMinutes", "Duration (mins)"],
    ["distanceKm", "Distance (km)"],
    ["status", "Status"],
  ],
  cities: [
    ["name", "City"],
    ["state", "State / region"],
    ["country", "Country"],
    ["status", "Status"],
  ],
  locations: [
    ["name", "Location"],
    ["cityName", "City"],
    ["usage", "Type"],
    ["address", "Address"],
    ["phone", "Phone"],
    ["status", "Status"],
  ],
  pois: [
    ["name", "Landmark"],
    ["cityName", "City"],
    ["category", "Category"],
    ["address", "Address"],
    ["status", "Status"],
  ],
};
