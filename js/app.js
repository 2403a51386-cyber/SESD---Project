import { addActivity, createDemoState, createId, loadState, RESOURCE_KEYS, RESOURCE_LABELS, saveState } from "./data.js";
import { returnIncidentAllocations, runAllocation } from "./allocation.js";
import { applyRole, canAccessPage, clearLocationMarker, initializeMaps, initializePickerMap, renderApp, showPage, showToast } from "./ui.js";

const ROLE_LABELS = { admin: "Admin", rescue: "Rescue Team", citizen: "Citizen" };
const ROLE_USERS = {
  admin: { name: "System Admin", role: "admin" },
  rescue: { name: "Rescue Team", role: "rescue" },
  citizen: { name: "Community Citizen", role: "citizen" }
};
const ACTION_ROLES = {
  report: ["admin", "citizen"],
  allocate: ["admin", "rescue"],
  resolve: ["admin", "rescue"],
  cancel: ["admin"],
  manageDepots: ["admin"],
  manageShelters: ["admin"],
  occupancy: ["admin", "rescue"],
  demo: ["admin"]
};

let state;
let currentUser = null;
let selectedLocation = null;
let managementLocation = null;
let managementKind = "";
let managementDepotId = "";
let mapsInitialized = false;
let queue = [];

/**
 * Returns the active workspace role.
 * @returns {string} Role identifier, or an empty string before role selection.
 */
function currentRole() {
  return currentUser?.role || "";
}

/**
 * Persists the latest state and refreshes the visible application.
 * @returns {void}
 */
function persistAndRender() {
  saveState(state);
  if (currentUser) renderApp(state, queue, currentRole());
}

/**
 * Checks a role against an action's allowlist and reports denied access.
 * @param {string[]} roles Allowed role identifiers.
 * @returns {boolean} Whether the current role may perform the action.
 */
function requireRoles(roles) {
  if (currentUser && roles.includes(currentRole())) return true;
  showToast("You do not have permission", "error");
  return false;
}

/**
 * Builds a priority-sorted queue without changing inventory.
 * @param {Object} appState Current application state.
 * @returns {Object[]} Ranked incident queue entries.
 */
function runAllocationPreview(appState) {
  return appState.incidents
    .map((incident) => ({ incident, score: incident.severity * incident.people }))
    .sort((left, right) => right.score - left.score || left.incident.createdAt.localeCompare(right.incident.createdAt));
}

/**
 * Displays an inline validation message.
 * @param {string} elementId Error element identifier.
 * @param {string} message Message to display.
 * @returns {void}
 */
function setInlineError(elementId, message) {
  document.getElementById(elementId).textContent = message;
}

/**
 * Clears inline validation messages within a form.
 * @param {Element} container Form or section containing validation messages.
 * @returns {void}
 */
function clearErrors(container) {
  container.querySelectorAll(".inline-error").forEach((element) => { element.textContent = ""; });
}

/**
 * Formats a user-entered name in title case while preserving hyphenated words.
 * @param {string} value Raw name.
 * @returns {string} Normalized name.
 */
function formatName(value) {
  return value.trim().split(/\s+/).filter(Boolean).map((word) =>
    word.split("-").map((part) => part ? `${part[0].toLocaleUpperCase()}${part.slice(1).toLocaleLowerCase()}` : "").join("-")
  ).join(" ");
}

/**
 * Refreshes the signed-in user's name, role and avatar initials.
 * @returns {void}
 */
function updateHeader() {
  document.getElementById("headerName").textContent = currentUser.name;
  document.getElementById("headerRole").textContent = ROLE_LABELS[currentRole()];
  const initials = currentUser.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase();
  document.querySelector(".avatar").textContent = initials;
}

/**
 * Enters a selected role's workspace and initializes maps and rendered views.
 * @param {string} role Role identifier.
 * @returns {void}
 */
