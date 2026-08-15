import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATION_001 } from './migrations/001_initial.js';
import { MIGRATION_002 } from './migrations/002_task_documents.js';
import { MIGRATION_003 } from './migrations/003_local_knowledge.js';
import { MIGRATION_004 } from './migrations/004_disclosure_grants.js';
import { MIGRATION_005 } from './migrations/005_task_verification_command.js';
import { MIGRATION_006 } from './migrations/006_role_assignments.js';
import { MIGRATION_007 } from './migrations/007_graph_run_blocked.js';
import { MIGRATION_008 } from './migrations/008_change_contracts.js';
import { MIGRATION_009 } from './migrations/009_task_contract_requirement.js';
import { MIGRATION_010 } from './migrations/010_feedback_items.js';
import { MIGRATION_011 } from './migrations/011_execution_plans.js';
import { MIGRATION_012 } from './migrations/012_concurrency_policy.js';
import { MIGRATION_013 } from './migrations/013_verification_specifications.js';
import { MIGRATION_014 } from './migrations/014_verification_results.js';
import { MIGRATION_015 } from './migrations/015_runner_identities.js';
import { MIGRATION_016 } from './migrations/016_change_passports.js';
import { MIGRATION_017 } from './migrations/017_role_recommendations.js';
import { MIGRATION_018 } from './migrations/018_task_role_assignments.js';
import { MIGRATION_019 } from './migrations/019_external_agent_events.js';
import { MIGRATION_020 } from './migrations/020_github_identity.js';
import { MIGRATION_021 } from './migrations/021_github_authority_links.js';
import { MIGRATION_022 } from './migrations/022_github_status_checks.js';
import { MIGRATION_023 } from './migrations/023_github_review_publications.js';
import { MIGRATION_024 } from './migrations/024_github_comment_feedback.js';
import { MIGRATION_025 } from './migrations/025_organisation_rbac.js';
import { MIGRATION_026 } from './migrations/026_trusted_runners.js';
import { MIGRATION_027 } from './migrations/027_shared_policies_credentials.js';
import { MIGRATION_028 } from './migrations/028_multi_party_transparency.js';
import { MIGRATION_029 } from './migrations/029_metadata_sync.js';
import { MIGRATION_030 } from './migrations/030_outcome_observations.js';
import { MIGRATION_031 } from './migrations/031_outcome_task_classes.js';
import { MIGRATION_032 } from './migrations/032_post_merge_outcomes.js';
import { MIGRATION_033 } from './migrations/033_adaptive_routing_controls.js';
import { MIGRATION_034 } from './migrations/034_invocation_identity.js';
import { MIGRATION_035 } from './migrations/035_workflow_snapshots.js';
import { MIGRATION_036 } from './migrations/036_driver_sessions.js';
import { MIGRATION_037 } from './migrations/037_graph_run_resumed_loop_iterations.js';

export type SqliteDb = Database.Database;

export interface OpenDatabaseOptions {
  path: string;
  readonly?: boolean;
}

export function openDatabase(options: OpenDatabaseOptions): SqliteDb {
  mkdirSync(dirname(options.path), { recursive: true });
  const db = new Database(options.path, {
    readonly: options.readonly ?? false,
    fileMustExist: false,
  });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function migrate(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: number }).version),
  );

  const migrations = [
    MIGRATION_001,
    MIGRATION_002,
    MIGRATION_003,
    MIGRATION_004,
    MIGRATION_005,
    MIGRATION_006,
    MIGRATION_007,
    MIGRATION_008,
    MIGRATION_009,
    MIGRATION_010,
    MIGRATION_011,
    MIGRATION_012,
    MIGRATION_013,
    MIGRATION_014,
    MIGRATION_015,
    MIGRATION_016,
    MIGRATION_017,
    MIGRATION_018,
    MIGRATION_019,
    MIGRATION_020,
    MIGRATION_021,
    MIGRATION_022,
    MIGRATION_023,
    MIGRATION_024,
    MIGRATION_025,
    MIGRATION_026,
    MIGRATION_027,
    MIGRATION_028,
    MIGRATION_029,
    MIGRATION_030,
    MIGRATION_031,
    MIGRATION_032,
    MIGRATION_033,
    MIGRATION_034,
    MIGRATION_035,
    MIGRATION_036,
    MIGRATION_037,
  ];
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const tx = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
    });
    tx();
  }
}

export function openMigratedDatabase(path: string): SqliteDb {
  const db = openDatabase({ path });
  migrate(db);
  return db;
}
