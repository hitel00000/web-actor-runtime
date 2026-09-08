export type ExecutionState = 'claimed' | 'completed' | 'failed';

export interface ExecutionRecord {
  executionKey: string;
  actorId: string;
  inputIds: string[];
  state: ExecutionState;
  timestamp: string;
}

export class ExecutionRegistry {
  private records = new Map<string, ExecutionRecord>();

  /**
   * Derives a deterministic unique key for an Actor execution based on
   * actor ID and the sorted list of input artifact IDs.
   */
  generateKey(actorId: string, inputIds: string[]): string {
    const sorted = [...inputIds].sort().join('+');
    return `${actorId}::${sorted}`;
  }

  /**
   * Atomically claims an execution for the given actor and inputs.
   * Returns true if successfully claimed, or false if already claimed/completed.
   */
  claim(actorId: string, inputIds: string[]): boolean {
    const key = this.generateKey(actorId, inputIds);
    const existing = this.records.get(key);

    if (existing && (existing.state === 'claimed' || existing.state === 'completed')) {
      return false;
    }

    this.records.set(key, {
      executionKey: key,
      actorId,
      inputIds: [...inputIds].sort(),
      state: 'claimed',
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  /**
   * Marks an execution as completed.
   */
  complete(actorId: string, inputIds: string[]): void {
    const key = this.generateKey(actorId, inputIds);
    const record = this.records.get(key);
    if (record) {
      record.state = 'completed';
      record.timestamp = new Date().toISOString();
    } else {
      this.records.set(key, {
        executionKey: key,
        actorId,
        inputIds: [...inputIds].sort(),
        state: 'completed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Releases an execution (e.g. on transient failure) allowing subsequent retries.
   */
  release(actorId: string, inputIds: string[]): void {
    const key = this.generateKey(actorId, inputIds);
    this.records.delete(key);
  }

  /**
   * Checks if an execution has already been claimed or completed.
   */
  isClaimedOrCompleted(actorId: string, inputIds: string[]): boolean {
    const key = this.generateKey(actorId, inputIds);
    const existing = this.records.get(key);
    return existing ? existing.state === 'claimed' || existing.state === 'completed' : false;
  }

  getRecord(actorId: string, inputIds: string[]): ExecutionRecord | undefined {
    const key = this.generateKey(actorId, inputIds);
    return this.records.get(key);
  }

  clear(): void {
    this.records.clear();
  }
}
