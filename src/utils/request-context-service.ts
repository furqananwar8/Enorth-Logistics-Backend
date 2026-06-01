import { EntityManager } from "@mikro-orm/core";
import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { SessionData } from "express-session";
import { ROLES } from "src/common/constants/roles";
import { Company } from "src/entities/company.entity";
import { User } from "src/entities/user.entity";

export interface RequestContext {
  user: User;
  company: Company | null;
  permissions: any[];
}

export interface RequestContextServiceParams {
    session: SessionData,
    em: EntityManager
}

@Injectable()
export class RequestContextService {
  constructor() {}

  async resolve({session, em}: RequestContextServiceParams ): Promise<RequestContext> {
    const userId = session.userId;
    const companyId = session.companyId;
    const isAdminOrStaff = session.role === ROLES.SUPER_ADMIN || session.role === ROLES.STAFF;

    if (!userId || (!companyId && !isAdminOrStaff)) {
      throw new UnauthorizedException('Invalid session');
    }

    const user = await em.findOne(
      User,
      { id: userId },
      { populate: ['company','company.savedCards'], refresh: true}
    );

    if (!user) {
      throw new BadRequestException('Invalid user');
    }

    if (!isAdminOrStaff && user?.company?.id !== companyId) {
      throw new ForbiddenException('User does not belong to company');
    }

    const company = isAdminOrStaff 
      ? (user.company ?? null) 
      : await em.findOne(Company, { id: companyId }) as any;

    if (!isAdminOrStaff && !company) {
      throw new BadRequestException('Invalid company');
    }

    return {
      user,
      company,
      permissions: session.permissions ?? [],
    };
  }
}