function initializeWorkspace(role) {
  if (!ROLE_USERS[role]) return;
  currentUser = ROLE_USERS[role];
  document.getElementById("roleSelection").hidden = true;
  document.getElementById("appShell").hidden = false;
  updateHeader();
  applyRole(currentRole());
  showPage("dashboard");
  if (!mapsInitialized) {
    initializeMaps(selectIncidentLocation);
    mapsInitialized = true;
  }
  queue = runAllocationPreview(state);
  renderApp(state, queue, currentRole());
}

/**
 * Returns to the role selection screen without discarding saved data.
 * @returns {void}
 */
function returnToRoleSelection() {
  currentUser = null;
  document.getElementById("appShell").hidden = true;
  document.getElementById("roleSelection").hidden = false;
  document.body.classList.remove("sidebar-open");
}

/**
 * Opens a native confirmation dialog, with a browser fallback where unsupported.
 * @param {string} title Dialog heading.
 * @param {string} message Confirmation details.
 * @param {string} [confirmLabel="Confirm"] Confirmation button label.
 * @returns {Promise<boolean>} Whether the user confirmed.
 */
function confirmAction(title, message, confirmLabel = "Confirm") {
  const dialog = document.getElementById("appDialog");
  document.getElementById("dialogTitle").textContent = title;
  document.getElementById("dialogMessage").textContent = message;
  document.getElementById("dialogConfirm").textContent = confirmLabel;
  if (typeof dialog.showModal !== "function") return Promise.resolve(window.confirm(message));
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
  });
}

/**
 * Navigates to a page only when the current role has access.
 * @param {string} page Page identifier.
 * @returns {void}
 */
function navigateTo(page) {
  if (!currentUser) return;
  if (!canAccessPage(currentRole(), page)) {
    showPage("dashboard");
    showToast("You do not have permission", "error");
    return;
  }
  showPage(page);
}

/**
 * Validates and stores a new incident report submitted from the form.
 * @param {SubmitEvent} event Form submit event.
 * @returns {void}
 */
function submitIncident(event) {
  event.preventDefault();
  if (!requireRoles(ACTION_ROLES.report)) return;
  const form = event.currentTarget;
  clearErrors(form);
  const type = document.getElementById("incidentType").value;
  const severity = Number(document.getElementById("incidentSeverity").value);
  const rawPeople = document.getElementById("peopleAffected").value.trim();
  const people = Number(rawPeople);
  const description = document.getElementById("incidentDescription").value.trim();
  let valid = true;
  if (!Number.isSafeInteger(people) || people < 1) {
    setInlineError("peopleError", "Enter a whole number of people (at least 1).");
    valid = false;
  }
  if (!selectedLocation) {
    setInlineError("incidentLocationError", "Click the map to pin the incident location.");
    valid = false;
  }
  if (!type || !Number.isInteger(severity) || severity < 1 || severity > 5 || !description) {
    setInlineError("incidentFormError", "Choose a disaster type and severity, and enter a description.");
    valid = false;
  }
  if (!valid) return;
  const incident = {
    id: createId("incident"), type, severity, people, description,
    lat: selectedLocation.lat, lng: selectedLocation.lng,
    createdAt: new Date().toISOString(), status: "Pending", allocated: {}
  };
  state.incidents.push(incident);
  addActivity(state, `New ${type.toLowerCase()} incident reported (${people} people affected).`);
  queue = runAllocationPreview(state);
  persistAndRender();
  form.reset();
  selectedLocation = null;
  clearLocationMarker();
  document.getElementById("selectedLocation").textContent = "Click on the map to pin a location";
  showToast("Incident report submitted and added to the response queue.");
  showPage("dashboard");
}

/**
 * Runs the allocation algorithm and records each depot dispatch in the activity log.
 * @returns {void}
 */
