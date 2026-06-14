import { createAppRepositories } from "./online/repositoryFactory";
import { configuredSupabaseUrl, isSupabaseConfigured, supabase } from "./online/supabaseClient";
import type { Club, TableRoom, TableSeat, UserAccount } from "./online/types";

type AppRepositories = ReturnType<typeof createAppRepositories>;

const getElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element: ${id}`);
  return element as T;
};

const configStatus = getElement("configStatus");
const lanHint = getElement("lanHint");
const logOutput = getElement("logOutput");
const currentUserText = getElement("currentUser");
const clubSelect = getElement<HTMLSelectElement>("clubSelect");
const tableSelect = getElement<HTMLSelectElement>("tableSelect");
const seatsOutput = getElement("seatsOutput");
const tableUrlText = getElement("tableUrl");
const debugSummary = getElement("debugSummary");

let repositories: AppRepositories | null = null;
let currentUser: UserAccount | null = null;
let clubs: Club[] = [];
let tables: TableRoom[] = [];
let tableUnsubscribe: (() => void) | null = null;
let realtimeStatus = "not connected";

function getTableIdFromUrl() {
  const queryTableId = new URLSearchParams(location.search).get("tableId");
  if (queryTableId) return queryTableId;
  const match = location.pathname.match(/^\/table\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function formatDetail(detail: unknown): string {
  if (detail instanceof Error) return detail.message;
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

function log(message: string, detail?: unknown) {
  const detailText = detail === undefined ? "" : `\n${formatDetail(detail)}`;
  logOutput.textContent = `${new Date().toLocaleTimeString()} ${message}${detailText}\n\n${logOutput.textContent ?? ""}`;
}

function showError(title: string, error: unknown) {
  console.error(error);
  log(`${title}\nCause: ${formatDetail(error)}`);
}

function requireRepositories() {
  if (!repositories) throw new Error("Supabase is not configured. Check VITE_SUPABASE_ANON_KEY in .env.");
  return repositories;
}

function requireUser() {
  if (!currentUser) throw new Error("Please sign in first.");
  return currentUser;
}

function selectedClubId() {
  const value = clubSelect.value || getElement<HTMLInputElement>("clubId").value.trim();
  if (!value) throw new Error("Select a club first.");
  return value;
}

function selectedTableId() {
  const value = tableSelect.value || getTableIdFromUrl() || "";
  if (!value) throw new Error("Select a table first.");
  return value;
}

function updateDebugSummary() {
  debugSummary.textContent = [
    `Supabase URL: ${configuredSupabaseUrl || "missing"}`,
    `Supabase: ${isSupabaseConfigured ? "OK" : "missing env"}`,
    `Auth: ${currentUser ? "signed in" : "signed out"}`,
    `Current user: ${currentUser ? `${currentUser.displayName} / ${currentUser.id}` : "none"}`,
    `Current club: ${clubSelect.value || "none"}`,
    `Tables loaded: ${tables.length}`,
    `Current table: ${tableSelect.value || getTableIdFromUrl() || "none"}`,
    `Realtime: ${realtimeStatus}`,
  ].join("\n");
}

function updateCurrentUser(user: UserAccount | null) {
  currentUser = user;
  currentUserText.textContent = user ? `${user.displayName} / ${user.id}` : "not signed in";
  if (user) getElement<HTMLInputElement>("userId").value = user.id;
  updateDebugSummary();
}

function renderClubs() {
  clubSelect.innerHTML = "";
  for (const club of clubs) {
    const option = document.createElement("option");
    option.value = club.id;
    option.textContent = `${club.name} (${club.id})`;
    clubSelect.append(option);
  }
  updateDebugSummary();
}

function renderTables() {
  tableSelect.innerHTML = "";
  for (const table of tables) {
    const option = document.createElement("option");
    option.value = table.id;
    option.textContent = `${table.name} (${table.status})`;
    tableSelect.append(option);
  }
  updateTableUrl();
  updateDebugSummary();
}

function updateTableUrl() {
  const tableId = tableSelect.value || getTableIdFromUrl();
  tableUrlText.textContent = tableId ? `${location.origin}/online-debug/?tableId=${encodeURIComponent(tableId)}` : "none";
}

function renderSeats(seats: TableSeat[]) {
  seatsOutput.textContent = JSON.stringify(seats, null, 2);
  updateDebugSummary();
}

async function refreshCurrentUser() {
  updateCurrentUser(await requireRepositories().users.getCurrentUser());
}

async function refreshClubs() {
  const user = requireUser();
  clubs = (await requireRepositories().clubs.listMyClubs(user.id)).map(({ myRole: _role, ...club }) => club);
  renderClubs();
  log("clubs loaded", clubs);
}

async function refreshTables() {
  tables = await requireRepositories().tables.listTablesByClub(selectedClubId());
  renderTables();
  log("tables loaded", tables);
}

async function refreshSeats() {
  const seats = await requireRepositories().tables.listSeats(selectedTableId());
  renderSeats(seats);
  log("seats loaded", seats);
}

async function run(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    showError("Action failed", error);
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    log("copied", text);
  } catch (error) {
    showError("Copy failed", error);
  }
}

function subscribeSelectedTable() {
  tableUnsubscribe?.();
  const tableId = tableSelect.value || getTableIdFromUrl();
  if (!repositories || !tableId) return;

  realtimeStatus = "connecting";
  updateDebugSummary();
  tableUnsubscribe = repositories.tables.subscribeTable(tableId, () => {
    realtimeStatus = "received update";
    updateDebugSummary();
    void refreshSeats();
    log("realtime table update received");
  });
  log("realtime subscribed", tableId);
}

async function signUp() {
  const displayName = getElement<HTMLInputElement>("displayName").value.trim();
  const password = getElement<HTMLInputElement>("password").value;
  if (!displayName) throw new Error("Display name is required.");
  if (!password) throw new Error("Password is required.");

  console.log("signup start");
  log("signup start");
  try {
    const user = await requireRepositories().users.signUp(displayName, password);
    console.log("signup success", user);
    updateCurrentUser(user);
    log("signup success. Save this user ID for login.", user);
  } catch (error) {
    console.error(error);
    log(`signup failed\nCause: ${formatDetail(error)}`);
    throw error;
  }
}

function wire() {
  getElement("signUpButton").addEventListener("click", () => run(signUp));

  getElement("signInButton").addEventListener("click", () => run(async () => {
    const user = await requireRepositories().users.signIn(
      getElement<HTMLInputElement>("userId").value.trim(),
      getElement<HTMLInputElement>("password").value,
    );
    updateCurrentUser(user);
    log("signed in", user);
    await refreshClubs();
  }));

  getElement("signOutButton").addEventListener("click", () => run(async () => {
    await requireRepositories().users.signOut();
    updateCurrentUser(null);
    clubs = [];
    tables = [];
    renderClubs();
    renderTables();
    log("signed out");
  }));

  getElement("createClubButton").addEventListener("click", () => run(async () => {
    const club = await requireRepositories().clubs.createClub({
      name: getElement<HTMLInputElement>("clubName").value.trim(),
      ownerUserId: requireUser().id,
    });
    getElement<HTMLInputElement>("clubId").value = club.id;
    log("club created", club);
    await refreshClubs();
  }));

  getElement("loadClubsButton").addEventListener("click", () => run(refreshClubs));

  getElement("requestJoinButton").addEventListener("click", () => run(async () => {
    await requireRepositories().clubs.requestJoin(getElement<HTMLInputElement>("clubId").value.trim(), requireUser().id);
    log("join request sent. Approve this user ID from owner browser.", requireUser().id);
  }));

  getElement("approveJoinButton").addEventListener("click", () => run(async () => {
    await requireRepositories().clubs.approveJoinRequest(
      selectedClubId(),
      getElement<HTMLInputElement>("applicantUserId").value.trim(),
      requireUser().id,
    );
    log("join request approved");
  }));

  getElement("createTableButton").addEventListener("click", () => run(async () => {
    const table = await requireRepositories().tables.createTable({
      clubId: selectedClubId(),
      name: getElement<HTMLInputElement>("tableName").value.trim(),
      ruleId: "anmika-rocket",
      pointRate: 1,
      rakePercent: 0,
      createdBy: requireUser().id,
    });
    log("table created", table);
    await refreshTables();
    tableSelect.value = table.id;
    updateTableUrl();
    subscribeSelectedTable();
  }));

  getElement("loadTablesButton").addEventListener("click", () => run(refreshTables));
  getElement("loadSeatsButton").addEventListener("click", () => run(refreshSeats));

  tableSelect.addEventListener("change", () => {
    updateTableUrl();
    subscribeSelectedTable();
    void run(refreshSeats);
  });

  getElement("copyTableUrlButton").addEventListener("click", () => run(async () => {
    const text = tableUrlText.textContent;
    if (text && text !== "none") await copyText(text);
  }));

  getElement("sitButton").addEventListener("click", () => run(async () => {
    const tableId = selectedTableId();
    const seats = await requireRepositories().tables.listSeats(tableId);
    const emptySeat = seats.find((seat) => !seat.userId);
    if (!emptySeat) throw new Error("No empty seat.");
    await requireRepositories().tables.sit(tableId, emptySeat.seatIndex, requireUser().id);
    log(`sat at seat ${emptySeat.seatIndex + 1}`);
    await refreshSeats();
  }));

  getElement("leaveButton").addEventListener("click", () => run(async () => {
    await requireRepositories().tables.leave(selectedTableId(), requireUser().id);
    log("left table");
    await refreshSeats();
  }));
}

function showLanHint() {
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    lanHint.textContent = "Other devices cannot open localhost. Use this PC's LAN IP, like http://192.168.x.x:5173.";
  } else {
    lanHint.textContent = `Open this URL on another device: ${location.origin}`;
  }
}

async function main() {
  wire();
  showLanHint();
  updateDebugSummary();

  if (!isSupabaseConfigured || !supabase) {
    configStatus.textContent = "Supabase env is missing. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
    configStatus.className = "warn";
    updateDebugSummary();
    return;
  }

  repositories = createAppRepositories();
  configStatus.textContent = "Supabase connection: OK";
  configStatus.className = "ok";
  updateDebugSummary();

  const tableIdFromUrl = getTableIdFromUrl();
  if (tableIdFromUrl) {
    const option = document.createElement("option");
    option.value = tableIdFromUrl;
    option.textContent = `URL table (${tableIdFromUrl})`;
    tableSelect.append(option);
    tableSelect.value = tableIdFromUrl;
    updateTableUrl();
    subscribeSelectedTable();
  }

  await refreshCurrentUser();
  if (currentUser) {
    await refreshClubs();
    if (!tableIdFromUrl && clubSelect.value) await refreshTables();
    if (tableIdFromUrl) await run(refreshSeats);
  }
}

void main();
