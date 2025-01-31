import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Domain } from '../entities/domain.entity';
import { CreateDomainDto } from '../dto/create-domain.dto';
import { UpdateDomainDto } from '../dto/update-domain.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { DataSource } from 'typeorm';
import * as whois from 'whois';
import * as parseWhois from 'parse-whois';
import * as dns from 'dns';
import * as net from 'node:net';
import { DNSBL } from '../../common/utility/dnsbl';
import DomainTypoChecker from '../../common/utility/domain-typo-checker';
import { differenceInDays } from 'date-fns';
import {
  CATCH_ALL_CHECK_DAY_GAP,
  CATCH_ALL_EMAIL,
  ERROR_DOMAIN_CHECK_DAY_GAP,
  MX_RECORD_CHECK_DAY_GAP,
  PROCESSED_EMAIL_CHECK_DAY_GAP,
  SPAM_DB_CHECK_DAY_GAP,
} from '../../common/utility/constant';
import { DisposableDomainsService } from '../../disposable-domains/disposable-domains.service';
import { EmailRolesService } from '../../email-roles/email-roles.service';
import { EmailRole } from '../../email-roles/entities/email-role.entity';
import { ErrorDomain } from '../entities/error_domain.entity';
import {
  EmailReason,
  EmailStatus,
  EmailStatusType,
  EmailValidationResponseType,
  SMTPResponseCode,
} from '../../common/utility/email-status-type';
import freeEmailProviderList from '../../common/utility/free-email-provider-list';
import { ProcessedEmail } from '../entities/processed_email.entity';

@Injectable()
export class DomainService {
  constructor(
    private dataSource: DataSource,
    private disposableDomainsService: DisposableDomainsService,
    private emailRolesService: EmailRolesService,
  ) {}

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

