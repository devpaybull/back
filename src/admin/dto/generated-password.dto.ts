import { ApiProperty } from '@nestjs/swagger';

export class GeneratedPasswordDto {
  @ApiProperty({
    example: 'q8ZtR2mWk4Ya',
    description:
      'Generated on the server and shown once; only its bcrypt hash is stored.',
  })
  password: string;
}
