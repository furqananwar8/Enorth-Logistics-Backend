import { EntityManager } from "@mikro-orm/core";
import { seedShipmentLocationTypes } from "./pallet-shipment-location-type.seeder";
import { seedSignatures } from "./signature.seeder";
import { seedPermissions } from "./permission.seeder";
import { seedRoles } from "./role.seeder";

export async function runSeeders(em: EntityManager) {
  //1) Seed permissions first
  const permissionMap = await seedPermissions(em);
  
  //2) Seed roles with permission map for assignment
  await seedRoles(em, permissionMap);

  //3) Seed signature options
  await seedSignatures(em);

  //4) Seed shipment location types
  await seedShipmentLocationTypes(em);
}