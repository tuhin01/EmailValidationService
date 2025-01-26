import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
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
  ERROR_DOMAIN_CHECK_DAY_GAP,
  MX_RECORD_CHECK_DAY_GAP,
  SPAM_DB_CHECK_DAY_GAP,
} from '../../common/utility/constant';
import { DisposableDomainsService } from '../../disposable-domains/disposable-domains.service';
import { EmailRolesService } from '../../email-roles/email-roles.service';
import { EmailRole } from '../../email-roles/entities/email-role.entity';
import { ErrorDomain } from '../entities/error_domain.entity';
import { EmailReason, EmailStatus, EmailStatusType } from '../../common/utility/email-status-type';

@Injectable()
export class DomainService {
  constructor(
    private dataSource: DataSource,
    private disposableDomainsService: DisposableDomainsService,
    private emailRolesService: EmailRolesService,
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
      if (errorDomain.domain_error['status'] !== existingDomain.domain_error['status']) {
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
      // Check if mx record save time is pass 30 days or not.
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
        const isCatchAllValid: EmailStatusType = await this.verifySmtp(email, mxHost);
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

      const commands = [
        `EHLO ${mxHost}`,
        `MAIL FROM: <tuhin.world@gmail.com>`,
        `RCPT TO: <${email}>`,
      ];

      let stage = 0;

      socket.on('connect', () => {
        socket.write(`${commands[stage++]}\r\n`);
      });

      socket.on('data', (data) => {
        // console.log(data);
        if (data.includes('250') && stage < commands.length) {
          socket.write(`${commands[stage++]}\r\n`);
        } else if (data.includes('550')) {
          this.closeSmtpConnection(socket);
          const error: EmailStatusType = {
            status: EmailStatus.INVALID,
            reason: EmailReason.MAILBOX_NOT_FOUND,
          };
          reject(error);
          return;
        } else if (stage === commands.length) {
          this.closeSmtpConnection(socket);
          const smailStatus: EmailStatusType = {
            status: EmailStatus.VALID,
            reason: EmailReason.EMPTY,
          };
          resolve(smailStatus);
          return;
        }
      });

      socket.on('error', (err) => {
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
      const isRoleBased: EmailRole = await this.emailRolesService.findOne(localPart);
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
    socket.write('QUIT\r\n');
    socket.end();
  }
}
