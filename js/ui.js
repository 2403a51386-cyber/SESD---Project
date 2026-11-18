import { DEFAULT_MAP_LOCATION, RESOURCE_KEYS, RESOURCE_LABELS, RESOURCE_SHORT_LABELS } from "./data.js";
import { getAllocationSummary, getIncidentNeeds, haversineDistance } from "./allocation.js";

/** @type {Object|null} */
let dashboardMap = null;
/** @type {Object|null} */
let locationMap = null;
/** @type {Object|null} */
let dashboardLayer = null;
/** @type {Object|null} */
let locationMarker = null;
const managementMaps = new Map();
/** @type {Object|null} */
let incidentChart = null;
/** @type {Object|null} */
let stockChart = null;

/**
 * Escapes potentially unsafe text before inserting it into HTML.
 * @param {unknown} value User-controlled or data-derived value.
 * @returns {string}
 */
export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

/**
 * Formats a number with locale-aware digit grouping.
 * @param {number} value Number to format.
 * @returns {string}
 */
export function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

/**
 * Provides an accessible icon name for an incident type.
 * @param {string} type Disaster type.
 * @returns {string}
 */
function incidentIcon(type) {
  const icons = { Flood: "fa-water", Fire: "fa-fire", Earthquake: "fa-house-crack", Cyclone: "fa-wind", Landslide: "fa-mountain-sun", "Medical emergency": "fa-kit-medical" };
  return icons[type] || "fa-triangle-exclamation";
}

/**
 * Converts a stored ISO timestamp into a short readable date and time.
 * @param {string} timestamp ISO date string.
 * @returns {string}
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Updates the dashboard summary cards from current incidents and shelter capacity.
 * @param {Object} state Current application state.
 * @returns {void}
 */
function renderStats(state) {
  const active = state.incidents.filter((incident) => incident.status !== "Resolved");
  const people = state.incidents.reduce((sum, incident) => sum + Number(incident.people || 0), 0);
  const capacity = state.shelters.reduce((sum, shelter) => sum + Number(shelter.capacity || 0), 0);
  const occupancy = state.shelters.reduce((sum, shelter) => sum + Number(shelter.occupancy || 0), 0);
  document.getElementById("statActive").textContent = formatNumber(active.length);
  document.getElementById("statCritical").textContent = formatNumber(active.filter((incident) => incident.severity >= 4).length);
  document.getElementById("statPeople").textContent = formatNumber(people);
  document.getElementById("statResolved").textContent = formatNumber(state.incidents.filter((incident) => incident.status === "Resolved").length);
  document.getElementById("statOccupancy").textContent = `${capacity ? Math.round(occupancy / capacity * 100) : 0}%`;
}

/**
 * Creates dashboard and location picker maps if the Leaflet CDN is available.
 * @param {(latitude: number, longitude: number) => void} onLocationSelect Location selection callback.
 * @returns {void}
 */
