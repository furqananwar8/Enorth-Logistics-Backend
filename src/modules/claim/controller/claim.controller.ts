import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
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


@Controller('claims')
export class ClaimController {
  constructor(private readonly claimsService: ClaimService) {}

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Post()
    async create(@Body() dto: CreateClaimDto, @Session() session: SessionData) {
        return this.claimsService.create(dto, session);
    }

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Post('upload-documents')
    @UseInterceptors(FileInterceptor('file', claimDocsMulterConfig))
    uploadClaimDocuments(@UploadedFile() file: Express.Multer.File,  @Body() body: UploadClaimDocumentDTO,) {
        if (!file) throw new BadRequestException('File missing, please attach file in request');

        return {
            message: 'File uploaded successfully',
            document: {
            fileUrl: `/uploads/claims/${file.filename}`,
            fileName: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            documentType: body.documentType,
            }
        };
    }

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Delete('documents/:documentId')
    async deleteDocument(@Param('documentId') documentId: number) {
        return  this.claimsService.deleteDocument(documentId);
    }

    @UseGuards(SessionAuthGuard)
    @Get()
    async findAll(@Session() session: SessionData, @Query() params: any) {
        return this.claimsService.findAll(session, params);
    }

    @UseGuards(SessionAuthGuard)
    @Get(':id')
    async findOne(
        @Param('id', ParseIntPipe) id: number,
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