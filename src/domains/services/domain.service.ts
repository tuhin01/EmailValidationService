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
import roles from '../../common/utility/roles';
import DomainTypoChecker from '../../common/utility/domain-typo-checker';
import { differenceInDays } from 'date-fns';
import { MX_RECORD_CHECK_DAY_GAP } from '../../common/utility/constant';
import { DisposableDomainsService } from '../../disposable-domains/disposable-domains.service';
import { EmailRolesService } from '../../email-roles/email-roles.service';
import { EmailRole } from '../../email-roles/entities/email-role.entity';

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
    const existingDomain = await Domain.findOneBy({ domain });
    if (!existingDomain) {
      throw new NotFoundException(`Domain ${domain} not found`);
    }
    return existingDomain;
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
        reject({
          status: 'invalid',
          reason: 'invalid_email_format',
        });
      }
      resolve(true);
    });
  }

  // Perform WHOIS lookup for domain age
  async getDomainAge(domain, dbDomain: Domain) {
    return new Promise((resolve, reject) => {
      if (dbDomain) {
        resolve({ domain_age_days: dbDomain.domain_age_days });
      }

      whois.lookup(domain, (err, data) => {
        if (err)
          reject({
            status: 'invalid_domain',
            reason: 'domain_not_found',
          });

        try {
          const parsedData = parseWhois.parseWhoIsData(data);
          // console.log({parsedData})
          const domainAge = parsedData.find(
            (p) => p.attribute === 'Creation Date',
          );
          const creationDate = domainAge?.value;

          if (!creationDate) {
            reject({
              status: 'invalid_domain',
              reason: 'domain_whois_data_not_found',
            });
          }

          const registrationDate = new Date(creationDate);
          const ageInDays =
            (Date.now() - registrationDate.getTime()) / (1000 * 60 * 60 * 24);

          resolve({
            // creation_date: registrationDate.toISOString(),
            domain_age_days: Math.floor(ageInDays),
          });
        } catch (err) {
          reject({
            status: 'invalid_domain',
            reason: 'domain_whois_data__parse_error',
          });
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
        console.log({ dayPassedSinceLastMxCheck });
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
        reject({ status: 'invalid', reason: 'does_not_accept_mail' });
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
    return new Promise(async (resolve, reject) => {
      try {
        const isCatchAllValid = await this.verifySmtp(email, mxHost);
        if (isCatchAllValid['status'] === 'valid') {
          reject({ status: 'catch-all', reason: '' });
          return;
        }
        resolve(true);
      } catch (e) {
        resolve(e);
      }
    });
  }

  async verifySmtp(email, mxHost) {
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
          reject({
            status: 'invalid',
            reason: 'mailbox_not_found',
          });
          return;
        } else if (stage === commands.length) {
          this.closeSmtpConnection(socket);
          resolve({
            status: 'valid',
            reason: '',
          });
          return;
        }
      });

      socket.on('error', (err) => {
        this.closeSmtpConnection(socket);
        reject({
          status: 'unknown',
          reason: err.message,
        });
        return;
      });

      socket.on('timeout', () => {
        this.closeSmtpConnection(socket);
        reject({
          status: 'unknown',
          reason: 'smtp_connection_timeout',
        });
        return;
      });
    });
  }

  checkDomainSpamDatabaseList(domain) {
    return new Promise((resolve, reject) => {
      const uribl = new DNSBL(domain);

      uribl.on('error', function(error, blocklist) {
      });
      uribl.on('data', function(result, blocklist) {
        // console.log(result.status + ' in ' + blocklist.zone);
        if (result.status === 'listed') {
          reject({ status: 'spamtrap', reason: '' });
          return;
        }
      });
      uribl.on('done', function() {
        resolve(true);
      });
    });
  }

  async isRoleBasedEmail(email) {
    return new Promise(async (resolve, reject) => {
      const localPart = email.split('@')[0].toLowerCase();
      const isRoleBased: EmailRole = await this.emailRolesService.findOne(localPart);
      if (isRoleBased) {
        reject({ status: 'do_not_mail', reason: 'role_based' });
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
        reject({
          status: 'do_not_mail',
          reason: 'disposable_domain_temporary_email',
        });
        return;
      }
      resolve(true);
    });
  }

  async domainTypoCheck(domain) {
    return new Promise((resolve, reject) => {
      const domainHasTypo = new DomainTypoChecker().check(domain);
      if (domainHasTypo) {
        reject({ status: 'invalid', reason: 'possible_typo' });
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
