/** Local persistence and demo records for the DMERAS application. */

/** @type {string} */
const STORAGE_KEY = "dmeras-state-v1";
export const DEFAULT_MAP_LOCATION = [17.385, 78.4867];

/** @type {string[]} */
export const RESOURCE_KEYS = ["food", "water", "medicine", "ambulances", "boats"];

/** @type {Record<string, string>} */
export const RESOURCE_LABELS = {
  food: "Food portions",
  water: "Water (L)",
  medicine: "Medicine kits",
  ambulances: "Ambulances",
  boats: "Boats"
};

/** @type {Record<string, string>} */
export const RESOURCE_SHORT_LABELS = {
  food: "Food",
  water: "Water",
  medicine: "Medicine",
  ambulances: "Ambulances",
  boats: "Boats"
};

/**
 * Builds the empty application state used on a first visit.
 * @returns {{incidents: Object[], depots: Object[], shelters: Object[], activity: Object[]}}
 */
export function createEmptyState() {
  return { incidents: [], depots: [], shelters: [], activity: [] };
}

/**
 * Reads and validates saved application data from localStorage.
 * @returns {{incidents: Object[], depots: Object[], shelters: Object[], activity: Object[]}}
 * @throws {Error} When saved JSON cannot be parsed or has an invalid shape.
 */
export function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return createEmptyState();
  let state;
  try {
    state = JSON.parse(saved);
  } catch (error) {
    throw new Error(`Saved DMERAS data could not be read: ${error.message}`);
  }
  if (!state || !Array.isArray(state.incidents) || !Array.isArray(state.depots) ||
      !Array.isArray(state.shelters) || !Array.isArray(state.activity)) {
    throw new Error("Saved DMERAS data has an invalid structure. Use the demo data or clear this site's local storage.");
  }
  return state;
}

/**
 * Saves the complete application state to localStorage.
 * @param {{incidents: Object[], depots: Object[], shelters: Object[], activity: Object[]}} state
 */
export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * Creates a deterministic set of sample incidents, depots and shelters.
 * @returns {{incidents: Object[], depots: Object[], shelters: Object[], activity: Object[]}}
 */
export function createDemoState() {
  const now = Date.now();
  return {
    incidents: [
      { id: "demo-i1", type: "Flood", severity: 5, people: 60, description: "Floodwater has reached homes near the Musi River. Residents need evacuation, clean water and essential supplies.", lat: 17.382, lng: 78.481, createdAt: new Date(now - 12 * 60000).toISOString(), status: "Pending", allocated: {} },
      { id: "demo-i2", type: "Fire", severity: 3, people: 15, description: "A small commercial building fire has affected nearby residents who need first aid and temporary support.", lat: 17.397, lng: 78.476, createdAt: new Date(now - 48 * 60000).toISOString(), status: "Pending", allocated: {} },
      { id: "demo-i3", type: "Earthquake", severity: 4, people: 40, description: "Structural damage has been reported in several buildings. Search and medical support are requested.", lat: 17.369, lng: 78.493, createdAt: new Date(now - 2 * 3600000).toISOString(), status: "Pending", allocated: {} },
      { id: "demo-i4", type: "Landslide", severity: 2, people: 8, description: "A road embankment has slipped after heavy rain. A small nearby community needs assistance.", lat: 17.411, lng: 78.505, createdAt: new Date(now - 3 * 3600000).toISOString(), status: "Pending", allocated: {} }
    ],
    depots: [
      { id: "demo-d1", name: "Central Relief Warehouse", location: "Abids", lat: 17.385, lng: 78.4867, inventory: { food: 150, water: 500, medicine: 30, ambulances: 3, boats: 2 } },
      { id: "demo-d2", name: "North Depot", location: "Secunderabad", lat: 17.4399, lng: 78.4983, inventory: { food: 80, water: 200, medicine: 15, ambulances: 1, boats: 0 } },
      { id: "demo-d3", name: "South Depot", location: "Mehdipatnam", lat: 17.3949, lng: 78.4432, inventory: { food: 100, water: 300, medicine: 10, ambulances: 2, boats: 3 } }
    ],
    shelters: [
      { id: "demo-s1", name: "Musi Community Relief Centre", location: "Chaderghat", capacity: 180, occupancy: 92, lat: 17.374, lng: 78.492 },
      { id: "demo-s2", name: "Secunderabad School Shelter", location: "Secunderabad", capacity: 120, occupancy: 67, lat: 17.439, lng: 78.501 }
    ],
    activity: [
      { id: "demo-a1", message: "Hyderabad demo response network loaded. Review incidents and run allocation.", createdAt: new Date(now - 5 * 60000).toISOString() }
    ]
  };
}

/**
 * Creates a collision-resistant identifier for a new local record.
 * @param {string} prefix Short record type prefix.
 * @returns {string}
 */
export function createId(prefix) {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Records a timestamped activity message and keeps the log to its latest 40 entries.
 * @param {{activity: Object[]}} state Current application state.
 * @param {string} message Message describing the user action.
 * @returns {void}
 */
export function addActivity(state, message) {
  state.activity.unshift({ id: createId("activity"), message, createdAt: new Date().toISOString() });
  state.activity = state.activity.slice(0, 40);
}
