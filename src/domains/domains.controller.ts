import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';
import { DomainService } from './services/domain.service';
import { SkipThrottle } from '@nestjs/throttler';
import { EmailDto } from './dto/email.dto';
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


}
