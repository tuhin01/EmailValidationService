import { Controller, Post, Body, Req, HttpException, HttpStatus } from '@nestjs/common';
import { BulkFilesService } from './bulk-files.service';
import { CreateBulkFileDto } from './dto/create-bulk-file.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { FastifyRequest } from 'fastify';
import * as fs from 'node:fs';

@Controller('bulk-files')
export class BulkFilesController {
  constructor(private readonly bulkFilesService: BulkFilesService) {
  }

  @SkipThrottle()
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

      const csvSavePath = `./uploads/csv/${file.filename}`;
      fs.writeFile(csvSavePath, buffer, (err) => {
        console.log(err);
      });

      // After saving the file locally, save it's location in DB
      const bulkFile: CreateBulkFileDto = {
        file_path: csvSavePath,
        total_email_count: isValid.total_emails,
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
