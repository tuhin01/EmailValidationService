import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('processed_emails') // sql table name === 'domains'
export class ProcessedEmail extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  @Index({ unique: true })
  email_address: string;

  @Column({ type: 'int', nullable: true })
  user_id: number;

  @Column({ type: 'int', nullable: true })
  bulk_file_id: number;

  @Column({ type: 'varchar', length: 255 })
  account: string;

  @Column({ type: 'varchar', length: 255 })
  domain: string;

  @Column({ type: 'varchar', length: 255 })
  email_status: string;

  @Column({ type: 'varchar', length: 255 })
  email_sub_status: string;

  @Column({ type: 'int', nullable: true })
  domain_age_days: number;

  @Column({ type: 'boolean' })
  free_email: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

// SQl Query to create Hash Index
// `CREATE INDEX CONCURRENTLY email_hash_index on domains USING HASH (email_address)`
