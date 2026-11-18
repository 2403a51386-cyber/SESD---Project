import { RESOURCE_KEYS, RESOURCE_SHORT_LABELS } from "./data.js";

/**
 * Calculates the resource requirements for one incident, rounding fractional kits up.
 * @param {Object} incident Incident report.
 * @returns {Record<string, number>}
 */
export function getIncidentNeeds(incident) {
  const people = Math.max(0, Number(incident.people) || 0);
  return {
    food: people,
    water: people * 3,
    medicine: Math.ceil(people / 5),
    ambulances: incident.severity >= 4 ? Math.ceil(people / 15) : 0,
    boats: incident.type.toLowerCase() === "flood" ? Math.ceil(people / 10) : 0
  };
}

/**
 * Calculates great-circle distance between two latitude/longitude points in kilometres.
 * @param {number} lat1 First latitude.
 * @param {number} lon1 First longitude.
 * @param {number} lat2 Second latitude.
 * @param {number} lon2 Second longitude.
 * @returns {number}
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(lat2 - lat1);
  const longitudeDelta = radians(lon2 - lon1);
  const value = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) *
    Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

/**
 * Allocates available supplies in priority order, taking each resource from nearest depots first.
 * Existing allocations are preserved and only outstanding needs are requested.
 * @param {{incidents: Object[], depots: Object[]}} state Current application state.
 * @returns {Object[]} Ranked incident queue with needs and dispatch results.
 */
export function runAllocation(state) {
  const queue = state.incidents
    .map((incident) => ({ incident, score: incident.severity * incident.people }))
    .sort((left, right) => right.score - left.score || left.incident.createdAt.localeCompare(right.incident.createdAt));

  for (const entry of queue) {
    const incident = entry.incident;
    incident.allocated = incident.allocated || {};
    entry.needs = getIncidentNeeds(incident);
    entry.dispatch = {};
    entry.depotDispatches = [];
    entry.fulfilled = true;
    if (incident.status === "Resolved") {
      entry.fulfilled = true;
      continue;
    }

    const sources = [...state.depots].map((depot) => ({
      depot,
      distanceKm: haversineDistance(incident.lat, incident.lng, depot.lat, depot.lng)
    })).sort((a, b) => a.distanceKm - b.distanceKm);

    for (const key of RESOURCE_KEYS) {
      const required = entry.needs[key];
      const alreadyAllocated = Math.max(0, Number(incident.allocated[key]) || 0);
      let outstanding = Math.max(0, required - alreadyAllocated);
      for (const source of sources) {
        const { depot, distanceKm } = source;
        const available = Math.max(0, Number(depot.inventory[key]) || 0);
        const amount = Math.min(available, outstanding);
        if (amount > 0) {
          depot.inventory[key] -= amount;
          incident.allocated[key] = (Number(incident.allocated[key]) || 0) + amount;
          incident.allocationsByDepot = incident.allocationsByDepot || {};
          incident.allocationsByDepot[depot.id] = incident.allocationsByDepot[depot.id] || {};
          incident.allocationsByDepot[depot.id][key] =
            (Number(incident.allocationsByDepot[depot.id][key]) || 0) + amount;
          entry.dispatch[key] = (entry.dispatch[key] || 0) + amount;
          let depotDispatch = entry.depotDispatches.find((item) => item.depotId === depot.id);
          if (!depotDispatch) {
            depotDispatch = { depotId: depot.id, depotName: depot.name, distanceKm, resources: {} };
            entry.depotDispatches.push(depotDispatch);
          }
          depotDispatch.resources[key] = (depotDispatch.resources[key] || 0) + amount;
          outstanding -= amount;
        }
        if (outstanding === 0) break;
      }
      if (outstanding > 0) entry.fulfilled = false;
    }
    const allocatedAny = RESOURCE_KEYS.some((key) => (Number(incident.allocated[key]) || 0) > 0);
    incident.status = entry.fulfilled ? "Allocated" : allocatedAny ? "Partial" : "Pending";
  }

  return queue;
}

/**
 * Returns an incident's allocated supplies to their source depots.
 * Legacy allocations without source records are returned to the nearest depot.
 * @param {Object} incident Incident being cancelled.
 * @param {{depots: Object[]}} state Current application state.
 * @returns {void}
 * @throws {Error} When allocated stock cannot be returned to an available depot.
 */
export function returnIncidentAllocations(incident, state) {
  const plan = new Map();
  const trackedTotals = {};
  const addToPlan = (depot, key, amount) => {
    if (!plan.has(depot.id)) plan.set(depot.id, {});
    const inventory = plan.get(depot.id);
    inventory[key] = (inventory[key] || 0) + amount;
  };

  for (const [depotId, allocations] of Object.entries(incident.allocationsByDepot || {})) {
    for (const key of RESOURCE_KEYS) {
      const amount = Math.max(0, Number(allocations?.[key]) || 0);
      if (!amount) continue;
      const depot = state.depots.find((item) => item.id === depotId);
      if (!depot) throw new Error("Cannot return allocated stock because its source depot is no longer available.");
      addToPlan(depot, key, amount);
      trackedTotals[key] = (trackedTotals[key] || 0) + amount;
    }
  }

  const legacyAmounts = RESOURCE_KEYS.map((key) => ({
    key,
    amount: Math.max(0, (Number(incident.allocated?.[key]) || 0) - (trackedTotals[key] || 0))
  })).filter((item) => item.amount > 0);
  if (legacyAmounts.length && state.depots.length === 0) {
    throw new Error("Cannot return allocated stock because no source depots are available.");
  }
  if (legacyAmounts.length) {
    const nearestDepot = [...state.depots].sort((a, b) =>
      haversineDistance(incident.lat, incident.lng, a.lat, a.lng) -
      haversineDistance(incident.lat, incident.lng, b.lat, b.lng))[0];
    for (const { key, amount } of legacyAmounts) addToPlan(nearestDepot, key, amount);
  }

  for (const [depotId, allocations] of plan) {
    const depot = state.depots.find((item) => item.id === depotId);
    for (const [key, amount] of Object.entries(allocations)) {
      depot.inventory[key] = (Number(depot.inventory[key]) || 0) + amount;
    }
  }
}

/**
 * Produces readable requirement and fulfilment summaries for an incident.
 * @param {Object} incident Incident report.
 * @returns {{key: string, label: string, needed: number, allocated: number}[]}
 */
export function getAllocationSummary(incident) {
  const needs = getIncidentNeeds(incident);
  return RESOURCE_KEYS.filter((key) => needs[key] > 0).map((key) => ({
    key,
    label: RESOURCE_SHORT_LABELS[key],
    needed: needs[key],
    allocated: Math.min(needs[key], Number(incident.allocated?.[key]) || 0)
  }));
}
