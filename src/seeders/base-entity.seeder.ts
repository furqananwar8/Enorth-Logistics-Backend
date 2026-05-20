import { EntityManager, AnyEntity } from "@mikro-orm/core";

export interface SeedData<T> {
  name: string;
  data: Partial<T>;
}

export interface SeedItem<T> {
  name: string;
  data: Partial<T>;
}

export interface SeederConfig<T extends AnyEntity> {
  entity: new () => T;
  items: SeedData<T>[];  // <-- array of objects, not just strings
  findExisting: (em: EntityManager, names: string[]) => Promise<T[]>;
  afterCreate?: (em: EntityManager, entityMap: Map<string, T>) => Promise<void> | void;
}

export async function seedEntities<T extends AnyEntity>(
  em: EntityManager,
  config: SeederConfig<T>
): Promise<Map<string, T>> {
  return await em.transactional(async (em) => {
    const names = config.items.map(i => i.name);
    const existing = await config.findExisting(em, names);
    
    const entityMap = new Map(existing.map(e => [(e as any).name, e]));
    const missing: T[] = [];

    for (const item of config.items) {
      if (!entityMap.has(item.name)) {
        const entity = em.create(config.entity, { 
          name: item.name,
          ...item.data  // spread all other fields
        });
        missing.push(entity);
        entityMap.set(item.name, entity);
      }
    }

    if (missing.length) em.persist(missing);

    if (config.afterCreate) {
      await config.afterCreate(em, entityMap);
    }
    
    return entityMap;
  });
}