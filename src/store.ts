import { DatabaseSync } from 'node:sqlite';
import type { Artifact, LineageNode } from './types.js';

export class ArtifactStore {
  private db: DatabaseSync;

  constructor(dbPath: string = 'runtime.db') {
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        parent_ids TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `);

    // Migration check for metadata column if table was created in older version
    const tableInfo = this.db.prepare(`PRAGMA table_info(artifacts)`).all() as Array<{ name: string }>;
    const hasMetadata = tableInfo.some((col) => col.name === 'metadata');
    if (!hasMetadata) {
      this.db.exec(`ALTER TABLE artifacts ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'`);
    }
  }

  put(artifact: Artifact): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO artifacts (id, type, content, created_by, created_at, parent_ids, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      artifact.id,
      artifact.type,
      artifact.content,
      artifact.createdBy,
      artifact.createdAt,
      JSON.stringify(artifact.parentIds ?? []),
      JSON.stringify(artifact.metadata ?? {})
    );
  }

  has(id: string): boolean {
    const row = this.db.prepare(`SELECT id FROM artifacts WHERE id = ?`).get(id);
    return !!row;
  }

  get(id: string): Artifact {
    const row = this.db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id) as any;
    if (!row) throw new Error(`Artifact not found: ${id}`);
    return this.mapRow(row);
  }

  tryGet(id: string): Artifact | undefined {
    const row = this.db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id) as any;
    if (!row) return undefined;
    return this.mapRow(row);
  }

  list(limit?: number): Artifact[] {
    const sql = limit ? `SELECT * FROM artifacts ORDER BY created_at DESC LIMIT ?` : `SELECT * FROM artifacts ORDER BY created_at ASC`;
    const rows = limit
      ? (this.db.prepare(sql).all(limit) as any[])
      : (this.db.prepare(sql).all() as any[]);
    const items = rows.map((r) => this.mapRow(r));
    return limit ? items.reverse() : items;
  }

  findByType(type: string): Artifact[] {
    const rows = this.db.prepare(`SELECT * FROM artifacts WHERE type = ? ORDER BY created_at ASC`).all(type) as any[];
    return rows.map((r) => this.mapRow(r));
  }

  findByParentId(parentId: string): Artifact[] {
    // parent_ids is stored as JSON array string, e.g. ["id1", "id2"]
    const all = this.list();
    return all.filter((a) => a.parentIds.includes(parentId));
  }

  findByCorrelationId(correlationId: string): Artifact[] {
    const all = this.list();
    return all.filter((a) => a.metadata?.correlationId === correlationId);
  }

  getLineage(id: string, visited = new Set<string>()): LineageNode {
    if (visited.has(id)) {
      throw new Error(`Cycle detected in lineage for artifact: ${id}`);
    }
    visited.add(id);

    const artifact = this.get(id);
    const parents: LineageNode[] = [];
    for (const parentId of artifact.parentIds) {
      if (this.has(parentId)) {
        parents.push(this.getLineage(parentId, new Set(visited)));
      }
    }

    return { artifact, parents };
  }

  getAncestors(id: string): Artifact[] {
    const ancestors: Artifact[] = [];
    const queue = [...(this.tryGet(id)?.parentIds ?? [])];
    const seen = new Set<string>(queue);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const item = this.tryGet(currentId);
      if (item) {
        ancestors.push(item);
        for (const pid of item.parentIds) {
          if (!seen.has(pid)) {
            seen.add(pid);
            queue.push(pid);
          }
        }
      }
    }

    return ancestors;
  }

  close(): void {
    this.db.close();
  }

  private mapRow(row: any): Artifact {
    return {
      id: row.id,
      type: row.type,
      content: row.content,
      createdBy: row.created_by,
      createdAt: row.created_at,
      parentIds: JSON.parse(row.parent_ids || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }
}

