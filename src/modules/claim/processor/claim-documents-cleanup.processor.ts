// claims/processors/claim-document-cleanup.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { promises as fs } from 'fs';
import { Injectable, Logger } from '@nestjs/common';

export interface ClaimDocumentCleanupJob {
  filePath: string;
}

@Processor('claim-document-cleanup', { concurrency: 5 })
@Injectable()
export class ClaimDocumentCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(ClaimDocumentCleanupProcessor.name);

  async process(job: Job<ClaimDocumentCleanupJob>): Promise<{ status: string }> {
    const { filePath } = job.data;
    console.log("File path to delete", filePath)
    try {
      await fs.unlink(filePath);
      this.logger.log(`Deleted file: ${filePath}`);
      return { status: 'deleted' };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        this.logger.warn(`File already gone: ${filePath}`);
        return { status: 'already_gone' };
      }
      this.logger.error(`Failed to delete ${filePath}: ${err.message}`);
      throw err; // BullMQ will retry based on default settings
    }
  }
}