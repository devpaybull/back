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
import { Country } from '../../countries/entities/country.entity';

@Entity('mobile_operators')
export class MobileOperator {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  code: string;

  @Column()
  name: string;

  @ManyToOne(() => Country, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'countryId' })
  country: Country;

  @Index()
  @Column({ type: 'int' })
  countryId: number;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
