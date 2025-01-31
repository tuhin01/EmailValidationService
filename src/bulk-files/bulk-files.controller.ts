import { Body, Controller, HttpException, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { BulkFilesService } from './bulk-files.service';
import { CreateBulkFileDto } from './dto/create-bulk-file.dto';
import { hours, minutes, SkipThrottle, Throttle } from '@nestjs/throttler';
import { FastifyRequest } from 'fastify';
import * as fs from 'node:fs';
import { BulkFileStatus } from './entities/bulk-file.entity';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

@Controller('bulk-files')
export class BulkFilesController {
  constructor(private readonly bulkFilesService: BulkFilesService) {
  }

  @Throttle({
    default: { limit: 500, ttl: minutes(1), blockDuration: minutes(1) },
  })
  @UseGuards(JwtAuthGuard)
  @Post('upload')
  async uploadCsv(
    @Req() req: FastifyRequest,
    @Body() payload: any,
  ) {
    if (!req.isMultipart()) {
      throw new HttpException(`Content-Type is not properly set.`, HttpStatus.NOT_ACCEPTABLE);
    }  // add this
    if (!req.file) {
      throw new HttpException(`File is required`, HttpStatus.BAD_REQUEST);
    }

    const allowedFIleType = [
      'text/csv',
    ];
    try {
      const file = await req.file({ limits: { fileSize: 40 * 1024 * 1024 } });
      if (!allowedFIleType.includes(file.mimetype)) {
        throw new HttpException(`${file.filename} is not allowed!`, HttpStatus.NOT_ACCEPTABLE);
      }

      const buffer = await file.toBuffer();
      const isValid = await this.bulkFilesService.validateCsvData(buffer);

      if (isValid.error) {
        throw new HttpException(isValid, HttpStatus.BAD_REQUEST);
      }
      const fileName = randomStringGenerator() + '.csv';
      const csvSavePath = `./uploads/csv/${fileName}`;
      fs.writeFile(csvSavePath, buffer, (err) => {
        console.log(err);
      });

      // After saving the file locally, saveBulkFile it's location in DB
      const bulkFile: CreateBulkFileDto = {
        file_path: csvSavePath,
        total_email_count: isValid.total_emails,
        file_status: BulkFileStatus.PENDING,
        valid_email_count: null,
        catch_all_count: null,
        invalid_email_count: null,
        do_not_mail_count: null,
        unknown_count: null,
        spam_trap_count: null,
        validation_file_path: null,
      };
      await this.bulkFilesService.saveBulkFile(bulkFile);

      return {
        message: 'File uploaded successfully!',
        fileName: file.filename,
        total_emails: isValid.total_emails,
      };
    } catch (e) {
      throw new HttpException(e, HttpStatus.BAD_REQUEST);
    }
  }
}
