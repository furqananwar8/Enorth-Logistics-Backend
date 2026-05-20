import { Collection, Entity, ManyToMany, PrimaryKey, Property } from "@mikro-orm/core";
import { Role } from "./role.entity";
import { User } from "./user.entity";

@Entity()
export class Permission {
    @PrimaryKey()
    id!: number;

    @Property({ unique: true})
    name!: string;

    @ManyToMany(() => Role, role => role.permissions)
    roles = new Collection<Role>(this);

    @ManyToMany(() => User, user => user.permissions)
    user = new Collection<User>(this);
}