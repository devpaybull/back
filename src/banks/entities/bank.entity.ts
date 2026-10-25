import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { Country } from '../../countries/entities/country.entity';
import { Currency } from '../../currencies/entities/currency.entity';

@Entity('banks')
export class Bank {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  bankId: string;

  @Column()
  name: string;

  @Index({ unique: true })
  @Column({ nullable: true })
  code: string;

  @ManyToOne(() => Country, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'countryId' })
  country: Country;

  @Column({ type: 'int' })
  countryId: number;

  @Column({ type: 'enum', enum: TransactionType, array: true })
  transactionTypes: TransactionType[];

  @ManyToOne(() => Currency, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'currencyId' })
  currency: Currency;

  @Column({ type: 'int' })
  currencyId: number;

  @ManyToOne(() => Currency, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'crossBorderCurrencyId' })
  crossBorderCurrency: Currency;

  @Column({ type: 'int', nullable: true })
  crossBorderCurrencyId: number;

  @Column({ default: true })
  active: boolean;

  @Column({ default: false })
  automatic: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
