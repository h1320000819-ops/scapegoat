import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRepositories, Unsubscribe } from "./repositories";
import type {
  Club,
  ClubId,
  ClubMember,
  GameAction,
  GameId,
  GameStateEnvelope,
  PendingActionChoiceRecord,
  PlayerConnection,
  ReplayData,
  TableId,
  TableRoom,
  TableSeat,
  UserAccount,
  UserId,
} from "./types";

const toMillis = (value: string | number | null | undefined): number => {
  if (typeof value === "number") return value;
  return value ? new Date(value).getTime() : Date.now();
};

const requireOne = async <T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> => {
  const { data, error } = await query;
  if (error) throw error;
  if (!data) throw new Error("record not found");
  return data;
};

const mapUser = (row: any): UserAccount => ({
  id: row.user_id,
  displayName: row.display_name,
  iconUrl: row.icon_url ?? undefined,
  createdAt: toMillis(row.created_at),
});

const mapClub = (row: any): Club => ({
  id: row.club_id,
  name: row.name,
  ownerUserId: row.owner_user_id,
  createdAt: toMillis(row.created_at),
});

const mapMember = (row: any): ClubMember => ({
  clubId: row.club_id,
  userId: row.user_id,
  role: row.role,
  pointBalance: Number(row.point_balance ?? 0),
  joinedAt: toMillis(row.joined_at),
});

const mapTable = (row: any): TableRoom => ({
  id: row.table_id,
  clubId: row.club_id,
  name: row.name,
  status: row.status,
  ruleId: row.rule_id,
  pointRate: Number(row.point_rate ?? 1),
  rakePercent: Number(row.rake_percent ?? 0),
  createdBy: row.created_by,
  createdAt: toMillis(row.created_at),
});

const mapSeat = (row: any): TableSeat => ({
  tableId: row.table_id,
  seatIndex: row.seat_index,
  userId: row.user_id ?? undefined,
  playerType: row.player_type ?? (row.user_id ? "human" : "empty"),
  displayName: row.display_name ?? undefined,
  isLastHandDeclared: Boolean(row.is_last_hand_declared),
  updatedAt: toMillis(row.updated_at),
});

const mapConnection = (row: any): PlayerConnection => ({
  tableId: row.table_id,
  userId: row.user_id,
  status: row.status,
  lastSeenAt: toMillis(row.last_seen_at),
});

const mapGameState = (row: any): GameStateEnvelope => ({
  gameId: row.game_id,
  tableId: row.table_id,
  version: row.version,
  state: row.state,
  updatedAt: toMillis(row.updated_at),
});

const mapAction = (row: any): GameAction => ({
  id: row.event_id,
  gameId: row.game_id,
  tableId: row.table_id,
  playerId: row.player_id,
  type: row.action_type,
  turnVersion: row.turn_version,
  payload: row.payload,
  createdAt: toMillis(row.created_at),
});

const mapPendingAction = (row: any): PendingActionChoiceRecord => ({
  id: row.pending_action_id,
  gameId: row.game_id,
  tableId: row.table_id,
  playerId: row.player_id,
  turnVersion: row.turn_version,
  options: row.options ?? [],
  selectedActionId: row.selected_action_id ?? undefined,
  expiresAt: toMillis(row.expires_at),
  createdAt: toMillis(row.created_at),
});