export function initializeMaps(onLocationSelect) {
  if (!globalThis.L) {
    showToast("Map library unavailable. Check your internet connection and reload.", "error");
    return;
  }
  if (!dashboardMap) {
    dashboardMap = L.map("dashboardMap", { scrollWheelZoom: false }).setView(DEFAULT_MAP_LOCATION, 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(dashboardMap);
    dashboardLayer = L.layerGroup().addTo(dashboardMap);
  }
  if (!locationMap) {
    locationMap = L.map("locationMap").setView(DEFAULT_MAP_LOCATION, 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(locationMap);
    locationMap.on("click", (event) => {
      const { lat, lng } = event.latlng;
      if (locationMarker) locationMarker.setLatLng(event.latlng);
      else locationMarker = L.marker(event.latlng).addTo(locationMap);
      onLocationSelect(lat, lng);
    });
  }
  refreshMapSize();
}

/**
 * Refreshes Leaflet dimensions after a page becomes visible.
 * @returns {void}
 */
export function refreshMapSize() {
  window.setTimeout(() => {
    if (dashboardMap) dashboardMap.invalidateSize();
    if (locationMap) locationMap.invalidateSize();
    managementMaps.forEach((map) => map.invalidateSize());
  }, 80);
}

/**
 * Initializes a reusable click-to-pin map inside a management dialog.
 * @param {string} elementId Map container identifier.
 * @param {(latitude: number, longitude: number) => void} onLocationSelect Location callback.
 * @returns {void}
 */
export function initializePickerMap(elementId, onLocationSelect) {
  if (!globalThis.L) {
    showToast("Map library unavailable. Check your internet connection and reload.", "error");
    return;
  }
  let picker = managementMaps.get(elementId);
  if (!picker) {
    const map = L.map(elementId).setView(DEFAULT_MAP_LOCATION, 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);
    picker = { map, marker: null, onLocationSelect };
    map.on("click", (event) => {
      const { lat, lng } = event.latlng;
      if (picker.marker) picker.marker.setLatLng(event.latlng);
      else picker.marker = L.marker(event.latlng).addTo(map);
      picker.onLocationSelect(lat, lng);
    });
    managementMaps.set(elementId, picker);
  } else {
    picker.onLocationSelect = onLocationSelect;
    if (picker.marker) {
      picker.map.removeLayer(picker.marker);
      picker.marker = null;
    }
    picker.map.setView(DEFAULT_MAP_LOCATION, 11);
  }
  window.setTimeout(() => picker.map.invalidateSize(), 80);
}

/**
 * Refreshes incident, depot and shelter markers on the dashboard map.
 * @param {Object} state Current application state.
 * @returns {void}
 */
function renderMap(state) {
  if (!dashboardLayer || !globalThis.L) return;
  dashboardLayer.clearLayers();
  for (const incident of state.incidents) {
    const radius = 7 + incident.severity * 2;
    const marker = L.circleMarker([incident.lat, incident.lng], {
      radius, color: "#ffffff", weight: 2, fillColor: incident.status === "Resolved" ? "#2A9D8F" : "#E63946", fillOpacity: .88
    }).bindPopup(`<strong>${escapeHTML(incident.type)}</strong><br>Severity ${escapeHTML(incident.severity)} · ${formatNumber(incident.people)} people<br>${escapeHTML(incident.status)}`);
    marker.addTo(dashboardLayer);
  }
  for (const depot of state.depots) {
    L.circleMarker([depot.lat, depot.lng], { radius: 7, color: "#fff", weight: 2, fillColor: "#3A86FF", fillOpacity: .95 })
      .bindPopup(`<strong>${escapeHTML(depot.name)}</strong><br>Resource depot`).addTo(dashboardLayer);
  }
  for (const shelter of state.shelters) {
    L.circleMarker([shelter.lat, shelter.lng], { radius: 7, color: "#fff", weight: 2, fillColor: "#2A9D8F", fillOpacity: .95 })
      .bindPopup(`<strong>${escapeHTML(shelter.name)}</strong><br>${formatNumber(shelter.occupancy)} / ${formatNumber(shelter.capacity)} occupants`).addTo(dashboardLayer);
  }
}

/**
 * Draws the incident-type doughnut and stock bar charts.
 * @param {Object} state Current application state.
 * @returns {void}
 */
function renderCharts(state) {
  if (!globalThis.Chart) {
    showToast("Chart library unavailable. Check your internet connection and reload.", "error");
    return;
  }
  const incidentCounts = state.incidents.reduce((counts, incident) => {
    counts[incident.type] = (counts[incident.type] || 0) + 1;
    return counts;
  }, {});
  const incidentCanvas = document.getElementById("incidentChart");
  const incidentEmpty = document.getElementById("incidentChartEmpty");
  const hasIncidents = Object.keys(incidentCounts).length > 0;
  incidentCanvas.style.display = hasIncidents ? "block" : "none";
  incidentEmpty.classList.toggle("visible", !hasIncidents);
  if (incidentChart) incidentChart.destroy();
  if (hasIncidents) {
    incidentChart = new Chart(incidentCanvas, {
      type: "doughnut",
      data: { labels: Object.keys(incidentCounts), datasets: [{ data: Object.values(incidentCounts), backgroundColor: ["#E63946", "#F4A261", "#3A86FF", "#2A9D8F", "#8466D7", "#51b5d5", "#ef6cb1"], borderWidth: 0, hoverOffset: 5 }] },
      options: { maintainAspectRatio: false, cutout: "70%", plugins: { legend: { position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 7, padding: 14, font: { size: 9, family: "Inter" } } } } }
    });
  }

  const stockTotals = RESOURCE_KEYS.map((key) => state.depots.reduce((sum, depot) => sum + (Number(depot.inventory[key]) || 0), 0));
  const stockCanvas = document.getElementById("stockChart");
  const stockEmpty = document.getElementById("stockChartEmpty");
  const hasStock = state.depots.length > 0;
  stockCanvas.style.display = hasStock ? "block" : "none";
  stockEmpty.classList.toggle("visible", !hasStock);
  if (stockChart) stockChart.destroy();
  if (hasStock) {
    stockChart = new Chart(stockCanvas, {
      type: "bar",
      data: { labels: RESOURCE_KEYS.map((key) => RESOURCE_SHORT_LABELS[key]), datasets: [{ data: stockTotals, backgroundColor: ["#3A86FF", "#52a4f5", "#F4A261", "#2A9D8F", "#8466D7"], borderRadius: 5, maxBarThickness: 29 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 8, family: "Inter" } } }, y: { beginAtZero: true, grid: { color: "rgba(130,145,165,.13)" }, ticks: { font: { size: 8, family: "Inter" } } } } }
    });
  }
}

