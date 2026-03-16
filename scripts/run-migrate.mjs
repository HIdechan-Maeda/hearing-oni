#!/usr/bin/env node
/**
 * Supabase の questions_core を 10 列スキーマに更新するスクリプト
 * .env.local または .env の SUPABASE_DB_URL を読み込んで実行します。
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
dotenv.config({ path: join(root, '.env.local'), quiet: true });
dotenv.config({ path: join(root, '.env'), quiet: true });

const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('エラー: SUPABASE_DB_URL または DATABASE_URL を設定してください。');
  console.error('例: SUPABASE_DB_URL="postgresql://postgres.[ref]:[password]@aws-0-xx.pooler.supabase.com:6543/postgres"');
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: process.env.SUPABASE_DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
});

async function tableExists() {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'questions_core'`
  );
  return r.rowCount > 0;
}

async function hasOldColumns() {
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'questions_core'`
  );
  const names = r.rows.map((row) => row.column_name);
  return names.includes('explain_core') || names.includes('explain_reason');
}

async function main() {
  try {
    await client.connect();
    const exists = await tableExists();

    if (!exists) {
      console.log('questions_core が存在しないため、新規作成します。');
      const createSql = readFileSync(join(__dirname, 'create-questions-core.sql'), 'utf8');
      await client.query(createSql);
      console.log('完了: questions_core を作成しました。');
      return;
    }

    const needMigrate = await hasOldColumns();
    if (!needMigrate) {
      console.log('questions_core はすでに 10 列スキーマです。変更は不要です。');
      return;
    }

    console.log('questions_core を 10 列スキーマにマイグレーションします。');
    const migrateSql = readFileSync(join(__dirname, 'migrate-questions-core.sql'), 'utf8');
    await client.query(migrateSql);
    console.log('完了: questions_core を更新しました。');
  } catch (err) {
    console.error('マイグレーション失敗:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
