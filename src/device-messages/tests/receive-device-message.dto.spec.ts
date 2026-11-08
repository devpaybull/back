import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MESSAGE_TEXT_MAX_LENGTH } from '../../common/utils/message-text-max-length';
import { ReceiveDeviceMessageDto } from '../dto/receive-device-message.dto';

const valid = {
  externalId: ' sms-1 ',
  kind: 'sms',
  sender: ' 900 ',
  text: 'Зачисление 1000 р',
  receivedAt: '2026-11-08T10:00:00Z',
};

const failedProperties = (given: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(ReceiveDeviceMessageDto, given)).map(
    (error) => error.property,
  );

describe('ReceiveDeviceMessageDto', () => {
  it('accepts a message and trims the id and the sender', () => {
    const dto = plainToInstance(ReceiveDeviceMessageDto, valid);

    expect(validateSync(dto)).toEqual([]);
    expect(dto.externalId).toBe('sms-1');
    expect(dto.sender).toBe('900');
  });

  it.each(['2026-11-08T10:00:00+03:00', '2026-11-08T10:00:00.250Z'])(
    'accepts receivedAt %s',
    (receivedAt) => {
      expect(failedProperties({ ...valid, receivedAt })).toEqual([]);
    },
  );

  it.each(['2026-11-08T10:00', '2026-11-08', 'yesterday'])(
    'refuses receivedAt %s, which has no zone',
    (receivedAt) => {
      expect(failedProperties({ ...valid, receivedAt })).toEqual([
        'receivedAt',
      ]);
    },
  );

  it('refuses a text above the cap, an unknown kind and blanks', () => {
    expect(
      failedProperties({
        ...valid,
        text: 'x'.repeat(MESSAGE_TEXT_MAX_LENGTH + 1),
      }),
    ).toEqual(['text']);
    expect(failedProperties({ ...valid, kind: 'mms' })).toEqual(['kind']);
    expect(
      failedProperties({ ...valid, sender: '  ', externalId: '' }),
    ).toEqual(['externalId', 'sender']);
  });
});
