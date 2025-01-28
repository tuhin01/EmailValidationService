import {
  Body,
  Controller, HttpException, HttpStatus,
  Post, Req,
} from '@nestjs/common';
import { DomainService } from './services/domain.service';
import { seconds, SkipThrottle, Throttle } from '@nestjs/throttler';
import { EmailDto } from './dto/email.dto';
import { FastifyRequest } from 'fastify';
import * as fs from 'node:fs';
import { parse } from 'csv-parse';


@Controller('email')
export class DomainsController {
  constructor(
    private readonly domainService: DomainService,
  ) {
  }


  // @Throttle({
  //   default: { limit: 5, ttl: seconds(5), blockDuration: seconds(1) },
  // })
  @SkipThrottle()
  @Post('validate')
  async validate(@Body() emailDto: EmailDto) {
    const { email } = emailDto;
    return await this.domainService.smtpValidation(email);
  }

  @SkipThrottle()
  @Post('bulk-validate')
  async bulkValidate() {
    const results = [];
    const csvPath = './uploads/csv/demo-contacts.csv';
    return new Promise((resolve, reject) => {
      // Read the CSV file
      fs.readFile(csvPath, 'utf8', (err, data) => {
        if (err) {
          reject(err);
          return;
        }

        // Parse the CSV content
        parse(data, {
          columns: true,  // Convert rows to objects using the first row as keys
          skip_empty_lines: true,  // Ignore empty lines
          trim: true,  // Trim spaces from values
        }, async (err, records) => {
          if (err) {
            reject(err);
            return;
          }
          for (const record of records) {
            const emailResult = await this.domainService.smtpValidation(record.Email);
            results.push(emailResult);
          }
          resolve(results);
        });
      });
    });
  }

  @SkipThrottle()
  @Post('upload')
  async uploadCsv(
    @Req() req: FastifyRequest,
    @Body() payload: any,
  ) {
    console.log(payload);
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
      const isValid = await this.domainService.validateCsvData(buffer);
      if (isValid.error) {
        throw new HttpException(isValid, HttpStatus.BAD_REQUEST);
      }
      const csvSavePath = `./uploads/csv/${file.filename}`;
      fs.writeFile(csvSavePath, buffer, (err) => {
        console.log(err);
      });
      return {
        message: 'File uploaded successfully!',
        fileName: file.filename,
        fileSize: buffer.length / (1024 * 1024),
      };
    } catch (e) {
      throw new HttpException(e, HttpStatus.BAD_REQUEST);
    }
  }


}
