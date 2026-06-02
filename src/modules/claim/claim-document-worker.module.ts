import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ClaimDocumentCleanupProcessor } from './processor/claim-documents-cleanup.processor';


@Module({
  imports: [
    BullModule.registerQueue({
      name: 'claim-document-cleanup',
    }),
  ],
  providers: [ClaimDocumentCleanupProcessor],
})
export class ClaimDocumentWorkerModule {}