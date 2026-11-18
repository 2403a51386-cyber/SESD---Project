# DMERAS

**Disaster Management & Emergency Resource Allocation System** is a responsive course project for coordinating incident reports, relief shelters and emergency supply depots. The frontend uses plain HTML, CSS and vanilla JavaScript modules. Its current application records are stored in the browser's `localStorage`. A FastAPI/PostgreSQL backend foundation is present under `backend/`; incident APIs and frontend integration are not implemented yet.

## Features

- Situation dashboard with incident, criticality, affected-people, resolved and shelter-capacity metrics.
- Leaflet/OpenStreetMap map with severity-sized incident circles, depots and shelters; report form includes a click-to-pin map.
- Chart.js incident-type doughnut and depot-stock bar chart.
- Validated incident reporting with toast feedback and a ranked response queue.
- Nearest-depot resource allocation, partial fulfilment, cumulative allocations and dispatch activity log; cancelled incidents return tracked supplies to their source depots.
- Depot inventory management with add, restock and remove actions.
- Shelter capacity cards with visual occupancy indicators and 10-person occupancy controls.
- Admin, Rescue Team and Citizen role selection opens the corresponding role-filtered workspace without credentials.
- Persistent light/dark mode toggle.
- Demo data loader for quickly exercising the project.
- User-entered content is escaped before it is rendered as HTML.

## Run the project

1. Open `index.html` in a modern browser and choose Admin, Rescue Team or Citizen to open that role's workspace.
2. The external font, icon, map and chart libraries require an internet connection.
3. If your browser blocks JavaScript ES-module imports from `file://`, serve this folder using a local static server (for example, VS Code Live Server) and open its `index.html` URL. No application backend is needed.
4. Choose **Load demo data** on the dashboard to populate a sample response network. The first load is additive to an empty workspace; subsequent loads ask before replacing local records.

All application data is kept in the current browser profile. Clearing site data removes incidents, depots, shelters and activity. Theme preference is stored separately.

## Backend foundation (step 1)

The `backend/` folder contains the initial FastAPI application, PostgreSQL connection setup and a health endpoint. It does not create an incidents table or incident APIs yet, and the frontend is not connected to it in this step.

1. Install and start PostgreSQL. Create a database named `dmeras` (for example, in `psql`):

   ```sql
   CREATE DATABASE dmeras;
   ```

2. In PowerShell, open the backend folder, create the Python environment, and install its dependencies:

   ```powershell
   cd backend
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   Copy-Item .env.example .env
   ```

3. Edit `.env` and replace the example database password in `DATABASE_URL` with your PostgreSQL password.
4. Start the API:

   ```powershell
   uvicorn app.main:app --reload
   ```

5. Open `http://127.0.0.1:8000/health`. It reports `database: connected` when PostgreSQL is reachable. If PostgreSQL has not been configured yet, it reports `database: not_configured`.

The next step is to verify the database connection, then add the incidents table and API routes. After those are tested, the existing Citizen form and Admin/Rescue Team dashboards can be connected without redesigning them.

## Use and test

1. Load demo data and inspect the map, charts, dashboard metrics, three depots and shelter capacity cards.
2. Open **Resource allocation** and select **Run allocation**. Check the priority order, needs and fulfilment, then run it again to verify already allocated resources are not dispatched twice.
3. Try **Report incident**: choose a disaster type and severity, enter a positive whole-number people count and description, click the map to set coordinates, and submit. Try an incomplete form to check validation.
4. As **Admin**, add a depot/shelter, restock a depot, adjust shelter occupancy and remove a depot. Destructive removal asks for confirmation.
5. Use **Switch role** to return to role selection and confirm each role has the expected pages and actions. Toggle dark mode and resize the browser to test the responsive sidebar and layouts.
6. To start over, clear this site's local storage in browser developer tools or load demo data and confirm replacement.

## Folder structure

```text
/
├── index.html             App shell and page layouts
├── css/
│   └── style.css          App theme, components and responsive styles
├── js/
│   ├── app.js             Event handlers and application orchestration
│   ├── data.js            Local storage, IDs and demo data
│   ├── allocation.js      Prioritization, distance and allocation rules
│   └── ui.js              Rendering, charts, maps and notifications
└── README.md
```

## Allocation algorithm

The allocation queue is sorted by descending **priority score = severity × people affected**. Required amounts are:

| Resource | Need per incident |
|---|---:|
| Food portions | 1 per person |
| Water | 3 litres per person |
| Medicine kits | 1 per 5 people, rounded up |
| Ambulances | 1 per 15 people, rounded up, only at severity 4 or 5 |
| Boats | 1 per 10 people, rounded up, only for floods |

For each active incident and each resource, the allocator calculates great-circle distance using the Haversine formula, visits depots nearest-first, and transfers the lesser of the depot stock and the outstanding need. It continues to the next depot when stock is insufficient, so an incident can receive partial or combined supplies. Previous allocations are counted toward need, and the stock is reduced immediately to prevent double allocation. An incident is **Pending** when none of its needs has been met, **Partial** when it has received supplies but at least one need remains, and **Allocated** when all needs are met. Resolved incidents are not reallocated.

New dispatches retain depot-level allocation records so cancelling an incident restores supplies to their source depots. Older saved allocations without source records are returned to the nearest available depot.

## Notes

- Leaflet, OpenStreetMap tiles, Chart.js, Font Awesome and Google Fonts are loaded from CDNs.
- Role selection is a local demonstration of role-specific UI access, not authentication or a security boundary.
- Coordinates for newly added depots and shelters are selected on the map and stored as latitude/longitude; report locations are selected the same way.