/**
 * Renders the dashboard's latest incidents table and empty state.
 * @param {Object} state Current application state.
 * @returns {void}
 */
function renderRecent(state) {
  const rows = document.getElementById("recentIncidents");
  const empty = document.getElementById("recentEmpty");
  const incidents = [...state.incidents].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  rows.innerHTML = incidents.map((incident) => `<tr>
    <td><span class="incident-name"><span class="incident-type-icon"><i class="fa-solid ${incidentIcon(incident.type)}"></i></span>${escapeHTML(incident.type)}</span></td>
    <td><span class="badge ${incident.severity >= 4 ? "badge-partial" : "badge-pending"}">Level ${escapeHTML(incident.severity)}</span></td>
    <td>${formatNumber(incident.people)}</td>
    <td><span class="badge badge-${incident.status.toLowerCase()}">${escapeHTML(incident.status)}</span></td>
  </tr>`).join("");
  empty.classList.toggle("visible", incidents.length === 0);
}

/**
 * Renders the ranked allocation queue with resource needs and incident actions.
 * @param {Object} state Current application state.
 * @param {Object[]} queue Ranked queue entries.
 * @param {string} role Current user role.
 * @returns {void}
 */
function renderQueue(state, queue, role) {
  const container = document.getElementById("allocationQueue");
  const empty = document.getElementById("queueEmpty");
  document.getElementById("queueCount").textContent = formatNumber(queue.filter((entry) => entry.incident.status !== "Resolved").length);
  document.getElementById("queueCritical").textContent = formatNumber(queue.filter((entry) => entry.incident.status !== "Resolved" && entry.incident.severity >= 4).length);
  document.getElementById("queueReady").textContent = formatNumber(queue.filter((entry) => entry.incident.status === "Allocated").length);
  container.innerHTML = queue.map((entry, index) => {
    const incident = entry.incident;
    const summaries = getAllocationSummary(incident);
    const needs = summaries.map((item) => `<span class="need-chip">${escapeHTML(item.label)} <strong>${formatNumber(item.allocated)}</strong><em> / ${formatNumber(item.needed)}</em></span>`).join("");
    const canResolve = ["admin", "rescue"].includes(role) && incident.status !== "Resolved";
    const canCancel = role === "admin";
    const actions = canResolve || canCancel
      ? `<div class="queue-actions">${canResolve ? `<button class="button button-outline button-small" data-action="resolve" data-id="${escapeHTML(incident.id)}"><i class="fa-solid fa-check"></i> Mark resolved</button>` : ""}${canCancel ? `<button class="button button-danger button-small" data-action="cancel-incident" data-id="${escapeHTML(incident.id)}"><i class="fa-solid fa-xmark"></i> Cancel incident</button>` : ""}</div>`
      : `<small>${escapeHTML(incident.description)}</small>`;
    const depotAllocations = Object.entries(incident.allocationsByDepot || {}).filter(([, resources]) =>
      Object.values(resources).some((amount) => Number(amount) > 0));
    const sourceDetails = depotAllocations.map(([depotId, resources]) => {
      const depot = state.depots.find((item) => item.id === depotId);
      if (!depot) return `<span class="source-chip">Source depot unavailable</span>`;
      const distance = haversineDistance(incident.lat, incident.lng, depot.lat, depot.lng);
      const supplied = RESOURCE_KEYS.filter((key) => Number(resources[key]) > 0)
        .map((key) => `${escapeHTML(RESOURCE_SHORT_LABELS[key])} ${formatNumber(resources[key])}`).join(", ");
      return `<span class="source-chip">${escapeHTML(depot.name)} · ${distance.toFixed(1)} km — ${supplied}</span>`;
    }).join("");
    return `<article class="queue-item">
      <div class="queue-top"><div class="queue-title"><span class="priority-rank">${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHTML(incident.type)} · ${formatNumber(incident.people)} people affected</strong><small>Severity ${escapeHTML(incident.severity)} / 5 · Reported ${escapeHTML(formatTime(incident.createdAt))}</small></div></div><div class="priority-score"><small>PRIORITY SCORE</small>${formatNumber(entry.score)}</div></div>
      <div class="queue-needs">${needs}</div>
      ${sourceDetails ? `<div class="queue-sources"><strong>Supplied by</strong>${sourceDetails}</div>` : ""}
      <div class="queue-bottom"><span class="badge badge-${incident.status.toLowerCase()}">${escapeHTML(incident.status)}</span>${actions}</div>
    </article>`;
  }).join("");
  empty.classList.toggle("visible", state.incidents.length === 0);
}

