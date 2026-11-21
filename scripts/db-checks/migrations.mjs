import fs from "fs";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

/** supabase/migrations altındaki tüm SQL dosyalarını sırayla birleştirir */
export function allMigrations() {
  const dir = path.join(process.cwd(), "supabase/migrations");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
}

/**
 * Supabase'e benzeyen gömülü bir Postgres kurar ve tüm migration'ları uygular:
 * auth şeması, auth.uid() (auth.current tablosundan), authenticated/anon rolleri ve
 * Supabase'deki gibi public şemasındaki yeni tablo/fonksiyonlara varsayılan yetkiler.
 */
export async function setupDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
    create table auth.current (uid uuid);
    create function auth.uid() returns uuid language sql stable as $$ select uid from auth.current limit 1 $$;
    create role authenticated; create role anon;
    grant usage on schema public, auth to authenticated, anon;
    grant all on all tables in schema auth to authenticated;
    alter default privileges in schema public grant all on tables to authenticated, anon;
    alter default privileges in schema public grant all on sequences to authenticated, anon;
    alter default privileges in schema public grant execute on functions to authenticated, anon;
    -- Supabase Storage'ın sade taklidi (RLS açık, yetki politikalarla)
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text, owner uuid default auth.uid());
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, anon;
    grant all on storage.objects to authenticated, anon;
    grant select on storage.buckets to authenticated, anon;
  `);
  await db.exec(allMigrations());
  return db;
}

/** Test kullanıcısı olarak oturum aç (auth.uid() bu kullanıcıyı döndürür) */
export async function as(db, uid) {
  await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${uid}'); set role authenticated`);
}
