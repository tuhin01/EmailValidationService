import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateDisposableDomainDto } from './dto/create-disposable-domain.dto';
import { UpdateDisposableDomainDto } from './dto/update-disposable-domain.dto';
import { DisposableDomain } from './entities/disposable-domain.entity';
import { DataSource } from 'typeorm';
import { Domain } from '../domains/entities/domain.entity';

@Injectable()
export class DisposableDomainsService {
  constructor(private dataSource: DataSource) {}

  create(createDisposableDomainDto: CreateDisposableDomainDto) {
    return 'This action adds a new disposableDomain';
  }

  findAll() {
    return `This action returns all disposableDomains`;
  }

  async findByDomain(domain: string) {
    return await DisposableDomain.findOneBy({
      domain,
    });
  }

  async createMany(domains: DisposableDomain[]) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.manager.save(DisposableDomain, domains);
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

  update(id: number, updateDisposableDomainDto: UpdateDisposableDomainDto) {
    return `This action updates a #${id} disposableDomain`;
  }

  remove(id: number) {
    return `This action removes a #${id} disposableDomain`;
  }
}