function handleRunAllocation() {
  if (!requireRoles(ACTION_ROLES.allocate)) return;
  if (!state.incidents.some((incident) => incident.status !== "Resolved")) {
    showToast("There are no active incidents to allocate resources to.", "warning");
    return;
  }
  if (state.depots.length === 0) {
    showToast("Add a resource depot or load demo data before running allocation.", "error");
    return;
  }
  queue = runAllocation(state);
  const allocatedCount = queue.filter((entry) => entry.incident.status === "Allocated").length;
  const partialCount = queue.filter((entry) => entry.incident.status === "Partial").length;
  let dispatchCount = 0;
  for (const entry of queue) {
    for (const depot of entry.depotDispatches || []) {
      const supplied = RESOURCE_KEYS.filter((key) => depot.resources[key] > 0)
        .map((key) => formatDispatchAmount(key, depot.resources[key])).join(", ");
      addActivity(state, `${entry.incident.type}: ${depot.depotName} (${depot.distanceKm.toFixed(1)} km) supplied ${supplied}.`);
      dispatchCount += 1;
    }
  }
  if (!dispatchCount) addActivity(state, `Allocation run complete: ${allocatedCount} fully allocated, ${partialCount} partially supplied.`);
  persistAndRender();
  showToast(`Allocation complete: ${allocatedCount} allocated, ${partialCount} partial.`);
}

/**
 * Formats a dispatched resource amount with readable singular and plural units.
 * @param {string} key Resource identifier.
 * @param {number} amount Amount dispatched.
 * @returns {string} Human-readable quantity and resource name.
 */
function formatDispatchAmount(key, amount) {
  if (key === "ambulances") return `${amount} ${amount === 1 ? "ambulance" : "ambulances"}`;
  if (key === "boats") return `${amount} ${amount === 1 ? "boat" : "boats"}`;
  if (key === "water") return `${amount} litres of water`;
  if (key === "food") return `${amount} food portions`;
  if (key === "medicine") return `${amount} medicine kits`;
  return `${amount} ${RESOURCE_LABELS[key].toLowerCase()}`;
}

/**
 * Confirms and marks an active incident as resolved.
 * @param {string} incidentId Incident identifier.
 * @returns {Promise<void>}
 */
async function resolveIncident(incidentId) {
  if (!requireRoles(ACTION_ROLES.resolve)) return;
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) {
    showToast("Incident could not be found.", "error");
    return;
  }
  if (incident.status === "Resolved") return;
  if (!await confirmAction("Resolve this incident?", `Mark the ${incident.type.toLowerCase()} incident as resolved?`, "Mark resolved")) return;
  incident.status = "Resolved";
  addActivity(state, `${incident.type} incident marked as resolved.`);
  queue = runAllocationPreview(state);
  persistAndRender();
  showToast("Incident marked as resolved.");
}

/**
 * Confirms incident cancellation and returns its supplies to their source depots.
 * @param {string} incidentId Incident identifier.
 * @returns {Promise<void>}
 */
async function cancelIncident(incidentId) {
  if (!requireRoles(ACTION_ROLES.cancel)) return;
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) {
    showToast("Incident could not be found.", "error");
    return;
  }
  if (!await confirmAction("Cancel this incident?", `Cancel the ${incident.type.toLowerCase()} incident and return its allocated supplies?`, "Cancel incident")) return;
  try {
    returnIncidentAllocations(incident, state);
  } catch (error) {
    showToast(error.message || "Allocated stock could not be returned.", "error");
    return;
  }
  state.incidents = state.incidents.filter((item) => item.id !== incidentId);
  addActivity(state, "Incident cancelled");
  queue = runAllocationPreview(state);
  persistAndRender();
  showToast("Incident cancelled and allocated stock returned.");
}

/**
 * Configures and opens the add-depot, add-shelter or restock dialog.
 * @param {"depot"|"shelter"|"restock"} kind Management operation.
 * @param {string} [depotId=""] Target depot for restocking.
 * @returns {void}
 */
