// src/seeders/role.seeder.ts
import { EntityManager } from "@mikro-orm/core";
import { Role } from "src/entities/role.entity";
import { Permission } from "src/entities/permission.entity";
import { RoleNames, ROLES } from "src/common/constants/roles";
import { seedEntities, SeedItem } from "./base-entity.seeder";
import { ENV } from "src/common/constants/env";
import { ADMIN_EXCLUDED_PERMISSIONS, SUPER_ADMIN_ALLOWED_PERMISSIONS } from "src/common/constants/permissions";
import { User } from "src/entities/user.entity";
import { getEnv } from "src/utils/getEnv";
import bcrypt from "bcrypt";

const roleData: SeedItem<Role>[] = RoleNames.map(name => ({
  name,
  data: {}
}));

export async function seedRoles(
  em: EntityManager, 
  permissionMap: Map<string, Permission>
): Promise<void> {
 await seedEntities(em, {
    entity: Role,
    items: roleData,
    findExisting: (em, names) => em.find(Role, { name: { $in: names } }),

    afterCreate: async (em, roleMap) => {

      // 1) Assign all permissions (except surcharges) to admin role
      const adminRole = roleMap.get(ROLES.ADMIN);
      if (adminRole) {
        const adminPermissions = Array.from(permissionMap.values()).filter(
          p => !ADMIN_EXCLUDED_PERMISSIONS.includes(p.name)
        );
        adminRole.permissions.set(adminPermissions);
      }

      // 2) Create default superAdmin account if not already present
      const superAdminRole = roleMap.get(ROLES.SUPER_ADMIN);
      if (superAdminRole) {

        const existing = await em.findOne(User, {
          role: { name: ROLES.SUPER_ADMIN }
        });

        if (!existing) {
          try {
            const defaultPassword = getEnv(ENV.SUPER_ADMIN_DEFAULT_PASSWORD);
            const passwordHash    = await bcrypt.hash(defaultPassword, 10);

            const superAdmin = em.create(User, {
              firstName:                 "Super",
              lastName:                  "Admin",
              email:                     getEnv(ENV.SUPER_ADMIN_EMAIL),
              password:                  passwordHash,
              role:                      superAdminRole,
              emailIsVerified:           true,
              freightBroker:             false,
              termsAndConditionAccepted: true,
              companyPolicyAccepted:     true,
              isMasterAccount:           false,
              accountIsVerified: true
            });

            const permissions = SUPER_ADMIN_ALLOWED_PERMISSIONS
              .map(name => permissionMap.get(name))
              .filter((p): p is Permission => !!p);

            superAdmin.permissions.set(permissions);

            await em.persist(superAdmin).flush(); // await was missing

            console.log(`✅ Default superAdmin created → ${superAdmin.email}`);

          } catch (err: any) {
             const util = require('util');
    console.error("❌ SuperAdmin seed error:");
    console.error("Name:",    err.name);
    console.error("Message:", typeof err.message === 'string' 
        ? err.message 
        : util.inspect(err.message, { depth: 1 })
    );
    console.error("Stack:",   err.stack?.split('\n').slice(0, 5).join('\n'));
          }
        }
      }
    }
});
}