import * as fs from 'node:fs';

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as csv from 'csv-parse';
import { createObjectCsvWriter } from 'csv-writer';
import * as path from 'path';

import { CsvUploadDto } from '../common/dto/csv-upload.dto';
import { CreateBulkFileDto } from './dto/create-bulk-file.dto';
import { UpdateBulkFileDto } from './dto/update-bulk-file.dto';
import { BulkFile, BulkFileStatus } from './entities/bulk-file.entity';

@Injectable()
export class BulkFilesService {
  async getPendingBulkFile() {
    return await BulkFile.findBy({ file_status: BulkFileStatus.PENDING });
  }

  async saveBulkFile(createBulkFileDto: CreateBulkFileDto) {
    const bulkFile: BulkFile = BulkFile.create({ ...createBulkFileDto });
    return bulkFile.save();
  }

  async updateBulkFile(id: number, updateBulkFileDto: UpdateBulkFileDto) {
    try {
      const bulkFile: BulkFile = await BulkFile.findOneBy({ id });
      const updateData = { ...bulkFile, ...updateBulkFileDto };

      await BulkFile.update(id, updateData);
      return updateData;
    } catch (e) {
      throw new HttpException(e, HttpStatus.BAD_REQUEST);
    }
  }

  async generateCsv(data: any[], filename: string): Promise<string> {
    // const filePath = path.join(__dirname, '..', 'uploads', filename);
    const csvSavePath = `./uploads/csv/validated/${filename}`;
    // Ensure the directory exists
    if (!fs.existsSync(path.dirname(csvSavePath))) {
      fs.mkdirSync(path.dirname(csvSavePath), { recursive: true });
    }

    const csvWriter = createObjectCsvWriter({
      path: csvSavePath,
      header: [
        { id: 'email_address', title: 'Email Address' },
        { id: 'account', title: 'Account' },
        { id: 'domain', title: 'Domain' },
        { id: 'email_status', title: 'Email Status' },
        { id: 'email_sub_status', title: 'Email Sub Status' },
        { id: 'domain_age_days', title: 'Domain Age Days' },
        { id: 'free_email', title: 'Free Email' },
      ],
    });

    await csvWriter.writeRecords(data);

    return csvSavePath; // Return the file path for downloading
  }

  async validateCsvData(file): Promise<any> {
    const csvContent = file;
    const parsedData: any = await new Promise((resolve, reject) => {
      csv.parse(
        csvContent,
        {
          columns: true,
          relax_quotes: true,
          skip_empty_lines: true,
          cast: true,
        },
        (err, records) => {
          if (err) {
            reject(err);
            return { error: true, message: 'Unable to parse file' };
          }
          resolve(records);
        },
      );
    });
    const errors: string[] = [];
    if (!parsedData.length) {
      errors.push('Empty File Provided');
      return {
        error: true,
        message: 'File Validation Failed',
        errorsArray: errors,
      };
    }
    //validate All Rows
    let rowCount = 0;
    for await (const [index, rowData] of parsedData.entries()) {
      const validationErrors = await this.validateFileRow(rowData);
      if (validationErrors.length) {
        return {
          error: true,
          message: `File Rows Validation Failed at row: ${index + 1} - ${validationErrors}`,
        };
      }
      rowCount++;
    }
    return { error: false, total_emails: rowCount };
  }

  async validateFileRow(rowData) {
    const errors: string[] = [];
    const csvDto = plainToInstance(CsvUploadDto, rowData);
    const validationErrors = await validate(csvDto);
    if (validationErrors.length > 0) {
      validationErrors.forEach((error) => {
        const { property, constraints } = error;
        const errorMessage = `${property}: ${Object.values(constraints).join(', ')}`;
        errors.push(errorMessage);
      });
    }
    return errors;
  }
}
