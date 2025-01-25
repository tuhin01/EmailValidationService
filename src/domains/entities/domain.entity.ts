import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('domains') // sql table name === 'domains'
export class Domain extends BaseEntity {
  // @PrimaryGeneratedColumn()
  // id: number;

  @PrimaryColumn({ type: 'varchar', length: 255 })
  domain: string;

  @Column({ nullable: true, type: 'varchar', length: 64 })
  domain_ip: string;

  @Column()
  domain_age_days: number;

  @Column({ nullable: true })
  mx_record_host: string;

  @CreateDateColumn({ type: 'timestamptz' })
  readonly created_at: Date;
}

// SQl Query to create Hash Index
// `CREATE INDEX CONCURRENTLY domain_hash_index on domains USING HASH (domain)`
