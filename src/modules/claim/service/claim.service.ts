// claims/services/consumer-claims.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { Shipment } from 'src/entities/shipment.entity';
import { Claim } from 'src/entities/claim.entity';
import { ClaimStatus, ClaimType } from 'src/common/enum/claims';
import { User } from 'src/entities/user.entity';
import { CreateClaimDto } from '../dto/create-claim.dto';
import { SessionData } from 'express-session';
import { ROLES } from 'src/common/constants/roles';
import { Company } from 'src/entities/company.entity';
import { buildQuery } from 'src/utils/api-query';
import { RequestContextService } from 'src/utils/request-context-service';
import { ClaimDocument } from 'src/entities/claim-document.entity';
import { allowedTransitions } from 'src/common/constants/claim';
import { UpdateClaimStatusDto } from '../dto/update-claim-status.dto';
import { join } from 'path';
import fs from 'fs/promises';
import { UpdateClaimDTO } from '../dto/update-clain.dto';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { ClaimComment } from 'src/entities/claim-comment.entity';
import { CreateClaimCommentDto } from 'src/modules/claim/dto/create-claim-comment.dto';


@Injectable()
export class ClaimService {
  constructor(
    private readonly em: EntityManager, 
    private readonly requestContextService: RequestContextService,
    @InjectQueue('claim-document-cleanup') private readonly cleanupQueue: Queue
  ) {}

