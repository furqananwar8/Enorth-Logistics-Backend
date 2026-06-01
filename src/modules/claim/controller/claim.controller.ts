import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Session,
  UploadedFiles,
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
import { FilesInterceptor } from '@nestjs/platform-express';
import { claimDocsMulterConfig } from 'src/config/multer.config';
import { UpdateClaimStatusDto } from '../dto/update-claim-status.dto';


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
    @UseInterceptors(FilesInterceptor('files', 10, claimDocsMulterConfig))
    uploadClaimDocuments(@UploadedFiles() files: Express.Multer.File[]) {
        const documents = files.map((file) => ({
            fileUrl: `/uploads/claims/${file.filename}`,
            fileName: file.originalname,
            mimeType: file.mimetype,
        }));

        return {
            message: 'Files uploaded successfully',
            documents,
        };
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