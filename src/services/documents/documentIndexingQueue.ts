export type DocumentIndexJobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed';

export interface DocumentIndexJobSnapshot {
  id: string;
  documentId: string;
  fileName: string;
  status: DocumentIndexJobStatus;
  totalChunks: number;
  indexedChunks: number;
  attempts: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

interface DocumentIndexJob extends DocumentIndexJobSnapshot {
  chunks: string[];
  storeChunk: (chunk: string, index: number, total: number) => Promise<boolean>;
  resolve: (value: { chunkCount: number; indexed: boolean }) => void;
  onUpdate?: (snapshot: DocumentIndexJobSnapshot) => void;
}

class DocumentIndexingQueue {
  private jobs: DocumentIndexJob[] = [];
  private active = false;
  private paused = false;
  private listeners = new Set<(jobs: DocumentIndexJobSnapshot[]) => void>();

  enqueue(params: {
    documentId: string;
    fileName: string;
    chunks: string[];
    storeChunk: (chunk: string, index: number, total: number) => Promise<boolean>;
    onUpdate?: (snapshot: DocumentIndexJobSnapshot) => void;
  }): Promise<{ chunkCount: number; indexed: boolean }> {
    const { promise } = this.enqueueWithHandle(params);
    return promise;
  }

  enqueueWithHandle(params: {
    documentId: string;
    fileName: string;
    chunks: string[];
    storeChunk: (chunk: string, index: number, total: number) => Promise<boolean>;
    onUpdate?: (snapshot: DocumentIndexJobSnapshot) => void;
  }): { jobId: string; promise: Promise<{ chunkCount: number; indexed: boolean }> } {
    let jobId = '';
    const promise = this.createJob(params, (id) => {
      jobId = id;
    });
    return { jobId, promise };
  }

  private createJob(
    params: {
      documentId: string;
      fileName: string;
      chunks: string[];
      storeChunk: (chunk: string, index: number, total: number) => Promise<boolean>;
      onUpdate?: (snapshot: DocumentIndexJobSnapshot) => void;
    },
    onCreated?: (jobId: string) => void
  ): Promise<{ chunkCount: number; indexed: boolean }> {
    return new Promise((resolve) => {
      const now = Date.now();
      const job: DocumentIndexJob = {
        id: `doc-index-${now}-${Math.random().toString(36).slice(2, 8)}`,
        documentId: params.documentId,
        fileName: params.fileName,
        chunks: params.chunks,
        storeChunk: params.storeChunk,
        onUpdate: params.onUpdate,
        resolve,
        status: 'queued',
        totalChunks: params.chunks.length,
        indexedChunks: 0,
        attempts: 0,
        createdAt: now,
        updatedAt: now
      };
      onCreated?.(job.id);
      this.jobs.push(job);
      this.notify();
      void this.pump();
    });
  }

  pause(): void {
    this.paused = true;
    for (const job of this.jobs) {
      if (job.status === 'running') {
        job.status = 'paused';
        job.updatedAt = Date.now();
      }
    }
    this.notify();
  }

  resume(): void {
    this.paused = false;
    for (const job of this.jobs) {
      if (job.status === 'paused') {
        job.status = 'queued';
        job.updatedAt = Date.now();
      }
    }
    this.notify();
    void this.pump();
  }

  retry(jobId: string): boolean {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || job.status !== 'failed') return false;
    job.status = 'queued';
    job.error = undefined;
    job.updatedAt = Date.now();
    this.notify();
    void this.pump();
    return true;
  }

  getSnapshots(): DocumentIndexJobSnapshot[] {
    return this.jobs.map(({ chunks: _chunks, storeChunk: _storeChunk, resolve: _resolve, ...rest }) => ({
      ...rest
    }));
  }

  subscribe(listener: (jobs: DocumentIndexJobSnapshot[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshots());
    return () => this.listeners.delete(listener);
  }

  private async pump(): Promise<void> {
    if (this.active || this.paused) return;
    this.active = true;
    try {
      while (!this.paused) {
        const job = this.jobs.find((j) => j.status === 'queued');
        if (!job) return;
        await this.runJob(job);
      }
    } finally {
      this.active = false;
    }
  }

  private async runJob(job: DocumentIndexJob): Promise<void> {
    job.status = 'running';
    job.attempts += 1;
    job.updatedAt = Date.now();
    this.notify();

    try {
      for (let i = job.indexedChunks; i < job.chunks.length; i += 1) {
        if (this.paused) {
          job.status = 'paused';
          job.updatedAt = Date.now();
          this.notify();
          return;
        }
        const ok = await job.storeChunk(job.chunks[i], i, job.chunks.length);
        if (!ok) {
          throw new Error(`chunk ${i + 1}/${job.chunks.length} write returned false`);
        }
        job.indexedChunks = i + 1;
        job.updatedAt = Date.now();
        this.notify();
      }
      job.status = 'completed';
      job.updatedAt = Date.now();
      this.notify();
      job.resolve({ chunkCount: job.totalChunks, indexed: job.indexedChunks > 0 });
    } catch (e) {
      job.status = 'failed';
      job.error = e instanceof Error ? e.message : String(e);
      job.updatedAt = Date.now();
      this.notify();
      job.resolve({ chunkCount: job.totalChunks, indexed: job.indexedChunks > 0 });
    }
  }

  private notify(): void {
    const snapshots = this.getSnapshots();
    for (const snapshot of snapshots) {
      const job = this.jobs.find((j) => j.id === snapshot.id);
      job?.onUpdate?.(snapshot);
    }
    this.listeners.forEach((listener) => listener(snapshots));
  }
}

export const documentIndexingQueue = new DocumentIndexingQueue();
