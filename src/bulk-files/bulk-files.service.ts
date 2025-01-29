import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateBulkFileDto } from './dto/create-bulk-file.dto';
import { UpdateBulkFileDto } from './dto/update-bulk-file.dto';
import * as csv from 'csv-parse';
import { plainToInstance } from 'class-transformer';
import { CsvUploadDto } from '../common/dto/csv-upload.dto';
import { validate } from 'class-validator';
import { BulkFile, BulkFileStatus } from './entities/bulk-file.entity';
import { stringify } from 'csv-stringify';
import * as fs from 'node:fs';
import * as path from 'path';
import { promisify } from 'util';
const writeFileAsync = promisify(fs.writeFile);


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

  async generateCsv(data: any[], fileName: string) {
    // Define the CSV headers with proper titles
    const columns = [
      { key: 'email_address', header: 'Email Address' },
      { key: 'account', header: 'Account' },
      { key: 'domain', header: 'Domain' },
      { key: 'email_status', header: 'Email Status' },
      { key: 'email_sub_status', header: 'Email Sub Status' },
      { key: 'domain_age_days', header: 'Domain Age Days' },
      { key: 'free_email', header: 'Free Email' },
    ];

    // Convert the array of objects to CSV
    return new Promise<string>((resolve, reject) => {
      stringify(data, { header: true, columns }, async (err, csv) => {
        if (err) {
          reject(err);
          return;
        }

        // Define CSV file save path
        // const csvSavePath = path.join(__dirname, '..', 'uploads', 'csv', 'validated', fileName);
        const csvSavePath = `./uploads/csv/validated/${fileName}`;
        // Ensure directory exists
        fs.mkdirSync(path.dirname(csvSavePath), { recursive: true });

        try {
          await writeFileAsync(csvSavePath, csv);
          resolve(csvSavePath);
        } catch (writeErr) {
          reject(writeErr);
        }
      });
    });
  }

  // async generateCsv(data: any[], fileName: string): Promise<string> {
  //   // Define the CSV headers
  //   const columns = [
  //     { key: 'email_address', header: 'Email Address' },
  //     { key: 'account', header: 'Account' },
  //     { key: 'domain', header: 'Domain' },
  //     { key: 'email_status', header: 'Email Status' },
  //     { key: 'email_sub_status', header: 'Email Sub Status' },
  //     { key: 'domain_age_days', header: 'Domain Age Days' },
  //     { key: 'free_email', header: 'Free Email' },
  //   ];
  //
  //   // Convert JSON data to CSV
  //   const csv = stringify(data, { header: true, columns });
  //
  //   // Define CSV file save path
  //   const csvSavePath = path.join(__dirname, '..', 'uploads', 'csv', 'validated', fileName);
  //
  //   // Ensure directory exists
  //   fs.mkdirSync(path.dirname(csvSavePath), { recursive: true });
  //
  //   // Write CSV to file
  //   await fs.promises.writeFile(csvSavePath, csv, 'utf8');
  //
  //   return csvSavePath;
  // }

  // async generateCsv(data: any[], fileName) {
  //   // Define the CSV headers
  //   const headers = [
  //     'email_address',
  //     'account',
  //     'domain',
  //     'email_status',
  //     'email_sub_status',
  //     'domain_age_days',
  //     'free_email',
  //   ];
  //
  //   // Convert the array of objects to CSV
  //   const csv = stringify(data, {
  //     header: true,
  //     columns: headers,
  //   });
  //   const csvSavePath = `./uploads/csv/validated/${fileName}`;
  //   fs.writeFile(csvSavePath, csv, (err) => {
  //     console.log(err);
  //   });
  //   return csvSavePath;
  // }

  async validateCsvData(file): Promise<any> {
    const csvContent = file;
    const parsedData: any = await new Promise((resolve, reject) => {
      csv.parse(csvContent, {
        columns: true,
        relax_quotes: true,
        skip_empty_lines: true,
        cast: true,
      }, (err, records) => {
        if (err) {
          reject(err);
          return { error: true, message: 'Unable to parse file' };
        }
        resolve(records);
      });
    });
    const errors: string[] = [];
    if (!parsedData.length) {
      errors.push('Empty File Provided');
      return { error: true, message: 'File Validation Failed', errorsArray: errors };
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