export function createSupabaseRepositories(client: SupabaseClient): AppRepositories {
  return {
    users: {
      async getCurrentUser() {
        const { data } = await client.auth.getUser();
        if (!data.user) return null;
        const { data: profile } = await client.from("users").select("*").eq("user_id", data.user.id).maybeSingle();
        return profile ? mapUser(profile) : null;
      },
      async signUp(displayName, password) {
        const email = `${crypto.randomUUID()}@anmika.local`;
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName,
            },
          },
        });
        if (error || !data.user) throw error ?? new Error("signUp failed");
        const { data: profile, error: profileError } = await client
          .from("users")
          .select("*")
          .eq("user_id", data.user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (profile) return mapUser(profile);
        const insertedProfile = await requireOne(client
          .from("users")
          .upsert({ user_id: data.user.id, auth_email: email, display_name: displayName }, { onConflict: "user_id" })
          .select("*")
          .single());
        return mapUser(insertedProfile);
      },
      async signIn(userId, password) {
        const { data: profile, error: profileError } = await client.from("users").select("auth_email").eq("user_id", userId).single();
        if (profileError) throw profileError;
        const { data, error } = await client.auth.signInWithPassword({ email: profile.auth_email, password });
        if (error || !data.user) throw error ?? new Error("signIn failed");
        return mapUser(await requireOne(client.from("users").select("*").eq("user_id", data.user.id).single()));
      },
      async signOut() {
        await client.auth.signOut();
      },
      async getUser(id) {
        const { data, error } = await client.from("users").select("*").eq("user_id", id).maybeSingle();
        if (error) throw error;
        return data ? mapUser(data) : null;
      },
      async updateUser(id, patch) {
        const updates: Record<string, unknown> = {};
        if (patch.displayName !== undefined) updates.display_name = patch.displayName;
        if (patch.iconUrl !== undefined) updates.icon_url = patch.iconUrl;
        const row = await requireOne(client.from("users").update(updates).eq("user_id", id).select("*").single());
        return mapUser(row);
      },
    },
    clubs: {
      async listMyClubs(userId) {
        const { data, error } = await client.from("club_members").select("*, clubs(*)").eq("user_id", userId);
        if (error) throw error;
        return (data ?? []).map((row: any) => ({ ...mapClub(row.clubs), myRole: row.role }));
      },
      async createClub(input) {
        const club = await requireOne<any>(client.from("clubs").insert({ name: input.name, owner_user_id: input.ownerUserId }).select("*").single());
        const { error } = await client.from("club_members").insert({ club_id: club.club_id, user_id: input.ownerUserId, role: "admin" });
        if (error) throw error;
        return mapClub(club);
      },
      async getClub(id) {
        const { data, error } = await client.from("clubs").select("*").eq("club_id", id).maybeSingle();
        if (error) throw error;
        return data ? mapClub(data) : null;
      },
      async searchClub(id) {
        return this.getClub(id);
      },
      async requestJoin(clubId, userId) {
        const { error } = await client
          .from("club_join_requests")
          .upsert({ club_id: clubId, user_id: userId, status: "pending" }, { onConflict: "club_id,user_id" });
        if (error) throw error;
      },
      async approveJoinRequest(clubId, applicantUserId, adminUserId) {
        const { error } = await client.rpc("approve_club_join_request", { p_club_id: clubId, p_user_id: applicantUserId, p_admin_user_id: adminUserId });
        if (error) throw error;
      },
      async rejectJoinRequest(clubId, applicantUserId, adminUserId) {
        const { error } = await client.rpc("reject_club_join_request", { p_club_id: clubId, p_user_id: applicantUserId, p_admin_user_id: adminUserId });
        if (error) throw error;
      },
      async listMembers(clubId) {
        const { data, error } = await client.from("club_members").select("*").eq("club_id", clubId);
        if (error) throw error;
        return (data ?? []).map(mapMember);
      },
    },
    tables: {
      async listTablesByClub(clubId) {
        const { data, error } = await client.from("tables").select("*").eq("club_id", clubId).order("created_at", { ascending: false });
        if (error) throw error;
        return (data ?? []).map(mapTable);
      },
      async getTable(id) {
        const { data, error } = await client.from("tables").select("*").eq("table_id", id).maybeSingle();
        if (error) throw error;
        return data ? mapTable(data) : null;
      },
      async createTable(table) {
        const row = await requireOne<any>(client.from("tables").insert({
          club_id: table.clubId,
          name: table.name,
          rule_id: table.ruleId,
          point_rate: table.pointRate,
          rake_percent: table.rakePercent,
          created_by: table.createdBy,
        }).select("*").single());
        const { error } = await client.from("table_seats").insert([0, 1, 2].map((seatIndex) => ({ table_id: row.table_id, seat_index: seatIndex })));
        if (error) throw error;
        return mapTable(row);
      },
      async updateTable(id, patch) {
        const updates: Record<string, unknown> = {};
        if (patch.name !== undefined) updates.name = patch.name;
        if (patch.status !== undefined) updates.status = patch.status;
        if (patch.pointRate !== undefined) updates.point_rate = patch.pointRate;
        if (patch.rakePercent !== undefined) updates.rake_percent = patch.rakePercent;
        const row = await requireOne(client.from("tables").update(updates).eq("table_id", id).select("*").single());
        return mapTable(row);
      },
      async deleteTable(id) {
        const { error } = await client.from("tables").delete().eq("table_id", id);
        if (error) throw error;
      },
      async listSeats(tableId) {
        const { data, error } = await client.from("table_seats").select("*").eq("table_id", tableId).order("seat_index");
        if (error) throw error;
        return (data ?? []).map(mapSeat);
      },
      async sit(tableId, seatIndex, userId) {
        const { error } = await client.rpc("sit_at_table", { p_table_id: tableId, p_seat_index: seatIndex, p_user_id: userId });
        if (error) throw error;
      },
      async leave(tableId, userId) {
        const { error } = await client.from("table_seats").update({ user_id: null, is_last_hand_declared: false }).eq("table_id", tableId).eq("user_id", userId);
        if (error) throw error;
      },
      async setLastHand(tableId, userId, isLastHandDeclared) {
        const { error } = await client.from("table_seats").update({ is_last_hand_declared: isLastHandDeclared }).eq("table_id", tableId).eq("user_id", userId);
        if (error) throw error;
      },
      async joinWaitingList(tableId, userId) {
        const { error } = await client
          .from("table_waiting_list")
          .upsert({ table_id: tableId, user_id: userId }, { onConflict: "table_id,user_id" });
        if (error) throw error;
      },
      async leaveWaitingList(tableId, userId) {
        const { error } = await client.from("table_waiting_list").delete().eq("table_id", tableId).eq("user_id", userId);
        if (error) throw error;
      },
      async tryStartGame(tableId) {
        const { data, error } = await client.rpc("try_start_table_game", { p_table_id: tableId });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        return row ? mapGameState(row) : null;
      },
      async upsertConnection(tableId, userId, status) {
        const { error } = await client
          .from("player_connections")
          .upsert({ table_id: tableId, user_id: userId, status }, { onConflict: "table_id,user_id" });
        if (error) throw error;
      },
      async listConnections(tableId) {
        const { data, error } = await client.from("player_connections").select("*").eq("table_id", tableId);
        if (error) throw error;
        return (data ?? []).map(mapConnection);
      },
      subscribeTable(tableId, onChange): Unsubscribe {
        const channel = client.channel(`table:${tableId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "tables", filter: `table_id=eq.${tableId}` }, onChange)
          .on("postgres_changes", { event: "*", schema: "public", table: "table_seats", filter: `table_id=eq.${tableId}` }, onChange)
          .on("postgres_changes", { event: "*", schema: "public", table: "table_waiting_list", filter: `table_id=eq.${tableId}` }, onChange)
          .on("postgres_changes", { event: "*", schema: "public", table: "player_connections", filter: `table_id=eq.${tableId}` }, onChange)
          .subscribe();
        return () => { void client.removeChannel(channel); };
      },
    },
    gameStates: {
      async getActiveGame(tableId) {
        const { data, error } = await client.from("game_states").select("*").eq("table_id", tableId).eq("is_active", true).maybeSingle();
        if (error) throw error;
        return data ? mapGameState(data) : null;
      },
      async createGame(tableId, initialState) {
        const game = await requireOne<any>(client.from("games").insert({ table_id: tableId }).select("*").single());
        const row = await requireOne<any>(client.from("game_states").insert({ game_id: game.game_id, table_id: tableId, version: initialState.version ?? 0, state: initialState, is_active: true }).select("*").single());
        return mapGameState(row);
      },
      async saveState(envelope) {
        const row = await requireOne(client.from("game_states").update({ version: envelope.version, state: envelope.state }).eq("game_id", envelope.gameId).eq("version", envelope.version - 1).select("*").single());
        return mapGameState(row);
      },
      async appendAction(action) {
        const row = await requireOne(client.from("game_events").insert({
          game_id: action.gameId,
          table_id: action.tableId,
          player_id: action.playerId,
          action_type: action.type,
          turn_version: action.turnVersion,
          payload: action.payload ?? {},
        }).select("*").single());
        return mapAction(row);
      },
      async submitAction(action) {
        const row = await requireOne(client.rpc("submit_game_action", {
          p_game_id: action.gameId,
          p_table_id: action.tableId,
          p_player_id: action.playerId,
          p_action_type: action.type,
          p_turn_version: action.turnVersion,
          p_payload: action.payload ?? {},
        }));
        return mapAction(row);
      },
      async listActions(gameId) {
        const { data, error } = await client.from("game_events").select("*").eq("game_id", gameId).order("created_at");
        if (error) throw error;
        return (data ?? []).map(mapAction);
      },
      async listPendingActions(gameId) {
        const { data, error } = await client.from("pending_actions").select("*").eq("game_id", gameId).is("selected_action_id", null).order("created_at");
        if (error) throw error;
        return (data ?? []).map(mapPendingAction);
      },
      subscribeGame(gameId, onChange): Unsubscribe {
        const channel = client.channel(`game:${gameId}`)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_states", filter: `game_id=eq.${gameId}` }, (payload: any) => {
            onChange(mapGameState(payload.new));
          })
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_events", filter: `game_id=eq.${gameId}` }, async () => {
            const { data } = await client.from("game_states").select("*").eq("game_id", gameId).single();
            if (data) onChange(mapGameState(data));
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "pending_actions", filter: `game_id=eq.${gameId}` }, async () => {
            const { data } = await client.from("game_states").select("*").eq("game_id", gameId).single();
            if (data) onChange(mapGameState(data));
          })
          .subscribe();
        return () => { void client.removeChannel(channel); };
      },
    },
    replays: {
      async saveReplay(replay) {
        const row = await requireOne<any>(client.from("replays").insert({
          replay_id: replay.replayId,
          club_id: replay.clubId,
          table_id: replay.tableId,
          game_id: replay.gameId,
          summary: replay.summary,
          initial_state: replay.initialState,
          events: replay.events,
          snapshots: replay.snapshots,
        }).select("*").single());
        return { ...replay, replayId: row.replay_id, createdAt: toMillis(row.created_at) };
      },
      async getReplay(id) {
        const { data, error } = await client.from("replays").select("*").eq("replay_id", id).maybeSingle();
        if (error) throw error;
        return data ? { replayId: data.replay_id, clubId: data.club_id, tableId: data.table_id, gameId: data.game_id, summary: data.summary, initialState: data.initial_state, events: data.events, snapshots: data.snapshots, createdAt: toMillis(data.created_at) } : null;
      },
      async listReplays(clubId) {
        let query = client.from("replays").select("*").order("created_at", { ascending: false }).limit(200);
        if (clubId) query = query.eq("club_id", clubId);
        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []).map((row: any) => ({ replayId: row.replay_id, clubId: row.club_id, tableId: row.table_id, gameId: row.game_id, summary: row.summary, initialState: row.initial_state, events: row.events, snapshots: row.snapshots, createdAt: toMillis(row.created_at) }));
      },
    },
    clubPoints: {
      async applyDeltas(deltas) {
        if (deltas.length === 0) return;
        const { error } = await client.from("club_points").insert(deltas.map((delta) => ({ club_id: delta.clubId, user_id: delta.userId, amount: delta.amount, reason: delta.reason, game_id: delta.gameId })));
        if (error) throw error;
      },
      async listPointDeltas(clubId) {
        const { data, error } = await client.from("club_points").select("*").eq("club_id", clubId).order("created_at", { ascending: false });
        if (error) throw error;
        return (data ?? []).map((row: any) => ({ clubId: row.club_id, userId: row.user_id, amount: row.amount, reason: row.reason, gameId: row.game_id, createdAt: toMillis(row.created_at) }));
      },
    },
  };
}
