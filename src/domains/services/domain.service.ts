import * as net from 'node:net';

import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { differenceInDays } from 'date-fns';
import * as dns from 'dns';
import * as parseWhois from 'parse-whois';
import { DataSource } from 'typeorm';
import * as whois from 'whois';

import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';
import {
  CATCH_ALL_CHECK_DAY_GAP,
  ERROR_DOMAIN_CHECK_DAY_GAP,
  MX_RECORD_CHECK_DAY_GAP,
  PROCESSED_EMAIL_CHECK_DAY_GAP,
  SPAM_DB_CHECK_DAY_GAP,
} from '@/common/utility/constant';
import { DNSBL } from '@/common/utility/dnsbl';
import DomainTypoChecker from '@/common/utility/domain-typo-checker';
import {
  EmailReason,
  EmailStatus,
  EmailStatusType,
  EmailValidationResponseType,
  ipBlockedStringsArray, SendMailOptions,
  SMTPResponseCode,
} from '@/common/utility/email-status-type';
import freeEmailProviderList from '@/common/utility/free-email-provider-list';
import { DisposableDomainsService } from '@/disposable-domains/disposable-domains.service';
import { EmailRolesService } from '@/email-roles/email-roles.service';
import { EmailRole } from '@/email-roles/entities/email-role.entity';
import { CreateDomainDto } from '@/domains/dto/create-domain.dto';
import { UpdateDomainDto } from '@/domains/dto/update-domain.dto';
import { Domain, MXRecord } from '@/domains/entities/domain.entity';
import { ErrorDomain } from '@/domains/entities/error_domain.entity';
import { ProcessedEmail, RetryStatus } from '@/domains/entities/processed_email.entity';
import { WinstonLoggerService } from '@/logger/winston-logger.service';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import { User } from '@/users/entities/user.entity';
import { MailerService } from '@/mailer/mailer.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DomainService {
  constructor(
    private dataSource: DataSource,
    private configService: ConfigService,
    private disposableDomainsService: DisposableDomainsService,
    private emailRolesService: EmailRolesService,
    private mailerService: MailerService,
    private winstonLoggerService: WinstonLoggerService,
  ) {
  }

  async createMany(domains: Domain[]) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.manager.save(Domain, domains);
      await queryRunner.commitTransaction();
    } catch (err) {
      // since we have errors lets rollback the changes we made
      await queryRunner.rollbackTransaction();
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    } finally {
      // you need to release a queryRunner which was manually instantiated
      await queryRunner.release();
    }
  }

  findAll(paginationQuery: PaginationQueryDto) {
    const { limit, offset } = paginationQuery;
    return Domain.find({
      skip: offset,
      take: limit,
    });
  }

  async findOne(domain: string) {
    return Domain.findOneBy({ domain });
  }

  async findErrorDomain(domain: string): Promise<ErrorDomain> {
    return new Promise(async (resolve: any, reject): Promise<ErrorDomain> => {
      // Check if domain is listed in error_domains and
      const errorDomain: ErrorDomain = await ErrorDomain.findOneBy({
        domain,
      });
      if (errorDomain) {
        const errorStatus: string = errorDomain.domain_error['status'];
        const dayPassedSinceCheck = differenceInDays(
          new Date(),
          errorDomain.created_at,
        );
        // if the error is 'spamtrap' and if error listed time
        // is not more than SPAM_DB_CHECK_DAY_GAP then we SKIP checking again
        if (errorStatus === EmailStatus.SPAMTRAP) {
          if (dayPassedSinceCheck < SPAM_DB_CHECK_DAY_GAP) {
            reject(errorDomain.domain_error);
            return;
          }
          // if the error is 'spamtrap' and if error listed time
          // is not more than CATCH_ALL_CHECK_DAY_GAP then we SKIP checking again
        } else if (errorStatus === EmailStatus.CATCH_ALL) {
          if (dayPassedSinceCheck < CATCH_ALL_CHECK_DAY_GAP) {
            reject(errorDomain.domain_error);
            return;
          }
        } else {
          if (dayPassedSinceCheck < ERROR_DOMAIN_CHECK_DAY_GAP) {
            reject(errorDomain.domain_error);
            return;
          }
        }
      }
      resolve(errorDomain);
    });
  }

  async saveProcessedEmail(processedEmail: EmailValidationResponseType, user, bulkFileId = null) {
    const existingDomain = await ProcessedEmail.findOneBy({
      email_address: processedEmail.email_address,
    });
    if (!existingDomain) {
      const dbProcessedEmail: ProcessedEmail = ProcessedEmail.create({
        ...processedEmail,
        user_id: user.id,
        bulk_file_id: bulkFileId,
      });
      return dbProcessedEmail.save();
    }
  }

  async getProcessedEmail(email: string) {
    const processedEmail: ProcessedEmail = await ProcessedEmail.findOneBy({
      email_address: email,
    });
    if (processedEmail) {
      const dayPassedSinceLastMxCheck = differenceInDays(
        new Date(),
        processedEmail.created_at,
      );

      if (
        (
          dayPassedSinceLastMxCheck < PROCESSED_EMAIL_CHECK_DAY_GAP
        )
        &&
        (
          processedEmail.email_status === EmailStatus.VALID ||
          processedEmail.email_status === EmailStatus.CATCH_ALL ||
          processedEmail.email_status === EmailStatus.SPAMTRAP ||
          processedEmail.email_status === EmailStatus.DO_NOT_MAIL
        )
      ) {
        return processedEmail;
      }

    }
    return null;
  }


  async getGrayListedProcessedEmail(bulkFileId: number) {
    return ProcessedEmail.find({
      where: [
        {
          email_sub_status: EmailReason.GREY_LISTED,
          bulk_file_id: bulkFileId,
          retry: RetryStatus.PENDING,
        },
        // {
        //   email_sub_status: EmailReason.MAILBOX_NOT_FOUND,
        //   bulk_file_id: bulkFileId,
        //   retry: RetryStatus.PENDING,
        // },
      ],
      order: {
        id: 'ASC',
      },
    });
  }

  async findProcessedEmailsByFileId(fileId: number) {
    return ProcessedEmail.find({
      where: { bulk_file_id: fileId },
      order: { id: 'ASC' },
    });
  }

  async create(createDomainDto: CreateDomainDto) {
    const existingDomain = await Domain.findOneBy({
      domain: createDomainDto.domain,
    });
    if (existingDomain) {
      throw new HttpException(
        `Domain ${createDomainDto.domain} already exist`,
        HttpStatus.FOUND,
      );
    }
    const domain = Domain.create({ ...createDomainDto });
    return domain.save();
  }

  async createOrUpdateErrorDomain(errorDomain: ErrorDomain) {
    const existingDomain = await ErrorDomain.findOneBy({
      domain: errorDomain.domain,
    });
    if (existingDomain) {
      if (
        errorDomain.domain_error['status'] !==
        existingDomain.domain_error['status']
      ) {
        return true;
      } else {
        existingDomain.domain_error = errorDomain.domain_error;
        await existingDomain.save();
        return true;
      }
    }
    const domain = ErrorDomain.create({ ...errorDomain });
    return domain.save();
  }

  async update(domain: string, updateDto: UpdateDomainDto) {
    const existingDomain = await Domain.findOneBy({ domain });
    if (!existingDomain) {
      throw new NotFoundException(`Domain #${domain} not found`);
    }
    if (updateDto.domain) delete updateDto.domain;
    const updatedDomain = { ...existingDomain, ...updateDto };
    try {
      await Domain.update(domain, updatedDomain);
      return updatedDomain;
    } catch (e) {
      throw new HttpException(e, HttpStatus.BAD_REQUEST);
    }
  }

  async updateProcessedEmail(processedEmailId: number, data) {
    const existingDomain = await ProcessedEmail.findOne({ where: { id: processedEmailId } });
    const updatedData = { ...existingDomain, ...data };
    await ProcessedEmail.update(processedEmailId, updatedData);
  }

  async updateProcessedEmailByEmail(email: string, data) {
    const existingDomain = await ProcessedEmail.findOne({ where: { email_address: email } });
    if (existingDomain) {
      const updatedData = { ...existingDomain, ...data };
      await ProcessedEmail.update(existingDomain.id, updatedData);
    }
  }

  async remove(domainRemove: string) {
    const domain = await Domain.findOneBy({ domain: domainRemove });
    return domain.remove();
  }

  // Validate email syntax
  async validateEmailFormat(email) {
    return new Promise((resolve, reject) => {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      const isValid = emailRegex.test(email);
      if (!isValid) {
        const error: EmailStatusType = {
          status: EmailStatus.INVALID,
          reason: EmailReason.INVALID_EMAIL_FORMAT,
        };
        reject(error);
        return;
      }
      resolve(true);
    });
  }

  // Perform WHOIS lookup for domain age
  async getDomainAge(domain: string, dbDomain: Domain) {
    return new Promise((resolve, reject) => {
      if (dbDomain) {
        resolve({ domain_age_days: dbDomain.domain_age_days });
        return;
      }

      whois.lookup(domain, (err, data) => {
        if (err) {
          const error: EmailStatusType = {
            status: EmailStatus.INVALID_DOMAIN,
            reason: EmailReason.DOMAIN_NOT_FOUND,
          };
          reject(error);
          return;
        }

        try {
          const parsedData = parseWhois.parseWhoIsData(data);
          const domainAge = parsedData.find(
            (p) => p.attribute === 'Creation Date',
          );
          const creationDate = domainAge?.value;

          if (!creationDate) {
            const error: EmailStatusType = {
              status: EmailStatus.INVALID_DOMAIN,
              reason: EmailReason.DOMAIN_WHOIS_DATA_NOT_FOUND,
            };
            reject(error);
            return;
          }

          const registrationDate = new Date(creationDate);
          const ageInDays =
            (Date.now() - registrationDate.getTime()) / (1000 * 60 * 60 * 24);

          resolve({
            domain_age_days: Math.floor(ageInDays),
          });
        } catch (err) {
          const error: EmailStatusType = {
            status: EmailStatus.INVALID_DOMAIN,
            reason: EmailReason.DOMAIN_WHOIS_PARSE_ERROR,
          };
          reject(error);
          return;
        }
      });
    });
  }

  async checkDomainMxRecords(
    domain: string,
    dbDomain: Domain,
  ): Promise<any> {
    return new Promise(async (resolve, reject) => {
      // Check if mx record saveBulkFile time is pass 30 days or not.
      // If yes - then revalidate mx records to make sure it is still valid
      // If not - then continue using it
      if (dbDomain) {
        const dayPassedSinceLastMxCheck = differenceInDays(
          new Date(),
          dbDomain.created_at,
        );
        if (dayPassedSinceLastMxCheck < MX_RECORD_CHECK_DAY_GAP) {
          resolve(JSON.parse(dbDomain.mx_record_hosts));
          return;
        }
      }

      // TODO - These 2 check takes more resources and disabled for now
      // const aRecords = await dns.promises.resolve(domain, 'A').catch(() => []);
      // const aaaaRecords = await dns.promises.resolve(domain, 'AAAA').catch(() => []);
      const mxRecords = await dns.promises.resolveMx(domain).catch(() => []);
      // TODO - These check takes more resources and disabled for now
      // If all records are empty, no DNS entries exist
      // if (aRecords.length === 0 && aaaaRecords.length === 0 && mxRecords.length === 0) {
      //    reject({ status: 'invalid', reason: 'no_dns_entries' });
      // }

      // TODO - These 2 check takes more resources and disabled for now
      // If all records are empty, no DNS entries exist
      // if (aRecords.length !== 0 && aaaaRecords.length !== 0 && mxRecords.length === 0) {
      if (mxRecords.length === 0) {
        const error: EmailStatusType = {
          status: EmailStatus.INVALID,
          reason: EmailReason.NO_MX_FOUND,
        };
        reject(error);

        return;
      }

      mxRecords.sort((a, b) => a.priority - b.priority);

      // If the domain is already saved but mx_record is new then we update our record
      if (dbDomain) {
        dbDomain.mx_record_hosts = JSON.stringify(mxRecords);
        await dbDomain.save();
      }

      resolve(mxRecords);
    });
  }

  async catchAllCheck(email, mxHost) {
    return new Promise(async (resolve, reject) => {
      try {
        const catchAllResponse: EmailStatusType = await this.verifySmtp(
          email,
          mxHost,
        );
        if (catchAllResponse.status === EmailStatus.VALID) {
          const error: EmailStatusType = {
            status: EmailStatus.CATCH_ALL,
            reason: EmailReason.EMPTY,
          };
          reject(error);

          return;
        }
        resolve(catchAllResponse);
      } catch (e) {
        resolve(e);
      }
    });
  }

  async verifySmtp(email: string, mxHost: string): Promise<EmailStatusType> {
    return new Promise((resolve, reject) => {
      let socket = net.createConnection(25, mxHost);
      socket.setEncoding('ascii');
      socket.setTimeout(5000);
      const fromEmail = 'tuhin.world@gmail.com';
      let dataStr = '';
      const commands = [
        `EHLO ${mxHost}`,
        `MAIL FROM: <${fromEmail}>`,
        `RCPT TO: <${email}>`,
        `QUIT`,
      ];

      console.log(email);

      let stage = 0;

      socket.on('connect', () => {
        socket.write(`${commands[stage++]}\r\n`);
      });

      // https://en.wikipedia.org/wiki/List_of_SMTP_server_return_codes
      // Parse the SMTP response based on response code listed above
      socket.on('data', (data) => {
        dataStr = data.toString();
        console.log(data);
        console.log({ stage });

        if (data.includes(SMTPResponseCode.TWO_50.smtp_code) && stage < commands.length) {
          // Check if the socket is writable before writing
          if (socket.writable) {
            socket.write(`${commands[stage++]}\r\n`);
          }
        } else if (data.includes(SMTPResponseCode.TWO_51.smtp_code)) {
          this.closeSmtpConnection(socket);
          const smailStatus: EmailStatusType = SMTPResponseCode.TWO_51;
          resolve(smailStatus);
          return;
        } else if (
          data.includes(SMTPResponseCode.FIVE_50.smtp_code) ||
          data.includes(SMTPResponseCode.FIVE_56.smtp_code) ||
          data.includes(SMTPResponseCode.FIVE_05.smtp_code) ||
          data.includes(SMTPResponseCode.FIVE_51.smtp_code) ||
          data.includes(SMTPResponseCode.FIVE_00.smtp_code)
        ) {
          this.closeSmtpConnection(socket);
          let error: EmailStatusType = { reason: undefined, status: undefined };
          this.winstonLoggerService.error(`(500,556,505,551,550) - ${email}`, dataStr);

          // Check if "data" has any of the strings from 'ipBlockedStringsArray'
          for (const str of ipBlockedStringsArray) {
            if (data.includes(str)) {
              error.status = EmailStatus.SERVICE_UNAVAILABLE;
              error.reason = EmailReason.IP_BLOCKED;
              reject(error);
              return;
            }
          }

          error = SMTPResponseCode.FIVE_50;
          reject(error);
          return;
        } else if (
          // Detect Gray listing (Temporary Failures)
          data.includes(SMTPResponseCode.FOUR_21.smtp_code) ||
          data.includes(SMTPResponseCode.FOUR_50.smtp_code) ||
          data.includes(SMTPResponseCode.FOUR_51.smtp_code) ||
          data.includes(SMTPResponseCode.FOUR_52.smtp_code)
        ) {
          this.closeSmtpConnection(socket);
          const error: EmailStatusType = SMTPResponseCode.FOUR_21;
          reject(error);
          return;
        } else if (data.includes(SMTPResponseCode.FIVE_53.smtp_code)) {
          this.closeSmtpConnection(socket);
          const error: EmailStatusType = SMTPResponseCode.FIVE_53;
          reject(error);
          return;
        } else if (data.includes(SMTPResponseCode.FIVE_54.smtp_code)) {
          this.closeSmtpConnection(socket);
          const emailStatus: EmailStatusType = SMTPResponseCode.FIVE_54;
          reject(emailStatus);
          return;
        } else if (stage === commands.length) {
          this.closeSmtpConnection(socket);
          const smailStatus: EmailStatusType = {
            status: EmailStatus.VALID,
            reason: EmailReason.EMPTY,
          };
          resolve(smailStatus);
          return;

        } else {
          // When no other condition is true, handle it for all other codes
          // Response code starts with "4" - Temporary error, and we should retry later
          // Response code starts with "5" - Permanent error and must not retry
          if (dataStr) {
            // Log the response
            if (!dataStr.startsWith('2')) {
              this.winstonLoggerService.error(`verifySmtp() else - ${email}`, dataStr);
            }

            if (dataStr.startsWith('4')) {
              const emailStatus: EmailStatusType = SMTPResponseCode.FOUR_51;
              reject(emailStatus);
              return;
            } else if (dataStr.startsWith('5')) {
              const emailStatus: EmailStatusType = SMTPResponseCode.FIVE_50;
              console.log(emailStatus);
              reject(emailStatus);
              return;
            }
          }
        }
      });

      socket.on('close', () => {
        console.log('Closing...', stage, commands.length);
        // If the socket is closed by the SMTP server without letting us complete
        // all commands then it probably blocked our IP. But if all commands
        // completed and SMTP response has code above 400, the email address is invalid
        if (dataStr && stage === commands.length) {
          const responseCode = parseInt(dataStr.substring(0, 3));
          if (responseCode >= 400) {
            const error: EmailStatusType = {
              status: EmailStatus.INVALID,
              reason: EmailReason.DOES_NOT_ACCEPT_MAIL,
            };
            reject(error);
          }
        } else {
          const error: EmailStatusType = {
            status: EmailStatus.SERVICE_UNAVAILABLE,
            reason: EmailReason.IP_BLOCKED,
          };
          reject(error);
        }
        return;
      });

      socket.on('error', (err) => {
        // Log the error
        this.winstonLoggerService.error(`verifySmtp() error - ${email}`, JSON.stringify(err));
        this.closeSmtpConnection(socket);
        // Detect if the connection is blocked
        if (err.message.includes('ECONNREFUSED') || err.message.includes('EHOSTUNREACH')) {
          reject({ status: EmailStatus.SERVICE_UNAVAILABLE, reason: EmailReason.IP_BLOCKED });
        } else {
          reject({ status: EmailStatus.UNKNOWN, reason: err.message });
        }
        return;
      });

      socket.on('timeout', () => {
        // Log the error
        this.winstonLoggerService.error(`verifySmtp() timeout - ${email}`, dataStr);

        this.closeSmtpConnection(socket);
        const emailStatus: EmailStatusType = {
          status: EmailStatus.UNKNOWN,
          reason: EmailReason.SMTP_TIMEOUT,
        };
        resolve(emailStatus);
        return;
      });
    });
  }

  private __parseEmailResponseData(
    data: string,
    email: string,
  ): EmailStatusType {
    if (data.includes(SMTPResponseCode.TWO_50.smtp_code.toString())) {
      return SMTPResponseCode.TWO_50;
    } else if (data.includes(SMTPResponseCode.TWO_51.smtp_code.toString())) {
      return SMTPResponseCode.TWO_51;
    } else if (
      data.includes(SMTPResponseCode.FIVE_50.smtp_code.toString()) ||
      data.includes(SMTPResponseCode.FIVE_56.smtp_code.toString()) ||
      data.includes(SMTPResponseCode.FIVE_05.smtp_code.toString()) ||
      data.includes(SMTPResponseCode.FIVE_51.smtp_code.toString()) ||
      data.includes(SMTPResponseCode.FIVE_00.smtp_code.toString())
    ) {
      let error: EmailStatusType = { reason: undefined, status: undefined };
      this.winstonLoggerService.error(`(500,556,505,551,550) - ${email}`, data);

      // Check if "data" has any of the strings from 'ipBlockedStringsArray'
      for (const str of ipBlockedStringsArray) {
        if (data.includes(str)) {
          error.status = EmailStatus.SERVICE_UNAVAILABLE;
          error.reason = EmailReason.IP_BLOCKED;
          return error;
        }
      }

      return SMTPResponseCode.FIVE_50;
    } else if (
      // Detect Gray listing (Temporary Failures)
      data.includes(SMTPResponseCode.FOUR_21.smtp_code.toString()) ||
      data.includes(SMTPResponseCode.FOUR_50.smtp_code.toString()) ||
      data.includes(SMTPResponseCode.FOUR_51.smtp_code.toString()) ||
      data.includes(SMTPResponseCode.FOUR_52.smtp_code.toString())
    ) {
      return SMTPResponseCode.FOUR_21;
    } else if (data.includes(SMTPResponseCode.FIVE_53.smtp_code.toString())) {
      return SMTPResponseCode.FIVE_53;
    } else if (data.includes(SMTPResponseCode.FIVE_54.smtp_code.toString())) {
      return SMTPResponseCode.FIVE_54;
    } else {
      console.log(data);
      // When no other condition is true, handle it for all other codes
      // Response code starts with "4" - Temporary error, and we should retry later
      // Response code starts with "5" - Permanent error and must not retry
      if (data) {
        // Log the response
        if (!data.startsWith('2')) {
          this.winstonLoggerService.error(`verifySmtp() else - ${email}`, data);
        }

        if (data.startsWith('4')) {
          return SMTPResponseCode.FOUR_51;
        } else if (data.startsWith('5')) {
          return SMTPResponseCode.FIVE_50;
        }
      }
    }

  }

  checkDomainSpamDatabaseList(domain: string) {
    return new Promise((resolve, reject) => {
      const dnsbl = new DNSBL(domain);

      dnsbl.on('error', function(error, blocklist) {
      });
      dnsbl.on('data', async function(result, blocklist) {
        if (result.status === 'listed') {
          const error: EmailStatusType = {
            status: EmailStatus.SPAMTRAP,
            reason: EmailReason.EMPTY,
          };
          reject(error);
          return;
        }
      });
      dnsbl.on('done', function() {
        resolve(true);
      });
    });
  }

  async isRoleBasedEmail(email) {
    return new Promise(async (resolve, reject) => {
      const localPart = email.split('@')[0].toLowerCase();
      const isRoleBased: EmailRole =
        await this.emailRolesService.findOne(localPart);
      if (isRoleBased) {
        const error: EmailStatusType = {
          status: EmailStatus.DO_NOT_MAIL,
          reason: EmailReason.ROLE_BASED,
        };
        reject(error);
        return;
      }
      resolve(true);
    });
  }

  async isDisposableDomain(domain) {
    return new Promise(async (resolve, reject) => {
      const isDisposable =
        await this.disposableDomainsService.findByDomain(domain);
      if (isDisposable) {
        const error: EmailStatusType = {
          status: EmailStatus.DO_NOT_MAIL,
          reason: EmailReason.DISPOSABLE_DOMAIN,
        };
        reject(error);
        return;
      }
      resolve(true);
    });
  }

  async domainTypoCheck(domain) {
    return new Promise((resolve, reject) => {
      const domainHasTypo = new DomainTypoChecker().check(domain);
      if (domainHasTypo) {
        const error: EmailStatusType = {
          status: EmailStatus.INVALID,
          reason: EmailReason.POSSIBLE_TYPO,
        };
        reject(error);
        return;
      }
      resolve(true);
    });
  }

  private closeSmtpConnection(socket) {
    if (socket.readyState === 'open') {
      socket.write('QUIT\r\n');
      socket.end();
    }
  }

  async smtpValidation(email: string, user: User, bulkFileId = null) {
    let emailStatus: EmailValidationResponseType = {
      email_address: email,
      verify_plus: false,
    };

    // Check if we processed the email today.
    // If we did then just return the previous result
    const processedEmail: ProcessedEmail = await this.getProcessedEmail(email);
    if (processedEmail) {
      console.log(processedEmail.email_address);
      // Delete these property so these are not included in the final response.
      delete processedEmail.id;
      delete processedEmail.user_id;
      delete processedEmail.bulk_file_id;
      delete processedEmail.created_at;
      delete processedEmail.retry;
      emailStatus = { ...emailStatus, ...processedEmail };
      return emailStatus;
    } else {
      console.log('Processed email not found for ' + email);
    }

    try {
      // Step - 1 : Check email syntax validity
      await this.validateEmailFormat(email);

      // Get domain part from the email address
      const [account, domain] = email.split('@');
      emailStatus.account = account;
      emailStatus.domain = domain;

      // Query DB to check if domain found in error_domains
      const dbErrorDomain: ErrorDomain = await this.findErrorDomain(domain);

      // Query DB for existing domain check
      let dbDomain: Domain = await this.findOne(domain);

      // Check if domain is one of free email providers.
      // If Yes - We SKIP,
      // skip role based check,
      // domain disposable check,
      // black list check,
      // domain typo check and
      // catch-all domain check.
      const isFreeEmailDomain = freeEmailProviderList.includes(domain);
      emailStatus.free_email = isFreeEmailDomain;
      if (!isFreeEmailDomain) {
        // Step - 2 : Check email is role based
        // Ex - contact@domain.com
        // We mark these as 'role_based' as these emails might be valid but
        // high chance of not getting any reply back.
        await this.isRoleBasedEmail(email);

        // Step - 3 : Check email is a temporary email
        await this.isDisposableDomain(domain);

        // Step - 4 : Check if the domain is one of DNSBL domain
        // Hint - Domain Name System Blacklists, also known as DNSBL's or DNS Blacklists,
        // are spam blocking lists. They allow a website administrator to block
        // messages from specific systems that have a history of sending spam.
        // These lists are based on the Internet's Domain Name System, or DNS.
        await this.checkDomainSpamDatabaseList(domain);

        // Step - 5 : Check if the domain name is very similar to another popular domain
        // Usually these domains are used for spam or spam-trap.
        await this.domainTypoCheck(domain);
      }

      // Step 7 : Get the MX records of the domain
      const allMxRecordHost: MXRecord[] = await this.checkDomainMxRecords(
        domain,
        dbDomain,
      );

      const index = Math.floor(Math.random() * allMxRecordHost.length);
      const mxRecordHost = allMxRecordHost[index].exchange;
      // Save The domain if it is not already saved
      if (!dbDomain) {
        const createDomainDto: CreateDomainDto = {
          domain,
          domain_age_days: null,
          mx_record_hosts: JSON.stringify(allMxRecordHost),
          domain_ip: '',
        };
        await this.create(createDomainDto);
      }

      if (!isFreeEmailDomain) {
        // Step 8 : Check if the mail server smtpResponse 'ok' for an abnormal email that does not exist.
        // This means the domain accepts any email address as valid
        // We mark these as 'catch_all' as the email is valid but
        // high chance of not getting any reply back.
        const catchAllEmail = `${randomStringGenerator()}${Date.now()}@${domain}`;
        const catchAllResponse: any = await this.catchAllCheck(catchAllEmail, mxRecordHost);
        console.log({ catchAllResponse });
        // If catchall check response timeout then
        // if (catchAllResponse.reason === EmailReason.SMTP_TIMEOUT) {
        //   // If timeout then we must trigger Verify+ (like zerobounce)
        //   // If catch-all email response is a 'timeout' then we can immediately trigger Verify+
        //   // Because we can not connect to regular SMTP to the
        //   // original email as it will 'timeout' as well. Once we get the response from Verify+,
        //   // We can save the response and stop the process as we already received the status.
        //   const verifyPlusResponse: EmailStatusType = await this.__sendVerifyPlusEmail(catchAllEmail);
        //   emailStatus.email_status = verifyPlusResponse.status;
        //   emailStatus.email_sub_status = verifyPlusResponse.reason;
        //   await this.saveProcessedEmail(emailStatus, user, bulkFileId);
        //   return emailStatus;
        // }
      }
      // Step 9 : Make a SMTP Handshake to very if the email address exist in the mail server
      // If email exist then we can confirm the email is valid
      const smtpResponse: EmailStatusType = await this.verifySmtp(
        email,
        mxRecordHost,
      );
      // If - User enabled verify+ and it's a free email and smtp response
      // is a 'timeout' then we must trigger Verify+
      // If timeout then we must trigger Verify+ (like zerobounce)
      if (user.verify_plus && smtpResponse.reason === EmailReason.SMTP_TIMEOUT) {
        const verifyPlusResponse: EmailStatusType = await this.__sendVerifyPlusEmail(email);
        emailStatus.email_status = verifyPlusResponse.status;
        emailStatus.email_sub_status = verifyPlusResponse.reason;
        emailStatus.verify_plus = true;
      } else {
        emailStatus.email_status = smtpResponse.status;
        emailStatus.email_sub_status = smtpResponse.reason;
      }


      // Step - 6 : Check domain whois database to make sure everything is in good shape
      if (
        smtpResponse.status === EmailStatus.VALID ||
        smtpResponse.status === EmailStatus.UNKNOWN ||
        smtpResponse.status === EmailStatus.CATCH_ALL
      ) {
        // const domainInfo: any = await this.getDomainAge(domain, dbDomain);
        // dbDomain.domain_age_days = domainInfo.domain_age_days;
        // await dbDomain.save();

        // emailStatus.domain_age_days = domainInfo.domain_age_days;
        emailStatus.retry = RetryStatus.COMPLETE;
      }
      await this.saveProcessedEmail(emailStatus, user, bulkFileId);
      // If everything goes well, then return the emailStatus
      return emailStatus;
    } catch (error) {
      emailStatus.email_status = error['status'];
      emailStatus.email_sub_status = error['reason'];
      emailStatus.free_email = freeEmailProviderList.includes(
        emailStatus.domain,
      );
      await this.saveProcessedErrorEmail(emailStatus, error, email, user, bulkFileId);

      return emailStatus;
    }
  }

  private async __sendVerifyPlusEmail(email: string) {
    const emailData: SendMailOptions = {
      fromEmail: this.configService.get<string>('VERIFY_PLUS_FROM_EMAIL'),
      to: email,
      headers: {
        // This header allow us tracking email delivery status.
        'X-SES-CONFIGURATION-SET': 'Default',
      },
      subject: '',
      template: 'email_verify+',
      context: {},
      attachments: [],
    };
    const emailResponse = await this.mailerService.sendEmail(emailData);
    console.log('Verify+');
    console.log({ emailResponse });
    return this.__parseEmailResponseData(emailResponse.response, email);
  }

  async saveProcessedErrorEmail(
    emailStatus: EmailValidationResponseType,
    error: { reason: EmailReason; },
    email: string,
    user: User,
    bulkFileId,
  ) {
    try {
      await this.saveProcessedEmail(emailStatus, user, bulkFileId);
      // If the email is a free email OR Error reasons
      // DO NOT confirm the domain has issues. Other emails
      // from the same domain might be valid.
      // So we do not save the domain into error_domains
      const skipReasons = [
        EmailReason.ROLE_BASED,
        EmailReason.INVALID_EMAIL_FORMAT,
        EmailReason.UNVERIFIABLE_EMAIL,
        EmailReason.MAILBOX_NOT_FOUND,
        EmailReason.IP_BLOCKED,
        EmailReason.SMTP_TIMEOUT,
      ];
      if (
        emailStatus.free_email ||
        (error.reason && skipReasons.includes(error.reason))
      ) {
        return emailStatus;
      }

      const domain = email.split('@')[1];
      const errorDomain: any = {
        domain,
        domain_error: error,
      };
      await this.createOrUpdateErrorDomain(errorDomain);
    } catch (e) {
      this.winstonLoggerService.error(`saveProcessedErrorEmail() - ${email}`, JSON.stringify(e));

      return e;
    }
  }
}