/**
 * Renders recent dispatch activity.
 * @param {Object} state Current application state.
 * @returns {void}
 */
function renderActivity(state) {
  const container = document.getElementById("activityLog");
  container.innerHTML = state.activity.map((item) => `<div class="activity-row"><span><i class="fa-solid fa-circle-check" style="color:#2A9D8F;margin-right:8px"></i>${escapeHTML(item.message)}</span><time>${escapeHTML(formatTime(item.createdAt))}</time></div>`).join("");
  document.getElementById("activityEmpty").classList.toggle("visible", state.activity.length === 0);
}

/**
 * Renders total resource stock and per-depot inventory rows.
 * @param {Object} state Current application state.
 * @returns {void}
 */
function renderDepots(state) {
  const totals = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, state.depots.reduce((sum, depot) => sum + (Number(depot.inventory[key]) || 0), 0)]));
  document.getElementById("resourceOverview").innerHTML = RESOURCE_KEYS.map((key) => `<div class="resource-tile"><i class="fa-solid ${key === "food" ? "fa-wheat-awn" : key === "water" ? "fa-droplet" : key === "medicine" ? "fa-kit-medical" : key === "ambulances" ? "fa-truck-medical" : "fa-ship"}"></i><span>${escapeHTML(RESOURCE_LABELS[key])}</span><strong>${formatNumber(totals[key])}</strong></div>`).join("");
  const rows = document.getElementById("depotRows");
  rows.innerHTML = state.depots.map((depot) => `<tr>
    <td><span class="incident-name"><span class="incident-type-icon" style="color:#3A86FF;background:#edf4ff"><i class="fa-solid fa-warehouse"></i></span>${escapeHTML(depot.name)}</span></td>
    <td class="muted-cell">${escapeHTML(depot.location)}</td>
    ${RESOURCE_KEYS.map((key) => `<td>${formatNumber(depot.inventory[key])}</td>`).join("")}
    <td><button class="table-action admin-only" data-action="restock" data-id="${escapeHTML(depot.id)}">Restock</button><button class="table-action danger admin-only" data-action="remove-depot" data-id="${escapeHTML(depot.id)}" aria-label="Remove ${escapeHTML(depot.name)}">Remove</button></td>
  </tr>`).join("");
  document.getElementById("depotEmpty").classList.toggle("visible", state.depots.length === 0);
}