  private serializeClaim(claim: Claim) {
  return {
    // --- Claim scalars ---
    id: claim.id,
    claimId: claim.claimId,
    status: claim.status,
    claimName: claim.claimName,
    claimType: claim.claimType,
    contactFullName: claim.contactFullName,
    contactPhoneNumber: claim.contactPhoneNumber,
    contactEmailAddress: claim.contactEmailAddress,
    additionalInsurancePurchased: claim.additionalInsurancePurchased,
    currency: claim.currency,
    goodsDescription: claim.goodsDescription,
    totalValueOfGoods: claim.totalValueOfGoods,
    additionalNotes: claim.additionalNotes,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
    statusUpdatedAt: claim.statusUpdatedAt,
    statusUpdatedBy: `${claim.statusUpdatedBy?.firstName} ${claim.statusUpdatedBy?.lastName}`,

    // --- Shipment (with hidden quote override) ---
    shipment: claim.shipment
      ? {
          id: claim.shipment.id,
          shipDate: claim.shipment.shipDate,
          serviceType: claim.shipment.serviceType,
          carrier: claim.shipment.carrier,
          trackingNumber: claim.shipment.trackingNumber,
          bolNumber: claim.shipment.bolNumber,
          totalNetCharge: claim.shipment.totalNetCharge,
          totalBaseCharge: claim.shipment.totalBaseCharge,
          surcharges: claim.shipment.surcharges,
          currency: claim.shipment.currency,
          bookedBy: claim.shipment.bookedBy
            ? {
                id: claim.shipment.bookedBy.id,
                firstName: claim.shipment.bookedBy.firstName,
                lastName: claim.shipment.bookedBy.lastName,
              }
            : null,
          quote: claim.shipment.quote
            ? {
                id: claim.shipment.quote.id,
                insurance: claim.shipment.quote.insurance
                  ? {
                      id: claim.shipment.quote.insurance.id,
                      amount: claim.shipment.quote.insurance.amount,
                      currency: claim.shipment.quote.insurance.currency,
                    }
                  : null,
              }
            : null,
        }
      : null,

    // --- Documents ---
    documents: claim.documents.getItems().map((doc) => ({
      id: doc.id,
      fileName: doc.fileName,
      fileUrl: doc.fileUrl,
      uploadedBy: doc.uploadedBy
        ? {
            firstName: doc.uploadedBy.firstName,
            lastName: doc.uploadedBy.lastName,
          }
        : null,
    })),

    // --- SubmittedBy ---
    submittedBy: claim.submittedBy
      ? {
          firstName: claim.submittedBy.firstName,
          lastName: claim.submittedBy.lastName,
        }
      : null,
  };
}
 async create(dto: CreateClaimDto, session: SessionData) {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    if (!ctx?.user?.accountIsVerified) {
        throw new ForbiddenException("Only approved account can create claim, get your account approved by admin first")
    }

    const shipment = await this.em.findOne(Shipment, { id: dto.shipmentId }, { populate: ['company'] });
    
    if (!shipment) {
      throw new BadRequestException('Invalid shipment id or you do not have required permissions');
    }

    if (shipment?.company?.id !== ctx?.company?.id) {
      throw new ForbiddenException('You do not own this shipment.');
    }

    if (shipment.currentStatus === 'READY_FOR_SHIP') {
      throw new BadRequestException('Cannot file a claim for a shipment with "ready for ship" status.');
    }

    const existing = await this.em.findOne(Claim, { shipment: shipment.id });
    
    if (existing) {
      throw new BadRequestException('A claim already exists for this shipment.');
    }

    if(![ClaimStatus.DRAFT, ClaimStatus.SUBMITTED].includes(dto.status)) {
      throw new BadRequestException('Claim status can be draft or submitted only');
    }

    // --- Build claim ---
    const claim = new Claim();
    claim.shipment = shipment;
    claim.status = dto.status;
    claim.submittedBy = ctx.user;
    claim.company = ctx.company;

    claim.contactFullName = dto.contactFullName;
    claim.contactPhoneNumber = dto.contactPhoneNumber;
    claim.contactEmailAddress = dto.contactEmailAddress;
    claim.claimName = dto.claimName;
    claim.claimType = dto.claimType;

    claim.additionalInsurancePurchased = dto.additionalInsurancePurchased;
    claim.currency = dto.currency;
    claim.totalValueOfGoods = dto.totalValueOfGoods;
    claim.goodsDescription = dto.goodsDescription;
    
    if (dto.claimType === ClaimType.MISSING && dto.additionalNotes) claim.additionalNotes = dto.additionalNotes;
    
    // --- Attach documents (URIs from DTO) ---
    if (dto.documents?.length) {
      const docs = dto.documents.map((docDto) => {
        const doc = new ClaimDocument();
        doc.fileUrl = docDto.fileUrl;
        doc.fileName = docDto.fileName;
        doc.mimeType = docDto.mimeType;
        doc.documentType = docDto.documentType;
        doc.claim = claim;
        doc.uploadedBy = ctx.user;
        return doc;
      });

      claim.documents.add(docs);
    }

    await this.em.persist(claim).flush();

    return {
      message: "Successfully created claim"
    };
  }

