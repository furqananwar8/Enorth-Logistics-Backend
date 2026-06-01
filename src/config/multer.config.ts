import { diskStorage } from 'multer';
import { BadRequestException } from '@nestjs/common';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export const sizeInMb = 1024 * 1024;

function ensureDirSync(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export interface MulterOptions {
  destination: string;
  maxSizeMb: number;
  allowedMimeRegex: RegExp;
}

export const createMulterConfig = (options: MulterOptions) => {
  ensureDirSync(options.destination);

  return {
    storage: diskStorage({
      destination: options.destination,
      filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueName + extname(file.originalname));
      },
    }),
    limits: {
      fileSize: options.maxSizeMb * sizeInMb,
    },
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.match(options.allowedMimeRegex)) {
        return cb(
          new BadRequestException(
            `Only files matching ${options.allowedMimeRegex} are allowed`
          ),
          false
        );
      }
      cb(null, true);
    },
  };
};

export const multerConfig = createMulterConfig({
  destination: join(process.cwd(), 'uploads','profile-pics'),
  maxSizeMb: 2,
  allowedMimeRegex: /\/(jpg|jpeg|png|webp)$/,
});

export const claimDocsMulterConfig = createMulterConfig({
  destination: join(process.cwd(), 'uploads', 'claims'),
  maxSizeMb: 5,
  allowedMimeRegex: /\/(jpg|jpeg|png|webp|pdf)$/,
});