/**
 * Renders shelter capacity cards, occupancy controls and aggregate totals.
 * @param {Object} state Current application state.
 * @param {string} role Current user role.
 * @returns {void}
 */
function renderShelters(state, role) {
  const occupancy = state.shelters.reduce((sum, shelter) => sum + Number(shelter.occupancy), 0);
  const capacity = state.shelters.reduce((sum, shelter) => sum + Number(shelter.capacity), 0);
  const available = Math.max(0, capacity - occupancy);
  document.getElementById("shelterSummary").innerHTML = `<span class="summary-pill">Camps<strong>${formatNumber(state.shelters.length)}</strong></span><span class="summary-pill">People sheltered<strong>${formatNumber(occupancy)}</strong></span><span class="summary-pill">Open capacity<strong>${formatNumber(available)}</strong></span>`;
  document.getElementById("shelterGrid").innerHTML = state.shelters.map((shelter) => {
    const percent = shelter.capacity ? Math.min(100, Math.round(shelter.occupancy / shelter.capacity * 100)) : 0;
    const isFull = shelter.occupancy >= shelter.capacity;
    const canUpdateOccupancy = ["admin", "rescue"].includes(role);
    return `<article class="card shelter-card"><div class="shelter-card-top"><div style="display:flex;gap:11px;align-items:center"><span class="shelter-avatar"><i class="fa-solid fa-house-medical"></i></span><div><h3>${escapeHTML(shelter.name)}</h3><p><i class="fa-solid fa-location-dot"></i> ${escapeHTML(shelter.location)}</p></div></div><span class="badge ${isFull ? "badge-partial" : "badge-resolved"}">${isFull ? "Full" : "Open"}</span></div>
    <div class="capacity-number"><span>Capacity used</span><strong>${formatNumber(shelter.occupancy)} / ${formatNumber(shelter.capacity)}</strong></div><div class="progress-track" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHTML(shelter.name)} occupancy"><div class="progress-fill ${isFull ? "full" : ""}" style="width:${percent}%"></div></div><span class="capacity-caption">${percent}% occupied · ${formatNumber(Math.max(0, shelter.capacity - shelter.occupancy))} places available</span>
    ${canUpdateOccupancy ? `<div class="shelter-actions"><span>Update occupancy <small>(10 people)</small></span><div class="stepper"><button data-action="occupancy" data-delta="-10" data-id="${escapeHTML(shelter.id)}" aria-label="Decrease occupancy" ${shelter.occupancy === 0 ? "disabled" : ""}>−</button><button data-action="occupancy" data-delta="10" data-id="${escapeHTML(shelter.id)}" aria-label="Increase occupancy" ${isFull ? "disabled" : ""}>+</button></div></div>` : ""}</article>`;
  }).join("");
  document.getElementById("shelterEmpty").classList.toggle("visible", state.shelters.length === 0);
}

/**
 * Updates navigation visibility, controls and role-specific actions.
 * @param {string} role Current role identifier.
 * @returns {void}
 */