  async findAll(
  session: SessionData,
  params: Record<string, any>
  ) {
    // 1) Validate session details
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    // 2) Allowed fields for search & orderBy (includes new sortable fields)
    const allowedFields: Record<string, string> = {
      claimId: 'claimId',
      status: 'status',
      createdAt: 'createdAt',          // adjust if your date field is named differently
      carrier: 'shipment.carrier',     // sorting by relation works if you populate it
      shipmentType: 'shipment.shipmentType',
    };

    // 3) Build pagination params
    const { search, page, limit, orderBy } = buildQuery(params, allowedFields);

    // 4) Base filter scoped to company
    const filter: any = { };

    if (ctx.user.role.name !==  ROLES.SUPER_ADMIN && !ctx.user.role.name !==  ROLES.STAFF) {
        filter.company = ctx.company;
    }

    // 5) --- Date range filter ---
    if (params.fromDate || params.toDate) {
      filter.createdAt = {};
      if (params.fromDate) {
        filter.createdAt.$gte = new Date(params.fromDate);
      }
      if (params.toDate) {
        // Inclusive: set to end of the provided day
        const endOfDay = new Date(params.toDate);
        endOfDay.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = endOfDay;
      }
    }

    // 6) --- Search by claimId / name (text search) ---
    if (search) {
      filter.$or = [
        { claimId: { $ilike: `%${search}%` } },
        // Add additional name fields here if your Claim has a claimant name/title:
        // { claimantName: { $ilike: `%${search}%` } },
      ];
    }

    // 7) --- Filter by claim status ---
    if (params.status) {
      filter.status = params.status;
    }

    // 8) --- Filter by carrier & packaging type via shipment relation ---
    const shipmentFilter: any = {};
    
    if (params.carrier) {
      shipmentFilter.carrier = params.carrier;
    }
    
    // Accept either `packagingType` or `shipmentType` query param
    const typeFilter = params.packagingType || params.shipmentType;
    if (typeFilter) {
      shipmentFilter.shipmentType = typeFilter;
    }

    if (Object.keys(shipmentFilter).length > 0) {
      filter.shipment = shipmentFilter;
    }

    // 9) Count & paginate
    const total = await this.em.count(Claim, filter);
    const totalPages = Math.ceil(total / limit) || 1;
    const clampedPage = Math.min(page, totalPages);
    const offset = (clampedPage - 1) * limit;

    // 10) Fetch data
    const claims = await this.em.find(
      Claim,
      filter,
      {
        limit,
        offset,
        orderBy: Object.entries(orderBy).map(([field, direction]) => ({
          [field]: direction,
        })),
        populate: [
          'shipment',
          'shipment.quote',
          'shipment.surcharges',
          'shipment.quote.insurance',
          'shipment.bookedBy',
          'documents',
          'documents.uploadedBy',
          'submittedBy',
          'statusUpdatedBy'
        ],
      },
    );

    // Map to plain objects so hidden: true doesn't apply
    const serializedClaims = claims.map((claim) => this.serializeClaim(claim));


    // 11) Return with pagination metadata
    return {
      message: 'Successfully retrieved claims',
      claims: serializedClaims,
      pagination: {
        page: clampedPage,
        limit,
        total,
        totalPages,
      },
    };
  }

  async findOne(id: number, session:SessionData) {
    const claim = await this.em.findOne(
      Claim,
      { id },
      { populate: [ 
          'shipment',
          'shipment.quote',
          'shipment.surcharges',
          'shipment.quote.insurance',
          'shipment.bookedBy',
          'documents',
          'documents.uploadedBy',
          'submittedBy',
          'statusUpdatedBy'
        ] 
      },
    );

    if (!claim) {
      throw new NotFoundException('Claim not found.');
    }

    if (session.role !== ROLES.SUPER_ADMIN && claim.shipment?.company?.id !== session.companyId) {
      throw new ForbiddenException('You do not own this claim.');
    }

    const serializedClaim = [claim].map((claim) => this.serializeClaim(claim));
    
    return {
      message: 'Claim retrieved successfully',
      claim: serializedClaim[0],
    };
  }

  async updateStatus(
    id: number,
    dto: UpdateClaimStatusDto,
    session: SessionData,
  ) {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    if (session.role !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenException('Admin access required.');
    }

    const claim = await this.em.findOne(
      Claim,
      { id },
      {
        populate: [
          'shipment',
          'shipment.quote',
          'shipment.surcharges',
          'shipment.quote.insurance',
          'shipment.bookedBy',
          'documents',
          'documents.uploadedBy',
          'submittedBy',
        ],
      },
    );

    if (!claim) {
      throw new NotFoundException('Claim not found.');
    }

    const current = claim.status as ClaimStatus;
    const next = dto.status;

    if (!allowedTransitions[current]?.includes(next)) {
      throw new BadRequestException(
        `Cannot transition claim from "${current}" to "${next}".`,
      );
    }

    claim.status = next;

    if (dto.adminNotes && dto.status === ClaimStatus.REJECTED) {
      claim.adminNotes = dto.adminNotes;
    }

    claim.statusUpdatedAt = new Date();
    claim.statusUpdatedBy = ctx.user;

    await this.em.persist(claim).flush();

    return {
      message: `Claim status updated to ${next}`,
      claim: this.serializeClaim(claim),
    };
  }