function setManagementMode(kind, depotId = "") {
  managementKind = kind;
  managementDepotId = depotId;
  managementLocation = null;
  const form = document.getElementById("managementForm");
  clearErrors(form);
  form.reset();
  const isRestock = kind === "restock";
  document.getElementById("locationFields").hidden = isRestock;
  document.getElementById("restockFields").hidden = !isRestock;
  document.getElementById("managementTitle").textContent = kind === "depot" ? "Add resource depot" : kind === "shelter" ? "Add relief shelter" : "Restock depot";
  document.getElementById("managementCoordinates").textContent = "Click on the map to set a location.";
  document.getElementById("managementDescription").textContent = isRestock
    ? `Add inventory at ${state.depots.find((depot) => depot.id === depotId)?.name || "this depot"}.`
    : "Enter details and click the map to set coordinates.";
  document.getElementById("capacityField").hidden = kind !== "shelter";
  document.getElementById("inventoryFields").hidden = kind !== "depot";
  document.getElementById("managementSubmit").textContent = isRestock ? "Restock" : "Save";
  if (isRestock) {
    document.getElementById("restockResource").innerHTML = RESOURCE_KEYS.map((key) =>
      `<option value="${key}">${RESOURCE_LABELS[key]}</option>`).join("");
  }
  const dialog = document.getElementById("managementDialog");
  dialog.showModal();
  if (!isRestock) initializePickerMap("managementMap", (lat, lng) => {
    managementLocation = { lat, lng };
    document.getElementById("managementCoordinates").textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    setInlineError("managementLocationError", "");
  });
}

/**
 * Opens the add-depot form after checking administrator access.
 * @returns {void}
 */
function addDepot() {
  if (!requireRoles(ACTION_ROLES.manageDepots)) return;
  setManagementMode("depot");
}

/**
 * Opens the add-shelter form after checking administrator access.
 * @returns {void}
 */
function addShelter() {
  if (!requireRoles(ACTION_ROLES.manageShelters)) return;
  setManagementMode("shelter");
}

/**
 * Opens the restock form for an existing depot.
 * @param {string} depotId Depot identifier.
 * @returns {void}
 */
function restockDepot(depotId) {
  if (!requireRoles(ACTION_ROLES.manageDepots)) return;
  if (!state.depots.some((depot) => depot.id === depotId)) {
    showToast("Depot could not be found.", "error");
    return;
  }
  setManagementMode("restock", depotId);
}

/**
 * Validates and applies a depot, shelter or restock form submission.
 * @param {SubmitEvent} event Form submit event.
 * @returns {void}
 */
function submitManagementForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form);
  if (managementKind === "restock") {
    if (!requireRoles(ACTION_ROLES.manageDepots)) return;
    const depot = state.depots.find((item) => item.id === managementDepotId);
    const key = document.getElementById("restockResource").value;
    const amountValue = document.getElementById("restockAmount").value.trim();
    const amount = Number(amountValue);
    if (!depot || !RESOURCE_KEYS.includes(key) || !Number.isInteger(amount) || amount < 0) {
      setInlineError("restockError", "Enter a whole-number amount of 0 or more.");
      return;
    }
    depot.inventory[key] = (Number(depot.inventory[key]) || 0) + amount;
    addActivity(state, `${amount} ${RESOURCE_LABELS[key].toLowerCase()} restocked at ${depot.name}.`);
    persistAndRender();
    document.getElementById("managementDialog").close();
    showToast("Depot stock updated.");
    return;
  }

  const requiredRole = managementKind === "depot" ? ACTION_ROLES.manageDepots : ACTION_ROLES.manageShelters;
  if (!requireRoles(requiredRole)) return;
  const name = formatName(document.getElementById("managementName").value);
  const area = formatName(document.getElementById("managementArea").value);
  const nameValid = Boolean(name);
  const areaValid = Boolean(area);
  if (!nameValid) setInlineError("managementNameError", "Enter a name.");
  if (!areaValid) setInlineError("managementAreaError", "Enter an area label.");
  if (!managementLocation) setInlineError("managementLocationError", "Click the map to set the location.");
  let valid = nameValid && areaValid && Boolean(managementLocation);
  if (managementKind === "depot") {
    const inventory = {};
    for (const key of RESOURCE_KEYS) {
      const value = document.getElementById(`stock${key[0].toUpperCase()}${key.slice(1)}`).value.trim();
      const amount = Number(value);
      if (!Number.isInteger(amount) || amount < 0) valid = false;
      inventory[key] = amount;
    }
    if (!valid) setInlineError("managementStockError", "Enter whole-number stock amounts of 0 or more.");
    if (valid) {
      state.depots.push({
        id: createId("depot"), name, location: area,
        lat: managementLocation.lat, lng: managementLocation.lng, inventory
      });
      addActivity(state, `Resource depot "${name}" added.`);
    }
  } else {
    const capacityValue = document.getElementById("managementCapacity").value.trim();
    const capacity = Number(capacityValue);
    if (!Number.isInteger(capacity) || capacity < 0) {
      setInlineError("managementCapacityError", "Enter a whole-number capacity of 0 or more.");
      valid = false;
    }
    if (valid) {
      state.shelters.push({
        id: createId("shelter"), name, location: area, capacity, occupancy: 0,
        lat: managementLocation.lat, lng: managementLocation.lng
      });
      addActivity(state, `Relief shelter "${name}" added.`);
    }
  }
  if (!valid) return;
  queue = runAllocationPreview(state);
  persistAndRender();
  document.getElementById("managementDialog").close();
  showToast(managementKind === "depot" ? "Resource depot added." : "Relief shelter added.");
}