export function applyRole(role) {
  document.querySelectorAll("[data-roles]").forEach((element) => {
    element.hidden = !element.dataset.roles.split(",").includes(role);
  });
  document.querySelectorAll(".admin-only").forEach((element) => { element.hidden = role !== "admin"; });
}

const ROLE_PAGES = {
  dashboard: ["admin", "rescue", "citizen"],
  report: ["admin", "citizen"],
  allocation: ["admin", "rescue"],
  resources: ["admin"],
  shelters: ["admin", "rescue", "citizen"]
};

/**
 * Checks whether a role may open a page.
 * @param {string} role Role identifier.
 * @param {string} page Page identifier.
 * @returns {boolean}
 */
export function canAccessPage(role, page) {
  return Boolean(ROLE_PAGES[page]?.includes(role));
}

/**
 * Returns the currently displayed page identifier.
 * @returns {string}
 */
function getCurrentPage() {
  return document.querySelector(".page.active")?.id.replace("page-", "") || "dashboard";
}

/**
 * Shows the requested page and updates active navigation and breadcrumb state.
 * @param {string} page Page identifier.
 * @returns {void}
 */
export function showPage(page) {
  const target = document.getElementById(`page-${page}`);
  if (!target || target.hidden) return;
  document.querySelectorAll(".page").forEach((element) => element.classList.toggle("active", element === target));
  document.querySelectorAll(".nav-link").forEach((element) => element.classList.toggle("active", element.dataset.page === page));
  const nav = document.querySelector(`.nav-link[data-page="${page}"]`);
  document.getElementById("currentPageLabel").textContent = nav?.querySelector("span")?.textContent || "Dashboard";
  document.body.classList.remove("sidebar-open");
  refreshMapSize();
}

/**
 * Displays a transient accessible toast notification.
 * @param {string} message Notification message.
 * @param {"success"|"error"|"warning"} [kind="success"] Notification severity.
 * @returns {void}
 */
export function showToast(message, kind = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  const icon = document.createElement("i");
  icon.className = `fa-solid ${kind === "error" ? "fa-circle-exclamation" : kind === "warning" ? "fa-triangle-exclamation" : "fa-circle-check"}`;
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = message;
  toast.append(icon, text);
  const region = document.getElementById("toastRegion");
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

/**
 * Renders all application views from the latest state.
 * @param {Object} state Current application state.
 * @param {Object[]} queue Current ranked allocation queue.
 * @param {string} role Current role identifier.
 * @returns {void}
 */
export function renderApp(state, queue, role) {
  renderStats(state);
  renderMap(state);
  renderCharts(state);
  renderRecent(state);
  renderQueue(state, queue, role);
  renderActivity(state);
  renderDepots(state);
  renderShelters(state, role);
}

/**
 * Updates the selected map pin marker after programmatic location changes.
 * @param {number} latitude Latitude value.
 * @param {number} longitude Longitude value.
 * @returns {void}
 */
export function setLocationMarker(latitude, longitude) {
  if (!locationMap || !globalThis.L) return;
  const point = [latitude, longitude];
  if (locationMarker) locationMarker.setLatLng(point);
  else locationMarker = L.marker(point).addTo(locationMap);
  locationMap.setView(point, Math.max(locationMap.getZoom(), 12));
}

/**
 * Removes the report form's selected marker after submission/reset.
 * @returns {void}
 */
export function clearLocationMarker() {
  if (!locationMap || !locationMarker) return;
  locationMap.removeLayer(locationMarker);
  locationMarker = null;
}

/**
 * Returns a concise description of the current inventory totals for tooltips or notices.
 * @param {Object} incident Incident report.
 * @returns {string}
 */
export function describeNeeds(incident) {
  const needs = getIncidentNeeds(incident);
  return RESOURCE_KEYS.filter((key) => needs[key] > 0).map((key) => `${formatNumber(needs[key])} ${RESOURCE_SHORT_LABELS[key]}`).join(", ");
}