  async deleteDocument(documentId: string, session: SessionData) { 
     const ctx = await this.requestContextService.resolve({ session, em: this.em });

    if (!ctx?.user?.accountIsVerified) {
        throw new ForbiddenException("Only approved account can delete document, get your account approved by admin first")
    }

    const isDbId = /^\d+$/.test(documentId);
  
    if (isDbId) {
      const id = parseInt(documentId, 10);

      const document = await this.em.findOne(
        ClaimDocument,
        { id },
        { populate: ['claim', 'claim.submittedBy'] },
      );

      if (!document) {
        throw new NotFoundException('Document not found');
      }

      const rawFilename = document.fileUrl.split('/').pop();
      if (rawFilename) {
        const filePath = join(process.cwd(), 'uploads', 'claims', rawFilename);

        try {
          await fs.unlink(filePath);
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            throw new BadRequestException('Failed to delete claim document. Try again later');
          }
          // ENOENT is ignored: file already gone, but we still remove the DB row
        }
      }

      this.em.remove(document);
      await this.em.flush();

      return { message: 'Successfully removed document' };
    }

    if (documentId.includes('..') || /[\\/]/.test(documentId)) {
      throw new BadRequestException('Invalid filename');
    }

    const filePath = join(process.cwd(), 'uploads', 'claims', documentId);

    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new NotFoundException('File not found on server');
      }
      throw new BadRequestException('Failed to delete file. Try again later');
    }

    return { message: 'Successfully removed file from server' };
  }

  async update(claimId: number, dto: UpdateClaimDTO, session: SessionData) {
    // 1) Get context from session
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    // 2) Only approve accounts can update claim
    if (!ctx?.user?.accountIsVerified) {
        throw new ForbiddenException("Only approved account can update claim, get your account approved by admin first")
    }

    // 3) Setup filter
    const filter: any = {
      id: claimId
    }

    // 4) Only approve accounts can 
    if (ctx.user.role.name !==  ROLES.SUPER_ADMIN && !ctx.user.role.name !==  ROLES.STAFF) {
        filter.company = ctx.company;
    }

    // 5) Find claim
    const claim = await this.em.findOne(
      Claim,
      filter,
      { populate: ['documents', 'company'] },
    );

    // 6) Throw error for invalid claim
    if (!claim) throw new NotFoundException("Claim not found or you don't have the permission to update this claim");


    // 7) Define fileds that can be updated
    const scalarFields = [
      'contactFullName',
      'contactPhoneNumber',
      'contactEmailAddress',
      'claimName',
      'additionalInsurancePurchased',
      'currency',
      'goodsDescription',
      'totalValueOfGoods',
      'claimType',
    ] as const;

    const hasScalarUpdate = scalarFields.some(
      (field) => dto[field] !== undefined,
    );

    const hasAdditionalNotes = dto.additionalNotes !== undefined;
    const hasDocuments = dto.documents !== undefined;

    if (!hasScalarUpdate && !hasAdditionalNotes && !hasDocuments) {
      return { message: 'Claim updated successfully', claim };
    }

    // 8) Update scalar fields
    for (const field of scalarFields) {
      if (dto[field] !== undefined) {
        (claim as any)[field] = dto[field];
      }
    }

    // 9) Handle additionalNotes
    if (dto.claimType !== undefined && dto.claimType !== ClaimType.MISSING) {
      claim.additionalNotes = null;
    } else if (dto.additionalNotes !== undefined) {
      claim.additionalNotes = dto.additionalNotes;
    }

    // 10) Diff documents (if provided)
    if (dto.documents !== undefined) {
      const existingDocs = claim.documents.getItems();
      const newDocUrls = new Set(dto.documents.map((d) => d.fileUrl));
      const existingUrls = new Set(existingDocs.map((d) => d.fileUrl));

      // 11) Documents to remove: exist in DB but not in new DTO
      const docsToRemove = existingDocs.filter((doc) => !newDocUrls.has(doc.fileUrl));

      for (const doc of docsToRemove) {
        // 12) Queue disk deletion for 10 minutes later
        const filename = doc.fileUrl.split('/').pop();
        if (filename) {
          const filePath = join(process.cwd(), 'uploads', 'claims', filename);
          await this.cleanupQueue.add(
            'delete-file',
            { filePath },
            { delay: 1 * 60 * 1000 }, // 10 minutes
          );
        }

        // 13) Remove from collection immediately (cascade handles DB)
        claim.documents.remove(doc);
      }

      // 14) Documents to add: exist in DTO but not in DB
      const docsToAdd = dto.documents.filter((docDto) => !existingUrls.has(docDto.fileUrl));

      if (docsToAdd.length) {
        const newDocs = docsToAdd.map((docDto) => {
          const doc = new ClaimDocument();
          doc.fileUrl = docDto.fileUrl;
          doc.fileName = docDto.fileName;
          doc.mimeType = docDto.mimeType;
          doc.fileSize = docDto.fileSize;
          doc.documentType = docDto.documentType;
          doc.claim = claim;
          doc.uploadedBy = ctx.user;
          return doc;
        });

        claim.documents.add(newDocs);
      }
    }

    // 15) Persist changes
    await this.em.flush();

    // 16) Return back success response
    return { message: 'Claim updated successfully'};
  }

  async addComment(claimId: number, dto: CreateClaimCommentDto, session: SessionData) {
    // 1) Get user from context
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    // 2) Only approve accounts can add comment
    if (ctx.user.role.name !==  ROLES.SUPER_ADMIN && !ctx?.user?.accountIsVerified) {
        throw new ForbiddenException("Only approved account can add comment, get your account approved by admin first")
    }

    // 3) Setup filter
    const filter: any = {
      id: claimId
    }

    // 4) Only approve accounts can 
    if (ctx.user.role.name !==  ROLES.SUPER_ADMIN && !ctx.user.role.name !==  ROLES.STAFF) {
        filter.company = ctx.company;
    }

    // 5) Get the claim
    const claim = await this.em.findOne(Claim, filter);
    
    // 6) Throw exception for invalid claim
    if (!claim) {
      throw new NotFoundException('Claim not found');
    }

    // 7) Add comment
    const comment = this.em.create(ClaimComment, {
      message: dto.message,
      addedBy: ctx.user,
      claim,
    });

    // 8) Persist it to database
    this.em.persist(comment);
    await this.em.flush();

    // 9) Return back success response
    return {
      message: 'Comment added successfully'
    };
  }

async getComments(claimId: number, session: SessionData) {
  // 1) Get context from session
  const ctx = await this.requestContextService.resolve({ session, em: this.em });
  
  // 2) Find claim
  const claim = await this.em.findOne(Claim, claimId);
  
  // 3) Throw exception for invalid claim
  if (!claim) {
    throw new NotFoundException('Claim not found');
  }

  // 4) Setup filter
  const filter: any = {
    claim: claimId
  }


  // 5) Only approve accounts can 
  if (ctx.user.role.name !==  ROLES.SUPER_ADMIN && !ctx.user.role.name !==  ROLES.STAFF) {
      filter.company = ctx.company;
  }

  // 6) Get all the comments for this calim
  const comments = await this.em.find(
    ClaimComment,
    filter,
    {
      populate: ['addedBy'],
      orderBy: { createdAt: 'DESC' },
    },
  );

  // 7) Return back success response
  return {
    message: 'Comments retrieved successfully',
    comments,
  };
}
}