  async saveProcessedEmail(processedEmail: EmailValidationResponseType) {
    const existingDomain = await ProcessedEmail.findOneBy({
      email_address: processedEmail.email_address,
    });
    if (!existingDomain) {
      const dbProcessedEmail: ProcessedEmail = ProcessedEmail.create({
        ...processedEmail,
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
      if (dayPassedSinceLastMxCheck < PROCESSED_EMAIL_CHECK_DAY_GAP) {
        return processedEmail;
      } else {
        return null;
      }
    }
    return null;
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
  ): Promise<string> {
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
          console.log('NOT Saving MX...');
          resolve(dbDomain.mx_record_host);
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
          reason: EmailReason.DOES_NOT_ACCEPT_MAIL,
        };
        reject(error);

        return;
      }

      mxRecords.sort((a, b) => a.priority - b.priority);
      const latest_mx_record = mxRecords[0].exchange;

      // If the domain is already saved but mx_record is new then we update our record
      if (dbDomain) {
        console.log('Updating MX...');
        dbDomain.mx_record_host = latest_mx_record;
        await dbDomain.save();
      }

      resolve(latest_mx_record);
    });
  }

  async catchAllCheck(email, mxHost) {
    console.log('check catch all...');
    return new Promise(async (resolve, reject) => {
      try {
        const isCatchAllValid: EmailStatusType = await this.verifySmtp(
          email,
          mxHost,
        );
        console.log({ isCatchAllValid });
        if (isCatchAllValid.status === EmailStatus.VALID) {
          const error: EmailStatusType = {
            status: EmailStatus.CATCH_ALL,
            reason: EmailReason.EMPTY,
          };
          reject(error);

          return;
        }
        resolve(true);
      } catch (e) {
        resolve(e);
      }
    });
  }

  async verifySmtp(email: string, mxHost: string): Promise<EmailStatusType> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(25, mxHost);
      socket.setEncoding('ascii');
      socket.setTimeout(5000);
      console.log({ email });
      const commands = [
        `EHLO ${mxHost}`,
        `MAIL FROM: <${email}>`,
        `RCPT TO: <${email}>`,
      ];

      let stage = 0;

      socket.on('connect', () => {
        socket.write(`${commands[stage++]}\r\n`);
      });

      // https://en.wikipedia.org/wiki/List_of_SMTP_server_return_codes
      // Parse the SMTP response based on response code listed above
      // socket.on('data', (data) => {
      //   console.log(data);
      //   if (data.includes(SMTPResponseCode.TWO_50.smtp_code) && stage < commands.length) {
      //     socket.write(`${commands[stage++]}\r\n`);
      //   } else if (data.includes(SMTPResponseCode.FIVE_50.smtp_code)) {
      //     this.closeSmtpConnection(socket);
      //     const error: EmailStatusType = SMTPResponseCode.FIVE_50;
      //     reject(error);
      //     return;
      //   } else if (data.includes(SMTPResponseCode.FOUR_21.smtp_code)) {
      //     this.closeSmtpConnection(socket);
      //     const error: EmailStatusType = SMTPResponseCode.FOUR_21;
      //     reject(error);
      //     return;
      //   } else if (data.includes(SMTPResponseCode.FIVE_53.smtp_code)) {
      //     this.closeSmtpConnection(socket);
      //     const error: EmailStatusType = SMTPResponseCode.FIVE_53;
      //     reject(error);
      //     return;
      //   } else if (stage === commands.length) {
      //     this.closeSmtpConnection(socket);
      //     const smailStatus: EmailStatusType = {
      //       status: EmailStatus.VALID,
      //       reason: EmailReason.EMPTY,
      //     };
      //     resolve(smailStatus);
      //     return;
      //   } else {
      //     const errorData = data.toString();
      //     // When no other condition is true, handle it for all other codes
      //     // Response code starts with "4" - Temporary error, and we should retry later
      //     // Response code starts with "5" - Permanent error and must not retry
      //     if (errorData.startsWith('4') || errorData.startsWith('5')) {
      //       const responseCode: number = parseInt(errorData.substring(0, 3));
      //       const smailStatus: EmailStatusType = {
      //         status: EmailStatus.INVALID,
      //         smtp_code: responseCode,
      //         reason: EmailReason.MAILBOX_NOT_FOUND,
      //         retry: errorData.startsWith('4'),
      //       };
      //       resolve(smailStatus);
      //       return;
      //     }
      //   }
      // });

      socket.on('data', (data) => {
        console.log(data);
        const dataStr = data.toString();

        // Function to handle errors and close the connection
        const handleError = (errorType: EmailStatusType) => {
          this.closeSmtpConnection(socket);
          reject(errorType);
        };

        if (
          dataStr.includes(SMTPResponseCode.TWO_50.smtp_code.toString()) &&
          stage < commands.length
        ) {
          socket.write(`${commands[stage++]}\r\n`);
          return;
        }

        // Handle specific SMTP error codes
        const smtpErrors: Record<string, EmailStatusType> = {
          [SMTPResponseCode.FIVE_50.smtp_code]: SMTPResponseCode.FIVE_50,
          [SMTPResponseCode.FOUR_21.smtp_code]: SMTPResponseCode.FOUR_21,
          [SMTPResponseCode.FIVE_53.smtp_code]: SMTPResponseCode.FIVE_53,
        };

        for (const [code, errorType] of Object.entries(smtpErrors)) {
          if (dataStr.includes(code)) {
            handleError(errorType);
            return;
          }
        }

        // If all commands have been processed successfully
        if (stage === commands.length) {
          this.closeSmtpConnection(socket);
          resolve({
            status: EmailStatus.VALID,
            reason: EmailReason.EMPTY,
          });
          return;
        }

        // General Error Handling for 4xx and 5xx Responses
        const smtpErrorRegex = /^([45]\d{2})/;
        const match = dataStr.match(smtpErrorRegex);
        if (match) {
          const responseCode = parseInt(match[1], 10);
          const isTemporaryError = responseCode >= 400 && responseCode < 500;

          resolve({
            status: EmailStatus.INVALID,
            smtp_code: responseCode,
            reason: EmailReason.MAILBOX_NOT_FOUND,
            retry: isTemporaryError,
          });
        }
      });

      socket.on('close', () => {
        const error: EmailStatusType = {
          status: EmailStatus.INVALID,
          reason: EmailReason.DOES_NOT_ACCEPT_MAIL,
        };
        reject(error);
        return;
      });

      socket.on('error', (err) => {
        console.log(err);
        this.closeSmtpConnection(socket);
        const error: EmailStatusType = {
          status: EmailStatus.UNKNOWN,
          reason: err.message,
        };
        reject(error);
        return;
      });

      socket.on('timeout', () => {
        this.closeSmtpConnection(socket);
        const error: EmailStatusType = {
          status: EmailStatus.UNKNOWN,
          reason: EmailReason.SMTP_TIMEOUT,
        };
        reject(error);
        return;
      });
    });
  }

  checkDomainSpamDatabaseList(domain: string) {
    return new Promise((resolve, reject) => {
      const dnsbl = new DNSBL(domain);

      dnsbl.on('error', function (error, blocklist) {});
      dnsbl.on('data', async function (result, blocklist) {
        if (result.status === 'listed') {
          const error: EmailStatusType = {
            status: EmailStatus.SPAMTRAP,
            reason: EmailReason.EMPTY,
          };
          reject(error);
          return;
        }
      });
      dnsbl.on('done', function () {
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

  async smtpValidation(email: string) {
    const emailStatus: EmailValidationResponseType = {
      email_address: email,
    };

    // Check if we processed the email today.
    // If we did then just return the previous result
    const processedEmail: ProcessedEmail = await this.getProcessedEmail(email);
    if (processedEmail) {
      delete processedEmail.id;
      delete processedEmail.created_at;
      return { ...emailStatus, ...processedEmail };
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
      const mxRecordHost: string = await this.checkDomainMxRecords(
        domain,
        dbDomain,
      );

      // Save The domain if it is not already saved
      if (!dbDomain) {
        const createDomainDto: CreateDomainDto = {
          domain,
          domain_age_days: null,
          mx_record_host: mxRecordHost,
          domain_ip: '',
        };
        dbDomain = await this.create(createDomainDto);
      }

      if (!isFreeEmailDomain) {
        // Step 8 : Check if the mail server smtpResponse 'ok' for an abnormal email that does not exist.
        // This means the domain accepts any email address as valid
        // We mark these as 'catch_all' as the email is valid but
        // high chance of not getting any reply back.
        const catchAllEmail = `${CATCH_ALL_EMAIL}@${domain}`;
        await this.catchAllCheck(catchAllEmail, mxRecordHost);
      }
      // Step 9 : Make a SMTP Handshake to very if the email address exist in the mail server
      // If email exist then we can confirm the email is valid
      const smtpResponse: EmailStatusType = await this.verifySmtp(
        email,
        mxRecordHost,
      );
      emailStatus.email_status = smtpResponse.status;
      emailStatus.email_sub_status = smtpResponse.reason;

      // Step - 6 : Check domain whois database to make sure everything is in good shape
      if (smtpResponse.status === EmailStatus.VALID) {
        const domainInfo: any = await this.getDomainAge(domain, dbDomain);
        emailStatus.domain_age_days = domainInfo.domain_age_days;
        dbDomain.domain_age_days = domainInfo.domain_age_days;
        await dbDomain.save();
      }

      await this.saveProcessedEmail(emailStatus);
      // If everything goes well, then return the emailStatus
      return emailStatus;
    } catch (error) {
      emailStatus.email_status = error['status'];
      emailStatus.email_sub_status = error['reason'];
      emailStatus.free_email = freeEmailProviderList.includes(
        emailStatus.domain,
      );

      await this.saveProcessedErrorEmail(emailStatus, error, email);

      return emailStatus;
    }
  }

  async saveProcessedErrorEmail(
    emailStatus: EmailValidationResponseType,
    error,
    email: string,
  ) {
    try {
      await this.saveProcessedEmail(emailStatus);
      // If the email is a free email OR Error reasons
      // DO NOT confirm the domain has issues. Other emails
      // from the same domain might be valid.
      // So we do not saveBulkFile the domain into error_domains
      const skipReasons = [
        EmailReason.ROLE_BASED,
        EmailReason.INVALID_EMAIL_FORMAT,
        EmailReason.UNVERIFIABLE_EMAIL,
        EmailReason.MAILBOX_NOT_FOUND,
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
      return e;
    }
  }
}
