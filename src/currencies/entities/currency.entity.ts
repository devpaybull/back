import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Country } from '../../countries/entities/country.entity';

@Entity('currencies')
export class Currency {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Index({ unique: true })
  @Column()
  isocode: string;

  @ManyToOne(() => Country, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'countryId' })
  country: Country;

  @Column({ type: 'int' })
  countryId: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
