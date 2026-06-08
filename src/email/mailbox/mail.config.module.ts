import { MailerModule } from "@nestjs-modules/mailer";
import { Module } from "@nestjs/common";
import path from "path";
import { PugAdapter } from '@nestjs-modules/mailer/dist/adapters/pug.adapter';

const isDev = process.env.NODE_ENV !== "production";

@Module({
  imports: [
    MailerModule.forRoot({
      transport: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        pool: true,
        maxConnections: 5,
        dnsTimeout: 300,
        auth: {
          user: process.env.MAIL_USERNAME,
          pass: process.env.MAIL_PASSWORD
        },
        logger: isDev,
        debug: isDev,
      },
      defaults: {
        from: "noreply<enorthlogistics.com>"
      },
      template: {
        dir: path.join(__dirname, '../templates'),
        adapter: new PugAdapter(),
        options: {
          strict: true
        }
      }
    })
  ],
  exports: [MailerModule]
})


export class MailConfigModule {}