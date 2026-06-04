import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Session,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CreateClaimDto } from '../dto/create-claim.dto';
import type { SessionData } from 'express-session';
import { SessionAuthGuard } from 'src/guards/sessionAuth.guard';
import { RolesGuard } from 'src/guards/roles.guard';
import { ROLES } from 'src/common/constants/roles';
import { Role } from "src/decorators/role.decorator";
import { ClaimService } from '../service/claim.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { claimDocsMulterConfig } from 'src/config/multer.config';
import { UpdateClaimStatusDto } from '../dto/update-claim-status.dto';
import { UploadClaimDocumentDTO } from '../dto/upload-claim.dto';
import { UpdateClaimDTO } from '../dto/update-claim.dto';
import { EntityManager } from '@mikro-orm/postgresql';
import { User } from 'src/entities/user.entity';
import { CreateClaimCommentDto } from 'src/modules/claim/dto/create-claim-comment.dto';


@Controller('claims')
export class ClaimController {
  constructor(private readonly claimsService: ClaimService, private readonly em: EntityManager) {}

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Post()
    async create(@Body() dto: CreateClaimDto, @Session() session: SessionData) {
        return this.claimsService.create(dto, session);
    }

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Put(':claimId')
    async update(@Param('claimId') claimId: number, @Body() dto: UpdateClaimDTO, @Session() session: SessionData) {
        return this.claimsService.update(claimId, dto, session);
    }

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Post('upload-documents')
    @UseInterceptors(FileInterceptor('file', claimDocsMulterConfig))
    async uploadClaimDocuments(@UploadedFile() file: Express.Multer.File,  @Body() body: UploadClaimDocumentDTO, @Session() session: SessionData) {
        if (!file) throw new BadRequestException('File missing, please attach file in request');

        const user = await this.em.findOne(User, { id: session.userId })
        
        if (!user?.accountIsVerified) {
            throw new ForbiddenException("Only approved account can create quote, get your account approved by admin first")
        }
        
        return {
            message: 'File uploaded successfully',
            document: [{
            fileUrl: `/uploads/claims/${file.filename}`,
            fileName: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            documentType: body.documentType,
            }]
        };
    }

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Delete('documents/:documentId')
    async deleteDocument(@Param('documentId') documentId: string, @Session() session: SessionData) {
        return  this.claimsService.deleteDocument(documentId, session);
    }

    @UseGuards(SessionAuthGuard)
    @Get('/')
    async findAll(@Session() session: SessionData, @Query() params: any) {
        return this.claimsService.findAll(session, params);
    }
    
    @UseGuards(SessionAuthGuard)
    @Post(':id/comments')
    async addComment(@Param('id') claimId: number, @Body() dto: CreateClaimCommentDto, @Session() session: SessionData) {
        return this.claimsService.addComment(claimId, dto, session);
    }

    @UseGuards(SessionAuthGuard)
    @Get(':id/comments')
    async getComments(@Param('id') claimId: number, @Session() session: SessionData) {
        return this.claimsService.getComments(claimId, session);
    }

    @UseGuards(SessionAuthGuard)
    @Get(':id')
    async findOne(
        @Param('id') id: number,
        @Session() session: SessionData
    ) {
        return this.claimsService.findOne(id, session);
    }

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.SUPER_ADMIN, ROLES.STAFF])
    @Patch(':id/status')
    async updateStatus(
        @Param('id') id: number,
        @Body() dto: UpdateClaimStatusDto,
        @Session() session: SessionData,
    ) {
        return this.claimsService.updateStatus(id, dto, session);
    }
}