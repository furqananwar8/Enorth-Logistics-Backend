import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import config from './mikro-orm.config';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EmailModule } from './email/email.module';
import { OtpModule } from './modules/otp/opt.module';
import { PermissionModule } from './modules/permission/permission.module';
import { RoleModule } from './modules/role/role.module';
import { MulterModule } from '@nestjs/platform-express';
import { CompanyModule } from './modules/company/company.module';
import { getEnv } from './utils/getEnv';
import { ENV } from './common/constants/env';
import { AddressBookModule } from './modules/address-book/address-book.module';
import { SignatureModule } from './modules/signature/signature.module';
import { PalletShippingLocationTypeModule } from './modules/pallet-shipping-location-type/pallet-shiping-location-type.module';
import { QuoteModule } from './modules/quote/quote.module';
import { LineItemUnitModule } from './modules/line-item-unit/line-item-unit.module';
import { ShipmentModule } from './modules/shipment/shipment.module';
import { SSEModule } from './modules/sse/sse.module';
import { NotificationsModule } from './modules/notification/notification.module';
import { ReminderModule } from './modules/reminder/reminder.module';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from './shared/redis/redis.module';
import { ShipmentCarrierModule } from './modules/shipment-carrier/shipment-carrier.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { PostalCodeModule } from './modules/postal-code/postal-code.module';
import { PaymentModule } from './modules/payment/payment.module';
import { SurchargeModule } from './modules/surcharge/surcharge.module';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { ClaimModule } from './modules/claim/claim.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    MikroOrmModule.forRoot({
      ...config,
      autoLoadEntities: true
    }),
    MulterModule.register({
      dest: getEnv(ENV.IMAGE_UPLOAD_DESTINATION)
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    AuthModule,
    UserModule,
    CompanyModule,
    EmailModule,
    OtpModule,
    PermissionModule,
    RoleModule,
    AddressBookModule,
    SignatureModule,
    PalletShippingLocationTypeModule,
    QuoteModule,
    LineItemUnitModule,
    ShipmentModule,
    SSEModule,
    NotificationsModule,
    ReminderModule,
    ShipmentCarrierModule,
    TrackingModule,
    PostalCodeModule,
    PaymentModule,
    SurchargeModule,
    InvoiceModule,
    ClaimModule
  ],
  controllers: [AppController],
  providers: [AppService],
})

export class AppModule {}
