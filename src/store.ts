import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { Channel, MetaApp, WebhookEvent } from "./types";

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");

const DATABASE_URL = (process.env.DATABASE_URL || "").trim();
const usePostgres = !!DATABASE_URL;
const EVENTS_MAX = Math.max(50, Number(process.env.WEBHOOK_EVENTS_MAX) || 500);

interface GlobalSettings {
  brandName?: string;
  updatedAt?: string;
}

let pool: Pool | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;

let settingsCache: GlobalSettings = {};
let apps: MetaApp[] = [];
let channels: Channel[] = [];
let events: WebhookEvent[] = [];

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    const full = path.join(DATA_DIR, file);
    if (!fs.existsSync(full)) return fallback;
    return JSON.parse(fs.readFileSync(full, "utf-8")) as T;
  } catch (err) {
    console.error(`[store] could not read ${file}:`, err);
    return fallback;
  }
}

function writeJsonNow(file: string, data: unknown): void {
  try {
    ensureDir();
    const full = path.join(DATA_DIR, file);
    const tmp = `${full}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, full);
  } catch (err) {
    console.error(`[store] could not write ${file}:`, err);
  }
}

function normalizeSslConfig(url: string): any {
  if (/sslmode=(require|verify-ca|verify-full)/i.test(url)) {
    return { rejectUnauthorized: false };
  }
  if (/sslmode=disable/i.test(url)) return false;
  return undefined;
}

function pg(): Pool {
  if (!pool) {
    const ssl = normalizeSslConfig(DATABASE_URL);
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX) || 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ...(ssl === undefined ? {} : { ssl }),
    });
  }
  return pool;
}

async function initPostgres(): Promise<void> {
  const db = pg();
  await db.query(`
    create table if not exists hub_settings (
      id integer primary key default 1 check (id = 1),
      data jsonb not null,
      updated_at timestamptz not null default now()
    );

    create table if not exists hub_apps (
      id text primary key,
      data jsonb not null,
      created_at timestamptz,
      updated_at timestamptz not null default now()
    );

    create table if not exists hub_channels (
      id text primary key,
      external_id text not null,
      type text not null,
      data jsonb not null,
      created_at timestamptz,
      updated_at timestamptz not null default now(),
      unique (external_id, type)
    );

    create table if not exists hub_events (
      id text primary key,
      ts timestamptz not null,
      data jsonb not null
    );

    create index if not exists hub_events_ts_idx on hub_events (ts);
  `);
  await refresh();
}

function initJson(): void {
  settingsCache = readJson<GlobalSettings>("settings.json", {});
  apps = readJson<MetaApp[]>("apps.json", []);
  channels = readJson<Channel[]>("channels.json", []);
  events = readJson<WebhookEvent[]>("events.json", []).slice(-EVENTS_MAX);
}

export function usesPostgres(): boolean {
  return usePostgres;
}

export async function init(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (usePostgres) await initPostgres();
    else initJson();
    initialized = true;
  })();
  return initPromise;
}

export async function refresh(): Promise<void> {
  if (!usePostgres) return;
  const db = pg();
  const [settingsRes, appsRes, channelsRes, eventsRes] = await Promise.all([
    db.query("select data from hub_settings where id = 1"),
    db.query("select data from hub_apps order by coalesce((data->>'createdAt')::timestamptz, created_at, updated_at) asc"),
    db.query("select data from hub_channels order by coalesce((data->>'createdAt')::timestamptz, created_at, updated_at) asc"),
    db.query("select data from hub_events order by ts desc limit $1", [EVENTS_MAX]),
  ]);
  settingsCache = (settingsRes.rows[0]?.data || {}) as GlobalSettings;
  apps = appsRes.rows.map((r) => r.data as MetaApp);
  channels = channelsRes.rows.map((r) => r.data as Channel);
  events = eventsRes.rows.map((r) => r.data as WebhookEvent).reverse();
}

export async function close(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
  initialized = false;
  initPromise = null;
}

async function saveSettingsRow(): Promise<void> {
  if (!usePostgres) {
    writeJsonNow("settings.json", settingsCache);
    return;
  }
  await pg().query(
    `insert into hub_settings (id, data, updated_at)
     values (1, $1::jsonb, now())
     on conflict (id) do update set data = excluded.data, updated_at = now()`,
    [JSON.stringify(settingsCache)]
  );
}

async function saveAppRow(app: MetaApp): Promise<void> {
  if (!usePostgres) {
    writeJsonNow("apps.json", apps);
    return;
  }
  await pg().query(
    `insert into hub_apps (id, data, created_at, updated_at)
     values ($1, $2::jsonb, $3::timestamptz, now())
     on conflict (id) do update set data = excluded.data, updated_at = now()`,
    [app.id, JSON.stringify(app), app.createdAt || null]
  );
}

async function deleteAppRow(id: string): Promise<void> {
  if (!usePostgres) {
    writeJsonNow("apps.json", apps);
    return;
  }
  await pg().query("delete from hub_apps where id = $1", [id]);
}

async function saveChannelRow(ch: Channel): Promise<void> {
  if (!usePostgres) {
    writeJsonNow("channels.json", channels);
    return;
  }
  await pg().query(
    `insert into hub_channels (id, external_id, type, data, created_at, updated_at)
     values ($1, $2, $3, $4::jsonb, $5::timestamptz, now())
     on conflict (external_id, type) do update
       set id = hub_channels.id,
           data = excluded.data || jsonb_build_object('id', hub_channels.id, 'createdAt', coalesce(hub_channels.data->>'createdAt', excluded.data->>'createdAt')),
           updated_at = now()`,
    [ch.id, ch.externalId, ch.type, JSON.stringify(ch), ch.createdAt || null]
  );
  await refresh();
}

async function deleteChannelRow(id: string): Promise<void> {
  if (!usePostgres) {
    writeJsonNow("channels.json", channels);
    return;
  }
  await pg().query("delete from hub_channels where id = $1", [id]);
}

async function saveEvents(): Promise<void> {
  if (!usePostgres) {
    writeJsonNow("events.json", events);
    return;
  }
  const db = pg();
  await db.query("begin");
  try {
    for (const ev of events) {
      await db.query(
        `insert into hub_events (id, ts, data)
         values ($1, $2::timestamptz, $3::jsonb)
         on conflict (id) do update set ts = excluded.ts, data = excluded.data`,
        [ev.id, ev.ts, JSON.stringify(ev)]
      );
    }
    await db.query(
      `delete from hub_events
       where id not in (select id from hub_events order by ts desc limit $1)`,
      [EVENTS_MAX]
    );
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

export function getSettings(): GlobalSettings {
  return settingsCache;
}

export async function saveSettings(next: GlobalSettings): Promise<GlobalSettings> {
  settingsCache = { ...settingsCache, ...next, updatedAt: new Date().toISOString() };
  await saveSettingsRow();
  return settingsCache;
}

export function listApps(): MetaApp[] {
  return apps;
}

export function findApp(id: string): MetaApp | undefined {
  return apps.find((a) => a.id === id);
}

export async function addApp(app: MetaApp): Promise<MetaApp> {
  apps.push(app);
  await saveAppRow(app);
  return app;
}

export async function updateApp(id: string, patch: Partial<MetaApp>): Promise<MetaApp | undefined> {
  const a = findApp(id);
  if (!a) return undefined;
  Object.assign(a, patch, { id: a.id, createdAt: a.createdAt, updatedAt: new Date().toISOString() });
  await saveAppRow(a);
  return a;
}

export async function deleteApp(id: string): Promise<boolean> {
  const idx = apps.findIndex((a) => a.id === id);
  if (idx < 0) return false;
  apps.splice(idx, 1);
  await deleteAppRow(id);
  return true;
}

export function listChannels(): Channel[] {
  return channels;
}

export function findChannelByExternalId(externalId: string): Channel | undefined {
  return channels.find((c) => c.externalId === externalId);
}

export function findChannelById(id: string): Channel | undefined {
  return channels.find((c) => c.id === id);
}

export function countChannelsByApp(appId: string): number {
  return channels.filter((c) => c.appId === appId).length;
}

export async function upsertChannel(ch: Channel): Promise<Channel> {
  const idx = channels.findIndex((c) => c.externalId === ch.externalId && c.type === ch.type);
  if (idx >= 0) {
    channels[idx] = { ...channels[idx], ...ch, id: channels[idx].id, createdAt: channels[idx].createdAt };
    await saveChannelRow(channels[idx]);
    return channels[idx];
  }
  channels.push(ch);
  await saveChannelRow(ch);
  return findChannelByExternalId(ch.externalId)!;
}

export async function deleteChannel(id: string): Promise<Channel | undefined> {
  const idx = channels.findIndex((c) => c.id === id);
  if (idx < 0) return undefined;
  const [removed] = channels.splice(idx, 1);
  await deleteChannelRow(id);
  return removed;
}

export async function touchChannelEvent(externalId: string): Promise<Channel | undefined> {
  const ch = findChannelByExternalId(externalId);
  if (ch) {
    ch.lastEventAt = new Date().toISOString();
    await saveChannelRow(ch);
  }
  return ch;
}

export async function addEvent(ev: WebhookEvent): Promise<void> {
  events.push(ev);
  if (events.length > EVENTS_MAX) events = events.slice(-EVENTS_MAX);
  await saveEvents();
}

export async function updateEvent(id: string, patch: Partial<WebhookEvent>): Promise<void> {
  const ev = events.find((e) => e.id === id);
  if (!ev) return;
  Object.assign(ev, patch);
  await saveEvents();
}

export async function setEventForward(eventId: string, url: string, ok: boolean, status: number | string): Promise<void> {
  const ev = events.find((e) => e.id === eventId);
  if (!ev) return;
  const f = ev.forwards.find((x) => x.url === url && x.status === "pending") || ev.forwards.find((x) => x.url === url);
  if (f) {
    f.ok = ok;
    f.status = status;
    await saveEvents();
  }
}

export function listEvents(sinceTs?: string, limit = 100): WebhookEvent[] {
  let out = events;
  if (sinceTs) out = out.filter((e) => e.ts > sinceTs);
  return out.slice(-limit).reverse();
}

export async function clearEvents(): Promise<void> {
  events = [];
  if (!usePostgres) {
    writeJsonNow("events.json", events);
    return;
  }
  await pg().query("delete from hub_events");
}

export function eventStats(): { total: number; lastHour: number; forwardsLastHour: number } {
  const hourAgo = Date.now() - 3600_000;
  let lastHour = 0;
  let forwardsLastHour = 0;
  for (const e of events) {
    const t = Date.parse(e.ts);
    if (!isNaN(t) && t >= hourAgo) {
      lastHour++;
      forwardsLastHour += e.forwards ? e.forwards.length : 0;
    }
  }
  return { total: events.length, lastHour, forwardsLastHour };
}