/**
 * Confirms and removes a depot that has no outstanding incident allocations.
 * @param {string} depotId Depot identifier.
 * @returns {Promise<void>}
 */
async function removeDepot(depotId) {
  if (!requireRoles(ACTION_ROLES.manageDepots)) return;
  const depot = state.depots.find((item) => item.id === depotId);
  if (!depot) {
    showToast("Depot could not be found.", "error");
    return;
  }
  const hasAllocatedStock = state.incidents.some((incident) =>
    Object.values(incident.allocationsByDepot?.[depotId] || {}).some((amount) => Number(amount) > 0));
  if (hasAllocatedStock) {
    showToast("This depot has supplies allocated to an incident. Cancel that incident before removing the depot.", "error");
    return;
  }
  if (!await confirmAction("Remove this depot?", `Remove "${depot.name}" and its remaining inventory? This cannot be undone.`, "Remove depot")) return;
  state.depots = state.depots.filter((item) => item.id !== depotId);
  addActivity(state, `Resource depot "${depot.name}" removed.`);
  persistAndRender();
  showToast("Depot removed.");
}

/**
 * Adjusts shelter occupancy in a bounded 10-person step.
 * @param {string} shelterId Shelter identifier.
 * @param {number} delta Occupancy change, either -10 or 10.
 * @returns {void}
 */
function adjustOccupancy(shelterId, delta) {
  if (!requireRoles(ACTION_ROLES.occupancy)) return;
  const shelter = state.shelters.find((item) => item.id === shelterId);
  if (!shelter || ![-10, 10].includes(delta)) {
    showToast("Shelter occupancy action is invalid.", "error");
    return;
  }
  const next = Math.min(shelter.capacity, Math.max(0, shelter.occupancy + delta));
  if (next === shelter.occupancy) return;
  shelter.occupancy = next;
  addActivity(state, `${shelter.name} occupancy updated to ${next} of ${shelter.capacity}.`);
  persistAndRender();
}

/**
 * Loads the sample response network, asking before replacing existing records.
 * @returns {Promise<void>}
 */
async function loadDemoData() {
  if (!requireRoles(ACTION_ROLES.demo)) return;
  if ((state.incidents.length || state.depots.length || state.shelters.length) &&
      !await confirmAction("Load demo data?", "This replaces the current incidents, depots and shelters stored on this device.", "Load demo data")) return;
  state = createDemoState();
  queue = runAllocationPreview(state);
  persistAndRender();
  showToast("Hyderabad demo response network loaded. Run allocation to dispatch supplies.");
}

