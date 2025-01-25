import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DomainService } from './services/domain.service';
import { CreateDomainDto } from './dto/create-domain.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Public } from '../common/decorators/public.decorator';
import { Domain } from './entities/domain.entity';
import { seconds, SkipThrottle, Throttle } from '@nestjs/throttler';
import { CATCH_ALL_EMAIL } from '../common/utility/constant';
import { EmailDto } from './dto/email.dto';

@Controller('domains')
export class DomainsController {
  constructor(private readonly domainService: DomainService) {}

  // @Throttle({ default: { limit: 3, ttl: 4 * 1000 } })
  // @Public()
  // @Get()
  // async findAll(@Query() paginationQuery: PaginationQueryDto) {
  //   return this.domainService.findAll(paginationQuery);
  // }

  @Throttle({
    default: { limit: 5, ttl: seconds(5), blockDuration: seconds(1) },
  })
  @Post('validate')
  async validate(@Body() emailDto: EmailDto) {
    const { email } = emailDto;
    try {
      // Step - 1 : Check email syntax validity
      await this.domainService.validateEmailFormat(email);

      // Get domain part from the email address
      const domain = email.split('@')[1];

      // Query DB for existing domain check
      const dbDomain: Domain = await Domain.findOneBy({ domain });

      // Step - 2 : Check email is role based
      // Ex - contact@domain.com
      // We mark these as 'role_based' as these emails might be valid but
      // high chance of not getting any reply back.
      await this.domainService.isRoleBasedEmail(email);

      // Step - 3 : Check email is a temporary email
      await this.domainService.isDisposableDomain(domain);

      // Step - 4 : Check if the domain is one of DNSBL domain
      // Hint - Domain Name System Blacklists, also known as DNSBL's or DNS Blacklists,
      // are spam blocking lists. They allow a website administrator to block
      // messages from specific systems that have a history of sending spam.
      // These lists are based on the Internet's Domain Name System, or DNS.
      await this.domainService.checkDomainSpamDatabaseList(domain);

      // Step - 5 : Check if the domain name is very similar to another popular domain
      // Usually these domains are used for spam or spam-trap.
      await this.domainService.domainTypoCheck(domain);

      // Step - 6 : Check domain whois database to make sure everything is in good shape
      const domainInfo: any = await this.domainService.getDomainAge(
        domain,
        dbDomain,
      );

      // Step 7 : Get the MX records of the domain
      const mxRecordHost: string =
        await this.domainService.checkDomainMxRecords(domain, dbDomain);

      // Step 8 : Check if the mail server response 'ok' for an abnormal email that does not exist.
      // This means the domain accepts any email address as valid
      // We mark these as 'catch_all' as the email is valid but
      // high chance of not getting any reply back.
      const catchAllEmail = `${CATCH_ALL_EMAIL}@${domain}`;
      await this.domainService.catchAllCheck(catchAllEmail, mxRecordHost);

      // Step 9 : Make a SMTP Handshake to very if the email address exist in the mail server
      // If email exist then we can confirm the email is valid
      const response = await this.domainService.verifySmtp(email, mxRecordHost);
      console.log(response);
      if (!dbDomain) {
        console.log('Saving domain...');
        const createDomainDto: CreateDomainDto = {
          domain,
          domain_age_days: domainInfo['domain_age_days'],
          mx_record_host: mxRecordHost,
          domain_ip: '',
        };
        await this.domainService.create(createDomainDto);
      }

      return response;
    } catch (e) {
      return e;
    }
  }

  // @Get(':domain')
  // findOne(@Param('domain') domain: string) {
  //   return this.domainService.findOne(domain);
  // }
  //
  // @Post()
  // async create(@Body() createEmailDto: CreateDomainDto) {
  //   return await this.domainService.create(createEmailDto);
  // }
  //
  // @SkipThrottle()
  // @Post('/create-many')
  // async createMany(@Body() createEmailDtos: Domain[]) {
  //   return await this.domainService.createMany(createEmailDtos);
  // }

  // @Patch(':id')
  // update(
  //   @Param('id', ParseIntPipe) id: number,
  //   @Body() updateEmailDto: UpdateDomainDto,
  // ) {
  //   return this.domainService.update(id, updateEmailDto);
  // }
  //
  // @Delete(':id')
  // async remove(@Param('id', ParseIntPipe) id: number) {
  //   return await this.domainService.remove(id);
  // }
}
