import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Session, UseGuards } from "@nestjs/common";
import { QuoteService } from "../service/quote.service";
import { SessionAuthGuard } from "src/guards/sessionAuth.guard";
import { PermissionsGuard } from "src/guards/permissions.guard";
import { CreateQuoteDTO } from "../dto/create-quote.dto";
import type { PaginationParams } from "src/types/pagination";
import { UpdateQuoteDTO } from "../dto/update-quote.dto";
import { UpdateQuoteStatusDTO } from "../dto/update-quote-status.dto";
import type { SessionData } from "express-session";

@Controller("quotes")
export class QuoteController{
    constructor(private readonly quoteService: QuoteService) {}

    @UseGuards(SessionAuthGuard, PermissionsGuard)
    @Post("/")
    async Create(@Body() dto: CreateQuoteDTO, @Session() session: SessionData){
        return this.quoteService.create(dto, session);
    }

    @UseGuards(SessionAuthGuard, PermissionsGuard)
    @Get("/")
    async GetAllAgainstCurrentUser(@Session() session: SessionData, @Query() params: PaginationParams){
        return this.quoteService.getAllAgainstCurrentUserCompany(session, params);
    }

     @Get('/favorites')
    async getAllFavoritesAgainstCurrentUser(
        @Session() session: SessionData,
        @Query() params: PaginationParams
    ) {
        return this.quoteService.getAllFavoritesAgainstCurrentUserCompany(session, params);
    }

    @UseGuards(SessionAuthGuard, PermissionsGuard)
    @Get('/favorites/:id')
    async GetFavoriteQuoteByIdAgainstCurrentUser(
        @Session() session: SessionData,
        @Param('id') id: number,
    ) {
        return this.quoteService.getFavoriteQuoteByIdAgainstCurrentUserCompany(session, id);
    }

    @UseGuards(SessionAuthGuard, PermissionsGuard)
    @Patch("/:id")
    async Update(@Param("id") quoteId: number, @Body() dto: UpdateQuoteDTO, @Session() session: SessionData){

        return this.quoteService.update(quoteId, dto, session)
    }

    @UseGuards(SessionAuthGuard, PermissionsGuard)
    @Get("/:id")
    async GetSingleAgainstCurrentUser(@Param("id") quoteId: number, @Session() session: SessionData){
        return this.quoteService.getSingleAgainstCurrentUserCompany(quoteId, session);
    }

    @UseGuards(SessionAuthGuard, PermissionsGuard)
    @Delete("/:id")
    async DeleteSingleAgainstCurrentUser(@Param("id") quoteId: number, @Session() session: SessionData){
        return this.quoteService.deleteSingleAgainstCurrentUserCompany(quoteId, session);
    }

    @UseGuards(SessionAuthGuard, PermissionsGuard)
    @Post("/:id/favorite")
    async MarkQuoteFavoriteAgainstCurrentUser(@Param("id") quoteId: number, @Session() session: SessionData){
        return this.quoteService.markQuoteFavoriteAgainstCurrentUserCompany(quoteId, session);
    }

    @UseGuards(SessionAuthGuard, PermissionsGuard)
    @Delete(':id/favorite')
    async UnmarkFavoriteAgainstCurrentUser(@Param('id') quoteId: number, @Session() session: SessionData) {
        return this.quoteService.unmarkQuoteFavoriteAgainstCurrentUserCompany(quoteId, session);
    }

   
    @UseGuards(SessionAuthGuard, PermissionsGuard)
    @Patch(':id/status')
    async UpdateStatus(
        @Param('id') quoteId: number, 
        @Body() dto: UpdateQuoteStatusDTO,
        @Session() session: SessionData
    ) {
        return this.quoteService.updateStatus(quoteId, dto, session);
    }

}