/**
 * Stores the incident location selected on the report map.
 * @param {number} latitude Latitude value.
 * @param {number} longitude Longitude value.
 * @returns {void}
 */
function selectIncidentLocation(latitude, longitude) {
  selectedLocation = { lat: latitude, lng: longitude };
  document.getElementById("selectedLocation").textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  setInlineError("incidentLocationError", "");
}

/**
 * Routes clicks on dynamically rendered controls to their corresponding handlers.
 * @param {MouseEvent} event Document click event.
 * @returns {void}
 */
function handleDelegatedAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === "resolve") void resolveIncident(id);
  if (action === "cancel-incident") void cancelIncident(id);
  if (action === "restock") restockDepot(id);
  if (action === "remove-depot") void removeDepot(id);
  if (action === "occupancy") adjustOccupancy(id, Number(button.dataset.delta));
}

/**
 * Registers navigation, form, theme and delegated action event handlers.
 * @returns {void}
 */
function bindEvents() {
  document.getElementById("roleSelection").addEventListener("click", (event) => {
    const option = event.target.closest("[data-role]");
    if (option) initializeWorkspace(option.dataset.role);
  });
  document.getElementById("switchRoleButton").addEventListener("click", returnToRoleSelection);
  document.getElementById("navigation").addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (button) navigateTo(button.dataset.page);
  });
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => navigateTo(button.dataset.go)));
  document.getElementById("incidentForm").addEventListener("submit", submitIncident);
  document.getElementById("runAllocationBtn").addEventListener("click", handleRunAllocation);
  document.getElementById("loadDemoBtn").addEventListener("click", () => void loadDemoData());
  document.getElementById("addDepotBtn").addEventListener("click", addDepot);
  document.getElementById("addShelterBtn").addEventListener("click", addShelter);
  document.getElementById("managementForm").addEventListener("submit", submitManagementForm);
  document.getElementById("managementCancel").addEventListener("click", () => document.getElementById("managementDialog").close());
  document.addEventListener("click", handleDelegatedAction);
  document.getElementById("menuToggle").addEventListener("click", () => {
    const opened = document.body.classList.toggle("sidebar-open");
    document.getElementById("menuToggle").setAttribute("aria-expanded", String(opened));
  });
  document.getElementById("sidebarScrim").addEventListener("click", () => document.body.classList.remove("sidebar-open"));
  document.getElementById("themeToggle").addEventListener("click", () => {
    const enabled = document.body.classList.toggle("dark-mode");
    localStorage.setItem("dmeras-dark-mode", String(enabled));
    document.getElementById("themeToggle").innerHTML = `<i class="fa-solid ${enabled ? "fa-sun" : "fa-moon"}"></i>`;
    document.getElementById("themeToggle").setAttribute("aria-label", enabled ? "Switch to light mode" : "Switch to dark mode");
  });
}

/**
 * Loads saved state, restores the theme preference and binds application events.
 * Startup failures are shown as plain text rather than interpreted as markup.
 * @returns {Promise<void>}
 */
async function initialize() {
  try {
    state = loadState();
    queue = runAllocationPreview(state);
    if (localStorage.getItem("dmeras-dark-mode") === "true") {
      document.body.classList.add("dark-mode");
      document.getElementById("themeToggle").innerHTML = '<i class="fa-solid fa-sun"></i>';
      document.getElementById("themeToggle").setAttribute("aria-label", "Switch to light mode");
    }
    bindEvents();
  } catch (error) {
    console.error(error);
    const main = document.createElement("main");
    const heading = document.createElement("h1");
    const message = document.createElement("p");
    main.className = "startup-error";
    heading.textContent = "DMERAS could not start";
    message.textContent = error instanceof Error ? error.message : "Unexpected startup error.";
    main.append(heading, message);
    document.body.replaceChildren(main);
  }
}

initialize();
